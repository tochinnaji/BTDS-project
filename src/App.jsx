import { useEffect, useMemo, useState } from 'react'
import IconActivity from '@tabler/icons-react/dist/esm/icons/IconActivity.mjs'
import IconAlertCircle from '@tabler/icons-react/dist/esm/icons/IconAlertCircle.mjs'
import IconBell from '@tabler/icons-react/dist/esm/icons/IconBell.mjs'
import IconCheck from '@tabler/icons-react/dist/esm/icons/IconCheck.mjs'
import IconChevronDown from '@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs'
import IconCircleCheck from '@tabler/icons-react/dist/esm/icons/IconCircleCheck.mjs'
import IconCode from '@tabler/icons-react/dist/esm/icons/IconCode.mjs'
import IconCopy from '@tabler/icons-react/dist/esm/icons/IconCopy.mjs'
import IconEye from '@tabler/icons-react/dist/esm/icons/IconEye.mjs'
import IconEyeOff from '@tabler/icons-react/dist/esm/icons/IconEyeOff.mjs'
import IconHelpCircle from '@tabler/icons-react/dist/esm/icons/IconHelpCircle.mjs'
import IconKey from '@tabler/icons-react/dist/esm/icons/IconKey.mjs'
import IconListDetails from '@tabler/icons-react/dist/esm/icons/IconListDetails.mjs'
import IconLogout from '@tabler/icons-react/dist/esm/icons/IconLogout.mjs'
import IconMenu2 from '@tabler/icons-react/dist/esm/icons/IconMenu2.mjs'
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
import IconUsers from '@tabler/icons-react/dist/esm/icons/IconUsers.mjs'
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
  const [team, setTeam] = useState(null)
  const [securityAlerts, setSecurityAlerts] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [workspaces, setWorkspaces] = useState([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null)
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
  const [showInvite, setShowInvite] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [endpointForm, setEndpointForm] = useState({ name: '', url: '', signingSecret: '' })
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const filteredDeliveries = useMemo(() => filter === 'All' ? deliveries : deliveries.filter((item) => item.status === filter), [deliveries, filter])
  const deliveredCount = deliveries.filter((item) => item.status === 'Delivered').length

  async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers)
    if (authToken) headers.set('authorization', `Bearer ${authToken}`)
    return fetch(`${API}${path}`, { ...options, headers })
  }

  async function loadData(preferredWorkspaceId = activeWorkspaceId) {
    const appsResponse = await apiFetch('/apps')
    if (appsResponse.status === 401) throw new Error('SESSION_EXPIRED')
    const apps = await appsResponse.json()
    const activeWorkspace = apps.find((workspace) => workspace.id === preferredWorkspaceId) || apps.find((workspace) => workspace.slug === 'tkc-foods') || apps[0]
    if (!activeWorkspace) throw new Error('No workspace is available for this account.')
    setWorkspace(activeWorkspace)
    setWorkspaces(apps)
    setActiveWorkspaceId(activeWorkspace.id)
    setAppId(activeWorkspace.id)
    const [deliveryRows, endpointRows, eventRows, apiKeyRows, teamResult, alertsResult] = await Promise.all([
      apiFetch(`/deliveries?appId=${activeWorkspace.id}`).then((response) => response.json()),
      apiFetch(`/endpoints?appId=${activeWorkspace.id}`).then((response) => response.json()),
      apiFetch(`/events?appId=${activeWorkspace.id}`).then((response) => response.json()),
      apiFetch(`/apps/${activeWorkspace.id}/api-keys`).then((response) => response.json()),
      apiFetch(`/apps/${activeWorkspace.id}/team`).then((response) => response.ok ? response.json() : null),
      apiFetch(`/apps/${activeWorkspace.id}/security-alerts`).then((response) => response.ok ? response.json() : []),
    ])
    const formatted = deliveryRows.map(displayDelivery)
    setDeliveries(formatted)
    setEndpoints(endpointRows)
    setEvents(eventRows)
    setApiKeys(apiKeyRows)
    setTeam(teamResult)
    setSecurityAlerts(alertsResult)
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
  useEffect(() => {
    if (!mobileMenuOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [mobileMenuOpen])

  async function authenticate(mode, form) {
    const response = await fetch(`${API}/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Unable to authenticate.')
    if (form.inviteToken) {
      const inviteResponse = await fetch(`${API}/invitations/accept`, { method: 'POST', headers: { authorization: `Bearer ${result.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ token: form.inviteToken }) })
      const inviteResult = await inviteResponse.json()
      if (!inviteResponse.ok) throw new Error(inviteResult.error || 'Unable to accept the invitation.')
    }
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

  async function rotateApiKey(key) {
    const response = await apiFetch(`/api-keys/${key.id}/rotate`, { method: 'POST' })
    const result = await response.json()
    if (!response.ok) return setError(result.error || 'Unable to rotate API key.')
    setNewApiKey(result.apiKey)
    await loadData()
    setNotice('Replacement key created. Update your app, then revoke the old key.')
  }

  async function createInvite(form) {
    const response = await apiFetch(`/apps/${appId}/invitations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Unable to create invitation.')
    setShowInvite(false)
    if (result.emailed) setNotice('Invitation email sent.')
    else setInviteLink(result.inviteUrl || `${window.location.origin}/#invite=${result.inviteToken}`)
    await loadData()
  }

  async function updateMemberRole(member, role) {
    const response = await apiFetch(`/apps/${appId}/members/${member.user_id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })
    const result = await response.json()
    if (!response.ok) return setError(result.error || 'Unable to update the staff role.')
    await loadData(); setNotice(`${member.name} is now a ${role}.`)
  }

  async function removeMember(member) {
    if (!window.confirm(`Remove ${member.name}'s access to this workspace?`)) return
    const response = await apiFetch(`/apps/${appId}/members/${member.user_id}`, { method: 'DELETE' })
    if (!response.ok) return setError((await response.json()).error || 'Unable to remove staff access.')
    await loadData(); setNotice(`${member.name}'s access was removed.`)
  }

  async function createWorkspace(form) {
    const slug = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `workspace-${Date.now()}`
    const response = await apiFetch('/apps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: form.name, slug }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Unable to create workspace.')
    setActiveWorkspaceId(result.id); setView('deliveries'); await loadData(result.id); setNotice(`${result.name} workspace created.`)
  }

  async function selectWorkspace(nextWorkspace) {
    setWorkspaceMenuOpen(false)
    setMobileMenuOpen(false)
    setActiveWorkspaceId(nextWorkspace.id)
    await loadData(nextWorkspace.id)
    setNotice(`Switched to ${nextWorkspace.name}.`)
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
    ['deliveries', 'Deliveries', IconActivity], ['events', 'Events', IconListDetails], ['endpoints', 'Endpoints', IconPlugConnected], ['api-keys', 'API Keys', IconKey], ['verify', 'Verify', IconShieldCheck], ['security', 'Security', IconAlertCircle], ['team', 'Team', IconUsers], ['logs', 'Logs', IconTerminal2],
  ]

  if (!authReady) return <main className="auth-page"><div className="auth-loading">Loading Webhookly...</div></main>
  if (!user) return <AuthScreen onAuthenticate={authenticate} />

  return <main className="app-shell">
    {mobileMenuOpen && <button className="mobile-nav-backdrop" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation" />}
    <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><span className="brand-mark">w</span><span>webhookly</span></div>
      <div className="workspace-switcher"><button className="workspace" onClick={() => setWorkspaceMenuOpen((open) => !open)} aria-expanded={workspaceMenuOpen} aria-haspopup="menu"><span className="workspace-dot" />{workspace?.name || 'Workspace'} <IconChevronDown {...iconProps} /></button>{workspaceMenuOpen && <div className="workspace-menu" role="menu">{workspaces.map((item) => <button key={item.id} className={item.id === appId ? 'workspace-choice active' : 'workspace-choice'} onClick={() => selectWorkspace(item)} role="menuitem">{item.name}{item.id === appId && <IconCheck {...iconProps} />}</button>)}<button className="workspace-create" onClick={() => { setWorkspaceMenuOpen(false); setView('new-workspace'); setMobileMenuOpen(false) }} role="menuitem"><IconPlus {...iconProps} /> Create new workspace</button></div>}</div>
      <nav aria-label="Main navigation">{navItems.map(([id, label, Icon]) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => { setView(id); setMobileMenuOpen(false) }} aria-label={label} title={label}><Icon {...iconProps} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => { setView('settings'); setMobileMenuOpen(false) }} aria-label="Settings" title="Settings"><IconSettings {...iconProps} /><span>Settings</span></button><div className="user"><div className="avatar">{user.name.slice(0, 2).toUpperCase()}</div><div><strong>{user.name}</strong><small>Owner</small></div><button className="logout-button" onClick={logout} aria-label="Sign out" title="Sign out"><IconLogout {...iconProps} /></button></div></div>
    </aside>

    <section className="content">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu-button" onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation" title="Navigation"><IconMenu2 {...iconProps} /></button><div className="crumb">Workspace <b>/</b><strong>{view[0].toUpperCase() + view.slice(1)}</strong></div></div><div className="top-actions"><button className="icon-button top-action" aria-label="Notifications" title="Notifications" onClick={() => { setShowNotifications((visible) => !visible); setShowHelp(false) }}><IconBell {...iconProps} /></button><button className="icon-button top-action" aria-label="Help" title="Help" onClick={() => { setShowHelp((visible) => !visible); setShowNotifications(false) }}><IconHelpCircle {...iconProps} /></button><TopPopover type={showNotifications ? 'notifications' : showHelp ? 'help' : null} deliveries={deliveries} onClose={() => { setShowNotifications(false); setShowHelp(false) }} /></div></header>
      {notice && <div className="toast"><IconCircleCheck {...iconProps} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notification"><IconX {...iconProps} /></button></div>}
      {error && <div className="toast error-toast"><IconAlertCircle {...iconProps} />{error}<button onClick={() => setError('')} aria-label="Dismiss error"><IconX {...iconProps} /></button></div>}
      {view === 'deliveries' && <DeliveriesView deliveries={filteredDeliveries} selected={selected} setSelected={setSelected} filter={filter} setFilter={setFilter} deliveredCount={deliveredCount} onSend={() => setShowEvent(true)} onRetry={retry} />}
      {view === 'endpoints' && <EndpointsView endpoints={endpoints} onAdd={() => { setEditingEndpoint(null); setEndpointForm({ name: '', url: '', signingSecret: '' }); setShowEndpoint(true) }} onToggle={toggleEndpoint} onEdit={openEditEndpoint} onDelete={deleteEndpoint} onCreateFailure={createFailureDemo} />}
      {view === 'api-keys' && <ApiKeysView apiKeys={apiKeys} onCreate={() => setShowKeyForm(true)} onRevoke={revokeApiKey} onRotate={rotateApiKey} />}
      {view === 'verify' && <SignatureGuideView />}
      {view === 'security' && <SecurityView alerts={securityAlerts} />}
      {view === 'team' && <TeamView team={team} onInvite={() => setShowInvite(true)} onUpdateRole={updateMemberRole} onRemoveMember={removeMember} />}
      {view === 'events' && <EventsView events={events} onSend={() => setShowEvent(true)} />}
      {view === 'logs' && <LogsView deliveries={deliveries} />}
      {view === 'settings' && <SettingsView workspace={workspace} endpointCount={endpoints.length} onSave={saveWorkspace} />}
      {view === 'new-workspace' && <NewWorkspaceView onCreate={createWorkspace} onCancel={() => setView('deliveries')} />}
    </section>

    {view === 'deliveries' && <DeliveryDetail selected={selected} onRetry={retry} />}
    {showEvent && <EventModal eventType={eventType} setEventType={setEventType} onClose={() => setShowEvent(false)} onSend={sendEvent} />}
    {showEndpoint && <EndpointModal form={endpointForm} setForm={setEndpointForm} editing={editingEndpoint} onClose={() => { setShowEndpoint(false); setEditingEndpoint(null) }} onSubmit={editingEndpoint ? updateEndpoint : addEndpoint} />}
    {showKeyForm && <ApiKeyModal name={apiKeyName} setName={setApiKeyName} onClose={() => setShowKeyForm(false)} onSubmit={createApiKey} />}
    {newApiKey && <NewApiKeyModal apiKey={newApiKey} onClose={() => setNewApiKey('')} />}
    {showInvite && <InviteModal onClose={() => setShowInvite(false)} onSubmit={createInvite} />}
    {inviteLink && <InviteLinkModal inviteLink={inviteLink} onClose={() => setInviteLink('')} />}
  </main>
}

function AuthScreen({ onAuthenticate }) {
  const hashParams = new URLSearchParams(window.location.hash.slice(1))
  const inviteToken = hashParams.get('invite') || ''
  const emailedResetToken = hashParams.get('reset') || ''
  const [mode, setMode] = useState(emailedResetToken ? 'reset-confirm' : 'signup')
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteToken })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resetToken, setResetToken] = useState(emailedResetToken)
  const [showPassword, setShowPassword] = useState(false)
  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value })
  async function submit(event) {
    event.preventDefault(); setError(''); setSubmitting(true)
    try {
      if (mode === 'reset-request') {
        const response = await fetch(`${API}/auth/password-reset/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: form.email }) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Unable to prepare a reset link.')
        if (result.resetToken) { setResetToken(result.resetToken); setMode('reset-confirm') } else setMode('reset-sent')
      } else if (mode === 'reset-confirm') {
        const response = await fetch(`${API}/auth/password-reset/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: resetToken, password: form.password }) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Unable to reset password.')
        window.history.replaceState(null, '', window.location.pathname)
        setMode('login'); setForm({ ...form, password: '' }); setResetToken('')
      } else await onAuthenticate(mode, form)
    } catch (authError) { setError(authError.message) } finally { setSubmitting(false) }
  }
  const isSignup = mode === 'signup'
  const isReset = mode.startsWith('reset')
  const title = mode === 'reset-sent' ? 'Check your inbox.' : mode === 'reset-request' ? 'Reset your password.' : mode === 'reset-confirm' ? 'Choose a new password.' : isSignup ? 'Start sending reliable webhooks.' : 'Sign in to Webhookly.'
  const description = mode === 'reset-sent' ? 'If that email belongs to a Webhookly account, a secure reset link is on its way.' : mode === 'reset-request' ? 'Enter your email and we will prepare a secure reset link.' : mode === 'reset-confirm' ? 'Create a new password with at least 8 characters.' : isSignup ? 'Deliver every important event with signed requests, clear delivery logs, and automatic retries when systems are unavailable.' : 'Step back into your command center for reliable, secure event delivery.'
  const showForm = mode !== 'reset-sent'
  return <main className="auth-page"><section className="auth-panel"><div className="auth-brand"><span className="brand-mark">w</span><strong>webhookly</strong></div><p className="eyebrow">{isReset ? 'ACCOUNT RECOVERY' : isSignup ? 'CREATE YOUR WORKSPACE' : 'WELCOME BACK'}</p><h1>{title}</h1><p className="auth-copy">{description}</p>{inviteToken && !isReset && <p className="invite-banner">You have been invited to join a WDC workspace. Create an account or sign in with the invited email.</p>}{showForm && <form onSubmit={submit} className="auth-form">{isSignup && <label>Full name<input required value={form.name} onChange={update('name')} placeholder="e.g. Amara Okafor" autoComplete="name" /></label>}{mode !== 'reset-confirm' && <label>Email address<input required type="email" value={form.email} onChange={update('email')} placeholder="you@example.com" autoComplete="email" /></label>}{mode !== 'reset-request' && <label>Password<span className="password-input"><input required type={showPassword ? 'text' : 'password'} minLength="8" value={form.password} onChange={update('password')} placeholder="At least 8 characters" autoComplete={isSignup || mode === 'reset-confirm' ? 'new-password' : 'current-password'} /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <IconEyeOff {...iconProps} /> : <IconEye {...iconProps} />}</button></span></label>}{mode === 'reset-confirm' && !resetToken && <p className="auth-error"><IconAlertCircle {...iconProps} />This reset link is missing or invalid. Request a new one.</p>}{error && <p className="auth-error"><IconAlertCircle {...iconProps} />{error}</p>}<button className="primary-button wide" disabled={submitting || (mode === 'reset-confirm' && !resetToken)} type="submit">{submitting ? 'Please wait...' : mode === 'reset-request' ? 'Send reset link' : mode === 'reset-confirm' ? 'Update password' : isSignup ? 'Create account' : 'Sign in'}</button></form>}{mode === 'login' && <button className="auth-switch" onClick={() => { setMode('reset-request'); setError('') }}>Forgot your password?</button>}{isReset ? <button className="auth-switch" onClick={() => { setMode('login'); setError('') }}>Back to sign in</button> : <button className="auth-switch" onClick={() => { setMode(isSignup ? 'login' : 'signup'); setError('') }}>{isSignup ? 'Already have an account? Sign in' : 'New to Webhookly? Create an account'}</button>}</section></main>
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

