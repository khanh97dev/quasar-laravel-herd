import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { paths } from '../core/paths.js'
import { IS_WIN, EXE } from '../core/platform.js'
import { run, which, isExecutable, killTree } from '../core/shell.js'
import { settings } from '../core/config.js'
import { log } from '../core/logger.js'
import { PHP_VERSIONS, phpSource } from '../core/registry.js'
import { fetchAndInstall } from '../core/download.js'
import { daemon } from '../core/shell.js'
import { waitForPort } from './supervisor.js'

/**
 * PHP versions live side by side under runtimes/php/<version>/. Each installed
 * version gets its own FPM pool (Linux) or php-cgi worker pool (Windows)
 * listening on a dedicated loopback port, so nginx can route per site.
 */
const FPM_BASE_PORT = 9100
const pools = new Map() // version -> { port, children[], mode }

function versionDir (version) {
  return path.join(paths.runtimes, 'php', version)
}

function binaryPath (version, name = 'php') {
  const dir = versionDir(version)
  for (const candidate of [
    path.join(dir, `${name}${EXE}`),
    path.join(dir, 'bin', `${name}${EXE}`),
    path.join(dir, 'sbin', `${name}${EXE}`)
  ]) {
    if (isExecutable(candidate) || (IS_WIN && fs.existsSync(candidate))) return candidate
  }
  return null
}

/**
 * Managed builds first, then whatever is on PATH — a distro PHP the user
 * already has must be poolable, not just listable. Version-suffixed names
 * (php8.3, php-fpm8.3) are how Debian and Fedora ship multiple versions.
 */
async function resolveBinary (version, name = 'php') {
  const managed = binaryPath(version, name)
  if (managed) return managed

  for (const candidate of [`${name}${version}`, `${name}-${version}`, name]) {
    const found = await which(candidate)
    if (!found) continue
    // A bare `php` on PATH may be a different version; only accept a match.
    if (candidate === name && !(await matchesVersion(found, version))) continue
    return found
  }
  return null
}

async function matchesVersion (binary, version) {
  const { stdout, code } = await run(binary, ['-v'], { allowFailure: true, timeout: 10_000 })
  if (code !== 0) return false
  return stdout.startsWith(`PHP ${version}.`)
}

export function poolPort (version) {
  const index = PHP_VERSIONS.indexOf(version)
  return FPM_BASE_PORT + (index === -1 ? PHP_VERSIONS.length : index)
}

export async function listInstalled () {
  const root = path.join(paths.runtimes, 'php')
  await fsp.mkdir(root, { recursive: true })
  const dirs = await fsp.readdir(root, { withFileTypes: true })

  const installed = []
  for (const entry of dirs.filter(d => d.isDirectory())) {
    const bin = binaryPath(entry.name)
    if (!bin) continue
    const { stdout } = await run(bin, ['-v'], { allowFailure: true, timeout: 10_000 })
    installed.push({
      version: entry.name,
      fullVersion: stdout.match(/PHP (\d+\.\d+\.\d+)/)?.[1] ?? entry.name,
      path: bin,
      fpm: Boolean(binaryPath(entry.name, 'php-fpm')),
      running: pools.has(entry.name),
      port: poolPort(entry.name),
      managed: true
    })
  }

  // A distro/XAMPP PHP already on PATH is usable too — surface it rather than
  // forcing a download the user does not need.
  const systemPhp = await which('php')
  if (systemPhp && !installed.some(p => p.path === systemPhp)) {
    const { stdout, code } = await run(systemPhp, ['-v'], { allowFailure: true })
    if (code === 0) {
      const full = stdout.match(/PHP (\d+\.\d+\.\d+)/)?.[1]
      if (full) {
        const minor = full.split('.').slice(0, 2).join('.')
        installed.push({
          version: minor,
          fullVersion: full,
          path: systemPhp,
          fpm: Boolean(await which('php-fpm')),
          running: pools.has(minor),
          port: poolPort(minor),
          managed: false
        })
      }
    }
  }

  return installed.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
}

export function listAvailable () {
  return PHP_VERSIONS
}

export async function install (version, onProgress) {
  const source = phpSource(version)
  const destDir = versionDir(version)
  await fsp.mkdir(destDir, { recursive: true })

  if (IS_WIN) {
    const url = await resolveWindowsUrl(source, version)
    log.info('php', `installing PHP ${version} from ${url}`)
    await fetchAndInstall({ url, destDir }, onProgress)
  } else {
    // Linux static builds ship CLI and FPM as separate archives; both unpack
    // into the same directory so one version folder holds a complete PHP.
    const index = await fetchIndex(source.indexUrl)
    const fpmUrl = newestMatch(index, source, 'fpm')
    const cliUrl = newestMatch(index, source, 'cli')
    if (!fpmUrl && !cliUrl) {
      throw new Error(`No static build published for PHP ${version} on this architecture.`)
    }
    for (const url of [fpmUrl, cliUrl].filter(Boolean)) {
      log.info('php', `installing PHP ${version} from ${url}`)
      await fetchAndInstall({ url, destDir }, onProgress)
    }
  }

  await flattenSingleChild(destDir)
  await writeIni(version)
  if (!settings.get('defaultPhp')) settings.set({ defaultPhp: version })
  return listInstalled()
}

