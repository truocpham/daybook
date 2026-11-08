create table users (
  id            integer primary key,
  email         text not null unique,
  password_hash text,
  invite_token  text,
  created_at    integer not null
);

create table sessions (
  id         text primary key,
  user_id    integer not null references users(id) on delete cascade,
  expires_at integer not null
);

create table pages (
  id         text primary key,
  owner_id   integer not null references users(id),
  parent_id  text,
  title      text not null default '',
  kind       text not null default 'page',
  position   text not null default 'a0',
  content    text,
  props      text,
  schema     text,
  daily_date text,
  deleted_at integer,
  seq        integer not null
);
create index pages_owner_seq on pages (owner_id, seq);
create unique index pages_daily on pages (owner_id, daily_date)
  where daily_date is not null and deleted_at is null;

create table page_history (
  id       integer primary key,
  page_id  text not null,
  seq      integer,
  title    text,
  content  text,
  saved_at integer not null
);
create index page_history_page on page_history (page_id, id);

create table files (
  sha      text not null,
  owner_id integer not null,
  mime     text not null,
  size     integer not null,
  primary key (sha, owner_id)
);

create table meta (key text primary key, value integer not null);
insert into meta (key, value) values ('seq', 0);

create virtual table page_fts using fts5(
  page_id unindexed, owner_id unindexed, title, body, tokenize = 'porter'
);
