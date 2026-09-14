import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { settings } from '../core/config.js'
import { log } from '../core/logger.js'
import { list as listSites, apply as applySites } from './sites.js'

/**
 * Parking a directory means "serve whatever is in here" — so dropping a project
 * into it has to be enough. Without a watcher the new folder only appears after
 * a restart, which defeats the point of parking at all.
 *
 * The watch is non-recursive: only the immediate children of a parked root can
 * become sites, and watching deeper would fire on every file a project writes.
 */
class ParkWatcher extends EventEmitter {
  #watchers = new Map()
  #timer = null
  #lastDomains = ''

  start () {
    this.stop()
    for (const dir of settings.get('parkedPaths')) {
      if (!fs.existsSync(dir)) continue
      try {
        const watcher = fs.watch(dir, { persistent: false }, () => this.#schedule())
        watcher.on('error', err => log.warn('watcher', `${dir}: ${err.message}`))
        this.#watchers.set(dir, watcher)
      } catch (err) {
        log.warn('watcher', `cannot watch ${dir}: ${err.message}`)
      }
    }
    this.#lastDomains = this.#snapshot()
    log.info('watcher', `watching ${this.#watchers.size} parked folder(s)`)
  }

  #snapshot () {
    return listSites().map(site => `${site.domain}:${site.root}`).sort().join('|')
  }

  /**
   * Creating a project writes many entries in a burst, so settle first and then
   * apply once rather than regenerating configs per filesystem event.
   */
  #schedule () {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#sync(), 750)
  }

  async #sync () {
    const current = this.#snapshot()
    // Only touch nginx and the hosts file when the set of sites really changed;
    // otherwise a noisy directory would re-prompt for elevation endlessly.
    if (current === this.#lastDomains) return
    this.#lastDomains = current

    log.info('watcher', 'parked folders changed, refreshing sites')
    try {
      const sites = await applySites()
      this.emit('change', sites)
    } catch (err) {
      log.error('watcher', `refresh failed: ${err.message}`)
    }
  }

  stop () {
    for (const watcher of this.#watchers.values()) watcher.close()
    this.#watchers.clear()
    clearTimeout(this.#timer)
  }

  /** Call after parkedPaths changes so the new root is covered immediately. */
  restart () {
    this.start()
  }
}

export const parkWatcher = new ParkWatcher()
