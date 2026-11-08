//! SQLite storage: schema, page sync (last write wins), history, full-text index.
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MIGRATIONS: &[&str] = &[include_str!("../migrations/001_init.sql")];
const HISTORY_KEEP: i64 = 20;
const HISTORY_MIN_GAP_SECS: i64 = 600;
pub const MAX_CONTENT_BYTES: usize = 2_000_000;

pub fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn d_kind() -> String {
    "page".into()
}
fn d_pos() -> String {
    "a0".into()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Page {
    pub id: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default = "d_kind")]
    pub kind: String,
    #[serde(default = "d_pos")]
    pub position: String,
    #[serde(default)]
    pub content: Option<Value>,
    #[serde(default)]
    pub props: Option<Value>,
    #[serde(default)]
    pub schema: Option<Value>,
    #[serde(default)]
    pub daily_date: Option<String>,
    #[serde(default)]
    pub deleted_at: Option<i64>,
    #[serde(default)]
    pub seq: i64,
    /// Seq the client last saw for this page. Only used on input.
    #[serde(default, skip_serializing)]
    pub base_seq: Option<i64>,
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let v: i64 = conn.query_row("pragma user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        if (i as i64) >= v {
            conn.execute_batch(&format!("begin;\n{sql}\ncommit;"))?;
            conn.pragma_update(None, "user_version", (i + 1) as i64)?;
        }
    }
    Ok(())
}

fn next_seq(tx: &Transaction) -> rusqlite::Result<i64> {
    tx.execute("update meta set value = value + 1 where key = 'seq'", [])?;
    tx.query_row("select value from meta where key = 'seq'", [], |r| r.get(0))
}

fn json_text(v: &Option<Value>) -> Option<String> {
    v.as_ref().and_then(|x| if x.is_null() { None } else { serde_json::to_string(x).ok() })
}

fn parse(s: Option<String>) -> Option<Value> {
    s.and_then(|t| serde_json::from_str(&t).ok())
}

/// Collect plain text from a TipTap/ProseMirror JSON document.
pub fn extract_text(v: &Value, out: &mut String) {
    match v {
        Value::Object(m) => {
            if let Some(Value::String(t)) = m.get("text") {
                out.push_str(t);
            }
            if let Some(c) = m.get("content") {
                extract_text(c, out);
            }
            if m.get("type").and_then(|t| t.as_str()).map_or(false, |t| t != "text") {
                out.push(' ');
            }
        }
        Value::Array(a) => a.iter().for_each(|x| extract_text(x, out)),
        _ => {}
    }
}

/// Blocks that carry no information of their own: empty paragraphs, and the untouched pieces of the
/// daily-note template (the "Tasks" and "Notes" headings and an empty to-do list).
fn is_boilerplate(n: &Value) -> bool {
    let mut text = String::new();
    extract_text(n, &mut text);
    let text = text.trim();
    match n.get("type").and_then(|t| t.as_str()) {
        Some("paragraph") | Some("taskList") => text.is_empty(),
        Some("heading") => text == "Tasks" || text == "Notes",
        _ => false,
    }
}

/// Append the blocks of `incoming` to `existing`, dropping empty paragraphs. Used when two
/// devices create the daily note for the same date while offline.
pub fn merge_docs(existing: Option<Value>, incoming: Option<Value>) -> Option<Value> {
    match (existing, incoming) {
        (Some(mut a), Some(b)) => {
            let extra: Vec<Value> = b
                .get("content")
                .and_then(|c| c.as_array())
                .map(|arr| arr.iter().filter(|n| !is_boilerplate(n)).cloned().collect())
                .unwrap_or_default();
            if let Some(arr) = a.get_mut("content").and_then(|c| c.as_array_mut()) {
                arr.extend(extra);
            }
            Some(a)
        }
        (a, None) => a,
        (None, b) => b,
    }
}

fn index_page(tx: &Transaction, owner: i64, p: &Page) -> rusqlite::Result<()> {
    tx.execute("delete from page_fts where page_id = ?1", [&p.id])?;
    if p.deleted_at.is_none() {
        let mut body = String::new();
        if let Some(c) = &p.content {
            extract_text(c, &mut body);
        }
        tx.execute(
            "insert into page_fts (page_id, owner_id, title, body) values (?1, ?2, ?3, ?4)",
            params![p.id, owner, p.title, body],
        )?;
    }
    Ok(())
}

fn archive(tx: &Transaction, page_id: &str, seq: i64, title: &str, content: Option<&str>, force: bool) -> rusqlite::Result<()> {
    let last: Option<i64> = tx
        .query_row("select max(saved_at) from page_history where page_id = ?1", [page_id], |r| r.get(0))
        .optional()?
        .flatten();
    if !force && last.map_or(false, |t| now() - t < HISTORY_MIN_GAP_SECS) {
        return Ok(());
    }
    tx.execute(
        "insert into page_history (page_id, seq, title, content, saved_at) values (?1, ?2, ?3, ?4, ?5)",
        params![page_id, seq, title, content, now()],
    )?;
    tx.execute(
        "delete from page_history where page_id = ?1 and id not in
           (select id from page_history where page_id = ?1 order by id desc limit ?2)",
        params![page_id, HISTORY_KEEP],
    )?;
    Ok(())
}

