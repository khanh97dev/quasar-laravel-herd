import fs from 'node:fs'
import { paths } from './paths.js'
import { IS_WIN } from './platform.js'
import { log } from './logger.js'

export const DEFAULT_SETTINGS = {
  tld: 'test',
  httpPort: 80,
  httpsPort: 443,
  defaultPhp: null,
  autoStart: true,
  startMinimised: false,
  secureByDefault: false,
  dnsMode: IS_WIN ? 'hosts' : 'hosts',
  parkedPaths: [],
  services: {
    mysql: { enabled: false, port: 3306, rootPassword: '' },
    postgres: { enabled: false, port: 5432, password: 'postgres' },
    redis: { enabled: false, port: 6379 },
    mailpit: { enabled: true, smtpPort: 1025, uiPort: 8025 }
  },
  dumpServer: { enabled: true, port: 9912 }
}

let cache = null

function read (file, fallback) {
  try {
    if (!fs.existsSync(file)) return structuredClone(fallback)
    return { ...structuredClone(fallback), ...JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch (err) {
    log.error('config', `corrupt ${file}, using defaults: ${err.message}`)
    return structuredClone(fallback)
  }
}

function write (file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

export const settings = {
  all () {
    if (!cache) cache = read(paths.settingsFile, DEFAULT_SETTINGS)
    return cache
  },
  get (key) {
    return this.all()[key]
  },
  set (patch) {
    cache = { ...this.all(), ...patch }
    write(paths.settingsFile, cache)
    return cache
  },
  reset () {
    cache = structuredClone(DEFAULT_SETTINGS)
    write(paths.settingsFile, cache)
    return cache
  }
}

export const siteStore = {
  all () {
    return read(paths.sitesFile, { sites: [] }).sites
  },
  save (sites) {
    write(paths.sitesFile, { sites })
    return sites
  }
}
