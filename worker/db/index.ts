let schemaApplied = false;

export async function initDB(db: D1Database): Promise<void> {
  if (schemaApplied) return;
  await db.exec(SCHEMA);
  schemaApplied = true;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  personaname TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  chat_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  appid INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  playtime_hours REAL NOT NULL DEFAULT 0,
  playtime_forever INTEGER NOT NULL DEFAULT 0,
  header_image TEXT NOT NULL DEFAULT '',
  genres TEXT NOT NULL DEFAULT '[]',
  release_date TEXT NOT NULL DEFAULT '',
  review_score INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, appid)
);
CREATE INDEX IF NOT EXISTS idx_library_user ON library(user_id);
CREATE INDEX IF NOT EXISTS idx_library_playtime ON library(user_id, playtime_hours DESC);

CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  appid INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, appid, created_at)
);
CREATE INDEX IF NOT EXISTS idx_recs_user_date ON recommendations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  appid INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, appid)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO config (key, value) VALUES ('STEAM_API_KEY', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('LLM_PROVIDER', 'openai');
INSERT OR IGNORE INTO config (key, value) VALUES ('LLM_API_KEY', '');`;
