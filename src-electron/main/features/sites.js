import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { paths } from '../core/paths.js'
import { settings, siteStore } from '../core/config.js'
import { log } from '../core/logger.js'
import * as nginx from './nginx.js'
import * as hosts from './hosts.js'
import * as ssl from './ssl.js'
import { supervisor } from '../services/supervisor.js'
import { startPool } from '../services/php.js'

/**
 * A site is either *linked* (explicitly added, any path) or *parked* (derived
 * from a watched directory, one site per subfolder) — the same two modes Herd
 * exposes. Parked sites are recomputed from disk so renaming a folder just
 * works; linked sites are persisted.
 */

export function detectType (root) {
  const has = f => fs.existsSync(path.join(root, f))
  if (has('artisan') && has('public')) return 'laravel'
  if (has('public/index.php')) return 'laravel'
  if (has('composer.json') && has('public')) return 'laravel'
  if (has('index.php')) return 'generic'
  if (has('index.html')) return 'static'
  return 'generic'
}

export function detectPublicPath (root, type) {
  if (type === 'laravel' && fs.existsSync(path.join(root, 'public'))) return 'public'
  for (const dir of ['public', 'web', 'htdocs', 'www']) {
    if (fs.existsSync(path.join(root, dir, 'index.php'))) return dir
  }
  return ''
}

async function detectFramework (root) {
  const composer = path.join(root, 'composer.json')
  if (!fs.existsSync(composer)) return null
  try {
    const json = JSON.parse(await fsp.readFile(composer, 'utf8'))
    const deps = { ...json.require, ...json['require-dev'] }
    if (deps['laravel/framework']) return { name: 'Laravel', version: deps['laravel/framework'] }
    if (deps['symfony/framework-bundle']) return { name: 'Symfony', version: deps['symfony/framework-bundle'] }
    if (deps['statamic/cms']) return { name: 'Statamic', version: deps['statamic/cms'] }
    if (deps['craftcms/cms']) return { name: 'Craft', version: deps['craftcms/cms'] }
    return { name: json.name ?? 'Composer project', version: null }
  } catch { return null }
}

function domainFor (name) {
  return `${name}.${settings.get('tld')}`
}

