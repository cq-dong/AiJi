import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { resolve } from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/)
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]
  }),
)
const planId = String(args.plan || 'yearly')
const count = Number(args.count || 1)
const maxUses = Number(args['max-uses'] || 1)
const expiresDays = args['expires-days'] ? Number(args['expires-days']) : null
const note = String(args.note || '')

const DURATION = { monthly: 30, yearly: 365 }
if (!(planId in DURATION)) {
  console.error(`--plan must be monthly|yearly, got ${planId}`)
  process.exit(1)
}

// cwd=server（DB 同 db/index.ts 的 resolve(process.cwd(),'data/aiji.db')）。
const db = new Database(resolve(process.cwd(), 'data/aiji.db'))
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS redeem_codes (
    code TEXT PRIMARY KEY, plan_id TEXT NOT NULL, duration_days INTEGER NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1, used_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT, note TEXT, created_at TEXT NOT NULL
  );
`)

function genCode() {
  const seg = () => randomBytes(2).toString('hex').toUpperCase()
  return `AIJI-${seg()}-${seg()}-${seg()}`
}

const now = new Date().toISOString()
const expiresAt = expiresDays ? new Date(Date.now() + expiresDays * 86400_000).toISOString() : null
const insert = db.prepare(
  `INSERT INTO redeem_codes (code, plan_id, duration_days, max_uses, used_count, expires_at, note, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
)
const codes = []
for (let i = 0; i < count; i++) {
  const code = genCode()
  insert.run(code, planId, DURATION[planId], maxUses, expiresAt, note, now)
  codes.push(code)
}
console.log(`生成 ${count} 个 ${planId} 兑换码（${DURATION[planId]} 天, 单码 ${maxUses} 次${expiresAt ? ', 码有效期至 ' + expiresAt : ''}）:`)
codes.forEach((c) => console.log('  ' + c))
