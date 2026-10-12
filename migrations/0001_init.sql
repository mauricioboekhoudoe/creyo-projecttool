-- Creyo projecttool: initial schema.
-- Plan content (phases, items, log, meta) is written by the admin and by Claude's updates
-- and is covered by versions/rollback. Feedback, comments and files are people's own
-- contributions and are never rolled back.

CREATE TABLE phases (
  id         TEXT PRIMARY KEY,           -- e.g. "A", "A2", "M", "R"
  name       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE items (
  id         TEXT PRIMARY KEY,           -- e.g. "F25", "A4", "R1"
  phase_id   TEXT REFERENCES phases(id),
  title      TEXT NOT NULL,
  owner      TEXT,                       -- person key ("M", "C") or NULL
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','busy','wait','done')),
  priority   INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  why        TEXT NOT NULL DEFAULT '',
  next       TEXT NOT NULL DEFAULT '',
  waits_for  TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX items_phase ON items(phase_id, sort);

CREATE TABLE log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,              -- YYYY-MM-DD
  title      TEXT NOT NULL,
  what       TEXT NOT NULL DEFAULT '',
  why        TEXT NOT NULL DEFAULT '',
  result     TEXT NOT NULL DEFAULT '',
  item_ids   TEXT NOT NULL DEFAULT '',   -- comma separated, for linking
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL
);

CREATE TABLE feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  for_owner  TEXT,                       -- person key or NULL ("don't know")
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','converted','closed')),
  item_id    TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK (target_type IN ('item','feedback')),
  target_id   TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL
);
CREATE INDEX comments_target ON comments(target_type, target_id);

CREATE TABLE files (
  id           TEXT PRIMARY KEY,         -- random id, also the R2 key
  target_type  TEXT NOT NULL CHECK (target_type IN ('item','feedback')),
  target_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL
);
CREATE INDEX files_target ON files(target_type, target_id);

-- Every change people make, so "copy for Claude" can send only what is new.
CREATE TABLE changes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  who        TEXT NOT NULL,
  kind       TEXT NOT NULL,              -- item_update, feedback_new, comment_new, file_new, ...
  ref        TEXT NOT NULL,
  summary    TEXT NOT NULL
);

-- Snapshots of the plan content, taken before every applied update.
CREATE TABLE versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  snapshot   TEXT NOT NULL               -- JSON: {phases, items, log, meta}
);
