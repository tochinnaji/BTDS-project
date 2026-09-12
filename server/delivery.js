import crypto from 'crypto'
import { pool } from './db.js'

const retryDelaysSeconds = [60, 5 * 60, 30 * 60]

const deliveryQuery = `
  select deliveries.id, deliveries.attempts, events.id as event_id, events.event_type, events.payload,
         events.created_at as event_created_at, endpoints.url, endpoints.signing_secret
  from deliveries
  join events on events.id = deliveries.event_id
  join endpoints on endpoints.id = deliveries.endpoint_id
  where deliveries.id = $1`

export async function deliver(deliveryId) {
  const { rows } = await pool.query(deliveryQuery, [deliveryId])
  const delivery = rows[0]
  if (!delivery) throw new Error('Delivery not found')

  const webhookEvent = {
    id: delivery.event_id,
    type: delivery.event_type,
    createdAt: delivery.event_created_at,
    data: delivery.payload,
  }
  const body = JSON.stringify(webhookEvent)
  const signature = crypto.createHmac('sha256', delivery.signing_secret).update(body).digest('hex')

  try {
    const response = await fetch(delivery.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhookly-signature': `sha256=${signature}`,
        'webhookly-event': delivery.event_type,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    })
    const responseBody = (await response.text()).slice(0, 2_000)
    return completeAttempt(delivery, { responseStatus: response.status, responseBody, succeeded: response.ok })
  } catch (error) {
    return completeAttempt(delivery, { responseBody: error.message, succeeded: false })
  }
}

async function completeAttempt(delivery, { responseStatus = null, responseBody, succeeded }) {
  const nextAttemptNumber = delivery.attempts + 1
  const retryDelay = retryDelaysSeconds[nextAttemptNumber - 1]
  const status = succeeded ? 'delivered' : retryDelay ? 'pending' : 'failed'
  const nextAttemptAt = retryDelay ? new Date(Date.now() + retryDelay * 1000) : null

  const { rows } = await pool.query(
    `update deliveries
     set status = $2, attempts = $3, response_status = $4, response_body = $5,
         next_attempt_at = $6, delivered_at = case when $2 = 'delivered' then now() else null end
     where id = $1 returning *`,
    [delivery.id, status, nextAttemptNumber, responseStatus, responseBody, nextAttemptAt],
  )
  return rows[0]
}

export async function processDueDeliveries() {
  const { rows } = await pool.query(
    `with due_deliveries as (
       select id from deliveries
       where status = 'pending' and next_attempt_at <= now()
       order by next_attempt_at
       for update skip locked
       limit 20
     )
     update deliveries
     set next_attempt_at = now() + interval '15 seconds'
     where id in (select id from due_deliveries)
     returning id`,
  )
  await Promise.all(rows.map(({ id }) => deliver(id)))
  return rows.length
}
