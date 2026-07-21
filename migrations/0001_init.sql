-- D1 schema. Mirrors server/src/db/schema.sql, minus PRAGMAs that D1 manages itself.

CREATE TABLE IF NOT EXISTS draws (
  id          INTEGER PRIMARY KEY,
  game_id     TEXT    NOT NULL,
  draw_date   TEXT    NOT NULL,
  draw_slot   TEXT    NOT NULL,
  numbers     TEXT    NOT NULL,
  extras      TEXT    NOT NULL DEFAULT '{}',
  source      TEXT    NOT NULL,
  ingested_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game_id, draw_date, draw_slot)
);

CREATE INDEX IF NOT EXISTS idx_draws_game_date
  ON draws (game_id, draw_slot, draw_date DESC);

CREATE TABLE IF NOT EXISTS tickets (
  id               INTEGER PRIMARY KEY,
  game_id          TEXT    NOT NULL,
  numbers          TEXT    NOT NULL,
  extras           TEXT    NOT NULL DEFAULT '{}',
  strategy         TEXT    NOT NULL,
  score            REAL,
  cost             REAL    NOT NULL,
  draw_slot        TEXT    NOT NULL DEFAULT 'main',
  target_draw_date TEXT,
  note             TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_pending
  ON tickets (game_id, draw_slot, target_draw_date);

CREATE TABLE IF NOT EXISTS ticket_results (
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  draw_id     INTEGER NOT NULL REFERENCES draws(id)  ON DELETE CASCADE,
  matches     INTEGER NOT NULL,
  extra_match INTEGER NOT NULL DEFAULT 0,
  tier        TEXT,
  payout      REAL    NOT NULL DEFAULT 0,
  checked_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ticket_id, draw_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
