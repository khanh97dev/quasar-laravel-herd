import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { paths } from '../core/paths.js'
import { log } from '../core/logger.js'
import { list as listSites } from './sites.js'

/**
 * Tails are per-window subscriptions: opening the Logs page starts one watcher
 * per file and streams appended bytes, so a 200MB log never enters memory.
 */
const tails = new Map()

export async function available () {
  const entries = []

  const files = await fsp.readdir(paths.logs).catch(() => [])
  for (const name of files.filter(f => f.endsWith('.log'))) {
    const file = path.join(paths.logs, name)
    const stat = await fsp.stat(file).catch(() => null)
    if (!stat) continue
    entries.push({
      id: name,
      label: prettify(name),
      file,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      group: groupOf(name)
    })
  }

  // Laravel writes its own logs inside each project — surface them too.
  for (const site of listSites()) {
    const dir = path.join(site.root, 'storage', 'logs')
    const laravelLogs = await fsp.readdir(dir).catch(() => [])
    for (const name of laravelLogs.filter(f => f.endsWith('.log'))) {
      const file = path.join(dir, name)
      const stat = await fsp.stat(file).catch(() => null)
      if (!stat) continue
      entries.push({
        id: `${site.domain}:${name}`,
        label: `${site.domain} · ${name}`,
        file,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        group: 'application'
      })
    }
  }

  return entries.sort((a, b) => b.modified.localeCompare(a.modified))
}

function groupOf (name) {
  if (name.startsWith('site-')) return 'site'
  if (name.startsWith('php')) return 'php'
  if (name.startsWith('nginx')) return 'web'
  if (/mysql|postgres|redis/.test(name)) return 'database'
  return 'herd'
}

function prettify (name) {
  return name
    .replace(/\.log$/, '')
    .replace(/^site-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export async function readTail (file, lines = 500) {
  if (!fs.existsSync(file)) return { file, lines: [] }
  const stat = await fsp.stat(file)
  // Read at most the last 512KB; enough for `lines` in any realistic log.
  const window = Math.min(stat.size, 512 * 1024)
  const handle = await fsp.open(file, 'r')
  try {
    const buffer = Buffer.alloc(window)
    await handle.read(buffer, 0, window, stat.size - window)
    const text = buffer.toString('utf8')
    return { file, size: stat.size, lines: text.split(/\r?\n/).slice(-lines) }
  } finally {
    await handle.close()
  }
}

export function startTail (id, file, onLine) {
  stopTail(id)
  if (!fs.existsSync(file)) return false

  let offset = fs.statSync(file).size
  const watcher = fs.watch(file, { persistent: false }, async eventType => {
    if (eventType !== 'change') return
    try {
      const stat = await fsp.stat(file)
      if (stat.size < offset) offset = 0 // rotated
      if (stat.size === offset) return
      const handle = await fsp.open(file, 'r')
      try {
        const buffer = Buffer.alloc(stat.size - offset)
        await handle.read(buffer, 0, buffer.length, offset)
        offset = stat.size
        for (const line of buffer.toString('utf8').split(/\r?\n/)) {
          if (line) onLine(line)
        }
      } finally { await handle.close() }
    } catch (err) {
      log.debug('logs', `tail ${file}: ${err.message}`)
    }
  })

  tails.set(id, watcher)
  return true
}

export function stopTail (id) {
  tails.get(id)?.close()
  return tails.delete(id)
}

export function stopAllTails () {
  for (const id of [...tails.keys()]) stopTail(id)
}

export async function clear (file) {
  // Truncate rather than delete: the writing process keeps its handle.
  await fsp.truncate(file, 0).catch(err => { throw new Error(`Cannot clear log: ${err.message}`) })
  return true
}
