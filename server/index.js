import cors from 'cors'
import crypto from 'crypto'
import express from 'express'
import { createPasswordReset, createSession, hashPassword, hashValue, passwordMatches, removeSession, requireAuth } from './auth.js'
import { pool } from './db.js'
import { deliver, processDueDeliveries } from './delivery.js'
import { createSecurityAlert } from './security.js'
import { sendPasswordResetEmail, sendWorkspaceInviteEmail } from './email.js'

const app = express()
const port = Number(process.env.PORT || 4000)
const origins = new Set([process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'])
app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.has(origin)) }))
app.use(express.json({ limit: '100kb' }))

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
const hashApiKey = (key) => crypto.createHash('sha256').update(key).digest('hex')
const ingestionLimit = new Map()
const maxEventsPerMinute = 60
const replayWindowMs = 5 * 60 * 1000

function allowIngestion(apiKeyId) {
  const now = Date.now()
  const entry = ingestionLimit.get(apiKeyId)
  if (!entry || now >= entry.resetAt) {
    ingestionLimit.set(apiKeyId, { count: 1, resetAt: now + 60_000 })
    return { allowed: true, resetAt: now + 60_000 }
  }
  if (entry.count >= maxEventsPerMinute) return { allowed: false, resetAt: entry.resetAt }
  entry.count += 1
  return { allowed: true, resetAt: entry.resetAt }
}

async function workspaceAccess(userId, appId) {
  const { rows } = await pool.query(
    `select apps.*, case when apps.owner_id = $2 then 'owner' else workspace_members.role end as role
     from apps left join workspace_members on workspace_members.app_id = apps.id and workspace_members.user_id = $2
     where apps.id = $1 and (apps.owner_id = $2 or workspace_members.user_id is not null)`,
    [appId, userId],
  )
  if (!rows[0]) { const error = new Error('Workspace not found.'); error.status = 404; throw error }
  return rows[0]
}

