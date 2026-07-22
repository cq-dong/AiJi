-- AiJi 后端 sqlite schema（文档参考；实际建表 DDL 内联在 src/db/index.ts）
-- WAL 模式 + better-sqlite3 同步事务，单机够用。

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  paid_plan_id TEXT,
  paid_expires_at TEXT,
  avatar TEXT,
  created_at TEXT NOT NULL,
  bound_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_hash ON refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS quotas (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  llm_used INTEGER DEFAULT 0,
  stt_used_sec INTEGER DEFAULT 0,
  agg_used INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
