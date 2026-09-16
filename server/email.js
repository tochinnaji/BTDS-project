const appUrl = () => process.env.APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return false
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
  })
  if (!response.ok) throw new Error('WDC could not send the email. Check the Resend configuration.')
  return true
}

export async function sendPasswordResetEmail(email, token) {
  const url = `${appUrl()}/#reset=${token}`
  const sent = await sendEmail({
    to: email,
    subject: 'Reset your Webhookly password',
    html: `<p>Use this secure link to reset your Webhookly password. It expires in 30 minutes.</p><p><a href="${url}">Reset password</a></p>`,
  })
  return { sent, url }
}

export async function sendWorkspaceInviteEmail(email, workspaceName, role, token) {
  const url = `${appUrl()}/#invite=${token}`
  const sent = await sendEmail({
    to: email,
    subject: `You were invited to ${workspaceName} on Webhookly`,
    html: `<p>You were invited to join <strong>${escapeHtml(workspaceName)}</strong> as a ${escapeHtml(role)}.</p><p><a href="${url}">Accept invitation</a></p><p>This invitation expires in 7 days.</p>`,
  })
  return { sent, url }
}