function ApiKeysView({ apiKeys, onCreate, onRevoke, onRotate }) {
  return <section className="resource-view"><div className="page-head"><div><p className="eyebrow">AUTHENTICATION</p><h1>API Keys</h1><p className="subhead">Use a key to let your app securely send events into Webhookly.</p></div><button className="primary-button" onClick={onCreate}><IconPlus {...iconProps} /> Create API key</button></div><div className="ingestion-note"><IconShieldCheck {...iconProps} /><span>External events require a Bearer key, a timestamp no older than 5 minutes, and an idempotency key. Each key is limited to 60 events per minute.</span></div><div className="api-key-list">{apiKeys.map((key) => <article className="api-key-row" key={key.id}><span className="api-key-icon"><IconKey {...iconProps} /></span><div><strong>{key.name}</strong><code>{key.key_prefix}...</code><small>{key.rotation_started_at ? 'Replacement created. Revoke this key after your app is updated.' : key.last_used_at ? `Last used ${new Date(key.last_used_at).toLocaleString()}` : 'Never used'}</small></div>{key.revoked_at ? <span className="endpoint-paused">Revoked</span> : <div className="key-actions"><button className="rotate-button" onClick={() => onRotate(key)}>Rotate</button><button className="revoke-button" onClick={() => onRevoke(key)}>Revoke</button></div>}</article>)}</div>{!apiKeys.length && <EmptyResource icon={IconKey} title="No API keys yet" body="Create a key to let TKC Foods send secure events into WDC." action={onCreate} label="Create API key" />}</section>
}

