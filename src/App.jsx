import { useEffect, useMemo, useState } from 'react'
import IconActivity from '@tabler/icons-react/dist/esm/icons/IconActivity.mjs'
import IconAlertCircle from '@tabler/icons-react/dist/esm/icons/IconAlertCircle.mjs'
import IconBell from '@tabler/icons-react/dist/esm/icons/IconBell.mjs'
import IconCheck from '@tabler/icons-react/dist/esm/icons/IconCheck.mjs'
import IconChevronDown from '@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs'
import IconCircleCheck from '@tabler/icons-react/dist/esm/icons/IconCircleCheck.mjs'
import IconCode from '@tabler/icons-react/dist/esm/icons/IconCode.mjs'
import IconCopy from '@tabler/icons-react/dist/esm/icons/IconCopy.mjs'
import IconHelpCircle from '@tabler/icons-react/dist/esm/icons/IconHelpCircle.mjs'
import IconKey from '@tabler/icons-react/dist/esm/icons/IconKey.mjs'
import IconListDetails from '@tabler/icons-react/dist/esm/icons/IconListDetails.mjs'
import IconLogout from '@tabler/icons-react/dist/esm/icons/IconLogout.mjs'
import IconPlus from '@tabler/icons-react/dist/esm/icons/IconPlus.mjs'
import IconPlayerPause from '@tabler/icons-react/dist/esm/icons/IconPlayerPause.mjs'
import IconPlayerPlay from '@tabler/icons-react/dist/esm/icons/IconPlayerPlay.mjs'
import IconPencil from '@tabler/icons-react/dist/esm/icons/IconPencil.mjs'
import IconPlugConnected from '@tabler/icons-react/dist/esm/icons/IconPlugConnected.mjs'
import IconRefresh from '@tabler/icons-react/dist/esm/icons/IconRefresh.mjs'
import IconSend from '@tabler/icons-react/dist/esm/icons/IconSend.mjs'
import IconSettings from '@tabler/icons-react/dist/esm/icons/IconSettings.mjs'
import IconShieldCheck from '@tabler/icons-react/dist/esm/icons/IconShieldCheck.mjs'
import IconTerminal2 from '@tabler/icons-react/dist/esm/icons/IconTerminal2.mjs'
import IconTrash from '@tabler/icons-react/dist/esm/icons/IconTrash.mjs'
import IconX from '@tabler/icons-react/dist/esm/icons/IconX.mjs'
import './App.css'
import './Wdc.css'

const API = 'http://127.0.0.1:4000/api'
const iconProps = { size: 17, stroke: 1.8, 'aria-hidden': true }
const signatureGuideCode = `import crypto from 'node:crypto'
import express from 'express'

const app = express()

app.post('/webhooks/wdc', express.raw({ type: 'application/json' }), (req, res) => {
  const received = req.get('webhookly-signature')
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WDC_SIGNING_SECRET)
    .update(req.body)
    .digest('hex')

  const valid = received && Buffer.byteLength(received) === Buffer.byteLength(expected) &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))

  if (!valid) return res.status(401).json({ error: 'Invalid signature' })

  const event = JSON.parse(req.body.toString('utf8'))
  console.log(event.type, event.data)
  res.sendStatus(204)
})`

function displayDelivery(row) {
  const status = row.status[0].toUpperCase() + row.status.slice(1)
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(row.created_at)) / 1000))
  const time = seconds < 60 ? 'just now' : seconds < 3600 ? `${Math.floor(seconds / 60)} min ago` : `${Math.floor(seconds / 3600)} hr ago`
  return { ...row, event: row.event_type, endpoint: row.endpoint_name, time, status, code: row.response_status || (status === 'Pending' ? '...' : '-'), color: status === 'Delivered' ? 'green' : status === 'Failed' ? 'red' : 'amber', body: JSON.stringify(row.payload, null, 2), retryAt: row.next_attempt_at ? new Date(row.next_attempt_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null }
}