async function fetchIndex (url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not read the PHP build index (HTTP ${res.status})`)
  return res.text()
}

/** Picks the highest patch release listed for this minor version. */
function newestMatch (index, source, sapi) {
  const names = [...new Set(index.match(source.pattern(sapi)) ?? [])]
  if (names.length === 0) return null
  names.sort((a, b) => patchOf(a) - patchOf(b))
  return source.baseUrl + names[names.length - 1]
}

function patchOf (filename) {
  return Number(filename.match(/^php-\d+\.\d+\.(\d+)/)?.[1] ?? 0)
}

async function resolveWindowsUrl (source, version) {
  try {
    const res = await fetch(source.indexUrl)
    const releases = await res.json()
    const entry = releases[version]
    const file = Object.values(entry ?? {})
      .flatMap(v => (Array.isArray(v?.files) ? v.files : []))
      .find(f => /nts-Win32-vs\d+-x64\.zip$/.test(f?.path ?? ''))
    if (file) return `https://windows.php.net/downloads/releases/${file.path}`
  } catch (err) {
    log.warn('php', `release index lookup failed: ${err.message}`)
  }
  return source.fallbackUrl
}

/** Archives often unpack into one nested folder; hoist it so paths stay stable. */
async function flattenSingleChild (dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  if (entries.length !== 1 || !entries[0].isDirectory()) return
  const nested = path.join(dir, entries[0].name)
  for (const name of await fsp.readdir(nested)) {
    await fsp.rename(path.join(nested, name), path.join(dir, name))
  }
  await fsp.rmdir(nested)
}

export async function uninstall (version) {
  await stopPool(version)
  await fsp.rm(versionDir(version), { recursive: true, force: true })
  if (settings.get('defaultPhp') === version) {
    const remaining = await listInstalled()
    settings.set({ defaultPhp: remaining[0]?.version ?? null })
  }
  return listInstalled()
}

export function iniPath (version) {
  return path.join(paths.phpConf, version, 'php.ini')
}

export async function writeIni (version, overrides = {}) {
  const dir = path.join(paths.phpConf, version)
  await fsp.mkdir(dir, { recursive: true })
  const file = iniPath(version)
  if (fs.existsSync(file) && Object.keys(overrides).length === 0) return file

  const current = fs.existsSync(file) ? parseIni(await fsp.readFile(file, 'utf8')) : defaultIni()
  const merged = { ...current, ...overrides }
  const body = [
    '; Managed by Quasar Herd — edit via the PHP page or directly, both work.',
    ...Object.entries(merged).map(([k, v]) => `${k} = ${v}`)
  ].join('\n')
  await fsp.writeFile(file, `${body}\n`)
  return file
}

function defaultIni () {
  return {
    memory_limit: '512M',
    upload_max_filesize: '256M',
    post_max_size: '256M',
    max_execution_time: '0',
    display_errors: 'On',
    error_reporting: 'E_ALL',
    date_view: '',
    'date.timezone': 'UTC',
    'opcache.enable': '1',
    'opcache.enable_cli': '0',
    'xdebug.mode': 'off'
  }
}

function parseIni (text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^;#=\s][^=]*?)\s*=\s*(.*)$/)
    if (match) out[match[1]] = match[2]
  }
  return out
}

export async function readIni (version) {
  const file = iniPath(version)
  if (!fs.existsSync(file)) await writeIni(version)
  return { file, values: parseIni(await fsp.readFile(file, 'utf8')) }
}

/* ------------------------------------------------------------------ pools */

export async function startPool (version) {
  if (pools.has(version)) return pools.get(version)
  const port = poolPort(version)

  const fpm = await resolveBinary(version, 'php-fpm')
  if (fpm && !IS_WIN) return startFpm(version, fpm, port)

  const cgi = await resolveBinary(version, 'php-cgi') ?? await resolveBinary(version, 'php')
  if (!cgi) throw new Error(`No PHP binary found for ${version}. Install it from the PHP page.`)
  return startCgiPool(version, cgi, port)
}

async function startFpm (version, binary, port) {
  const confFile = path.join(paths.phpConf, version, 'php-fpm.conf')
  await fsp.mkdir(path.dirname(confFile), { recursive: true })
  await fsp.writeFile(confFile, [
    '[global]',
    `pid = ${path.join(paths.run, `php-fpm-${version}.pid`)}`,
    `error_log = ${path.join(paths.logs, `php-fpm-${version}.log`)}`,
    'daemonize = no',
    '',
    '[herd]',
    // FPM refuses to start as root without an explicit unprivileged user.
    ...(process.getuid?.() === 0 ? [`user = ${fpmUser()}`, `group = ${fpmUser()}`] : []),
    `listen = 127.0.0.1:${port}`,
    'pm = dynamic',
    'pm.max_children = 20',
    'pm.start_servers = 3',
    'pm.min_spare_servers = 2',
    'pm.max_spare_servers = 6',
    'catch_workers_output = yes',
    'clear_env = no',
    'php_admin_value[error_log] = ' + path.join(paths.logs, `php-error-${version}.log`),
    'php_admin_flag[log_errors] = on'
  ].join('\n'))

  const child = daemon(binary, ['--nodaemonize', '--fpm-config', confFile, '-c', iniPath(version)], {
    name: `php-fpm-${version}`
  })
  await waitForOwnPort(child, port)
  const pool = { version, port, mode: 'fpm', children: [child] }
  pools.set(version, pool)
  await recordPids()
  log.info('php', `PHP-FPM ${version} listening on 127.0.0.1:${port}`)
  return pool
}

