mod db;

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path as UrlPath, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use db::Page;
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(RustEmbed)]
#[folder = "../web/dist/"]
struct Assets;

const SESSION_SECS: i64 = 30 * 86_400;
const MAX_FILE_BYTES: usize = 15 * 1024 * 1024;
const MAX_CHANGES: usize = 500;
const PAGE_LIMIT: i64 = 500;
const LOGIN_MAX_FAILS: u32 = 5;
const LOGIN_WINDOW: Duration = Duration::from_secs(15 * 60);

struct AppState {
    db: Mutex<Connection>,
    data_dir: PathBuf,
    secure_cookie: bool,
    fails: Mutex<HashMap<String, (u32, Instant)>>,
}

impl AppState {
    fn locked_out(&self, key: &str) -> bool {
        let mut f = self.fails.lock().unwrap();
        match f.get(key) {
            Some((n, at)) if at.elapsed() < LOGIN_WINDOW => *n >= LOGIN_MAX_FAILS,
            Some(_) => {
                f.remove(key);
                false
            }
            None => false,
        }
    }
    fn record_fail(&self, key: &str) {
        let mut f = self.fails.lock().unwrap();
        let e = f.entry(key.to_string()).or_insert((0, Instant::now()));
        if e.1.elapsed() >= LOGIN_WINDOW {
            *e = (0, Instant::now());
        }
        e.0 += 1;
    }
    fn clear_fails(&self, key: &str) {
        self.fails.lock().unwrap().remove(key);
    }
}

type Shared = Arc<AppState>;

fn internal<E: std::fmt::Display>(e: E) -> StatusCode {
    tracing::error!("{e}");
    StatusCode::INTERNAL_SERVER_ERROR
}

fn random_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut b);
    hex::encode(b)
}

fn hash_pw(pw: &str) -> Result<String, StatusCode> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default().hash_password(pw.as_bytes(), &salt).map(|h| h.to_string()).map_err(internal)
}

fn verify_pw(hash: &str, pw: &str) -> bool {
    PasswordHash::new(hash).map(|p| Argon2::default().verify_password(pw.as_bytes(), &p).is_ok()).unwrap_or(false)
}

fn session_user(s: &AppState, h: &HeaderMap) -> Option<i64> {
    let cookie = h.get(header::COOKIE)?.to_str().ok()?;
    let sid = cookie.split(';').find_map(|p| p.trim().strip_prefix("sid="))?;
    if sid.len() != 64 {
        return None;
    }
    let db = s.db.lock().ok()?;
    db.query_row("select user_id from sessions where id = ?1 and expires_at > ?2", params![sid, db::now()], |r| r.get(0)).ok()
}

fn require_user(s: &AppState, h: &HeaderMap) -> Result<i64, StatusCode> {
    session_user(s, h).ok_or(StatusCode::UNAUTHORIZED)
}

// ---------- auth ----------

#[derive(Deserialize)]
struct LoginReq {
    email: String,
    password: String,
}

async fn login(State(s): State<Shared>, Json(b): Json<LoginReq>) -> Result<Response, StatusCode> {
    let email = b.email.trim().to_lowercase();
    if s.locked_out(&email) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let row: Option<(i64, Option<String>)> = {
        let db = s.db.lock().unwrap();
        db.query_row("select id, password_hash from users where email = ?1", [&email], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(internal)?
    };
    let (uid, hash) = match row {
        Some((id, Some(h))) => (Some(id), h),
        // run a verification anyway so timing does not reveal which emails exist
        _ => (None, "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm8".into()),
    };
    let pw = b.password.clone();
    let ok = tokio::task::spawn_blocking(move || verify_pw(&hash, &pw)).await.unwrap_or(false);
    let uid = match (ok, uid) {
        (true, Some(u)) => u,
        _ => {
            s.record_fail(&email);
            return Err(StatusCode::UNAUTHORIZED);
        }
    };
    s.clear_fails(&email);
    let sid = random_hex(32);
    {
        let db = s.db.lock().unwrap();
        db.execute("delete from sessions where expires_at < ?1", [db::now()]).map_err(internal)?;
        db.execute("insert into sessions (id, user_id, expires_at) values (?1, ?2, ?3)", params![sid, uid, db::now() + SESSION_SECS])
            .map_err(internal)?;
    }
    let cookie = format!("sid={sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_SECS}{}", if s.secure_cookie { "; Secure" } else { "" });
    Ok(([(header::SET_COOKIE, cookie)], Json(serde_json::json!({ "email": email }))).into_response())
}

async fn logout(State(s): State<Shared>, headers: HeaderMap) -> Response {
    if let Some(c) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
        if let Some(sid) = c.split(';').find_map(|p| p.trim().strip_prefix("sid=")) {
            let _ = s.db.lock().unwrap().execute("delete from sessions where id = ?1", [sid]);
        }
    }
    let clear = format!("sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{}", if s.secure_cookie { "; Secure" } else { "" });
    ([(header::SET_COOKIE, clear)], StatusCode::NO_CONTENT).into_response()
}

