import { Tray, Menu, nativeImage, app, shell } from 'electron'
import { resourcePath } from './core/paths.js'
import { settings } from './core/config.js'
import { supervisor } from './services/supervisor.js'
import { list as listSites } from './features/sites.js'
import { webUrl } from './services/mail.js'
import { log } from './core/logger.js'

let tray = null
let showWindow = null

/**
 * Herd lives in the tray — the window is secondary. The menu is rebuilt on
 * every service change so status dots are never stale.
 */
export function createTray (onShow) {
  showWindow = onShow
  const iconFile = resourcePath('icons', 'tray.png')
  const icon = nativeImage.createFromPath(iconFile)
  if (icon.isEmpty()) {
    // An empty image gives a blank tray slot with no hint as to why, so say it.
    log.warn('tray', `tray icon missing or unreadable at ${iconFile}`)
  }
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 18, height: 18 }))
  tray.setToolTip('Quasar Herd')
  tray.on('click', () => onShow())

  supervisor.on('change', () => rebuild())
  rebuild()
  return tray
}

function dot (status) {
  return { running: '🟢', starting: '🟡', error: '🔴', stopped: '⚪' }[status] ?? '⚪'
}

export function rebuild () {
  if (!tray) return
  const services = supervisor.list()
  const sites = listSites().slice(0, 12)
  const { httpPort, httpsPort } = settings.all()

  const template = [
    { label: 'Quasar Herd', enabled: false },
    { type: 'separator' },

    {
      label: 'Sites',
      submenu: sites.length
        ? sites.map(site => ({
            label: `${site.secure ? '🔒 ' : ''}${site.domain}`,
            click: () => {
              const port = site.secure ? httpsPort : httpPort
              const suffix = (site.secure && port === 443) || (!site.secure && port === 80) ? '' : `:${port}`
              shell.openExternal(`${site.secure ? 'https' : 'http'}://${site.domain}${suffix}`)
            }
          }))
        : [{ label: 'No sites yet', enabled: false }]
    },

    {
      label: 'Services',
      submenu: services.map(service => ({
        label: `${dot(service.status)}  ${service.label}`,
        submenu: [
          { label: 'Start', enabled: service.status !== 'running', click: () => supervisor.start(service.id) },
          { label: 'Stop', enabled: service.status === 'running', click: () => supervisor.stop(service.id) },
          { label: 'Restart', click: () => supervisor.restart(service.id) }
        ]
      }))
    },

    { type: 'separator' },
    { label: 'Open Mailbox', click: () => shell.openExternal(webUrl()) },
    { label: 'Start all', click: () => startAll() },
    { label: 'Stop all', click: () => supervisor.stopAll() },
    { type: 'separator' },
    { label: 'Open Quasar Herd', click: () => showWindow?.() },
    { label: 'Quit', click: async () => { await supervisor.stopAll(); app.quit() } }
  ]

  tray.setContextMenu(Menu.buildFromTemplate(template))
}

async function startAll () {
  await supervisor.start('nginx').catch(err => log.error('tray', err))
  for (const [id, conf] of Object.entries(settings.get('services'))) {
    if (conf.enabled) await supervisor.start(id).catch(err => log.warn('tray', `${id}: ${err.message}`))
  }
}

export function destroyTray () {
  tray?.destroy()
  tray = null
}
