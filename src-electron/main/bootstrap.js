import fsp from 'node:fs/promises'
import { ensureDirs, paths } from './core/paths.js'
import { settings } from './core/config.js'
import { log } from './core/logger.js'
import { supervisor, reapStalePids } from './services/supervisor.js'
import { listInstalled, reapOrphans } from './services/php.js'
import { createCa } from './features/ssl.js'
import { dumpServer } from './services/dumps.js'
import * as sites from './features/sites.js'
import * as web from './services/web.js'

// Side-effect imports: each registers its services with the supervisor.
import './services/web.js'
import './services/databases.js'
import './services/mail.js'

/**
 * First run does the boring setup so the app is usable immediately: create the
 * directory tree, park ~/Herd, mint the CA, and start whatever was enabled last
 * time.
 */
export async function bootstrap () {
  ensureDirs()
  log.info('boot', `data root: ${paths.root}`)

  // Clean up after a previous run that was killed rather than closed.
  await reapStalePids().catch(err => log.warn('boot', `service cleanup: ${err.message}`))
  await reapOrphans().catch(err => log.warn('boot', `PHP cleanup: ${err.message}`))

  if (settings.get('parkedPaths').length === 0) {
    await fsp.mkdir(paths.parkRoot, { recursive: true })
    settings.set({ parkedPaths: [paths.parkRoot] })
    log.info('boot', `parked ${paths.parkRoot}`)
  }

  await createCa().catch(err => log.error('boot', `CA creation failed: ${err.message}`))

  const installed = await listInstalled()
  if (installed.length > 0 && !settings.get('defaultPhp')) {
    settings.set({ defaultPhp: installed[0].version })
  }

  if (settings.get('dumpServer').enabled) {
    try { dumpServer.start() } catch (err) { log.error('boot', err) }
  }

  await sites.apply().catch(err => log.error('boot', `site sync failed: ${err.message}`))

  if (settings.get('autoStart') && installed.length > 0) {
    await web.ensureLowPortsAllowed().catch(err => log.warn('boot', err.message))
    await supervisor.start('nginx').catch(err => log.error('boot', `nginx: ${err.message}`))
    for (const [id, conf] of Object.entries(settings.get('services'))) {
      if (conf.enabled) await supervisor.start(id).catch(err => log.warn('boot', `${id}: ${err.message}`))
    }
  }

  return { firstRun: installed.length === 0 }
}

export async function shutdown () {
  log.info('boot', 'shutting down services')
  dumpServer.stop()
  await web.stopEverything().catch(err => log.error('boot', err))
}
