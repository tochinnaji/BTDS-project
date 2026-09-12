import cors from 'cors'
import crypto from 'crypto'
import express from 'express'
import { pool } from './db.js'
import { deliver, processDueDeliveries } from './delivery.js'

const app = express()
const port = Number(process.env.PORT || 4000)

const allowedOrigins = new Set([
  process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
])

app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }))
app.use(express.json({ limit: '100kb' }))

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

async function createEvent(appId, { eventType, payload = {}, idempotencyKey }) {
  if (!eventType) {
    const error = new Error('eventType is required')
    error.status = 400
    throw error
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    const eventResult = await client.query(
      `insert into events (app_id, event_type, payload, idempotency_key)
       values ($1, $2, $3, $4) returning *`,
      [appId, eventType, payload, idempotencyKey || null],
    )
    const event = eventResult.rows[0]
    const deliveriesResult = await client.query(
      `insert into deliveries (event_id, endpoint_id)
       select $1, id from endpoints where app_id = $2 and is_active = true
       returning *`,
      [event.id, appId],
    )
    await client.query('commit')
    const deliveries = await Promise.all(deliveriesResult.rows.map((delivery) => deliver(delivery.id)))
    return { event, deliveriesCreated: deliveries.length, deliveries }
  } catch (error) {
    await client.query('rollback')
    if (error.code === '23505') {
      error.status = 409
      error.message = 'This event was already received.'
    }
    throw error
  } finally {
    client.release()
  }
}

const hashApiKey = (apiKey) => crypto.createHash('sha256').update(apiKey).digest('hex')

app.get('/api/health', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query('select now() as database_time')
  res.json({ ok: true, databaseTime: rows[0].database_time })
}))

app.get('/api/apps', asyncRoute(async (req, res) => {
  const { slug } = req.query
  const { rows } = await pool.query(
    slug ? 'select * from apps where slug = $1' : 'select * from apps order by created_at desc',
    slug ? [slug] : [],
  )
  res.json(rows)
}))

app.post('/api/apps', asyncRoute(async (req, res) => {
  const { name, slug } = req.body
  if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' })

  const { rows } = await pool.query(
    'insert into apps (name, slug) values ($1, $2) returning *',
    [name.trim(), slug.trim().toLowerCase()],
  )
  res.status(201).json(rows[0])
}))

app.patch('/api/apps/:id', asyncRoute(async (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  const { rows } = await pool.query(
    'update apps set name = $2 where id = $1 returning *',
    [req.params.id, name.trim()],
  )
  if (!rows[0]) return res.status(404).json({ error: 'App not found' })
  res.json(rows[0])
}))

app.get('/api/apps/:id/api-keys', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `select id, name, key_prefix, last_used_at, revoked_at, created_at
     from api_keys where app_id = $1 order by created_at desc`,
    [req.params.id],
  )
  res.json(rows)
}))

app.post('/api/apps/:id/api-keys', asyncRoute(async (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'A key name is required' })

  const apiKey = `wdc_live_${crypto.randomBytes(24).toString('hex')}`
  const { rows } = await pool.query(
    `insert into api_keys (app_id, name, key_prefix, key_hash)
     values ($1, $2, $3, $4)
     returning id, name, key_prefix, last_used_at, revoked_at, created_at`,
    [req.params.id, name.trim(), apiKey.slice(0, 13), hashApiKey(apiKey)],
  )
  res.status(201).json({ apiKey, key: rows[0] })
}))

app.post('/api/api-keys/:id/revoke', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `update api_keys set revoked_at = now()
     where id = $1 and revoked_at is null
     returning id, name, key_prefix, last_used_at, revoked_at, created_at`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'Active API key not found' })
  res.json(rows[0])
}))

app.post('/api/endpoints', asyncRoute(async (req, res) => {
  const { appId, name, url, signingSecret } = req.body
  if (!appId || !name || !url || !signingSecret) {
    return res.status(400).json({ error: 'appId, name, url, and signingSecret are required' })
  }

  try {
    new URL(url)
  } catch {
    return res.status(400).json({ error: 'url must be a valid URL' })
  }

  const { rows } = await pool.query(
    `insert into endpoints (app_id, name, url, signing_secret)
     values ($1, $2, $3, $4) returning id, app_id, name, url, is_active, created_at`,
    [appId, name.trim(), url, signingSecret],
  )
  res.status(201).json(rows[0])
}))

