-- Creyo projecttool: per-task history with a plain-language reason, and phases on log entries.
-- History is a record of what happened. It is never rolled back; a rollback adds its own history lines.

CREATE TABLE item_history (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id  TEXT NOT NULL,
  at       TEXT NOT NULL,
  who      TEXT NOT NULL,
  what     TEXT NOT NULL,
  reason   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX item_history_item ON item_history(item_id, id);

ALTER TABLE log ADD COLUMN phase_ids TEXT NOT NULL DEFAULT '';
