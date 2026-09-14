import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import { IS_WIN } from './platform.js'
import { log } from './logger.js'

const execFileAsync = promisify(execFile)

/**
 * Run a command and capture its output. Throws on non-zero exit unless
 * `allowFailure` is set — callers that probe for a binary want the code back,
 * not an exception.
 */
export async function run (cmd, args = [], opts = {}) {
  const { allowFailure = false, timeout = 120_000, cwd, env } = opts
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout,
      cwd,
      env: { ...process.env, ...env },
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    })
    return { code: 0, stdout: stdout.toString(), stderr: stderr.toString() }
  } catch (err) {
    if (!allowFailure) {
      log.error('shell', `${cmd} ${args.join(' ')} -> ${err.message}`)
      throw err
    }
    return {
      code: err.code ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? err.message
    }
  }
}

/**
 * Long-lived child process (nginx, php-fpm, mysqld...). Never awaited.
 *
 * On POSIX these get their own process group so we can signal the whole tree.
 * nginx and php-fpm fork workers that keep listening if only the master is
 * killed, which then blocks the port on the next start.
 */
export function daemon (cmd, args = [], opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    detached: !IS_WIN,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  const tag = opts.name || cmd
  child.stdout.on('data', d => log.debug(tag, d.toString().trim()))
  child.stderr.on('data', d => log.warn(tag, d.toString().trim()))
  child.on('error', err => log.error(tag, err))
  return child
}

export async function which (bin) {
  const { code, stdout } = await run(IS_WIN ? 'where' : 'which', [bin], { allowFailure: true })
  return code === 0 ? stdout.trim().split(/\r?\n/)[0] : null
}

export function isExecutable (file) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch { return false }
}

/** Kill a process tree — Windows needs taskkill, POSIX needs the group. */
export async function killTree (pid, { timeout = 5000 } = {}) {
  if (!pid) return

  if (IS_WIN) {
    await run('taskkill', ['/pid', String(pid), '/T', '/F'], { allowFailure: true })
    return
  }

  // Negative pid signals the whole group, so workers go down with the master.
  const signalGroup = signal => {
    try { process.kill(-pid, signal) } catch {
      try { process.kill(pid, signal) } catch { /* already gone */ }
    }
  }

  signalGroup('SIGTERM')

  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return
    await new Promise(resolve => setTimeout(resolve, 150))
  }

  // Anything still up after the grace period gets SIGKILL.
  signalGroup('SIGKILL')
}

export function isAlive (pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