function requireRole(access, roles) {
  if (!roles.includes(access.role)) { const error = new Error('You do not have permission for this action.'); error.status = 403; throw error }
  return access
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
app.post('/api/auth/password-reset/request', asyncRoute(async (req, res) => {
  const email = req.body.email?.trim().toLowerCase()
  const { rows } = await pool.query('select id from users where email = $1', [email])
  if (!rows[0]) return res.json({ message: 'If an account exists, a reset link has been created.' })
  const token = await createPasswordReset(rows[0].id)
  const delivery = await sendPasswordResetEmail(email, token)
  res.json({ message: delivery.sent ? 'Check your email for a password-reset link.' : 'A local password-reset link is ready.', resetToken: delivery.sent ? undefined : token, resetUrl: delivery.sent ? undefined : delivery.url })
}))
app.post('/api/auth/password-reset/confirm', asyncRoute(async (req, res) => {
  const { token, password } = req.body
  if (!token || !password || password.length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' })
  const { rows } = await pool.query('select * from password_resets where token_hash = $1 and expires_at > now()', [hashValue(token)])
  if (!rows[0]) return res.status(400).json({ error: 'This reset link is invalid or has expired.' })
  await pool.query('update users set password_hash = $2 where id = $1', [rows[0].user_id, await hashPassword(password)])
  await pool.query('delete from password_resets where user_id = $1', [rows[0].user_id])
  await pool.query('delete from sessions where user_id = $1', [rows[0].user_id])
  res.json({ message: 'Password updated. You can now sign in.' })
}))
app.post('/api/invitations/accept', requireAuth, asyncRoute(async (req, res) => {
  const { token } = req.body
  const { rows } = await pool.query('select * from workspace_invitations where token_hash = $1 and accepted_at is null and expires_at > now()', [hashValue(token || '')])
  const invitation = rows[0]
  if (!invitation || invitation.email !== req.user.email) return res.status(400).json({ error: 'This invitation is invalid, expired, or belongs to another email address.' })
  await pool.query(`insert into workspace_members (app_id, user_id, role) values ($1, $2, $3)
    on conflict (app_id, user_id) do update set role = excluded.role`, [invitation.app_id, req.user.id, invitation.role])
  await pool.query('update workspace_invitations set accepted_at = now() where id = $1', [invitation.id])
  res.json({ message: 'You joined the workspace.' })
}))

app.get('/api/apps', requireAuth, asyncRoute(async (req, res) => {
  const { slug } = req.query
  const { rows } = await pool.query(slug ? `select distinct apps.* from apps left join workspace_members on workspace_members.app_id = apps.id
    where apps.slug = $1 and (apps.owner_id = $2 or workspace_members.user_id = $2)` : `select distinct apps.* from apps left join workspace_members on workspace_members.app_id = apps.id
    where apps.owner_id = $1 or workspace_members.user_id = $1 order by apps.created_at desc`, slug ? [slug, req.user.id] : [req.user.id])
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
  requireRole(await workspaceAccess(req.user.id, req.params.id), ['owner', 'admin'])
  const { rows } = await pool.query('update apps set name = $2 where id = $1 returning *', [req.params.id, req.body.name.trim()])
  res.json(rows[0])
}))

app.get('/api/apps/:id/team', requireAuth, asyncRoute(async (req, res) => {
  const access = await workspaceAccess(req.user.id, req.params.id)
  const members = await pool.query(`select users.id, users.name, users.email, 'owner' as role, apps.owner_id as user_id from apps join users on users.id = apps.owner_id where apps.id = $1
    union all select users.id, users.name, users.email, workspace_members.role, workspace_members.user_id from workspace_members join users on users.id = workspace_members.user_id where workspace_members.app_id = $1 order by role, name`, [req.params.id])
  const invitations = ['owner', 'admin'].includes(access.role) ? await pool.query(`select id, email, role, expires_at, created_at from workspace_invitations
    where app_id = $1 and accepted_at is null and expires_at > now() order by created_at desc`, [req.params.id]) : { rows: [] }
  res.json({ role: access.role, members: members.rows, invitations: invitations.rows })
}))
app.post('/api/apps/:id/invitations', requireAuth, asyncRoute(async (req, res) => {
  requireRole(await workspaceAccess(req.user.id, req.params.id), ['owner', 'admin'])
  const { email, role } = req.body
  const normalizedEmail = email?.trim().toLowerCase()
  if (!normalizedEmail || !['admin', 'developer', 'viewer'].includes(role)) return res.status(400).json({ error: 'Enter an email and choose a valid role.' })
  const inviteToken = `wdc_invite_${crypto.randomBytes(24).toString('hex')}`
  const { rows } = await pool.query(`insert into workspace_invitations (app_id, email, role, token_hash, invited_by, expires_at)
    values ($1, $2, $3, $4, $5, $6) returning id, email, role, expires_at`, [req.params.id, normalizedEmail, role, hashValue(inviteToken), req.user.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)])
  await createSecurityAlert(req.params.id, 'team_invite_created', 'Workspace invitation created', `${normalizedEmail} was invited as ${role}.`)
  const workspace = await workspaceAccess(req.user.id, req.params.id)
  const delivery = await sendWorkspaceInviteEmail(normalizedEmail, workspace.name, role, inviteToken)
  res.status(201).json({ invitation: rows[0], inviteToken: delivery.sent ? undefined : inviteToken, inviteUrl: delivery.sent ? undefined : delivery.url, emailed: delivery.sent })
}))
app.patch('/api/apps/:id/members/:userId', requireAuth, asyncRoute(async (req, res) => {
  requireRole(await workspaceAccess(req.user.id, req.params.id), ['owner'])
  const { role } = req.body
  if (!['admin', 'developer', 'viewer'].includes(role)) return res.status(400).json({ error: 'Choose a valid staff role.' })
  const { rows } = await pool.query(`update workspace_members set role = $3 where app_id = $1 and user_id = $2
    returning user_id, role`, [req.params.id, req.params.userId, role])
  if (!rows[0]) return res.status(404).json({ error: 'Staff member not found.' })
  const member = (await pool.query('select email from users where id = $1', [req.params.userId])).rows[0]
  await createSecurityAlert(req.params.id, 'staff_role_changed', 'Staff role changed', `${member.email} is now a ${role}.`)
  res.json(rows[0])
}))
app.delete('/api/apps/:id/members/:userId', requireAuth, asyncRoute(async (req, res) => {
  requireRole(await workspaceAccess(req.user.id, req.params.id), ['owner'])
  const member = (await pool.query(`select users.email from workspace_members
    join users on users.id = workspace_members.user_id where workspace_members.app_id = $1 and workspace_members.user_id = $2`, [req.params.id, req.params.userId])).rows[0]
  if (!member) return res.status(404).json({ error: 'Staff member not found.' })
  await pool.query('delete from workspace_members where app_id = $1 and user_id = $2', [req.params.id, req.params.userId])
  await createSecurityAlert(req.params.id, 'staff_access_removed', 'Staff access removed', `${member.email} was removed from this workspace.`)
  res.status(204).end()
}))
app.get('/api/apps/:id/security-alerts', requireAuth, asyncRoute(async (req, res) => {
  requireRole(await workspaceAccess(req.user.id, req.params.id), ['owner', 'admin'])
  const { rows } = await pool.query('select * from security_alerts where app_id = $1 order by created_at desc limit 100', [req.params.id])
  res.json(rows)
}))

app.get('/api/apps/:id/api-keys', requireAuth, asyncRoute(async (req, res) => {
  requireRole(await workspaceAccess(req.user.id, req.params.id), ['owner', 'admin'])
  const { rows } = await pool.query('select id, name, key_prefix, last_used_at, revoked_at, rotation_started_at, replaced_by_id, created_at from api_keys where app_id = $1 order by created_at desc', [req.params.id])
  res.json(rows)
}))
app.post('/api/apps/:id/api-keys', requireAuth, asyncRoute(async (req, res) => {
  if (!req.body.name?.trim()) return res.status(400).json({ error: 'A key name is required' })
  requireRole(await workspaceAccess(req.user.id, req.params.id), ['owner', 'admin'])
  const apiKey = `wdc_live_${crypto.randomBytes(24).toString('hex')}`
  const { rows } = await pool.query('insert into api_keys (app_id, name, key_prefix, key_hash) values ($1, $2, $3, $4) returning id, name, key_prefix, last_used_at, revoked_at, rotation_started_at, replaced_by_id, created_at', [req.params.id, req.body.name.trim(), apiKey.slice(0, 13), hashApiKey(apiKey)])
  res.status(201).json({ apiKey, key: rows[0] })
}))
app.post('/api/api-keys/:id/rotate', requireAuth, asyncRoute(async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const oldKey = (await client.query('select * from api_keys where id = $1 and revoked_at is null for update', [req.params.id])).rows[0]
    if (!oldKey) { const error = new Error('Active API key not found.'); error.status = 404; throw error }
    requireRole(await workspaceAccess(req.user.id, oldKey.app_id), ['owner', 'admin'])
    const apiKey = `wdc_live_${crypto.randomBytes(24).toString('hex')}`
    const newKey = (await client.query(`insert into api_keys (app_id, name, key_prefix, key_hash)
      values ($1, $2, $3, $4) returning id, name, key_prefix, last_used_at, revoked_at, rotation_started_at, replaced_by_id, created_at`, [oldKey.app_id, `${oldKey.name} replacement`, apiKey.slice(0, 13), hashApiKey(apiKey)])).rows[0]
    await client.query('update api_keys set rotation_started_at = now(), replaced_by_id = $2 where id = $1', [oldKey.id, newKey.id])
    await client.query('commit')
    await createSecurityAlert(oldKey.app_id, 'api_key_rotation', 'API key rotation started', `${oldKey.name} was replaced by a new key.`)
    res.status(201).json({ apiKey, key: newKey, replacedKeyId: oldKey.id })
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally { client.release() }
}))
app.post('/api/api-keys/:id/revoke', requireAuth, asyncRoute(async (req, res) => {
  const key = (await pool.query('select * from api_keys where id = $1 and revoked_at is null', [req.params.id])).rows[0]
  if (!key) return res.status(404).json({ error: 'Active API key not found' })
  requireRole(await workspaceAccess(req.user.id, key.app_id), ['owner', 'admin'])
  const { rows } = await pool.query('update api_keys set revoked_at = now() where id = $1 returning id, name, key_prefix, last_used_at, revoked_at, created_at', [key.id])
  await createSecurityAlert(key.app_id, 'api_key_revoked', 'API key revoked', `${key.name} was revoked.`)
  res.json(rows[0])
}))