async fn me(State(s): State<Shared>, headers: HeaderMap) -> Result<Json<serde_json::Value>, StatusCode> {
    let uid = require_user(&s, &headers)?;
    let email: String = s.db.lock().unwrap().query_row("select email from users where id = ?1", [uid], |r| r.get(0)).map_err(internal)?;
    Ok(Json(serde_json::json!({ "email": email })))
}

#[derive(Deserialize)]
struct SetupReq {
    token: String,
    password: String,
}

async fn setup(State(s): State<Shared>, Json(b): Json<SetupReq>) -> Result<StatusCode, StatusCode> {
    if b.password.chars().count() < 10 || b.token.len() != 64 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let pw = b.password.clone();
    let hash = tokio::task::spawn_blocking(move || hash_pw(&pw)).await.map_err(internal)??;
    let db = s.db.lock().unwrap();
    let n = db
        .execute("update users set password_hash = ?1, invite_token = null where invite_token = ?2", params![hash, b.token])
        .map_err(internal)?;
    if n == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------- sync ----------

#[derive(Deserialize)]
struct SyncReq {
    #[serde(default)]
    cursor: i64,
    #[serde(default)]
    changes: Vec<Page>,
}

#[derive(Serialize)]
struct SyncRes {
    cursor: i64,
    pages: Vec<Page>,
    more: bool,
}

async fn sync(State(s): State<Shared>, headers: HeaderMap, Json(req): Json<SyncReq>) -> Result<Json<SyncRes>, StatusCode> {
    let uid = require_user(&s, &headers)?;
    if req.changes.len() > MAX_CHANGES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let mut db = s.db.lock().unwrap();
    db::apply_changes(&mut db, uid, &req.changes).map_err(internal)?;
    let pages = db::changes_since(&db, uid, req.cursor, PAGE_LIMIT).map_err(internal)?;
    let cursor = pages.last().map_or(req.cursor, |p| p.seq);
    let more = pages.len() as i64 == PAGE_LIMIT;
    Ok(Json(SyncRes { cursor, pages, more }))
}

async fn search(State(s): State<Shared>, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Result<Json<Vec<db::Hit>>, StatusCode> {
    let uid = require_user(&s, &headers)?;
    let term = q.get("q").cloned().unwrap_or_default();
    let db = s.db.lock().unwrap();
    db::search(&db, uid, &term).map(Json).map_err(internal)
}

// ---------- files ----------

fn valid_sha(sha: &str) -> bool {
    sha.len() == 64 && sha.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

async fn put_file(State(s): State<Shared>, headers: HeaderMap, UrlPath(sha): UrlPath<String>, body: Bytes) -> Result<StatusCode, StatusCode> {
    let uid = require_user(&s, &headers)?;
    if !valid_sha(&sha) || body.is_empty() || body.len() > MAX_FILE_BYTES {
        return Err(StatusCode::BAD_REQUEST);
    }
    if hex::encode(Sha256::digest(&body)) != sha {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .filter(|m| m.len() < 100 && m.chars().all(|c| c.is_ascii_alphanumeric() || "/.+-".contains(c)))
        .unwrap_or("application/octet-stream")
        .to_string();
    let dir = s.data_dir.join("files");
    tokio::fs::create_dir_all(&dir).await.map_err(internal)?;
    let path = dir.join(&sha);
    if !path.exists() {
        let tmp = dir.join(format!("{sha}.{}.tmp", random_hex(4)));
        tokio::fs::write(&tmp, &body).await.map_err(internal)?;
        tokio::fs::rename(&tmp, &path).await.map_err(internal)?;
    }
    s.db.lock()
        .unwrap()
        .execute("insert or ignore into files (sha, owner_id, mime, size) values (?1, ?2, ?3, ?4)", params![sha, uid, mime, body.len() as i64])
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_file(State(s): State<Shared>, headers: HeaderMap, UrlPath(sha): UrlPath<String>) -> Result<Response, StatusCode> {
    let uid = require_user(&s, &headers)?;
    if !valid_sha(&sha) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mime: String = s
        .db
        .lock()
        .unwrap()
        .query_row("select mime from files where sha = ?1 and owner_id = ?2", params![sha, uid], |r| r.get(0))
        .optional()
        .map_err(internal)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let data = tokio::fs::read(s.data_dir.join("files").join(&sha)).await.map_err(|_| StatusCode::NOT_FOUND)?;
    // Only raster images render inline; everything else downloads, so uploads cannot run script.
    let inline = matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif");
    let mut res = (StatusCode::OK, data).into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(if inline { &mime } else { "application/octet-stream" }).unwrap());
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable"));
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    h.insert("content-security-policy", HeaderValue::from_static("sandbox"));
    if !inline {
        h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_static("attachment"));
    }
    Ok(res)
}

// ---------- static web app ----------

async fn static_files(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path.starts_with("api/") || path.starts_with("files/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let (file, name) = match Assets::get(if path.is_empty() { "index.html" } else { path }) {
        Some(f) => (f, if path.is_empty() { "index.html" } else { path }),
        None => match Assets::get("index.html") {
            Some(f) => (f, "index.html"),
            None => return (StatusCode::NOT_FOUND, "web app not built").into_response(),
        },
    };
    let mime = mime_guess::from_path(name).first_or_octet_stream();
    let mut res = (StatusCode::OK, file.data.into_owned()).into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(mime.as_ref()).unwrap());
    let cache = if name.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    if name == "index.html" {
        h.insert(
            "content-security-policy",
            HeaderValue::from_static("default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"),
        );
    }
    res
}

async fn health() -> &'static str {
    "ok"
}

// ---------- CLI + server ----------

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn data_dir() -> PathBuf {
    let d = PathBuf::from(env("DAYBOOK_DATA", "./data"));
    std::fs::create_dir_all(&d).expect("cannot create data directory");
    d
}

fn invite(email: &str) {
    let email = email.trim().to_lowercase();
    if !email.contains('@') {
        eprintln!("not an email address: {email}");
        std::process::exit(1);
    }
    let conn = db::open(&data_dir().join("daybook.db")).expect("open database");
    let token = random_hex(32);
    let n = conn.execute("update users set invite_token = ?1 where email = ?2", params![token, email]).unwrap();
    if n == 0 {
        conn.execute("insert into users (email, invite_token, created_at) values (?1, ?2, ?3)", params![email, token, db::now()]).unwrap();
    }
    let base = env("DAYBOOK_PUBLIC_URL", "http://localhost:8080");
    println!("Send {email} this one-time link to choose a password:\n\n  {}/#/setup/{token}\n", base.trim_end_matches('/'));
}

async fn serve() {
    tracing_subscriber::fmt().init();
    let dir = data_dir();
    let conn = db::open(&dir.join("daybook.db")).expect("open database");
    let public = env("DAYBOOK_PUBLIC_URL", "http://localhost:8080");
    let state = Arc::new(AppState {
        db: Mutex::new(conn),
        data_dir: dir,
        secure_cookie: env("DAYBOOK_COOKIE_SECURE", if public.starts_with("https") { "1" } else { "0" }) == "1",
        fails: Mutex::new(HashMap::new()),
    });
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/login", post(login))
        .route("/api/logout", post(logout))
        .route("/api/me", get(me))
        .route("/api/setup", post(setup))
        .route("/api/sync", post(sync).layer(DefaultBodyLimit::max(8 * 1024 * 1024)))
        .route("/api/search", get(search))
        .route("/files/:sha", put(put_file).get(get_file).layer(DefaultBodyLimit::max(MAX_FILE_BYTES + 1024)))
        .fallback(static_files)
        .with_state(state);
    let addr = format!("0.0.0.0:{}", env("PORT", "8080"));
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    tracing::info!("daybook listening on {addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("server");
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("invite") | Some("passwd") => match args.get(1) {
            Some(email) => invite(email),
            None => eprintln!("usage: daybook invite <email>"),
        },
        Some("serve") | None => serve().await,
        Some(other) => eprintln!("unknown command {other}\nusage: daybook [serve | invite <email>]"),
    }
}
