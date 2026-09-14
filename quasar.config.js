import { defineConfig } from '#q-app/wrappers'

export default defineConfig(() => ({
  boot: ['bridge'],

  css: ['app.scss'],

  extras: ['roboto-font', 'material-icons', 'mdi-v7'],

  build: {
    target: { browser: ['es2022'], node: 'node20' },
    vueRouterMode: 'hash',
    typescript: false
  },

  devServer: { open: false, port: 9300 },

  framework: {
    config: {
      dark: true,
      brand: {
        primary: '#ff2d20',
        secondary: '#1b1b18',
        accent: '#f9322c',
        dark: '#121212',
        'dark-page': '#0c0c0c',
        positive: '#21ba45',
        negative: '#c10015',
        info: '#31ccec',
        warning: '#f2c037'
      }
    },
    plugins: ['Notify', 'Dialog', 'Loading', 'LocalStorage']
  },

  electron: {
    preloadScripts: ['electron-preload'],
    inspectPort: 5858,
    bundler: 'builder',

    builder: {
      appId: 'au.com.ipsupply.quasar-laravel-herd',
      productName: 'Quasar Herd',
      copyright: 'Copyright © 2026',
      directories: { output: 'dist/installers' },
      linux: {
        target: ['AppImage', 'deb'],
        category: 'Development',
        maintainer: 'ips@ipsupply.com.au'
      },
      win: {
        target: ['nsis'],
        requestedExecutionLevel: 'asInvoker'
      },
      nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        perMachine: false
      }
    }
  },

  sourceFiles: {
    electronMain: 'src-electron/electron-main.js'
  }
}))