app.post('/api/endpoints', requireAuth, asyncRoute(async (req, res) => {
  const { appId, name, url, signingSecret } = req.body
  if (!appId || !name || !url || !signingSecret) return res.status(400).json({ error: 'appId, name, url, and signingSecret are required' })
  try { new URL(url) } catch { return res.status(400).json({ error: 'url must be a valid URL' }) }
  requireRole(await workspaceAccess(req.user.id, appId), ['owner', 'admin', 'developer'])
  const { rows } = await pool.query('insert into endpoints (app_id, name, url, signing_secret) values ($1, $2, $3, $4) returning id, app_id, name, url, is_active, created_at', [appId, name.trim(), url, signingSecret])
  res.status(201).json(rows[0])
}))
app.post('/api/apps/:id/test-endpoints/failure', requireAuth, asyncRoute(async (req, res) => {
  requireRole(await workspaceAccess(req.user.id, req.params.id), ['owner', 'admin', 'developer'])
  const url = `http://127.0.0.1:${port}/api/test-receiver/fail`
  const existing = (await pool.query('select * from endpoints where app_id = $1 and url = $2 and deleted_at is null', [req.params.id, url])).rows[0]
  if (existing) { const { rows } = await pool.query('update endpoints set is_active = true where id = $1 returning id, name, url, is_active', [existing.id]); return res.json({ endpoint: rows[0], created: false }) }
  const { rows } = await pool.query(`insert into endpoints (app_id, name, url, signing_secret) values ($1, 'Simulated failing receiver', $2, 'wdc_failure_demo_secret') returning id, name, url, is_active`, [req.params.id, url])
  res.status(201).json({ endpoint: rows[0], created: true })
}))
app.patch('/api/endpoints/:id', requireAuth, asyncRoute(async (req, res) => {
  const { name, url, signingSecret, isActive } = req.body
  if (url) { try { new URL(url) } catch { return res.status(400).json({ error: 'url must be a valid URL' }) } }
  const endpoint = (await pool.query('select app_id from endpoints where id = $1 and deleted_at is null', [req.params.id])).rows[0]
  if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' })
  requireRole(await workspaceAccess(req.user.id, endpoint.app_id), ['owner', 'admin', 'developer'])
  const updates = []; const values = [req.params.id]
  const addUpdate = (column, value) => { values.push(value); updates.push(`${column} = $${values.length}`) }
  if (name?.trim()) addUpdate('name', name.trim()); if (url) addUpdate('url', url); if (signingSecret) addUpdate('signing_secret', signingSecret); if (typeof isActive === 'boolean') addUpdate('is_active', isActive)
  if (!updates.length) return res.status(400).json({ error: 'Provide endpoint details to update' })
  const { rows } = await pool.query(`update endpoints set ${updates.join(', ')}
    where endpoints.id = $1 and endpoints.deleted_at is null
    returning endpoints.id, endpoints.app_id, endpoints.name, endpoints.url, endpoints.is_active, endpoints.created_at`, values)
  res.json(rows[0])
}))
app.delete('/api/endpoints/:id', requireAuth, asyncRoute(async (req, res) => {
  const endpoint = (await pool.query('select app_id from endpoints where id = $1 and deleted_at is null', [req.params.id])).rows[0]
  if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' })
  requireRole(await workspaceAccess(req.user.id, endpoint.app_id), ['owner', 'admin', 'developer'])
  const { rows } = await pool.query('update endpoints set is_active = false, deleted_at = now() where id = $1 returning id, name', [req.params.id])
  res.json(rows[0])
}))
app.get('/api/endpoints', requireAuth, asyncRoute(async (req, res) => {
  if (!req.query.appId) return res.status(400).json({ error: 'appId is required' })
  await workspaceAccess(req.user.id, req.query.appId)
  const { rows } = await pool.query(`select endpoints.id, endpoints.name, endpoints.url, endpoints.is_active, endpoints.created_at,
    count(deliveries.id)::integer as delivery_count, count(deliveries.id) filter (where deliveries.status = 'failed')::integer as failed_count
    from endpoints left join deliveries on deliveries.endpoint_id = endpoints.id
    where endpoints.app_id = $1 and endpoints.deleted_at is null group by endpoints.id order by endpoints.created_at desc`, [req.query.appId])
  res.json(rows)
}))

