import { ipcMain, shell, dialog, app, BrowserWindow, clipboard } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { paths, ensureDirs } from './core/paths.js'
import { settings, DEFAULT_SETTINGS } from './core/config.js'
import { log } from './core/logger.js'
import { IS_WIN, IS_LINUX } from './core/platform.js'
import { supervisor } from './services/supervisor.js'
import * as php from './services/php.js'
import * as web from './services/web.js'
import * as db from './services/databases.js'
import * as mail from './services/mail.js'
import * as tooling from './services/tooling.js'
import { dumpServer, envSnippet as dumpEnv } from './services/dumps.js'
import * as sites from './features/sites.js'
import * as ssl from './features/ssl.js'
import * as hosts from './features/hosts.js'
import * as nginx from './features/nginx.js'
import * as logs from './features/logs.js'
import { parkWatcher } from './features/watcher.js'
import { fetchAndInstall } from './core/download.js'
import { RUNTIMES } from './core/registry.js'

/**
 * Every renderer call lands here. Handlers are wrapped so a thrown error comes
 * back as { ok: false, error } instead of an opaque rejected promise — the UI
 * can then show the real message in a banner.
 */
function handle (channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      log.error('ipc', `${channel}: ${err.stack || err.message}`)
      return { ok: false, error: err.message }
    }
  })
}

