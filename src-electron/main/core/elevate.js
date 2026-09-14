import fs from 'node:fs/promises'
import path from 'node:path'
import { paths } from './paths.js'
import { IS_WIN } from './platform.js'
import { run } from './shell.js'
import { log } from './logger.js'

/**
 * Privileged work (hosts file, CA trust store, port 80/443 binding) is batched
 * into a single script so the user sees one password / UAC prompt instead of
 * one per operation.
 */
export async function runElevated (lines, { reason = 'Quasar Herd needs administrator access' } = {}) {
  if (lines.length === 0) return { code: 0, stdout: '', stderr: '' }

  const script = IS_WIN
    ? await writeScript('herd-elevated.ps1', ['$ErrorActionPreference = "Stop"', ...lines].join('\r\n'))
    : await writeScript('herd-elevated.sh', ['#!/bin/bash', 'set -euo pipefail', ...lines].join('\n'))

  log.info('elevate', `running ${lines.length} privileged step(s): ${reason}`)

  if (IS_WIN) {
    // Start-Process -Verb RunAs triggers UAC; -Wait so we can read the exit code.
    const ps = `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
      `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${script}'; exit $p.ExitCode`
    return run('powershell.exe', ['-NoProfile', '-Command', ps], { allowFailure: true, timeout: 300_000 })
  }

  await fs.chmod(script, 0o755)
  const runner = await pickLinuxElevator()
  if (!runner) {
    return { code: 1, stdout: '', stderr: 'No pkexec/sudo available. Run the printed script manually.' }
  }
  return run(runner.cmd, [...runner.args, script], { allowFailure: true, timeout: 300_000 })
}

async function pickLinuxElevator () {
  // pkexec gives a graphical prompt; sudo -n only works if already cached.
  for (const candidate of [
    { cmd: 'pkexec', args: ['--disable-internal-agent'] },
    { cmd: 'sudo', args: ['-n'] }
  ]) {
    const { code } = await run('which', [candidate.cmd], { allowFailure: true })
    if (code === 0) return candidate
  }
  return null
}

async function writeScript (name, body) {
  const file = path.join(paths.tmp, name)
  await fs.writeFile(file, body, { mode: 0o700 })
  return file
}

/** True when we can write the hosts file without prompting (root / dev container). */
export async function canWriteHosts () {
  const target = IS_WIN
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts'
  try {
    await fs.access(target, (await import('node:fs')).constants.W_OK)
    return true
  } catch { return false }
}