/**
 * Windows has no PHP-FPM. php-cgi in FastCGI mode (-b) handles one request at
 * a time, so we run a small fixed pool and let nginx round-robin across it.
 */
/** An unprivileged account FPM workers can drop to when we are running as root. */
function fpmUser () {
  for (const name of ['www-data', 'http', 'nobody']) {
    try {
      if (fs.readFileSync('/etc/passwd', 'utf8').split('\n').some(l => l.startsWith(`${name}:`))) return name
    } catch { /* fall through to the default */ }
  }
  return 'nobody'
}

async function startCgiPool (version, binary, basePort, size = 4) {
  const children = []
  const ports = []
  for (let i = 0; i < size; i += 1) {
    const port = basePort + 100 + i
    children.push(daemon(binary, ['-b', `127.0.0.1:${port}`, '-c', iniPath(version)], {
      name: `php-cgi-${version}-${i}`,
      env: { PHP_FCGI_MAX_REQUESTS: '0' }
    }))
    ports.push(port)
  }
  await waitForOwnPort(children[0], ports[0])
  const pool = { version, port: basePort, ports, mode: 'cgi', children }
  pools.set(version, pool)
  log.info('php', `php-cgi pool for ${version} on ports ${ports.join(', ')}`)
  return pool
}

/**
 * waitForPort alone is not enough: a stale process from a previous run can be
 * holding the port, so a successful connect would hide our child's bind error.
 * Fail if the child dies while we wait.
 */
async function waitForOwnPort (child, port, timeout = 15_000) {
  let exited = null
  child.once('exit', code => { exited = code })

  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`PHP worker exited (code ${exited}) — port ${port} is probably taken by a stale process.`)
    }
    try {
      await waitForPort(port, 500)
      // Give the child a beat to fail its own bind before declaring success.
      await new Promise(resolve => setTimeout(resolve, 250))
      if (exited !== null) {
        throw new Error(`PHP worker could not bind 127.0.0.1:${port} (already in use).`)
      }
      return true
    } catch (err) {
      if (err.message.includes('already in use') || err.message.includes('exited')) throw err
    }
  }
  throw new Error(`Timed out waiting for the PHP worker on port ${port}`)
}

export async function stopPool (version) {
  const pool = pools.get(version)
  if (!pool) return
  await Promise.allSettled(pool.children.map(child => killTree(child.pid)))
  pools.delete(version)
  await recordPids()
  log.info('php', `stopped pool for ${version}`)
}

export async function restartPool (version) {
  await stopPool(version)
  return startPool(version)
}

const POOL_PID_FILE = () => path.join(paths.run, 'php-pools.json')

async function recordPids () {
  const record = [...pools.values()].flatMap(pool => pool.children.map(c => c.pid)).filter(Boolean)
  await fsp.writeFile(POOL_PID_FILE(), JSON.stringify(record)).catch(() => {})
}

/**
 * A SIGKILLed app leaves FPM masters holding their ports. Reap them on the
 * next launch so start-up is not blocked by our own leftovers.
 */
export async function reapOrphans () {
  let pids = []
  try { pids = JSON.parse(await fsp.readFile(POOL_PID_FILE(), 'utf8')) } catch { return 0 }

  let reaped = 0
  for (const pid of pids) {
    try { process.kill(pid, 0) } catch { continue } // already gone
    await killTree(pid)
    reaped += 1
  }
  await fsp.rm(POOL_PID_FILE(), { force: true }).catch(() => {})
  if (reaped) log.info('php', `reaped ${reaped} orphaned PHP worker(s) from a previous run`)
  return reaped
}

export function runningPools () {
  return [...pools.values()].map(({ version, port, mode, ports }) => ({ version, port, mode, ports }))
}

export async function stopAllPools () {
  await Promise.allSettled([...pools.keys()].map(stopPool))
}

/** Upstream block nginx uses for a version; a cgi pool needs every port listed. */
export function upstreamServers (version) {
  const pool = pools.get(version)
  if (pool?.ports) return pool.ports.map(p => `127.0.0.1:${p}`)
  return [`127.0.0.1:${poolPort(version)}`]
}

export async function cli (version, args, opts = {}) {
  const bin = await resolveBinary(version, 'php') ?? await which('php')
  if (!bin) throw new Error(`No PHP CLI available for ${version}`)
  return run(bin, ['-c', iniPath(version), ...args], { ...opts, allowFailure: true })
}

export async function extensions (version) {
  const { stdout } = await cli(version, ['-m'])
  return stdout.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('['))
}