function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('wdc_session'))
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [view, setView] = useState('deliveries')
  const [deliveries, setDeliveries] = useState([])
  const [endpoints, setEndpoints] = useState([])
  const [events, setEvents] = useState([])
  const [apiKeys, setApiKeys] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('All')
  const [appId, setAppId] = useState(null)
  const [eventType, setEventType] = useState('order.created')
  const [showEvent, setShowEvent] = useState(false)
  const [showEndpoint, setShowEndpoint] = useState(false)
  const [editingEndpoint, setEditingEndpoint] = useState(null)
  const [showKeyForm, setShowKeyForm] = useState(false)
  const [apiKeyName, setApiKeyName] = useState('')
  const [newApiKey, setNewApiKey] = useState('')
  const [endpointForm, setEndpointForm] = useState({ name: '', url: '', signingSecret: '' })
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const filteredDeliveries = useMemo(() => filter === 'All' ? deliveries : deliveries.filter((item) => item.status === filter), [deliveries, filter])
  const deliveredCount = deliveries.filter((item) => item.status === 'Delivered').length

  async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers)
    if (authToken) headers.set('authorization', `Bearer ${authToken}`)
    return fetch(`${API}${path}`, { ...options, headers })
  }

  async function loadData() {
    const appsResponse = await apiFetch('/apps?slug=tkc-foods')
    if (appsResponse.status === 401) throw new Error('SESSION_EXPIRED')
    const apps = await appsResponse.json()
    if (!apps[0]) throw new Error('No workspace is available for this account.')
    setWorkspace(apps[0])
    setAppId(apps[0].id)
    const [deliveryRows, endpointRows, eventRows, apiKeyRows] = await Promise.all([
      apiFetch(`/deliveries?appId=${apps[0].id}`).then((response) => response.json()),
      apiFetch(`/endpoints?appId=${apps[0].id}`).then((response) => response.json()),
      apiFetch(`/events?appId=${apps[0].id}`).then((response) => response.json()),
      apiFetch(`/apps/${apps[0].id}/api-keys`).then((response) => response.json()),
    ])
    const formatted = deliveryRows.map(displayDelivery)
    setDeliveries(formatted)
    setEndpoints(endpointRows)
    setEvents(eventRows)
    setApiKeys(apiKeyRows)
    setSelected((current) => formatted.find((item) => item.id === current?.id) || formatted[0] || null)
  }

  useEffect(() => {
    if (!authToken) { setAuthReady(true); return undefined }
    apiFetch('/auth/me').then(async (response) => {
      if (!response.ok) throw new Error('SESSION_EXPIRED')
      const result = await response.json(); setUser(result.user); await loadData()
    }).catch((loadError) => {
      if (loadError.message === 'SESSION_EXPIRED') { localStorage.removeItem('wdc_session'); setAuthToken(null) } else setError(loadError.message)
    }).finally(() => setAuthReady(true))
    return undefined
  }, [authToken])
  useEffect(() => {
    if (!notice) return undefined
    const timeoutId = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timeoutId)
  }, [notice])

  async function authenticate(mode, form) {
    const response = await fetch(`${API}/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Unable to authenticate.')
    localStorage.setItem('wdc_session', result.token); setUser(result.user); setAuthToken(result.token)
  }

  async function logout() {
    try { await apiFetch('/auth/logout', { method: 'POST' }) } finally {
      localStorage.removeItem('wdc_session'); setAuthToken(null); setUser(null); setWorkspace(null); setDeliveries([]); setEndpoints([]); setEvents([]); setApiKeys([])
    }
  }

  async function sendEvent() {
    if (!appId) return setError('The TKC Foods demo is not ready yet.')
    setError('')
    setShowEvent(false)
    setNotice(`Sending ${eventType}...`)
    try {
      const response = await apiFetch('/events', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId, eventType, payload: { order_id: `TKC-${Date.now().toString().slice(-4)}`, total: 9200 }, idempotencyKey: crypto.randomUUID() }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to send event.')
      await loadData()
      setNotice(result.deliveries.some((delivery) => delivery.status === 'pending') ? `${eventType} is queued for retry.` : `${eventType} was delivered.`)
    } catch (sendError) {
      setNotice('')
      setError(sendError.message)
    }
  }

  async function addEndpoint(event) {
    event.preventDefault()
    if (!appId) return
    setError(''); setNotice('')
    const response = await apiFetch('/endpoints', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId, ...endpointForm }),
    })
    if (!response.ok) return setError((await response.json()).error || 'Unable to add endpoint.')
    await loadData(); setShowEndpoint(false); setEndpointForm({ name: '', url: '', signingSecret: '' }); setNotice('Endpoint added successfully.')
  }

  async function toggleEndpoint(endpoint) {
    setError(''); setNotice('')
    const response = await apiFetch(`/endpoints/${endpoint.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isActive: !endpoint.is_active }),
    })
    if (!response.ok) return setError((await response.json()).error || 'Unable to update endpoint.')
    await loadData()
    setNotice(`${endpoint.name} ${endpoint.is_active ? 'paused' : 'activated'}.`)
  }

  async function createFailureDemo() {
    const response = await apiFetch(`/apps/${appId}/test-endpoints/failure`, { method: 'POST' })
    const result = await response.json()
    if (!response.ok) return setError(result.error || 'Unable to create failure demo.')
    await loadData()
    setNotice(result.created ? 'Failure demo endpoint created. Send an event to test retries.' : 'Failure demo endpoint is active.')
  }

  function openEditEndpoint(endpoint) {
    setEndpointForm({ name: endpoint.name, url: endpoint.url, signingSecret: '' })
    setEditingEndpoint(endpoint)
    setShowEndpoint(true)
  }

  async function updateEndpoint(event) {
    event.preventDefault()
    if (!editingEndpoint) return
    const body = { name: endpointForm.name, url: endpointForm.url }
    if (endpointForm.signingSecret) body.signingSecret = endpointForm.signingSecret
    const response = await apiFetch(`/endpoints/${editingEndpoint.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!response.ok) return setError((await response.json()).error || 'Unable to update endpoint.')
    await loadData(); setShowEndpoint(false); setEditingEndpoint(null); setEndpointForm({ name: '', url: '', signingSecret: '' }); setNotice('Endpoint updated.')
  }

  async function deleteEndpoint(endpoint) {
    if (!window.confirm(`Remove ${endpoint.name}? Past delivery logs will be kept.`)) return
    const response = await apiFetch(`/endpoints/${endpoint.id}`, { method: 'DELETE' })
    if (!response.ok) return setError((await response.json()).error || 'Unable to remove endpoint.')
    await loadData(); setNotice(`${endpoint.name} was removed.`)
  }

  async function createApiKey(event) {
    event.preventDefault()
    const response = await apiFetch(`/apps/${appId}/api-keys`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: apiKeyName }),
    })
    const result = await response.json()
    if (!response.ok) return setError(result.error || 'Unable to create API key.')
    setShowKeyForm(false); setApiKeyName(''); setNewApiKey(result.apiKey)
    await loadData()
  }

  async function revokeApiKey(key) {
    const response = await apiFetch(`/api-keys/${key.id}/revoke`, { method: 'POST' })
    if (!response.ok) return setError((await response.json()).error || 'Unable to revoke API key.')
    await loadData(); setNotice(`${key.name} was revoked.`)
  }

  async function retry(delivery = selected) {
    if (!delivery) return
    const response = await apiFetch(`/deliveries/${delivery.id}/retry`, { method: 'POST' })
    const result = await response.json()
    if (!response.ok) return setError(result.error || 'Unable to retry delivery.')
    await loadData(); setNotice(result.status === 'pending' ? 'Retry attempted. WDC scheduled the next retry.' : 'Delivery retried.')
  }

  async function saveWorkspace(name) {
    const response = await apiFetch(`/apps/${appId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
    if (!response.ok) return setError((await response.json()).error || 'Unable to update workspace.')
    await loadData(); setNotice('Workspace name updated.')
  }

  const navItems = [
    ['deliveries', 'Deliveries', IconActivity], ['events', 'Events', IconListDetails], ['endpoints', 'Endpoints', IconPlugConnected], ['api-keys', 'API Keys', IconKey], ['verify', 'Verify', IconShieldCheck], ['logs', 'Logs', IconTerminal2],
  ]

  if (!authReady) return <main className="auth-page"><div className="auth-loading">Loading Webhookly...</div></main>
  if (!user) return <AuthScreen onAuthenticate={authenticate} />

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">w</span><span>webhookly</span></div>
      <button className="workspace"><span className="workspace-dot" />TKC Foods <IconChevronDown {...iconProps} /></button>
      <nav aria-label="Main navigation">{navItems.map(([id, label, Icon]) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => setView(id)} aria-label={label} title={label}><Icon {...iconProps} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')} aria-label="Settings" title="Settings"><IconSettings {...iconProps} /><span>Settings</span></button><div className="user"><div className="avatar">{user.name.slice(0, 2).toUpperCase()}</div><div><strong>{user.name}</strong><small>Owner</small></div><button className="logout-button" onClick={logout} aria-label="Sign out" title="Sign out"><IconLogout {...iconProps} /></button></div></div>
    </aside>

    <section className="content">
      <header className="topbar"><div className="crumb">Workspace <b>/</b><strong>{view[0].toUpperCase() + view.slice(1)}</strong></div><div className="top-actions"><button className="icon-button top-action" aria-label="Notifications" title="Notifications" onClick={() => { setShowNotifications((visible) => !visible); setShowHelp(false) }}><IconBell {...iconProps} /></button><button className="icon-button top-action" aria-label="Help" title="Help" onClick={() => { setShowHelp((visible) => !visible); setShowNotifications(false) }}><IconHelpCircle {...iconProps} /></button><TopPopover type={showNotifications ? 'notifications' : showHelp ? 'help' : null} deliveries={deliveries} onClose={() => { setShowNotifications(false); setShowHelp(false) }} /></div></header>
      {notice && <div className="toast"><IconCircleCheck {...iconProps} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notification"><IconX {...iconProps} /></button></div>}
      {error && <div className="toast error-toast"><IconAlertCircle {...iconProps} />{error}<button onClick={() => setError('')} aria-label="Dismiss error"><IconX {...iconProps} /></button></div>}
      {view === 'deliveries' && <DeliveriesView deliveries={filteredDeliveries} selected={selected} setSelected={setSelected} filter={filter} setFilter={setFilter} deliveredCount={deliveredCount} onSend={() => setShowEvent(true)} onRetry={retry} />}
      {view === 'endpoints' && <EndpointsView endpoints={endpoints} onAdd={() => { setEditingEndpoint(null); setEndpointForm({ name: '', url: '', signingSecret: '' }); setShowEndpoint(true) }} onToggle={toggleEndpoint} onEdit={openEditEndpoint} onDelete={deleteEndpoint} onCreateFailure={createFailureDemo} />}
      {view === 'api-keys' && <ApiKeysView apiKeys={apiKeys} onCreate={() => setShowKeyForm(true)} onRevoke={revokeApiKey} />}
      {view === 'verify' && <SignatureGuideView />}
      {view === 'events' && <EventsView events={events} onSend={() => setShowEvent(true)} />}
      {view === 'logs' && <LogsView deliveries={deliveries} />}
      {view === 'settings' && <SettingsView workspace={workspace} endpointCount={endpoints.length} onSave={saveWorkspace} />}
    </section>

    {view === 'deliveries' && <DeliveryDetail selected={selected} onRetry={retry} />}
    {showEvent && <EventModal eventType={eventType} setEventType={setEventType} onClose={() => setShowEvent(false)} onSend={sendEvent} />}
    {showEndpoint && <EndpointModal form={endpointForm} setForm={setEndpointForm} editing={editingEndpoint} onClose={() => { setShowEndpoint(false); setEditingEndpoint(null) }} onSubmit={editingEndpoint ? updateEndpoint : addEndpoint} />}
    {showKeyForm && <ApiKeyModal name={apiKeyName} setName={setApiKeyName} onClose={() => setShowKeyForm(false)} onSubmit={createApiKey} />}
    {newApiKey && <NewApiKeyModal apiKey={newApiKey} onClose={() => setNewApiKey('')} />}
  </main>
}

function AuthScreen({ onAuthenticate }) {
  const [mode, setMode] = useState('signup')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value })
  async function submit(event) {
    event.preventDefault(); setError(''); setSubmitting(true)
    try { await onAuthenticate(mode, form) } catch (authError) { setError(authError.message) } finally { setSubmitting(false) }
  }
  const isSignup = mode === 'signup'
  return <main className="auth-page"><section className="auth-panel"><div className="auth-brand"><span className="brand-mark">w</span><strong>webhookly</strong></div><p className="eyebrow">{isSignup ? 'CREATE YOUR WORKSPACE' : 'WELCOME BACK'}</p><h1>{isSignup ? 'Start sending reliable webhooks.' : 'Sign in to Webhookly.'}</h1><p className="auth-copy">{isSignup ? 'Deliver every important event with signed requests, clear delivery logs, and automatic retries when systems are unavailable.' : 'Use your owner account to manage your webhook workspace.'}</p><form onSubmit={submit} className="auth-form">{isSignup && <label>Full name<input required value={form.name} onChange={update('name')} placeholder="e.g. Amara Okafor" autoComplete="name" /></label>}<label>Email address<input required type="email" value={form.email} onChange={update('email')} placeholder="you@example.com" autoComplete="email" /></label><label>Password<input required type="password" minLength="8" value={form.password} onChange={update('password')} placeholder="At least 8 characters" autoComplete={isSignup ? 'new-password' : 'current-password'} /></label>{error && <p className="auth-error"><IconAlertCircle {...iconProps} />{error}</p>}<button className="primary-button wide" disabled={submitting} type="submit">{submitting ? 'Please wait...' : isSignup ? 'Create account' : 'Sign in'}</button></form><button className="auth-switch" onClick={() => { setMode(isSignup ? 'login' : 'signup'); setError('') }}>{isSignup ? 'Already have an account? Sign in' : 'New to Webhookly? Create an account'}</button></section></main>
}

function DeliveriesView({ deliveries, selected, setSelected, filter, setFilter, deliveredCount, onSend, onRetry }) {
  return <>
    <div className="page-head"><div><p className="eyebrow">ACTIVITY</p><h1>Deliveries</h1><p className="subhead">Every event your apps have sent, in one reliable place.</p></div><button className="primary-button" onClick={onSend}><IconSend {...iconProps} /> Send test event</button></div>
    <section className="stats"><div><span className="stat-label">DELIVERED TODAY</span><strong>{deliveredCount}</strong><small className="positive">Live database data</small></div><div><span className="stat-label">SUCCESS RATE</span><strong>{deliveries.length ? `${Math.round(deliveredCount / deliveries.length * 100)}%` : '-'}</strong><small className="positive">For TKC Foods</small></div><div><span className="stat-label">ACTIVE ENDPOINTS</span><strong>1</strong><small className="positive">Ready to receive events</small></div><div><span className="stat-label">REQUIRES ATTENTION</span><strong className="attention">{deliveries.filter((item) => item.status !== 'Delivered').length}</strong><small className="neutral">Failed or pending deliveries</small></div></section>
    <section className="delivery-section"><div className="section-toolbar"><div className="tabs">{['All', 'Delivered', 'Failed', 'Pending'].map((item) => <button key={item} className={filter === item ? 'tab active-tab' : 'tab'} onClick={() => setFilter(item)}>{item}</button>)}</div><button className="refresh-button" onClick={() => window.location.reload()}><IconRefresh {...iconProps} /> Refresh</button></div><div className="table-wrap"><table><thead><tr><th>EVENT</th><th>ENDPOINT</th><th>TIME</th><th>STATUS</th><th>RESPONSE</th></tr></thead><tbody>{deliveries.map((item) => <tr key={item.id} className={selected?.id === item.id ? 'selected-row' : ''} onClick={() => setSelected(item)}><td><strong>{item.event}</strong><small>{item.id.slice(0, 12)}</small></td><td>{item.endpoint}</td><td>{item.time}</td><td><span className={`status ${item.color}`}><i />{item.status}</span></td><td className="response-cell"><code>{item.code}</code>{item.status !== 'Delivered' && <button className="inline-retry" onClick={(event) => { event.stopPropagation(); onRetry(item) }} aria-label={`Retry ${item.event}`} title="Retry now"><IconRefresh {...iconProps} /></button>}</td></tr>)}</tbody></table>{!deliveries.length && <div className="empty-state"><IconActivity size={24} stroke={1.5} /><strong>No deliveries yet</strong><span>Send a test event to create your first webhook delivery.</span></div>}</div></section>
  </>
}

function EndpointsView({ endpoints, onAdd, onToggle, onEdit, onDelete, onCreateFailure }) {
  return <section className="endpoints-view"><div className="page-head"><div><p className="eyebrow">DESTINATIONS</p><h1>Endpoints</h1><p className="subhead">Choose where Webhookly should send your events.</p></div><button className="primary-button" onClick={onAdd}><IconPlus {...iconProps} /> Add endpoint</button></div><div className="test-mode-bar"><div><strong>Retry test mode</strong><span>Add a receiver that always returns 503 so you can inspect pending retries.</span></div><button className="test-mode-button" onClick={onCreateFailure}><IconAlertCircle {...iconProps} /> Add failing receiver</button></div><div className="endpoint-list">{endpoints.map((endpoint) => <article className="endpoint-row" key={endpoint.id}><div className="endpoint-icon"><IconSend {...iconProps} /></div><div className="endpoint-main"><div className="endpoint-name"><strong>{endpoint.name}</strong><span className={endpoint.is_active ? 'endpoint-live' : 'endpoint-paused'}>{endpoint.is_active ? 'Active' : 'Paused'}</span></div><code>{endpoint.url}</code><small>{endpoint.delivery_count} deliveries {endpoint.failed_count ? `- ${endpoint.failed_count} failed` : ''}</small></div><div className="endpoint-controls"><button className="icon-button endpoint-action" onClick={() => onEdit(endpoint)} aria-label={`Edit ${endpoint.name}`} title="Edit endpoint"><IconPencil {...iconProps} /></button><button className="icon-button endpoint-action" onClick={() => onToggle(endpoint)} aria-label={`${endpoint.is_active ? 'Pause' : 'Activate'} ${endpoint.name}`} title={endpoint.is_active ? 'Pause endpoint' : 'Activate endpoint'}>{endpoint.is_active ? <IconPlayerPause {...iconProps} /> : <IconPlayerPlay {...iconProps} />}</button><button className="icon-button endpoint-action delete-endpoint" onClick={() => onDelete(endpoint)} aria-label={`Remove ${endpoint.name}`} title="Remove endpoint"><IconTrash {...iconProps} /></button></div></article>)}</div>{!endpoints.length && <div className="blank-endpoints"><IconSend size={34} stroke={1.4} /><h2>Connect your first endpoint</h2><p>Add a URL where Webhookly can send events from TKC Foods.</p><button className="primary-button" onClick={onAdd}><IconPlus {...iconProps} /> Add endpoint</button></div>}</section>
}

function ApiKeysView({ apiKeys, onCreate, onRevoke }) {
  return <section className="resource-view"><div className="page-head"><div><p className="eyebrow">AUTHENTICATION</p><h1>API Keys</h1><p className="subhead">Use a key to let your app securely send events into Webhookly.</p></div><button className="primary-button" onClick={onCreate}><IconPlus {...iconProps} /> Create API key</button></div><div className="api-key-list">{apiKeys.map((key) => <article className="api-key-row" key={key.id}><span className="api-key-icon"><IconKey {...iconProps} /></span><div><strong>{key.name}</strong><code>{key.key_prefix}...</code><small>{key.last_used_at ? `Last used ${new Date(key.last_used_at).toLocaleString()}` : 'Never used'}</small></div>{key.revoked_at ? <span className="endpoint-paused">Revoked</span> : <button className="revoke-button" onClick={() => onRevoke(key)}>Revoke</button>}</article>)}</div>{!apiKeys.length && <EmptyResource icon={IconKey} title="No API keys yet" body="Create a key to let TKC Foods send secure events into WDC." action={onCreate} label="Create API key" />}</section>
}

function SignatureGuideView() {
  const [copied, setCopied] = useState(false)
  async function copyCode() { await navigator.clipboard.writeText(signatureGuideCode); setCopied(true); window.setTimeout(() => setCopied(false), 2000) }
  return <section className="resource-view guide-view"><div className="page-head"><div><p className="eyebrow">SECURITY GUIDE</p><h1>Verify signatures</h1><p className="subhead">Confirm that each webhook request truly came from WDC before using its data.</p></div></div><div className="guide-content"><section className="guide-step"><span>1</span><div><h2>Keep the signing secret private</h2><p>Use the signing secret from your endpoint in the receiving app’s environment variables as <code>WDC_SIGNING_SECRET</code>.</p></div></section><section className="guide-step"><span>2</span><div><h2>Verify the raw request body</h2><p>Use this Express route before any JSON parser. The signature is made from the exact bytes WDC sent.</p></div></section><div className="code-toolbar"><strong>Node.js and Express</strong><button className="icon-button" onClick={copyCode} aria-label={copied ? 'Code copied' : 'Copy signature verification code'} title={copied ? 'Copied' : 'Copy code'}><IconCopy {...iconProps} /></button></div><pre className="guide-code"><code>{signatureGuideCode}</code></pre><section className="guide-step"><span>3</span><div><h2>Respond quickly</h2><p>Return a <code>2xx</code> response after accepting the event. WDC treats errors and timeouts as failed deliveries and retries them automatically.</p></div></section></div></section>
}

function EventsView({ events, onSend }) {
  return <section className="resource-view"><div className="page-head"><div><p className="eyebrow">EVENT STREAM</p><h1>Events</h1><p className="subhead">Every important change produced by TKC Foods.</p></div><button className="primary-button" onClick={onSend}><IconSend {...iconProps} /> Send test event</button></div><div className="event-list">{events.map((event) => <article className="event-row" key={event.id}><div className="event-icon"><IconActivity {...iconProps} /></div><div className="event-main"><strong>{event.event_type}</strong><code>{event.id}</code><pre>{JSON.stringify(event.payload, null, 2)}</pre></div><div className="event-delivery"><span>{event.delivered_count}/{event.delivery_count}</span><small>delivered</small></div></article>)}</div>{!events.length && <EmptyResource icon={IconListDetails} title="No events yet" body="Events appear here when TKC Foods tells Webhookly that something happened." action={onSend} label="Send test event" />}</section>
}

function LogsView({ deliveries }) {
  return <section className="resource-view"><div className="page-head"><div><p className="eyebrow">REQUEST HISTORY</p><h1>Logs</h1><p className="subhead">Technical records for every delivery attempt made by Webhookly.</p></div></div><div className="logs-list">{deliveries.map((delivery) => <article className="log-row" key={delivery.id}><span className={`log-marker ${delivery.color}`}><IconTerminal2 {...iconProps} /></span><div><strong>{delivery.event}</strong><p>POST <code>{delivery.endpoint_url}</code></p></div><div className="log-response"><span className={`status ${delivery.color}`}><i />{delivery.status}</span><code>{delivery.code}</code></div></article>)}</div>{!deliveries.length && <EmptyResource icon={IconTerminal2} title="No request logs yet" body="Webhookly will record the endpoint response for every delivery attempt." />}</section>
}

function SettingsView({ workspace, endpointCount, onSave }) {
  const [name, setName] = useState(workspace?.name || '')
  useEffect(() => setName(workspace?.name || ''), [workspace?.name])
  if (!workspace) return <section className="resource-view"><div className="empty-state">Loading workspace settings.</div></section>
  return <section className="resource-view settings-view"><div className="page-head"><div><p className="eyebrow">WORKSPACE</p><h1>Settings</h1><p className="subhead">Manage your Webhookly workspace and integration details.</p></div></div><form className="settings-section" onSubmit={(event) => { event.preventDefault(); onSave(name) }}><div><h2>Workspace details</h2><p>Change the name shown across your dashboard.</p></div><label>Workspace name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><button className="primary-button" type="submit"><IconCheck {...iconProps} /> Save changes</button></form><section className="settings-section integration-summary"><div><h2>Integration summary</h2><p>Your demo app is ready to receive and deliver events.</p></div><div className="settings-facts"><span><IconPlugConnected {...iconProps} /> {endpointCount} active endpoint{endpointCount === 1 ? '' : 's'}</span><span><IconShieldCheck {...iconProps} /> Signed webhook requests</span><span><IconCode {...iconProps} /> PostgreSQL connected</span></div></section></section>
}

function EmptyResource({ icon: Icon, title, body, action, label }) { return <div className="resource-empty"><Icon size={33} stroke={1.4} /><h2>{title}</h2><p>{body}</p>{action && <button className="primary-button" onClick={action}><IconPlus {...iconProps} /> {label}</button>}</div> }

function TopPopover({ type, deliveries, onClose }) {
  if (!type) return null
  if (type === 'help') return <div className="top-popover help-popover"><button className="popover-close" onClick={onClose} aria-label="Close help"><IconX {...iconProps} /></button><strong>How WDC works</strong><p>Your app sends an event to WDC. WDC signs it, sends it to active endpoints, and records each delivery attempt.</p><p>Use Events to test the flow, then check Deliveries and Logs for the result.</p></div>
  return <div className="top-popover"><div className="popover-heading"><strong>Notifications</strong><button className="popover-close" onClick={onClose} aria-label="Close notifications"><IconX {...iconProps} /></button></div>{deliveries.length ? deliveries.slice(0, 3).map((delivery) => <div className="notification-row" key={delivery.id}><span className={`status ${delivery.color}`}><i />{delivery.status}</span><div><strong>{delivery.event}</strong><small>{delivery.time}</small></div></div>) : <p className="popover-empty">No delivery updates yet.</p>}</div>
}

function DeliveryDetail({ selected, onRetry }) {
  const responseMessage = selected?.status === 'Delivered' ? 'Delivered successfully' : selected?.status === 'Pending' && selected.retryAt ? `Retry scheduled for ${selected.retryAt}` : 'Delivery attempt failed'
  return <aside className="detail-panel">{selected ? <><div className="detail-heading"><div><p className="eyebrow">DELIVERY DETAIL</p><h2>{selected.event}</h2></div><span className={`status ${selected.color}`}><i />{selected.status}</span></div><div className="detail-block"><span>Endpoint</span><strong>{selected.endpoint}</strong><code>{selected.endpoint_url}</code></div><div className="detail-block"><span>Response</span><strong>{selected.code} {selected.status === 'Delivered' ? 'OK' : 'Awaiting response'}</strong><code>{responseMessage}</code></div><div className="payload-title"><span>PAYLOAD</span><button aria-label="Copy payload"><IconCopy {...iconProps} /></button></div><pre>{selected.body}</pre>{selected.status !== 'Delivered' && <div className="detail-footer"><button className="retry-button" onClick={onRetry}><IconRefresh {...iconProps} /> {selected.status === 'Pending' ? 'Retry now' : 'Retry delivery'}</button></div>}</> : <div className="empty-state">Select a delivery to inspect it.</div>}</aside>
}

function EventModal({ eventType, setEventType, onClose, onSend }) { return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><IconX {...iconProps} /></button><p className="eyebrow">TEST EVENT</p><h2>Send a sample event</h2><p>Webhookly will deliver this event to your active endpoints.</p><label>Event type<select value={eventType} onChange={(event) => setEventType(event.target.value)}><option>order.created</option><option>stock.low</option><option>payment.succeeded</option></select></label><button className="primary-button wide" onClick={onSend}><IconSend {...iconProps} /> Send event</button></div></div> }

function EndpointModal({ form, setForm, editing, onClose, onSubmit }) { const update = (key) => (event) => setForm({ ...form, [key]: event.target.value }); return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={onSubmit}><button type="button" className="modal-close" onClick={onClose} aria-label="Close"><IconX {...iconProps} /></button><p className="eyebrow">{editing ? 'EDIT ENDPOINT' : 'NEW ENDPOINT'}</p><h2>{editing ? 'Update destination' : 'Add a destination'}</h2><p>Webhookly signs every request before sending it to this URL.</p><label>Endpoint name<input required value={form.name} onChange={update('name')} placeholder="e.g. Warehouse alerts" /></label><label>Webhook URL<input required type="url" value={form.url} onChange={update('url')} placeholder="https://example.com/webhooks/orders" /></label><label>Signing secret<input required={!editing} type="password" value={form.signingSecret} onChange={update('signingSecret')} placeholder={editing ? 'Leave blank to keep the current secret' : 'Create a private secret'} /></label><button className="primary-button wide" type="submit">{editing ? <IconCheck {...iconProps} /> : <IconPlus {...iconProps} />}{editing ? ' Save endpoint' : ' Add endpoint'}</button></form></div> }

function ApiKeyModal({ name, setName, onClose, onSubmit }) { return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={onSubmit}><button type="button" className="modal-close" onClick={onClose} aria-label="Close"><IconX {...iconProps} /></button><p className="eyebrow">NEW API KEY</p><h2>Name this key</h2><p>Use a descriptive name so you know which system uses it.</p><label>Key name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. TKC Foods production" /></label><button className="primary-button wide" type="submit"><IconKey {...iconProps} /> Create key</button></form></div> }

function NewApiKeyModal({ apiKey, onClose }) { return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><IconX {...iconProps} /></button><p className="eyebrow">COPY THIS NOW</p><h2>Your API key is ready</h2><p>This is the only time WDC will show the full key.</p><code className="new-api-key">{apiKey}</code><button className="primary-button wide" onClick={() => navigator.clipboard.writeText(apiKey)}><IconCopy {...iconProps} /> Copy API key</button></div></div> }

export default App
