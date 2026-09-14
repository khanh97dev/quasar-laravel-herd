import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { hostsFile, IS_WIN } from '../core/platform.js'
import { runElevated, canWriteHosts } from '../core/elevate.js'
import { log } from '../core/logger.js'

const BEGIN = '# BEGIN Quasar Herd'
const END = '# END Quasar Herd'

function stripBlock (text) {
  const start = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  if (start === -1 || end === -1) return text.trimEnd()
  return (text.slice(0, start) + text.slice(end + END.length)).trimEnd()
}

export async function currentEntries () {
  const text = await fsp.readFile(hostsFile(), 'utf8').catch(() => '')
  const start = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  if (start === -1 || end === -1) return []
  return text.slice(start + BEGIN.length, end)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.split(/\s+/)[1])
    .filter(Boolean)
}

/**
 * Rewrites only our managed block, never the rest of the file — the user's own
 * entries must survive every sync.
 */
export async function sync (domains) {
  const file = hostsFile()
  const existing = await fsp.readFile(file, 'utf8').catch(() => '')
  const unique = [...new Set(domains)].sort()

  const block = [
    BEGIN,
    ...unique.flatMap(d => [`127.0.0.1\t${d}`, `::1\t${d}`]),
    END
  ].join(IS_WIN ? '\r\n' : '\n')

  const next = `${stripBlock(existing)}\n\n${block}\n`
  if (existing === next) return { changed: false, domains: unique }

  if (await canWriteHosts()) {
    await fsp.writeFile(file, next)
    log.info('hosts', `wrote ${unique.length} domain(s) directly`)
    return { changed: true, domains: unique, elevated: false }
  }

  const result = await writeElevated(file, next)
  if (result.code !== 0) throw new Error(result.stderr || 'Failed to update the hosts file')
  log.info('hosts', `wrote ${unique.length} domain(s) with elevation`)
  return { changed: true, domains: unique, elevated: true }
}

async function writeElevated (file, contents) {
  const { paths } = await import('../core/paths.js')
  const staging = `${paths.tmp}/hosts.staged`
  await fsp.writeFile(staging, contents)

  return runElevated(
    IS_WIN
      ? [`Copy-Item -Force -LiteralPath '${staging}' -Destination '${file}'`]
      : [`cp "${staging}" "${file}"`, `chmod 644 "${file}"`],
    { reason: 'Update the hosts file so .test domains resolve' }
  )
}

export async function remove () {
  const file = hostsFile()
  const existing = await fsp.readFile(file, 'utf8').catch(() => '')
  const next = `${stripBlock(existing)}\n`
  if (await canWriteHosts()) {
    await fsp.writeFile(file, next)
    return { changed: true }
  }
  const result = await writeElevated(file, next)
  return { changed: result.code === 0 }
}

export function hostsPath () {
  return hostsFile()
}

export function hostsReadable () {
  return fs.existsSync(hostsFile())
}