function TeamView({ team, onInvite, onUpdateRole, onRemoveMember }) {
  if (!team) return <section className="resource-view"><div className="empty-state">Loading team...</div></section>
  const canManage = ['owner', 'admin'].includes(team.role)
  const isOwner = team.role === 'owner'
  return <section className="resource-view"><div className="page-head"><div><p className="eyebrow">WORKSPACE ACCESS</p><h1>Team</h1><p className="subhead">Invite people and choose the access they need.</p></div>{canManage && <button className="primary-button" onClick={onInvite}><IconPlus {...iconProps} /> Invite member</button>}</div><div className="team-list">{team.members.map((member) => <article className="team-row" key={member.id}><span className="member-avatar">{member.name.slice(0, 2).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.email}</small></div>{isOwner && member.role !== 'owner' ? <div className="member-actions"><select value={member.role} onChange={(event) => onUpdateRole(member, event.target.value)} aria-label={`Role for ${member.name}`}><option value="admin">Admin</option><option value="developer">Developer</option><option value="viewer">Viewer</option></select><button className="icon-button delete-endpoint" onClick={() => onRemoveMember(member)} aria-label={`Remove access for ${member.name}`} title="Remove access"><IconTrash {...iconProps} /></button></div> : <span className={`role-badge ${member.role}`}>{member.role}</span>}</article>)}</div>{canManage && <><div className="team-section-label">PENDING INVITATIONS</div><div className="team-list">{team.invitations.length ? team.invitations.map((invite) => <article className="team-row" key={invite.id}><span className="member-avatar pending">?</span><div><strong>{invite.email}</strong><small>Expires {new Date(invite.expires_at).toLocaleDateString()}</small></div><span className={`role-badge ${invite.role}`}>{invite.role}</span></article>) : <p className="team-empty">No pending invitations.</p>}</div></>}</section>
}

