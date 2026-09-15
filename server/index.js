import cors from 'cors'
import crypto from 'crypto'
import express from 'express'
import { createSession, hashPassword, passwordMatches, removeSession, requireAuth } from './auth.js'
import { pool } from './db.js'
import { deliver, processDueDeliveries } from './delivery.js'

const app = express()
const port = Number(process.env.PORT || 4000)
const origins = new Set([process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'])
app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.has(origin)) }))
app.use(express.json({ limit: '100kb' }))

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
const hashApiKey = (key) => crypto.createHash('sha256').update(key).digest('hex')

async function ownedApp(userId, appId) {
  const { rows } = await pool.query('select * from apps where id = $1 and owner_id = $2', [appId, userId])
  if (!rows[0]) { const error = new Error('Workspace not found.'); error.status = 404; throw error }
  return rows[0]
}

async function createEvent(appId, { eventType, payload = {}, idempotencyKey }) {
  if (!eventType) { const error = new Error('eventType is required'); error.status = 400; throw error }
  const client = await pool.connect()
  try {
    await client.query('begin')
    const event = (await client.query('insert into events (app_id, event_type, payload, idempotency_key) values ($1, $2, $3, $4) returning *', [appId, eventType, payload, idempotencyKey || null])).rows[0]
    const deliveryRows = (await client.query(`insert into deliveries (event_id, endpoint_id)
      select $1, id from endpoints where app_id = $2 and is_active = true and deleted_at is null returning *`, [event.id, appId])).rows
    await client.query('commit')
    const deliveries = await Promise.all(deliveryRows.map((row) => deliver(row.id)))
    return { event, deliveriesCreated: deliveries.length, deliveries }
  } catch (error) {
    await client.query('rollback')
    if (error.code === '23505') { error.status = 409; error.message = 'This event was already received.' }
    throw error
  } finally { client.release() }
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query('select now() as database_time')
  res.json({ ok: true, databaseTime: rows[0].database_time })
}))

app.post('/api/auth/signup', asyncRoute(async (req, res) => {
  const { name, email, password } = req.body
  const normalizedEmail = email?.trim().toLowerCase()
  if (!name?.trim() || !normalizedEmail || !password || password.length < 8) return res.status(400).json({ error: 'Enter your name, email, and a password of at least 8 characters.' })
  const client = await pool.connect()
  try {
    await client.query('begin')
    const user = (await client.query('insert into users (name, email, password_hash) values ($1, $2, $3) returning id, name, email', [name.trim(), normalizedEmail, await hashPassword(password)])).rows[0]
    const claimed = (await client.query("update apps set owner_id = $1 where slug = 'tkc-foods' and owner_id is null returning id", [user.id])).rows[0]
    if (!claimed) {
      const workspace = (await client.query('insert into apps (name, slug, owner_id) values ($1, $2, $3) returning id', [`${user.name}'s workspace`, `workspace-${user.id.slice(0, 8)}`, user.id])).rows[0]
      await client.query(`insert into endpoints (app_id, name, url, signing_secret) values ($1, 'Local test receiver', $2, 'local_demo_secret')`, [workspace.id, `http://127.0.0.1:${port}/api/test-receiver`])
    }
    await client.query('commit')
    res.status(201).json({ token: await createSession(user.id), user })
  } catch (error) {
    await client.query('rollback')
    if (error.code === '23505') return res.status(409).json({ error: 'An account already exists with that email.' })
    throw error
  } finally { client.release() }
}))

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('select * from users where email = $1', [req.body.email?.trim().toLowerCase()])
  if (!rows[0] || !await passwordMatches(req.body.password || '', rows[0].password_hash)) return res.status(401).json({ error: 'Incorrect email or password.' })
  const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email }
  res.json({ token: await createSession(user.id), user })
}))
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email } }))
app.post('/api/auth/logout', requireAuth, asyncRoute(async (req, res) => { await removeSession(req.user.session_id); res.status(204).end() }))

app.get('/api/apps', requireAuth, asyncRoute(async (req, res) => {
  const { slug } = req.query
  const { rows } = await pool.query(slug ? 'select * from apps where owner_id = $1 and slug = $2' : 'select * from apps where owner_id = $1 order by created_at desc', slug ? [req.user.id, slug] : [req.user.id])
  res.json(rows)
}))
app.post('/api/apps', requireAuth, asyncRoute(async (req, res) => {
  const { name, slug } = req.body
  if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' })
  const { rows } = await pool.query('insert into apps (name, slug, owner_id) values ($1, $2, $3) returning *', [name.trim(), slug.trim().toLowerCase(), req.user.id])
  res.status(201).json(rows[0])
}))
app.patch('/api/apps/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!req.body.name?.trim()) return res.status(400).json({ error: 'name is required' })
  const { rows } = await pool.query('update apps set name = $2 where id = $1 and owner_id = $3 returning *', [req.params.id, req.body.name.trim(), req.user.id])
  if (!rows[0]) return res.status(404).json({ error: 'Workspace not found.' })
  res.json(rows[0])
}))