app.post('/api/events', requireAuth, asyncRoute(async (req, res) => {
  const { appId, eventType, payload = {}, idempotencyKey } = req.body
  if (!appId || !eventType) return res.status(400).json({ error: 'appId and eventType are required' })
  requireRole(await workspaceAccess(req.user.id, appId), ['owner', 'admin', 'developer'])
  res.status(201).json(await createEvent(appId, { eventType, payload, idempotencyKey }))
}))
app.post('/api/ingest/events', asyncRoute(async (req, res) => {
  const apiKey = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!apiKey) return res.status(401).json({ error: 'Use Authorization: Bearer YOUR_API_KEY' })
  const { rows } = await pool.query('select id, app_id, revoked_at from api_keys where key_hash = $1', [hashApiKey(apiKey)])
  if (!rows[0] || rows[0].revoked_at) {
    if (rows[0]?.revoked_at) await createSecurityAlert(rows[0].app_id, 'revoked_key_used', 'Revoked API key used', 'A request was attempted with a revoked API key.')
    return res.status(401).json({ error: 'Invalid or revoked API key' })
  }
  const timestamp = Date.parse(req.get('webhookly-timestamp') || '')
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > replayWindowMs) {
    await createSecurityAlert(rows[0].app_id, 'replay_blocked', 'Expired request blocked', 'An event request used a missing, invalid, or expired timestamp.')
    return res.status(401).json({ error: 'Request timestamp is missing, invalid, or older than 5 minutes.' })
  }
  if (!req.body.idempotencyKey) return res.status(400).json({ error: 'idempotencyKey is required for replay protection.' })
  const limit = allowIngestion(rows[0].id)
  if (!limit.allowed) {
    await createSecurityAlert(rows[0].app_id, 'rate_limit_triggered', 'Rate limit triggered', `An API key exceeded ${maxEventsPerMinute} events per minute.`)
    res.set('Retry-After', String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))))
    return res.status(429).json({ error: `Rate limit reached. Each API key can send ${maxEventsPerMinute} events per minute.` })
  }
  await pool.query('update api_keys set last_used_at = now() where id = $1', [rows[0].id])
  res.status(201).json(await createEvent(rows[0].app_id, req.body))
}))
app.get('/api/events', requireAuth, asyncRoute(async (req, res) => {
  if (!req.query.appId) return res.status(400).json({ error: 'appId is required' })
  await workspaceAccess(req.user.id, req.query.appId)
  const { rows } = await pool.query(`select events.*, count(deliveries.id)::integer as delivery_count,
    count(deliveries.id) filter (where deliveries.status = 'delivered')::integer as delivered_count
    from events left join deliveries on deliveries.event_id = events.id
    where events.app_id = $1 group by events.id order by events.created_at desc limit 100`, [req.query.appId])
  res.json(rows)
}))
app.get('/api/deliveries', requireAuth, asyncRoute(async (req, res) => {
  if (!req.query.appId) return res.status(400).json({ error: 'appId is required' })
  await workspaceAccess(req.user.id, req.query.appId)
  const values = [req.query.appId]; const filters = ['events.app_id = $1']
  if (req.query.status) { values.push(req.query.status); filters.push(`deliveries.status = $${values.length}`) }
  const { rows } = await pool.query(`select deliveries.*, events.event_type, events.payload, endpoints.name as endpoint_name, endpoints.url as endpoint_url
    from deliveries join events on events.id = deliveries.event_id join endpoints on endpoints.id = deliveries.endpoint_id
    where ${filters.join(' and ')} order by deliveries.created_at desc limit 100`, values)
  res.json(rows)
}))
app.post('/api/deliveries/:id/retry', requireAuth, asyncRoute(async (req, res) => {
  const delivery = (await pool.query('select events.app_id from deliveries join events on events.id = deliveries.event_id where deliveries.id = $1', [req.params.id])).rows[0]
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' })
  requireRole(await workspaceAccess(req.user.id, delivery.app_id), ['owner', 'admin', 'developer'])
  const { rows } = await pool.query(`update deliveries set status = 'pending', response_status = null, response_body = null, next_attempt_at = now() where id = $1 returning *`, [req.params.id])
  res.json(await deliver(rows[0].id))
}))

app.post('/api/test-receiver', (req, res) => { console.log(`Test receiver accepted ${req.body.type} (${req.body.id})`); res.status(204).end() })
app.post('/api/test-receiver/fail', (req, res) => { console.log(`Failure demo rejected ${req.body.type} (${req.body.id})`); res.status(503).json({ error: 'Simulated receiver outage' }) })
app.use((error, _req, res, _next) => { console.error(error); res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong.' }) })
app.listen(port, () => { console.log(`WDC API listening on http://127.0.0.1:${port}`); setInterval(() => processDueDeliveries().catch((error) => console.error('Retry worker failed:', error)), 5_000) })