fn write_page(tx: &Transaction, owner: i64, p: &Page) -> rusqlite::Result<i64> {
    let seq = next_seq(tx)?;
    tx.execute(
        "insert into pages (id, owner_id, parent_id, title, kind, position, content, props, schema, daily_date, deleted_at, seq)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         on conflict(id) do update set
           parent_id = excluded.parent_id, title = excluded.title, kind = excluded.kind,
           position = excluded.position, content = excluded.content, props = excluded.props,
           schema = excluded.schema, daily_date = excluded.daily_date,
           deleted_at = excluded.deleted_at, seq = excluded.seq
         where pages.owner_id = excluded.owner_id",
        params![
            p.id, owner, p.parent_id, p.title, p.kind, p.position,
            json_text(&p.content), json_text(&p.props), json_text(&p.schema),
            p.daily_date, p.deleted_at, seq
        ],
    )?;
    let mut stored = p.clone();
    stored.seq = seq;
    index_page(tx, owner, &stored)?;
    Ok(seq)
}

fn valid(p: &Page) -> bool {
    !p.id.is_empty()
        && p.id.len() <= 64
        && p.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && p.title.len() <= 1000
        && p.position.len() <= 64
        && (p.kind == "page" || p.kind == "database")
        && p.parent_id.as_ref().map_or(true, |x| x.len() <= 64)
        && p.daily_date.as_ref().map_or(true, |d| d.len() == 10)
        && [&p.content, &p.props, &p.schema]
            .iter()
            .all(|v| json_text(v).map_or(true, |t| t.len() <= MAX_CONTENT_BYTES))
}

