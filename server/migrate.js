import { pool } from './db.js'

await pool.query(`
  create table if not exists api_keys (
    id uuid primary key default gen_random_uuid(),
    app_id uuid not null references apps(id) on delete cascade,
    name text not null,
    key_prefix text not null,
    key_hash text not null unique,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
  )
`)

console.log('API keys table is ready.')
await pool.end()
