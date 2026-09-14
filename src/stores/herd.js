import { defineStore } from 'pinia'

/**
 * One store for cross-page state: services, sites, PHP versions and settings.
 * Pages read from here instead of each running their own poll loop, so the
 * main process sees one refresh per interval regardless of what is open.
 */
export const useHerdStore = defineStore('herd', {
  state: () => ({
    ready: false,
    info: null,
    settings: {},
    services: [],
    sites: [],
    phpVersions: [],
    phpAvailable: [],
    ssl: { caExists: false, trusted: false },
    firstRun: false,
    lastError: null
  }),

  getters: {
    api: () => window.$herd,
    service: state => id => state.services.find(s => s.id === id) ?? { id, status: 'stopped' },
    webRunning: state => state.services.find(s => s.id === 'nginx')?.status === 'running',
    defaultPhp: state => state.settings.defaultPhp,
    tld: state => state.settings.tld ?? 'test',
    runningCount: state => state.services.filter(s => s.status === 'running').length,
    securedCount: state => state.sites.filter(s => s.secure).length
  },

  actions: {
    async init () {
      if (!window.$herd) return
      window.$herd.app.onReady(({ firstRun }) => { this.firstRun = firstRun; this.ready = true })
      window.$herd.app.onError(message => { this.lastError = message })
      // The main process watches parked folders; a new project appears here
      // without the user pressing refresh.
      window.$herd.sites.onChange(() => this.refreshSites())
      window.$herd.services.onChange(state => {
        const index = this.services.findIndex(s => s.id === state.id)
        if (index === -1) this.services.push(state)
        else this.services[index] = { ...this.services[index], ...state }
      })
      await this.refreshAll()
      this.ready = true
    },

    async refreshAll () {
      const api = window.$herd
      const [info, settings, services, sites, phpVersions, phpAvailable, ssl] = await Promise.all([
        api.app.info(),
        api.settings.get(),
        api.services.list(),
        api.sites.list(),
        api.php.installed(),
        api.php.available(),
        api.ssl.status()
      ])
      Object.assign(this, { info, settings, services, sites, phpVersions, phpAvailable, ssl })
    },

    async refreshServices () {
      this.services = await window.$herd.services.list()
    },

    async refreshSites () {
      this.sites = await window.$herd.sites.list()
    },

    async refreshPhp () {
      this.phpVersions = await window.$herd.php.installed()
      this.settings = await window.$herd.settings.get()
    },

    async saveSettings (patch) {
      this.settings = await window.$herd.settings.set(patch)
      return this.settings
    },

    async startAll () {
      this.services = await window.$herd.services.startAll()
    },

    async stopAll () {
      this.services = await window.$herd.services.stopAll()
    }
  }
})
