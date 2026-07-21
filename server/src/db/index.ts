import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DB_PATH = resolve(process.cwd(), 'data/aiji.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  mkdirSync(dirname(DB_PATH), { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
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
      bound_at TEXT,
      trial_expires_at TEXT
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
  `)
  // 迁移：旧库 users 表无 trial_expires_at 列 → 补加。SQLite ADD COLUMN 无 IF NOT EXISTS，
  // 用 try/catch 容错（列已存在时抛 "duplicate column" → 忽略）。
  try {
    db.exec(`ALTER TABLE users ADD COLUMN trial_expires_at TEXT`)
  } catch {
    // 列已存在，忽略。
  }
  _db = db
  return db
}

export interface UserRow {
  id: string
  email: string
  password_hash: string
  nickname: string
  plan: string
  paid_plan_id: string | null
  paid_expires_at: string | null
  avatar: string | null
  created_at: string
  bound_at: string | null
  trial_expires_at: string | null
}

export interface RefreshTokenRow {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
  revoked_at: string | null
  created_at: string
}

export interface QuotaRow {
  user_id: string
  date: string
  llm_used: number
  stt_used_sec: number
  agg_used: number
}
