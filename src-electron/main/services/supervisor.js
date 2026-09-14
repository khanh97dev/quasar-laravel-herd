import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { paths } from '../core/paths.js'
import { daemon, killTree } from '../core/shell.js'
import { log } from '../core/logger.js'

/**
 * One place that knows how to start, stop and watch every long-running child.
 * Services register a spec; the supervisor owns the process handle, restart
 * backoff and the status the UI polls.
 */
class Supervisor extends EventEmitter {
  #specs = new Map()
  #state = new Map()

  register (spec) {
    this.#specs.set(spec.id, spec)
    if (!this.#state.has(spec.id)) {
      this.#state.set(spec.id, { id: spec.id, status: 'stopped', pid: null, restarts: 0, error: null })
    }
  }

  list () {
    return [...this.#specs.values()].map(spec => ({
      ...this.#state.get(spec.id),
      label: spec.label,
      group: spec.group ?? 'service',
      port: typeof spec.port === 'function' ? spec.port() : spec.port
    }))
  }

  get (id) {
    return this.#state.get(id) ?? null
  }

  #patch (id, patch) {
    const next = { ...this.#state.get(id), ...patch }
    this.#state.set(id, next)
    this.emit('change', next)
    return next
  }

  async start (id) {
    const spec = this.#specs.get(id)
    if (!spec) throw new Error(`Unknown service: ${id}`)
    const current = this.#state.get(id)
    if (current.status === 'running') return current

    this.#patch(id, { status: 'starting', error: null })
    try {
      await spec.prepare?.()
      const { cmd, args, env, cwd } = await spec.command()
      const child = daemon(cmd, args, { env, cwd, name: id })
      spec._child = child

      child.once('exit', (code, signal) => {
        spec._child = null
        const wasRunning = this.#state.get(id).status === 'running'
        this.#patch(id, { status: 'stopped', pid: null })
        if (wasRunning && !spec._stopping && code !== 0) {
          log.warn('supervisor', `${id} exited unexpectedly (code=${code} signal=${signal})`)
          this.#restart(id)
        }
      })

      if (spec.readyPort) {
        await waitForPort(typeof spec.readyPort === 'function' ? spec.readyPort() : spec.readyPort, spec.readyTimeout ?? 15_000)
      }
      writePid(id, child.pid)
      return this.#patch(id, { status: 'running', pid: child.pid })
    } catch (err) {
      log.error('supervisor', `failed to start ${id}: ${err.message}`)
      return this.#patch(id, { status: 'error', error: err.message, pid: null })
    }
  }

  async stop (id) {
    const spec = this.#specs.get(id)
    if (!spec) throw new Error(`Unknown service: ${id}`)
    spec._stopping = true
    try {
      if (spec.stop) await spec.stop()
      else if (spec._child) await killTree(spec._child.pid)
      clearPid(id)
      return this.#patch(id, { status: 'stopped', pid: null, error: null })
    } finally {
      spec._stopping = false
    }
  }

  async restart (id) {
    await this.stop(id)
    return this.start(id)
  }

  /** Exponential backoff, capped — a service that cannot bind its port should
   *  surface an error rather than spin forever. */
  #restart (id) {
    const state = this.#state.get(id)
    if (state.restarts >= 3) {
      this.#patch(id, { status: 'error', error: 'Crashed repeatedly; giving up.' })
      return
    }
    const delay = 1000 * 2 ** state.restarts
    this.#patch(id, { restarts: state.restarts + 1 })
    setTimeout(() => this.start(id), delay)
  }

  async stopAll () {
    await Promise.allSettled([...this.#specs.keys()].map(id => this.stop(id)))
  }

  async reload (id) {
    const spec = this.#specs.get(id)
    if (spec?.reload) return spec.reload()
    return this.restart(id)
  }
}

export const supervisor = new Supervisor()

export function waitForPort (port, timeout = 15_000, host = '127.0.0.1') {
  const deadline = Date.now() + timeout
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) reject(new Error(`Timed out waiting for port ${port}`))
        else setTimeout(attempt, 250)
      })
    }
    attempt()
  })
}

export function isPortFree (port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, host)
  })
}

/**
 * Services write a pid file while they run; if the app was killed rather than
 * closed, those processes are still holding their ports. Clear them before
 * anything tries to bind.
 */
export async function reapStalePids () {
  const dir = pidDir()
  let files = []
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.pid')) } catch { return 0 }

  let reaped = 0
  for (const name of files) {
    const file = path.join(dir, name)
    const pid = Number(fs.readFileSync(file, 'utf8').trim())
    try { fs.unlinkSync(file) } catch { /* best effort */ }
    if (!pid) continue
    try { process.kill(pid, 0) } catch { continue } // already gone
    await killTree(pid)
    reaped += 1
  }
  if (reaped) log.info('supervisor', `reaped ${reaped} orphaned service process(es) from a previous run`)
  return reaped
}

/**
 * Kept in its own directory: daemons like nginx write their own pid file into
 * run/, and letting the two collide left us with an empty file and an
 * un-reapable orphan.
 */
function pidDir () {
  const dir = path.join(paths.run, 'supervisor')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writePid (id, pid) {
  try { fs.writeFileSync(path.join(pidDir(), `${id}.pid`), String(pid)) } catch { /* non-fatal */ }
}

function clearPid (id) {
  try { fs.unlinkSync(path.join(pidDir(), `${id}.pid`)) } catch { /* already gone */ }
}
