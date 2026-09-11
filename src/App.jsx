import { useMemo, useState } from 'react'
import './App.css'

const initialDeliveries = [
  { id: 'evt_9f2a8c', event: 'order.created', endpoint: 'Logistics partner', time: '2 min ago', status: 'Delivered', code: '200', color: 'green', body: '{ "order_id": "TKC-1042", "total": 18500 }' },
  { id: 'evt_7e4b11', event: 'stock.low', endpoint: 'Operations alerts', time: '18 min ago', status: 'Failed', code: '502', color: 'red', body: '{ "sku": "RICE-5KG", "remaining": 3 }' },
  { id: 'evt_93cd20', event: 'payment.succeeded', endpoint: 'Accounting sync', time: '42 min ago', status: 'Delivered', code: '204', color: 'green', body: '{ "payment_id": "pay_42a", "amount": 18500 }' },
  { id: 'evt_118ce2', event: 'order.delivered', endpoint: 'Customer updates', time: '1 hr ago', status: 'Pending', code: '...', color: 'amber', body: '{ "order_id": "TKC-1037", "status": "delivered" }' },
]

function App() {
  const [deliveries, setDeliveries] = useState(initialDeliveries)
  const [filter, setFilter] = useState('All')
  const [selected, setSelected] = useState(initialDeliveries[1])
  const [showEvent, setShowEvent] = useState(false)
  const [copied, setCopied] = useState(false)
  const visibleDeliveries = useMemo(() => filter === 'All' ? deliveries : deliveries.filter((delivery) => delivery.status === filter), [deliveries, filter])

  const retry = () => {
    const updated = { ...selected, status: 'Delivered', code: '200', color: 'green', time: 'just now' }
    setDeliveries((items) => items.map((item) => item.id === updated.id ? updated : item))
    setSelected(updated)
  }
  const sendTestEvent = () => {
    const item = { id: `evt_${Math.random().toString(16).slice(2, 8)}`, event: 'order.created', endpoint: 'Logistics partner', time: 'just now', status: 'Pending', code: '...', color: 'amber', body: '{ "order_id": "TKC-1043", "total": 9200 }' }
    setDeliveries((items) => [item, ...items]); setSelected(item); setShowEvent(false)
    window.setTimeout(() => {
      const complete = { ...item, status: 'Delivered', code: '200', color: 'green' }
      setDeliveries((items) => items.map((delivery) => delivery.id === item.id ? complete : delivery))
      setSelected((current) => current.id === item.id ? complete : current)
    }, 1100)
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">w</span><span>webhookly</span></div>
      <div className="workspace"><span className="workspace-dot" />TKC Foods <span className="chevron">⌄</span></div>
      <nav aria-label="Main navigation">
        <a className="nav-item active" href="#deliveries"><span>⌁</span> Deliveries</a><a className="nav-item" href="#events"><span>◉</span> Events</a><a className="nav-item" href="#endpoints"><span>↗</span> Endpoints</a><a className="nav-item" href="#logs"><span>≡</span> Logs</a>
      </nav>
      <div className="sidebar-bottom"><a className="nav-item" href="#settings"><span>⚙</span> Settings</a><div className="user"><div className="avatar">AO</div><div><strong>Amara Okafor</strong><small>Owner</small></div><span className="more">•••</span></div></div>
    </aside>
    <section className="content">
      <header className="topbar"><div className="crumb"><span>Workspace</span><b>/</b><strong>Deliveries</strong></div><div className="top-actions"><button className="icon-button" aria-label="Notifications">◌</button><button className="help-button">?</button></div></header>
      <div className="page-head"><div><p className="eyebrow">ACTIVITY</p><h1>Deliveries</h1><p className="subhead">Every event your apps have sent, in one reliable place.</p></div><button className="primary-button" onClick={() => setShowEvent(true)}><span>+</span> Send test event</button></div>
      <section className="stats"><div><span className="stat-label">DELIVERED TODAY</span><strong>1,284</strong><small className="positive">↑ 12.5% <em>from yesterday</em></small></div><div><span className="stat-label">SUCCESS RATE</span><strong>99.2%</strong><small className="positive">↑ 0.4% <em>from yesterday</em></small></div><div><span className="stat-label">AVG. LATENCY</span><strong>184 <em>ms</em></strong><small className="positive">↓ 24ms <em>from yesterday</em></small></div><div><span className="stat-label">REQUIRES ATTENTION</span><strong className="attention">3</strong><small className="neutral">Failed or pending deliveries</small></div></section>
      <section className="delivery-section" id="deliveries"><div className="section-toolbar"><div className="tabs">{['All', 'Delivered', 'Failed', 'Pending'].map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? 'tab active-tab' : 'tab'}>{item}{item === 'Failed' && <span className="tab-count">1</span>}</button>)}</div><div className="table-actions"><button className="search">⌕ <span>Search deliveries</span></button><button className="filter-button">☷ Filter</button></div></div>
        <div className="table-wrap"><table><thead><tr><th>EVENT</th><th>ENDPOINT</th><th>TIME</th><th>STATUS</th><th>RESPONSE</th><th /></tr></thead><tbody>{visibleDeliveries.map((delivery) => <tr key={delivery.id} className={selected.id === delivery.id ? 'selected-row' : ''} onClick={() => setSelected(delivery)}><td><strong>{delivery.event}</strong><small>{delivery.id}</small></td><td>{delivery.endpoint}</td><td>{delivery.time}</td><td><span className={`status ${delivery.color}`}><i />{delivery.status}</span></td><td><code className={delivery.color === 'red' ? 'bad-code' : ''}>{delivery.code}</code></td><td><button className="row-more" aria-label="Open delivery">•••</button></td></tr>)}</tbody></table>{visibleDeliveries.length === 0 && <div className="empty-state">No {filter.toLowerCase()} deliveries yet.</div>}</div>
      </section>
    </section>
    <aside className="detail-panel"><div className="detail-heading"><div><p className="eyebrow">DELIVERY DETAIL</p><h2>{selected.event}</h2></div><button className="close-button" aria-label="Close detail">×</button></div><div className="detail-status"><span className={`status ${selected.color}`}><i />{selected.status}</span><span className="detail-time">{selected.time}</span></div><div className="detail-block"><span>Endpoint</span><strong>{selected.endpoint}</strong><code>https://logistics.example.com/hooks/orders</code></div><div className="detail-block"><span>Response</span><strong className={selected.color === 'red' ? 'red-text' : ''}>{selected.code} {selected.status === 'Failed' ? 'Bad Gateway' : selected.status === 'Delivered' ? 'OK' : 'Awaiting response'}</strong><code>{selected.status === 'Failed' ? 'Upstream connection timed out' : 'Delivered successfully'}</code></div><div className="payload-title"><span>PAYLOAD</span><button onClick={() => { navigator.clipboard?.writeText(selected.body); setCopied(true); window.setTimeout(() => setCopied(false), 1200) }}>{copied ? 'Copied' : 'Copy'}</button></div><pre>{selected.body}</pre><div className="detail-footer"><button className="secondary-button">View full request</button>{selected.status === 'Failed' && <button className="retry-button" onClick={retry}>↻ Retry delivery</button>}</div></aside>
    {showEvent && <div className="modal-backdrop" onMouseDown={() => setShowEvent(false)}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowEvent(false)}>×</button><p className="eyebrow">TEST EVENT</p><h2>Send a sample event</h2><p>Webhookly will deliver this event to your Logistics partner endpoint.</p><label>Event type<select defaultValue="order.created"><option>order.created</option><option>stock.low</option><option>payment.succeeded</option></select></label><button className="primary-button wide" onClick={sendTestEvent}>Send event</button></div></div>}
  </main>
}
export default App
