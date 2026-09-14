import { app, BrowserWindow, nativeTheme, Menu, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpc } from './main/ipc.js'
import { bootstrap, shutdown } from './main/bootstrap.js'
import { createTray, destroyTray } from './main/tray.js'
import { settings } from './main/core/config.js'
import { log } from './main/core/logger.js'
import { IS_WIN, IS_LINUX } from './main/core/platform.js'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

nativeTheme.themeSource = 'dark'

let mainWindow = null
let quitting = false

// A second launch should focus the running instance, not start a second stack
// of servers fighting over port 80.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#0c0c0c',
    autoHideMenuBar: true,
    icon: path.resolve(currentDir, 'icons', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.resolve(
        currentDir,
        path.join(
          process.env.QUASAR_ELECTRON_PRELOAD_FOLDER,
          `electron-preload${process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION}`
        )
      )
    }
  })

  // Dev serves from Vite; the packaged build loads the bundled index.html.
  if (process.env.DEV) mainWindow.loadURL(process.env.APP_URL)
  else mainWindow.loadFile(path.resolve(currentDir, 'index.html'))

  mainWindow.once('ready-to-show', () => {
    if (!settings.get('startMinimised')) mainWindow.show()
  })

  // Closing the window leaves the servers running — that is the whole point of
  // a tray app. Quit explicitly from the tray or Cmd/Ctrl+Q.
  mainWindow.on('close', event => {
    if (!quitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  // External links open in the real browser, never inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.DEBUGGING) mainWindow.webContents.openDevTools()
  else mainWindow.webContents.on('devtools-opened', () => mainWindow.webContents.closeDevTools())
}

function showWindow () {
  if (!mainWindow) return createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

app.whenReady().then(async () => {
  registerIpc()
  Menu.setApplicationMenu(buildMenu())
  createWindow()
  createTray(showWindow)

  try {
    const { firstRun } = await bootstrap()
    mainWindow?.webContents.send('app:ready', { firstRun })
  } catch (err) {
    log.error('main', err)
    mainWindow?.webContents.send('app:error', err.message)
  }
})

app.on('window-all-closed', () => {
  // Keep running in the tray on every platform; quitting is explicit.
})

app.on('before-quit', async event => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  destroyTray()
  await shutdown()
  app.exit(0)
})

process.on('uncaughtException', err => log.error('main', err))
process.on('unhandledRejection', err => log.error('main', err))

function buildMenu () {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Hide window', accelerator: 'CmdOrCtrl+W', click: () => mainWindow?.hide() },
        { type: 'separator' },
        { role: 'quit', accelerator: IS_WIN || IS_LINUX ? 'Ctrl+Q' : 'Cmd+Q' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal('https://laravel.com/docs') },
        { label: 'Open data folder', click: async () => {
          const { paths } = await import('./main/core/paths.js')
          shell.openPath(paths.root)
        } }
      ]
    }
  ])
}
