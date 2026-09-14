import { paths } from '../core/paths.js'
import { settings } from '../core/config.js'
import { log } from '../core/logger.js'
import { run } from '../core/shell.js'
import { IS_WIN } from '../core/platform.js'
import { runElevated } from '../core/elevate.js'
import { supervisor, isPortFree } from './supervisor.js'
import * as nginx from '../features/nginx.js'
import * as sites from '../features/sites.js'
import { listInstalled, startPool, stopAllPools, runningPools } from './php.js'

supervisor.register({
  id: 'nginx',
  label: 'Web server',
  group: 'core',
  port: () => settings.get('httpPort'),
  readyPort: () => settings.get('httpPort'),
  readyTimeout: 20_000,

  async prepare () {
    // Fail on the real cause first: a missing binary reads better than
    // "config is invalid" from the validation step below.
    if (!(await nginx.binary())) {
      throw new Error('nginx is not installed. Install it from the Services page ' +
        '(or with your package manager on Linux).')
    }

    // PHP must be listening before nginx validates its upstreams.
    const installed = await listInstalled()
    if (installed.length === 0) throw new Error('No PHP version installed. Install one from the PHP page.')

    const wanted = new Set([settings.get('defaultPhp') ?? installed[0].version])
    for (const site of sites.list()) if (site.php) wanted.add(site.php)
    for (const version of wanted) {
      await startPool(version).catch(err => log.warn('web', `PHP ${version}: ${err.message}`))
    }

    await nginx.writeMainConfig()
    await sites.apply()

    const check = await nginx.test()
    if (!check.ok) throw new Error(`nginx config is invalid:\n${check.output}`)

    const port = settings.get('httpPort')
    if (!(await isPortFree(port))) {
      throw new Error(`Port ${port} is already in use. Stop the other server or change the port in Settings.`)
    }
  },

  async command () {
    const bin = await nginx.binary()
    if (!bin) throw new Error('nginx is not installed. Install it from the Services page.')
    return { cmd: bin, args: ['-c', nginx.confFile(), '-p', paths.root], cwd: paths.root }
  },

  async reload () {
    await nginx.writeMainConfig()
    await sites.apply()
    const check = await nginx.test()
    if (!check.ok) throw new Error(check.output)
    return nginx.reload()
  }
})

/**
 * Binding 80/443 as an unprivileged user fails on Linux. Rather than run the
 * whole app as root, grant the nginx binary CAP_NET_BIND_SERVICE once.
 */
export async function ensureLowPortsAllowed () {
  if (IS_WIN) return { ok: true, needed: false }
  const port = settings.get('httpPort')
  if (port >= 1024 || process.getuid?.() === 0) return { ok: true, needed: false }

  const bin = await nginx.binary()
  if (!bin) return { ok: false, needed: true, reason: 'nginx is not installed' }

  const { stdout } = await run('getcap', [bin], { allowFailure: true })
  if (stdout.includes('cap_net_bind_service')) return { ok: true, needed: false }

  const result = await runElevated([`setcap 'cap_net_bind_service=+ep' "${bin}"`], {
    reason: `Allow nginx to listen on port ${port}`
  })
  return { ok: result.code === 0, needed: true, reason: result.stderr }
}

export async function status () {
  return {
    nginx: supervisor.get('nginx'),
    pools: runningPools(),
    sites: sites.list().length
  }
}

export async function stopEverything () {
  await supervisor.stopAll()
  await stopAllPools()
}