app.get('/api/apps/:id/api-keys', requireAuth, asyncRoute(async (req, res) => {
  await ownedApp(req.user.id, req.params.id)
  const { rows } = await pool.query('select id, name, key_prefix, last_used_at, revoked_at, created_at from api_keys where app_id = $1 order by created_at desc', [req.params.id])
  res.json(rows)
}))
app.post('/api/apps/:id/api-keys', requireAuth, asyncRoute(async (req, res) => {
  if (!req.body.name?.trim()) return res.status(400).json({ error: 'A key name is required' })
  await ownedApp(req.user.id, req.params.id)
  const apiKey = `wdc_live_${crypto.randomBytes(24).toString('hex')}`
  const { rows } = await pool.query('insert into api_keys (app_id, name, key_prefix, key_hash) values ($1, $2, $3, $4) returning id, name, key_prefix, last_used_at, revoked_at, created_at', [req.params.id, req.body.name.trim(), apiKey.slice(0, 13), hashApiKey(apiKey)])
  res.status(201).json({ apiKey, key: rows[0] })
}))
app.post('/api/api-keys/:id/revoke', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`update api_keys set revoked_at = now() from apps
    where api_keys.app_id = apps.id and api_keys.id = $1 and apps.owner_id = $2 and api_keys.revoked_at is null
    returning api_keys.id, api_keys.name, api_keys.key_prefix, api_keys.last_used_at, api_keys.revoked_at, api_keys.created_at`, [req.params.id, req.user.id])
  if (!rows[0]) return res.status(404).json({ error: 'Active API key not found' })
  res.json(rows[0])
}))

app.post('/api/endpoints', requireAuth, asyncRoute(async (req, res) => {
  const { appId, name, url, signingSecret } = req.body
  if (!appId || !name || !url || !signingSecret) return res.status(400).json({ error: 'appId, name, url, and signingSecret are required' })
  try { new URL(url) } catch { return res.status(400).json({ error: 'url must be a valid URL' }) }
  await ownedApp(req.user.id, appId)
  const { rows } = await pool.query('insert into endpoints (app_id, name, url, signing_secret) values ($1, $2, $3, $4) returning id, app_id, name, url, is_active, created_at', [appId, name.trim(), url, signingSecret])
  res.status(201).json(rows[0])
}))
app.post('/api/apps/:id/test-endpoints/failure', requireAuth, asyncRoute(async (req, res) => {
  await ownedApp(req.user.id, req.params.id)
  const url = `http://127.0.0.1:${port}/api/test-receiver/fail`
  const existing = (await pool.query('select * from endpoints where app_id = $1 and url = $2 and deleted_at is null', [req.params.id, url])).rows[0]
  if (existing) { const { rows } = await pool.query('update endpoints set is_active = true where id = $1 returning id, name, url, is_active', [existing.id]); return res.json({ endpoint: rows[0], created: false }) }
  const { rows } = await pool.query(`insert into endpoints (app_id, name, url, signing_secret) values ($1, 'Simulated failing receiver', $2, 'wdc_failure_demo_secret') returning id, name, url, is_active`, [req.params.id, url])
  res.status(201).json({ endpoint: rows[0], created: true })
}))
app.patch('/api/endpoints/:id', requireAuth, asyncRoute(async (req, res) => {
  const { name, url, signingSecret, isActive } = req.body
  if (url) { try { new URL(url) } catch { return res.status(400).json({ error: 'url must be a valid URL' }) } }
  const updates = []; const values = [req.params.id, req.user.id]
  const addUpdate = (column, value) => { values.push(value); updates.push(`${column} = $${values.length}`) }
  if (name?.trim()) addUpdate('name', name.trim()); if (url) addUpdate('url', url); if (signingSecret) addUpdate('signing_secret', signingSecret); if (typeof isActive === 'boolean') addUpdate('is_active', isActive)
  if (!updates.length) return res.status(400).json({ error: 'Provide endpoint details to update' })
  const { rows } = await pool.query(`update endpoints set ${updates.join(', ')} from apps
    where endpoints.id = $1 and apps.id = endpoints.app_id and apps.owner_id = $2 and endpoints.deleted_at is null
    returning endpoints.id, endpoints.app_id, endpoints.name, endpoints.url, endpoints.is_active, endpoints.created_at`, values)
  if (!rows[0]) return res.status(404).json({ error: 'Endpoint not found' })
  res.json(rows[0])
}))
app.delete('/api/endpoints/:id', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`update endpoints set is_active = false, deleted_at = now() from apps
    where endpoints.id = $1 and apps.id = endpoints.app_id and apps.owner_id = $2 and endpoints.deleted_at is null returning endpoints.id, endpoints.name`, [req.params.id, req.user.id])
  if (!rows[0]) return res.status(404).json({ error: 'Endpoint not found' })
  res.json(rows[0])
}))
app.get('/api/endpoints', requireAuth, asyncRoute(async (req, res) => {
  if (!req.query.appId) return res.status(400).json({ error: 'appId is required' })
  const { rows } = await pool.query(`select endpoints.id, endpoints.name, endpoints.url, endpoints.is_active, endpoints.created_at,
    count(deliveries.id)::integer as delivery_count, count(deliveries.id) filter (where deliveries.status = 'failed')::integer as failed_count
    from endpoints join apps on apps.id = endpoints.app_id left join deliveries on deliveries.endpoint_id = endpoints.id
    where endpoints.app_id = $1 and apps.owner_id = $2 and endpoints.deleted_at is null group by endpoints.id order by endpoints.created_at desc`, [req.query.appId, req.user.id])
  res.json(rows)
}))