function broadcast (channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function registerIpc () {
  /* ------------------------------------------------------------- app */

  handle('app:info', async () => ({
    version: app.getVersion(),
    name: app.getName(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    paths: { ...paths }
  }))

  handle('app:openExternal', url => shell.openExternal(url))
  handle('app:openPath', target => shell.openPath(target))
  handle('app:showItem', target => { shell.showItemInFolder(target); return true })
  handle('app:copy', text => { clipboard.writeText(text); return true })
  handle('app:quit', async () => { await web.stopEverything(); app.quit(); return true })

  handle('app:pickDirectory', async (title = 'Choose a folder') => {
    const result = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  /* -------------------------------------------------------- settings */

  handle('settings:get', () => settings.all())
  handle('settings:set', async patch => {
    const before = settings.all()
    const next = settings.set(patch)
    // Domain suffix or port changes invalidate every vhost.
    if (patch.tld !== undefined && patch.tld !== before.tld) await sites.apply()
    if (patch.httpPort || patch.httpsPort) await supervisor.reload('nginx').catch(() => {})
    return next
  })
  handle('settings:reset', () => settings.reset())
  handle('settings:defaults', () => DEFAULT_SETTINGS)

  /* ------------------------------------------------------------ php */

  handle('php:installed', () => php.listInstalled())
  handle('php:available', () => php.listAvailable())
  handle('php:install', async version => {
    const result = await php.install(version, progress =>
      broadcast('php:progress', { version, ...progress }))
    broadcast('php:progress', { version, percent: 1, done: true })
    return result
  })
  handle('php:uninstall', version => php.uninstall(version))
  handle('php:setDefault', async version => {
    settings.set({ defaultPhp: version })
    await php.startPool(version).catch(() => {})
    await sites.apply()
    return settings.all()
  })
  handle('php:ini', version => php.readIni(version))
  handle('php:saveIni', async (version, values) => {
    await php.writeIni(version, values)
    await php.restartPool(version).catch(() => {})
    return php.readIni(version)
  })
  handle('php:extensions', version => php.extensions(version))
  handle('php:restartPool', version => php.restartPool(version))
  handle('php:run', (version, args, cwd) => php.cli(version, args, { cwd }))

  /* ---------------------------------------------------------- sites */

  handle('sites:list', async () => Promise.all(sites.list().map(sites.describe)))
  handle('sites:link', (root, options) => sites.link(root, options))
  handle('sites:unlink', domain => sites.unlink(domain))
  handle('sites:park', async dir => {
    const parked = await sites.park(dir)
    parkWatcher.restart()
    return parked
  })
  handle('sites:unpark', async dir => {
    const parked = await sites.unpark(dir)
    parkWatcher.restart()
    return parked
  })
  handle('sites:setPhp', (domain, version) => sites.setPhpVersion(domain, version))
  handle('sites:setSecure', (domain, secure) => sites.setSecure(domain, secure))
  handle('sites:rename', (domain, name) => sites.rename(domain, name))
  handle('sites:apply', () => sites.apply())
  handle('sites:create', async options => {
    const target = await tooling.createProject(options)
    return sites.link(target, { php: options.php })
  })
  handle('sites:vhost', async domain => {
    const file = path.join(paths.nginxSites, `${domain}.conf`)
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  })

  /* ------------------------------------------------------- services */

  handle('services:list', () => supervisor.list())
  handle('services:start', id => supervisor.start(id))
  handle('services:stop', id => supervisor.stop(id))
  handle('services:restart', id => supervisor.restart(id))
  handle('services:reload', id => supervisor.reload(id))
  handle('services:status', () => web.status())

  handle('services:startAll', async () => {
    await web.ensureLowPortsAllowed()
    await supervisor.start('nginx')
    const configured = settings.get('services')
    for (const [id, conf] of Object.entries(configured)) {
      if (conf.enabled) await supervisor.start(id).catch(err => log.warn('ipc', `${id}: ${err.message}`))
    }
    return supervisor.list()
  })
  handle('services:stopAll', async () => { await web.stopEverything(); return supervisor.list() })

  handle('services:install', async id => {
    const spec = RUNTIMES[id]
    if (!spec) throw new Error(`Nothing to download for ${id}`)
    if (spec.system) {
      throw new Error(`On Linux, install ${spec.system} with your package manager ` +
        `(e.g. sudo apt install ${id}), then press Refresh.`)
    }
    const destDir = path.join(paths.runtimes, id)
    await fetchAndInstall({ url: spec.url, destDir }, progress => broadcast('services:progress', { id, ...progress }))
    broadcast('services:progress', { id, percent: 1, done: true })
    return { id, installed: true }
  })

  /* ------------------------------------------------------ databases */

  handle('db:connections', () => db.connectionInfo())
  handle('db:mysqlList', () => db.mysqlDatabases())
  handle('db:mysqlCreate', name => db.createMysqlDatabase(name))
  handle('db:mysqlDrop', name => db.dropMysqlDatabase(name))
  handle('db:postgresList', () => db.postgresDatabases())
  handle('db:ping', port => db.ping(port))

  /* ----------------------------------------------------------- mail */

  handle('mail:list', options => mail.messages(options))
  handle('mail:get', id => mail.message(id))
  handle('mail:delete', id => mail.deleteMessage(id))
  handle('mail:clear', () => mail.deleteAll())
  handle('mail:read', (id, read) => mail.markRead(id, read))
  handle('mail:url', () => mail.webUrl())
  handle('mail:env', () => mail.envSnippet())

  /* ---------------------------------------------------------- dumps */

  handle('dumps:list', () => dumpServer.list())
  handle('dumps:clear', () => dumpServer.clear())
  handle('dumps:start', () => dumpServer.start())
  handle('dumps:stop', () => dumpServer.stop())
  handle('dumps:env', () => dumpEnv())
  dumpServer.on('dump', entry => broadcast('dumps:new', entry))

  /* ------------------------------------------------------------ ssl */

  handle('ssl:status', async () => ({
    caExists: ssl.caExists(),
    trusted: await ssl.isTrusted()
  }))
  handle('ssl:createCa', () => ssl.createCa())
  handle('ssl:trust', () => ssl.trustCa())
  handle('ssl:untrust', () => ssl.untrustCa())
  handle('ssl:issue', domain => ssl.issue(domain))

  /* ---------------------------------------------------------- hosts */

  handle('hosts:path', () => hosts.hostsPath())
  handle('hosts:entries', () => hosts.currentEntries())
  handle('hosts:sync', () => sites.apply())
  handle('hosts:remove', () => hosts.remove())

  /* ---------------------------------------------------------- nginx */

  handle('nginx:test', () => nginx.test())
  handle('nginx:config', () => fs.readFileSync(nginx.confFile(), 'utf8'))

  /* ----------------------------------------------------------- logs */

  handle('logs:list', () => logs.available())
  handle('logs:read', (file, lines) => logs.readTail(file, lines))
  handle('logs:clear', file => logs.clear(file))
  handle('logs:tail', (id, file) => logs.startTail(id, file, line => broadcast('logs:line', { id, line })))
  handle('logs:untail', id => logs.stopTail(id))
  log.subscribe(entry => broadcast('logs:app', entry))

  /* -------------------------------------------------------- tooling */

  handle('tool:composer', (args, options) => tooling.composer(args, options))
  handle('tool:composerInstalled', () => tooling.composerInstalled())
  handle('tool:installComposer', () => tooling.installComposer(p => broadcast('services:progress', { id: 'composer', ...p })))
  handle('tool:artisan', (args, options) => tooling.artisan(args, options))
  handle('tool:tinker', (code, options) => tooling.tinker(code, options))
  handle('tool:node', () => tooling.nodeInfo())
  handle('tool:patchEnv', (root, entries) => tooling.patchEnv(root, entries))
  handle('tool:openEditor', (target, editor) => tooling.openInEditor(target, editor))

  /* -------------------------------------------------------- lifecycle */

  supervisor.on('change', state => broadcast('services:changed', state))
  // A site appearing on disk should show up in an open window without a refresh.
  parkWatcher.on('change', () => broadcast('sites:changed', null))

  ensureDirs()
  log.info('ipc', `registered handlers (${IS_WIN ? 'windows' : IS_LINUX ? 'linux' : process.platform})`)
}

export { broadcast }