function SecurityView({ alerts }) {
  return <section className="resource-view"><div className="page-head"><div><p className="eyebrow">SECURITY CENTER</p><h1>Security alerts</h1><p className="subhead">Review key activity and suspicious requests for this workspace.</p></div></div><div className="security-list">{alerts.map((alert) => <article className="security-row" key={alert.id}><span className="security-icon"><IconAlertCircle {...iconProps} /></span><div><strong>{alert.title}</strong><p>{alert.detail}</p><small>{new Date(alert.created_at).toLocaleString()}</small></div></article>)}</div>{!alerts.length && <EmptyResource icon={IconShieldCheck} title="No security alerts" body="WDC will record rate-limit, replay, revoked-key, rotation, and team-access activity here." />}</section>
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

function NewWorkspaceView({ onCreate, onCancel }) { const [name, setName] = useState(''); const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false); return <section className="resource-view new-workspace-view"><div className="page-head"><div><p className="eyebrow">NEW WORKSPACE</p><h1>Register your company</h1><p className="subhead">Give each company its own apps, endpoints, API keys, deliveries, and staff.</p></div></div><form className="settings-section" onSubmit={async (event) => { event.preventDefault(); setError(''); setSubmitting(true); try { await onCreate({ name }) } catch (workspaceError) { setError(workspaceError.message) } finally { setSubmitting(false) } }}><div><h2>Company details</h2><p>Use the name your team will recognize in the workspace switcher.</p></div><label>Company or workspace name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Acme Payments" /></label>{error && <p className="auth-error new-workspace-error"><IconAlertCircle {...iconProps} />{error}</p>}<div className="workspace-page-actions"><button className="primary-button" disabled={submitting} type="submit"><IconPlus {...iconProps} /> {submitting ? 'Creating workspace...' : 'Create workspace'}</button><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button></div></form></section> }

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

function NewApiKeyModal({ apiKey, onClose }) { const [copied, setCopied] = useState(false); async function copyKey() { await navigator.clipboard.writeText(apiKey); setCopied(true) } return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><IconX {...iconProps} /></button><p className="eyebrow">COPY THIS NOW</p><h2>Your API key is ready</h2><p>This is the only time WDC will show the full key.</p><code className="new-api-key">{apiKey}</code><button className="primary-button wide" onClick={copyKey}>{copied ? <IconCheck {...iconProps} /> : <IconCopy {...iconProps} />} {copied ? 'API key copied' : 'Copy API key'}</button></div></div> }

function InviteModal({ onClose, onSubmit }) { const [email, setEmail] = useState(''); const [role, setRole] = useState('developer'); const [error, setError] = useState(''); return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); try { await onSubmit({ email, role }) } catch (inviteError) { setError(inviteError.message) } }}><button type="button" className="modal-close" onClick={onClose} aria-label="Close"><IconX {...iconProps} /></button><p className="eyebrow">INVITE MEMBER</p><h2>Give someone access</h2><p>They will use the invitation link with this email address.</p><label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="staff@company.com" /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value)}><option value="admin">Admin</option><option value="developer">Developer</option><option value="viewer">Viewer</option></select></label>{error && <p className="auth-error"><IconAlertCircle {...iconProps} />{error}</p>}<button className="primary-button wide" type="submit"><IconUsers {...iconProps} /> Create invitation</button></form></div> }

function InviteLinkModal({ inviteLink, onClose }) { const [copied, setCopied] = useState(false); async function copyLink() { await navigator.clipboard.writeText(inviteLink); setCopied(true) } return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><IconX {...iconProps} /></button><p className="eyebrow">INVITATION READY</p><h2>Share this link securely</h2><p>The invitation expires in 7 days and works only for the invited email address.</p><code className="new-api-key">{inviteLink}</code><button className="primary-button wide" onClick={copyLink}>{copied ? <IconCheck {...iconProps} /> : <IconCopy {...iconProps} />} {copied ? 'Link copied' : 'Copy invitation link'}</button></div></div> }

export default App
