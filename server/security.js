import { pool } from './db.js'

export async function createSecurityAlert(appId, type, title, detail) {
  await pool.query(
    'insert into security_alerts (app_id, type, title, detail) values ($1, $2, $3, $4)',
    [appId, type, title, detail],
  )
}
