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

await pool.query('alter table endpoints add column if not exists deleted_at timestamptz')
await pool.query(`
  create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text not null unique,
    password_hash text not null,
    created_at timestamptz not null default now()
  )
`)
await pool.query(`
  create table if not exists sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    token_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  )
`)
await pool.query('alter table apps add column if not exists owner_id uuid references users(id) on delete cascade')
await pool.query('create index if not exists apps_owner_id_idx on apps(owner_id)')
await pool.query('create index if not exists sessions_token_hash_idx on sessions(token_hash)')

console.log('Database migrations are ready.')
await pool.end()