fn apply_one(tx: &Transaction, owner: i64, c: &Page) -> rusqlite::Result<()> {
    if !valid(c) {
        return Ok(());
    }
    let existing: Option<(i64, i64, String, Option<String>)> = tx
        .query_row("select owner_id, seq, title, content from pages where id = ?1", [&c.id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .optional()?;
    if let Some((o, ..)) = &existing {
        if *o != owner {
            return Ok(()); // someone else's id: ignore silently
        }
    }

    // Two devices made the note for the same date: merge into the earlier one.
    if c.deleted_at.is_none() {
        if let Some(d) = &c.daily_date {
            let other: Option<(String, String, Option<String>)> = tx
                .query_row(
                    "select id, title, content from pages
                     where owner_id = ?1 and daily_date = ?2 and deleted_at is null and id <> ?3 limit 1",
                    params![owner, d, c.id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            if let Some((oid, otitle, ocontent)) = other {
                archive(tx, &oid, 0, &otitle, ocontent.as_deref(), true)?;
                let mut keep: Page = tx.query_row(
                    "select id, parent_id, title, kind, position, content, props, schema, daily_date, deleted_at, seq
                     from pages where id = ?1",
                    [&oid],
                    row_to_page,
                )?;
                keep.content = merge_docs(keep.content.take(), c.content.clone());
                write_page(tx, owner, &keep)?;
                let mut loser = c.clone();
                loser.deleted_at = Some(now());
                write_page(tx, owner, &loser)?;
                return Ok(());
            }
        }
    }

    if let Some((_, old_seq, old_title, old_content)) = &existing {
        let new_content = json_text(&c.content);
        if new_content != *old_content || c.title != *old_title {
            let conflict = c.base_seq.map_or(false, |b| b != *old_seq);
            archive(tx, &c.id, *old_seq, old_title, old_content.as_deref(), conflict)?;
        }
    }
    write_page(tx, owner, c)?;
    Ok(())
}

pub fn apply_changes(conn: &mut Connection, owner: i64, changes: &[Page]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for c in changes {
        apply_one(&tx, owner, c)?;
    }
    tx.commit()
}

fn row_to_page(r: &rusqlite::Row) -> rusqlite::Result<Page> {
    Ok(Page {
        id: r.get(0)?,
        parent_id: r.get(1)?,
        title: r.get(2)?,
        kind: r.get(3)?,
        position: r.get(4)?,
        content: parse(r.get(5)?),
        props: parse(r.get(6)?),
        schema: parse(r.get(7)?),
        daily_date: r.get(8)?,
        deleted_at: r.get(9)?,
        seq: r.get(10)?,
        base_seq: None,
    })
}

pub fn changes_since(conn: &Connection, owner: i64, cursor: i64, limit: i64) -> rusqlite::Result<Vec<Page>> {
    let mut st = conn.prepare(
        "select id, parent_id, title, kind, position, content, props, schema, daily_date, deleted_at, seq
         from pages where owner_id = ?1 and seq > ?2 order by seq limit ?3",
    )?;
    let rows = st.query_map(params![owner, cursor, limit], row_to_page)?;
    rows.collect()
}

#[derive(Serialize)]
pub struct Hit {
    pub id: String,
    pub title: String,
    pub snippet: String,
}

pub fn search(conn: &Connection, owner: i64, q: &str) -> rusqlite::Result<Vec<Hit>> {
    let expr: Vec<String> = q
        .split_whitespace()
        .map(|t| t.chars().filter(|c| c.is_alphanumeric()).collect::<String>())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    if expr.is_empty() {
        return Ok(vec![]);
    }
    let mut st = conn.prepare(
        "select p.id, p.title, snippet(page_fts, 3, '', '', '…', 12)
         from page_fts join pages p on p.id = page_fts.page_id
         where page_fts match ?1 and page_fts.owner_id = ?2 and p.deleted_at is null
         order by rank limit 20",
    )?;
    let rows = st.query_map(params![expr.join(" "), owner], |r| {
        Ok(Hit { id: r.get(0)?, title: r.get(1)?, snippet: r.get(2)? })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate(&c).unwrap();
        for (i, e) in ["a@x.io", "b@x.io"].iter().enumerate() {
            c.execute("insert into users (id, email, created_at) values (?1, ?2, 0)", params![i as i64 + 1, e]).unwrap();
        }
        c
    }

    fn page(id: &str, title: &str) -> Page {
        Page {
            id: id.into(), parent_id: None, title: title.into(), kind: "page".into(), position: "a0".into(),
            content: Some(json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello world"}]}]})),
            props: None, schema: None, daily_date: None, deleted_at: None, seq: 0, base_seq: None,
        }
    }

    #[test]
    fn push_then_pull_assigns_increasing_seq() {
        let mut c = db();
        apply_changes(&mut c, 1, &[page("p1", "One"), page("p2", "Two")]).unwrap();
        let got = changes_since(&c, 1, 0, 100).unwrap();
        assert_eq!(got.len(), 2);
        assert!(got[0].seq < got[1].seq);
        assert!(changes_since(&c, 1, got[1].seq, 100).unwrap().is_empty());
    }

    #[test]
    fn accounts_are_isolated() {
        let mut c = db();
        apply_changes(&mut c, 1, &[page("p1", "Mine")]).unwrap();
        assert!(changes_since(&c, 2, 0, 100).unwrap().is_empty());
        // another account cannot overwrite my page by reusing its id
        apply_changes(&mut c, 2, &[page("p1", "Stolen")]).unwrap();
        assert_eq!(changes_since(&c, 1, 0, 100).unwrap()[0].title, "Mine");
        assert!(search(&c, 2, "hello").unwrap().is_empty());
        assert_eq!(search(&c, 1, "hel").unwrap().len(), 1);
    }

    #[test]
    fn stale_write_wins_and_old_version_is_kept() {
        let mut c = db();
        apply_changes(&mut c, 1, &[page("p1", "v1")]).unwrap();
        let seq = changes_since(&c, 1, 0, 10).unwrap()[0].seq;
        let mut a = page("p1", "from device A");
        a.base_seq = Some(seq);
        apply_changes(&mut c, 1, &[a]).unwrap();
        let mut b = page("p1", "from device B");
        b.base_seq = Some(seq); // B never saw A's write
        apply_changes(&mut c, 1, &[b]).unwrap();
        assert_eq!(changes_since(&c, 1, 0, 10).unwrap()[0].title, "from device B");
        let n: i64 = c.query_row("select count(*) from page_history where page_id = 'p1'", [], |r| r.get(0)).unwrap();
        assert!(n >= 1);
    }

    #[test]
    fn duplicate_daily_notes_merge() {
        let mut c = db();
        let mut a = page("d1", "2026-11-08");
        a.daily_date = Some("2026-11-08".into());
        let mut b = page("d2", "2026-11-08");
        b.daily_date = Some("2026-11-08".into());
        b.content = Some(json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"from phone"}]}]}));
        apply_changes(&mut c, 1, &[a]).unwrap();
        apply_changes(&mut c, 1, &[b]).unwrap();
        let all = changes_since(&c, 1, 0, 10).unwrap();
        let alive: Vec<_> = all.iter().filter(|p| p.deleted_at.is_none()).collect();
        assert_eq!(alive.len(), 1);
        assert_eq!(alive[0].id, "d1");
        let mut text = String::new();
        extract_text(alive[0].content.as_ref().unwrap(), &mut text);
        assert!(text.contains("hello world") && text.contains("from phone"));
    }

    #[test]
    fn merge_skips_untouched_template_blocks() {
        let tpl = json!({"type":"doc","content":[
            {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Tasks"}]},
            {"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph"}]}]},
            {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Notes"}]},
            {"type":"paragraph"}]});
        let mine = json!({"type":"doc","content":[
            {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Tasks"}]},
            {"type":"paragraph","content":[{"type":"text","text":"real note"}]}]});
        let merged = merge_docs(Some(mine), Some(tpl)).unwrap();
        assert_eq!(merged["content"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn rejects_bad_ids() {
        let mut c = db();
        apply_changes(&mut c, 1, &[page("../etc", "x"), page("", "y")]).unwrap();
        assert!(changes_since(&c, 1, 0, 10).unwrap().is_empty());
    }
}
