import fs from 'node:fs'
import path from 'node:path'
import { paths } from './paths.js'

const MAX_BYTES = 5 * 1024 * 1024
let stream = null
const listeners = new Set()

function open () {
  if (stream) return stream
  const file = path.join(paths.logs, 'herd.log')
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, `${file}.1`)
    }
  } catch { /* rotation is best-effort */ }
  stream = fs.createWriteStream(file, { flags: 'a' })
  return stream
}

function write (level, scope, message) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    message: typeof message === 'string' ? message : JSON.stringify(message)
  }
  try { open().write(`${entry.ts} [${level}] ${scope}: ${entry.message}\n`) } catch { /* disk full */ }
  for (const fn of listeners) fn(entry)
  if (level === 'error') console.error(`[${scope}]`, message)
}

export const log = {
  info: (scope, msg) => write('info', scope, msg),
  warn: (scope, msg) => write('warn', scope, msg),
  error: (scope, msg) => write('error', scope, msg?.stack || msg),
  debug: (scope, msg) => { if (process.env.HERD_DEBUG) write('debug', scope, msg) },

  /** The Logs page subscribes here to get a live tail without polling. */
  subscribe (fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
}