app.patch('/api/endpoints/:id', asyncRoute(async (req, res) => {
  const { name, url, signingSecret, isActive } = req.body
  if (url) {
    try { new URL(url) } catch { return res.status(400).json({ error: 'url must be a valid URL' }) }
  }

  const updates = []
  const values = [req.params.id]
  const addUpdate = (column, value) => { values.push(value); updates.push(`${column} = $${values.length}`) }
  if (name?.trim()) addUpdate('name', name.trim())
  if (url) addUpdate('url', url)
  if (signingSecret) addUpdate('signing_secret', signingSecret)
  if (typeof isActive === 'boolean') addUpdate('is_active', isActive)
  if (!updates.length) return res.status(400).json({ error: 'Provide endpoint details to update' })

  const { rows } = await pool.query(
    `update endpoints set ${updates.join(', ')}
     where id = $1 returning id, app_id, name, url, is_active, created_at`,
    values,
  )
  if (!rows[0]) return res.status(404).json({ error: 'Endpoint not found' })
  res.json(rows[0])
}))

app.get('/api/endpoints', asyncRoute(async (req, res) => {
  const { appId } = req.query
  if (!appId) return res.status(400).json({ error: 'appId is required' })

  const { rows } = await pool.query(
    `select endpoints.id, endpoints.name, endpoints.url, endpoints.is_active, endpoints.created_at,
            count(deliveries.id)::integer as delivery_count,
            count(deliveries.id) filter (where deliveries.status = 'failed')::integer as failed_count
     from endpoints
     left join deliveries on deliveries.endpoint_id = endpoints.id
     where endpoints.app_id = $1
     group by endpoints.id
     order by endpoints.created_at desc`,
    [appId],
  )
  res.json(rows)
}))

app.post('/api/events', asyncRoute(async (req, res) => {
  const { appId, eventType, payload = {}, idempotencyKey } = req.body
  if (!appId || !eventType) return res.status(400).json({ error: 'appId and eventType are required' })
  res.status(201).json(await createEvent(appId, { eventType, payload, idempotencyKey }))
}))

app.post('/api/ingest/events', asyncRoute(async (req, res) => {
  const apiKey = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!apiKey) return res.status(401).json({ error: 'Use Authorization: Bearer YOUR_API_KEY' })

  const { rows } = await pool.query(
    `select id, app_id from api_keys where key_hash = $1 and revoked_at is null`,
    [hashApiKey(apiKey)],
  )
  if (!rows[0]) return res.status(401).json({ error: 'Invalid or revoked API key' })

  await pool.query('update api_keys set last_used_at = now() where id = $1', [rows[0].id])
  const result = await createEvent(rows[0].app_id, req.body)
  res.status(201).json(result)
}))

app.get('/api/events', asyncRoute(async (req, res) => {
  const { appId } = req.query
  if (!appId) return res.status(400).json({ error: 'appId is required' })

  const { rows } = await pool.query(
    `select events.*, count(deliveries.id)::integer as delivery_count,
            count(deliveries.id) filter (where deliveries.status = 'delivered')::integer as delivered_count
     from events
     left join deliveries on deliveries.event_id = events.id
     where events.app_id = $1
     group by events.id
     order by events.created_at desc
     limit 100`,
    [appId],
  )
  res.json(rows)
}))

app.get('/api/deliveries', asyncRoute(async (req, res) => {
  const { appId, status } = req.query
  const values = []
  const filters = []
  if (appId) {
    values.push(appId)
    filters.push(`events.app_id = $${values.length}`)
  }
  if (status) {
    values.push(status)
    filters.push(`deliveries.status = $${values.length}`)
  }
  const where = filters.length ? `where ${filters.join(' and ')}` : ''
  const { rows } = await pool.query(
    `select deliveries.*, events.event_type, events.payload, endpoints.name as endpoint_name, endpoints.url as endpoint_url
     from deliveries
     join events on events.id = deliveries.event_id
     join endpoints on endpoints.id = deliveries.endpoint_id
     ${where}
     order by deliveries.created_at desc
     limit 100`,
    values,
  )
  res.json(rows)
}))

app.post('/api/deliveries/:id/retry', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `update deliveries
     set status = 'pending', response_status = null, response_body = null, next_attempt_at = now()
     where id = $1 returning *`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'Delivery not found' })
  const delivery = await deliver(rows[0].id)
  res.json(delivery)
}))

app.post('/api/test-receiver', (req, res) => {
  console.log(`Test receiver accepted ${req.body.type} (${req.body.id})`)
  res.status(204).end()
})

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong.' })
})

app.listen(port, () => {
  console.log(`WDC API listening on http://127.0.0.1:${port}`)
  setInterval(() => {
    processDueDeliveries().catch((error) => console.error('Retry worker failed:', error))
  }, 5_000)
})