function parkedSites () {
  const out = []
  for (const parkRoot of settings.get('parkedPaths')) {
    let entries = []
    try { entries = fs.readdirSync(parkRoot, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const root = path.join(parkRoot, entry.name)
      const type = detectType(root)
      out.push({
        id: `parked:${root}`,
        name: entry.name,
        domain: domainFor(entry.name),
        root,
        publicPath: detectPublicPath(root, type),
        type,
        php: null,
        secure: false,
        mode: 'parked',
        parkRoot
      })
    }
  }
  return out
}

/** Linked sites win over a parked site with the same domain. */
export function list () {
  const linked = siteStore.all().map(site => ({ ...site, mode: 'linked' }))
  const linkedDomains = new Set(linked.map(s => s.domain))
  const overrides = new Map(linked.filter(s => s.mode === 'linked').map(s => [s.root, s]))

  const parked = parkedSites()
    .filter(s => !linkedDomains.has(s.domain))
    .map(s => ({ ...s, ...(overrides.get(s.root) ?? {}) }))

  return [...linked, ...parked].sort((a, b) => a.domain.localeCompare(b.domain))
}

export async function describe (site) {
  return {
    ...site,
    framework: await detectFramework(site.root),
    exists: fs.existsSync(site.root),
    php: site.php ?? settings.get('defaultPhp'),
    url: `${site.secure ? 'https' : 'http'}://${site.domain}${portSuffix(site.secure)}`
  }
}

function portSuffix (secure) {
  const { httpPort, httpsPort } = settings.all()
  if (secure) return httpsPort === 443 ? '' : `:${httpsPort}`
  return httpPort === 80 ? '' : `:${httpPort}`
}

export async function link (root, options = {}) {
  const absolute = path.resolve(root)
  if (!fs.existsSync(absolute)) throw new Error(`${absolute} does not exist`)

  const name = options.name || path.basename(absolute)
  const type = options.type || detectType(absolute)
  const site = {
    id: `linked:${absolute}`,
    name,
    domain: options.domain || domainFor(name),
    root: absolute,
    publicPath: options.publicPath ?? detectPublicPath(absolute, type),
    type,
    php: options.php ?? null,
    secure: options.secure ?? settings.get('secureByDefault'),
    mode: 'linked',
    createdAt: new Date().toISOString()
  }

  const sites = siteStore.all().filter(s => s.domain !== site.domain)
  siteStore.save([...sites, site])
  await apply()
  log.info('sites', `linked ${site.domain} -> ${absolute}`)
  return site
}

export async function unlink (domain) {
  siteStore.save(siteStore.all().filter(s => s.domain !== domain))
  await nginx.removeSiteConfig(domain)
  await ssl.revoke(domain)
  await apply()
  log.info('sites', `unlinked ${domain}`)
}

export async function park (dir) {
  const absolute = path.resolve(dir)
  await fsp.mkdir(absolute, { recursive: true })
  const parked = new Set(settings.get('parkedPaths'))
  parked.add(absolute)
  settings.set({ parkedPaths: [...parked] })
  await apply()
  return [...parked]
}

export async function unpark (dir) {
  const absolute = path.resolve(dir)
  settings.set({ parkedPaths: settings.get('parkedPaths').filter(p => p !== absolute) })
  await apply()
  return settings.get('parkedPaths')
}

/** Overrides for a parked site are stored as a linked record pinned to its path. */
async function upsertOverride (site, patch) {
  const sites = siteStore.all()
  const existing = sites.find(s => s.domain === site.domain)
  const next = { ...(existing ?? site), ...patch, mode: existing?.mode ?? site.mode }
  siteStore.save([...sites.filter(s => s.domain !== site.domain), next])
  return next
}

export async function setPhpVersion (domain, version) {
  const site = list().find(s => s.domain === domain)
  if (!site) throw new Error(`Unknown site: ${domain}`)
  const next = await upsertOverride(site, { php: version })
  await startPool(version).catch(err => log.warn('sites', `pool ${version}: ${err.message}`))
  await apply()
  return next
}

export async function setSecure (domain, secure) {
  const site = list().find(s => s.domain === domain)
  if (!site) throw new Error(`Unknown site: ${domain}`)
  if (secure) await ssl.issue(domain)
  else await ssl.revoke(domain)
  const next = await upsertOverride(site, { secure })
  await apply()
  return next
}

export async function rename (domain, newName) {
  const site = list().find(s => s.domain === domain)
  if (!site) throw new Error(`Unknown site: ${domain}`)
  const newDomain = domainFor(newName)
  await nginx.removeSiteConfig(domain)
  if (site.secure) { await ssl.revoke(domain); await ssl.issue(newDomain) }
  const next = await upsertOverride(site, { name: newName, domain: newDomain })
  await apply()
  return next
}

/**
 * Single source of truth: rewrite every vhost, sync the hosts file, reload
 * nginx. Every mutation above funnels through here so state can never drift.
 */
export async function apply () {
  const sites = list()
  await fsp.rm(paths.nginxSites, { recursive: true, force: true })
  await fsp.mkdir(paths.nginxSites, { recursive: true })

  for (const site of sites) {
    if (!fs.existsSync(site.root)) {
      log.warn('sites', `skipping ${site.domain}: ${site.root} is gone`)
      continue
    }
    try {
      if (site.secure) await ssl.issue(site.domain)
      await nginx.writeSiteConfig({ ...site, php: site.php ?? settings.get('defaultPhp') })
    } catch (err) {
      log.error('sites', `vhost for ${site.domain}: ${err.message}`)
    }
  }

  await hosts.sync(sites.map(s => s.domain)).catch(err =>
    log.error('sites', `hosts sync failed: ${err.message}`))

  if (supervisor.get('nginx')?.status === 'running') {
    const ok = await nginx.reload().catch(() => false)
    if (!ok) await supervisor.restart('nginx')
  }
  return sites
}

