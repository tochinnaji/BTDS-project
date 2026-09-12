import { pool } from './db.js'

const appResult = await pool.query(
  `insert into apps (name, slug) values ('TKC Foods', 'tkc-foods')
   on conflict (slug) do update set name = excluded.name
   returning *`,
)
const app = appResult.rows[0]

const existingEndpoint = await pool.query(
  'select id from endpoints where app_id = $1 and name = $2',
  [app.id, 'Local logistics receiver'],
)

if (!existingEndpoint.rows[0]) {
  await pool.query(
    `insert into endpoints (app_id, name, url, signing_secret)
     values ($1, 'Local logistics receiver', 'http://127.0.0.1:4000/api/test-receiver', 'dev_receiver_secret')`,
    [app.id],
  )
}

console.log(`Demo app ready: ${app.name} (${app.id})`)
await pool.end()
