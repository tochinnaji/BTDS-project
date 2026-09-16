import crypto from 'crypto'
import { pool } from './db.js'

const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000

export const hashValue = (value) => crypto.createHash('sha256').update(value).digest('hex')
const deriveKey = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key))
})

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const key = await deriveKey(password, salt)
  return `${salt}:${key.toString('hex')}`
}

export async function passwordMatches(password, storedHash) {
  const [salt, storedKey] = storedHash.split(':')
  if (!salt || !storedKey) return false
  const derivedKey = await deriveKey(password, salt)
  const expected = Buffer.from(storedKey, 'hex')
  return expected.length === derivedKey.length && crypto.timingSafeEqual(expected, derivedKey)
}

export async function createSession(userId) {
  const token = `wdc_session_${crypto.randomBytes(32).toString('hex')}`
  const expiresAt = new Date(Date.now() + sessionLifetimeMs)
  await pool.query(
    `insert into sessions (user_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [userId, hashValue(token), expiresAt],
  )
  return token
}

export async function requireAuth(req, res, next) {
  try {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' })

    const { rows } = await pool.query(
      `select users.id, users.name, users.email, sessions.id as session_id
       from sessions join users on users.id = sessions.user_id
       where sessions.token_hash = $1 and sessions.expires_at > now()`,
      [hashValue(token)],
    )
    if (!rows[0]) return res.status(401).json({ error: 'Your session has expired. Sign in again.' })
    req.user = rows[0]
    next()
  } catch (error) {
    next(error)
  }
}

export async function removeSession(sessionId) {
  await pool.query('delete from sessions where id = $1', [sessionId])
}

export async function createPasswordReset(userId) {
  const token = `wdc_reset_${crypto.randomBytes(32).toString('hex')}`
  await pool.query('delete from password_resets where user_id = $1', [userId])
  await pool.query(
    'insert into password_resets (user_id, token_hash, expires_at) values ($1, $2, $3)',
    [userId, hashValue(token), new Date(Date.now() + 30 * 60 * 1000)],
  )
  return token
}
