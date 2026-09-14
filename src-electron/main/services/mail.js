import fs from 'node:fs'
import path from 'node:path'
import { paths } from '../core/paths.js'
import { EXE } from '../core/platform.js'
import { which } from '../core/shell.js'
import { settings } from '../core/config.js'
import { supervisor } from './supervisor.js'

function mailpitBinary () {
  const bundled = path.join(paths.runtimes, 'mailpit', `mailpit${EXE}`)
  return fs.existsSync(bundled) ? bundled : null
}

supervisor.register({
  id: 'mailpit',
  label: 'Mail',
  group: 'service',
  port: () => settings.get('services').mailpit.smtpPort,
  readyPort: () => settings.get('services').mailpit.smtpPort,
  async command () {
    const bin = mailpitBinary() ?? await which('mailpit')
    if (!bin) throw new Error('mailpit not found. Install it from the Services page.')
    const { smtpPort, uiPort } = settings.get('services').mailpit
    return {
      cmd: bin,
      args: [
        '--smtp', `127.0.0.1:${smtpPort}`,
        '--listen', `127.0.0.1:${uiPort}`,
        '--database', path.join(paths.data, 'mailpit.db'),
        '--max', '2000'
      ]
    }
  }
})

const api = () => `http://127.0.0.1:${settings.get('services').mailpit.uiPort}/api/v1`

/**
 * Mailpit answers reads with JSON but replies to PUT and DELETE with a plain
 * "ok", so parsing everything as JSON throws on a request that actually
 * succeeded. Decide by content type, not by assumption.
 */
async function json (url, init) {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`Mail API ${res.status}: ${await res.text()}`)
  if (res.status === 204) return null

  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) {
    const text = (await res.text()).trim()
    return text === '' ? null : text
  }
  return res.json()
}

export async function messages ({ limit = 50, start = 0, query = '' } = {}) {
  const url = query
    ? `${api()}/search?query=${encodeURIComponent(query)}&limit=${limit}`
    : `${api()}/messages?limit=${limit}&start=${start}`
  const data = await json(url)
  return {
    total: data.total ?? data.messages_count ?? 0,
    unread: data.unread ?? 0,
    messages: (data.messages ?? []).map(m => ({
      id: m.ID,
      from: m.From?.Address ?? '',
      fromName: m.From?.Name ?? '',
      to: (m.To ?? []).map(t => t.Address),
      subject: m.Subject,
      snippet: m.Snippet,
      size: m.Size,
      read: m.Read,
      attachments: m.Attachments ?? 0,
      created: m.Created
    }))
  }
}

export async function message (id) {
  const m = await json(`${api()}/message/${id}`)
  return {
    id: m.ID,
    from: m.From,
    to: m.To,
    cc: m.Cc,
    subject: m.Subject,
    html: m.HTML,
    text: m.Text,
    attachments: m.Attachments,
    created: m.Date
  }
}

export async function deleteMessage (id) {
  return json(`${api()}/messages`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ IDs: [id] })
  })
}

export async function deleteAll () {
  return json(`${api()}/messages`, { method: 'DELETE' })
}

export async function markRead (id, read = true) {
  return json(`${api()}/messages`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ IDs: [id], Read: read })
  })
}

export function webUrl () {
  return `http://127.0.0.1:${settings.get('services').mailpit.uiPort}`
}

/** Drop-in .env block so a project can point at the local mailbox instantly. */
export function envSnippet () {
  const { smtpPort } = settings.get('services').mailpit
  return [
    'MAIL_MAILER=smtp',
    'MAIL_HOST=127.0.0.1',
    `MAIL_PORT=${smtpPort}`,
    'MAIL_USERNAME=null',
    'MAIL_PASSWORD=null',
    'MAIL_ENCRYPTION=null',
    'MAIL_FROM_ADDRESS="hello@example.test"'
  ].join('\n')
}