app.post('/api/events', requireAuth, asyncRoute(async (req, res) => {
  const { appId, eventType, payload = {}, idempotencyKey } = req.body
  if (!appId || !eventType) return res.status(400).json({ error: 'appId and eventType are required' })
  await ownedApp(req.user.id, appId)
  res.status(201).json(await createEvent(appId, { eventType, payload, idempotencyKey }))
}))
app.post('/api/ingest/events', asyncRoute(async (req, res) => {
  const apiKey = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!apiKey) return res.status(401).json({ error: 'Use Authorization: Bearer YOUR_API_KEY' })
  const { rows } = await pool.query('select id, app_id from api_keys where key_hash = $1 and revoked_at is null', [hashApiKey(apiKey)])
  if (!rows[0]) return res.status(401).json({ error: 'Invalid or revoked API key' })
  await pool.query('update api_keys set last_used_at = now() where id = $1', [rows[0].id])
  res.status(201).json(await createEvent(rows[0].app_id, req.body))
}))
app.get('/api/events', requireAuth, asyncRoute(async (req, res) => {
  if (!req.query.appId) return res.status(400).json({ error: 'appId is required' })
  const { rows } = await pool.query(`select events.*, count(deliveries.id)::integer as delivery_count,
    count(deliveries.id) filter (where deliveries.status = 'delivered')::integer as delivered_count
    from events join apps on apps.id = events.app_id left join deliveries on deliveries.event_id = events.id
    where events.app_id = $1 and apps.owner_id = $2 group by events.id order by events.created_at desc limit 100`, [req.query.appId, req.user.id])
  res.json(rows)
}))
app.get('/api/deliveries', requireAuth, asyncRoute(async (req, res) => {
  if (!req.query.appId) return res.status(400).json({ error: 'appId is required' })
  const values = [req.query.appId, req.user.id]; const filters = ['events.app_id = $1', 'apps.owner_id = $2']
  if (req.query.status) { values.push(req.query.status); filters.push(`deliveries.status = $${values.length}`) }
  const { rows } = await pool.query(`select deliveries.*, events.event_type, events.payload, endpoints.name as endpoint_name, endpoints.url as endpoint_url
    from deliveries join events on events.id = deliveries.event_id join apps on apps.id = events.app_id join endpoints on endpoints.id = deliveries.endpoint_id
    where ${filters.join(' and ')} order by deliveries.created_at desc limit 100`, values)
  res.json(rows)
}))
app.post('/api/deliveries/:id/retry', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`update deliveries set status = 'pending', response_status = null, response_body = null, next_attempt_at = now()
    from events, apps where deliveries.id = $1 and events.id = deliveries.event_id and apps.id = events.app_id and apps.owner_id = $2 returning deliveries.*`, [req.params.id, req.user.id])
  if (!rows[0]) return res.status(404).json({ error: 'Delivery not found' })
  res.json(await deliver(rows[0].id))
}))

app.post('/api/test-receiver', (req, res) => { console.log(`Test receiver accepted ${req.body.type} (${req.body.id})`); res.status(204).end() })
app.post('/api/test-receiver/fail', (req, res) => { console.log(`Failure demo rejected ${req.body.type} (${req.body.id})`); res.status(503).json({ error: 'Simulated receiver outage' }) })
app.use((error, _req, res, _next) => { console.error(error); res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong.' }) })
app.listen(port, () => { console.log(`WDC API listening on http://127.0.0.1:${port}`); setInterval(() => processDueDeliveries().catch((error) => console.error('Retry worker failed:', error)), 5_000) })
