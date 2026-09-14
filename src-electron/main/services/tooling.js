import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { paths } from '../core/paths.js'
import { IS_WIN } from '../core/platform.js'
import { run, which } from '../core/shell.js'
import { settings } from '../core/config.js'
import { log } from '../core/logger.js'
import { download } from '../core/download.js'
import { cli as phpCli } from './php.js'

/** composer.phar is tiny and version-pinned by getcomposer.org — just fetch it. */
export function composerPath () {
  return path.join(paths.bin, 'composer.phar')
}

export function composerInstalled () {
  return fs.existsSync(composerPath())
}

export async function installComposer (onProgress) {
  await download('https://getcomposer.org/download/latest-stable/composer.phar', composerPath(), onProgress)
  log.info('tooling', 'installed Composer')
  return composerPath()
}

export async function composer (args, { cwd, php } = {}) {
  if (!composerInstalled()) await installComposer()
  const version = php ?? settings.get('defaultPhp')
  return phpCli(version, [composerPath(), '--no-ansi', ...args], { cwd, timeout: 600_000 })
}

export async function artisan (args, { cwd, php } = {}) {
  if (!fs.existsSync(path.join(cwd, 'artisan'))) {
    throw new Error(`${cwd} is not a Laravel project (no artisan file).`)
  }
  const version = php ?? settings.get('defaultPhp')
  return phpCli(version, ['artisan', '--no-ansi', ...args], { cwd, timeout: 300_000 })
}

/** Non-interactive tinker: feed one expression via `tinker --execute`. */
export async function tinker (code, { cwd, php } = {}) {
  return artisan(['tinker', '--execute', code], { cwd, php })
}

export async function nodeInfo () {
  const node = await which('node')
  const npm = await which('npm')
  const versions = {}
  if (node) versions.node = (await run(node, ['-v'], { allowFailure: true })).stdout.trim()
  if (npm) versions.npm = (await run(npm, ['-v'], { allowFailure: true })).stdout.trim()
  return { node, npm, versions }
}

/**
 * Scaffolds a new project inside a parked directory and links it, so "New
 * site" in the UI is one action rather than a terminal detour.
 */
export async function createProject ({ name, preset = 'laravel', parent }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error('Project names may only contain letters, numbers, _ and -')
  }
  const parentDir = parent ?? settings.get('parkedPaths')[0] ?? paths.parkRoot
  await fsp.mkdir(parentDir, { recursive: true })
  const target = path.join(parentDir, name)
  if (fs.existsSync(target)) throw new Error(`${target} already exists`)

  const recipes = {
    laravel: ['create-project', 'laravel/laravel', name],
    symfony: ['create-project', 'symfony/skeleton', name],
    statamic: ['create-project', 'statamic/statamic', name],
    plain: null
  }

  if (preset === 'plain') {
    await fsp.mkdir(path.join(target, 'public'), { recursive: true })
    await fsp.writeFile(path.join(target, 'public', 'index.php'), "<?php phpinfo();\n")
  } else {
    const recipe = recipes[preset]
    if (!recipe) throw new Error(`Unknown preset: ${preset}`)
    const result = await composer(recipe, { cwd: parentDir })
    if (result.code !== 0) throw new Error(result.stderr.slice(-2000) || 'composer create-project failed')
  }

  log.info('tooling', `created ${preset} project at ${target}`)
  return target
}

/** Writes the Herd-provided env keys into a project's .env, preserving the rest. */
export async function patchEnv (projectRoot, entries) {
  const file = path.join(projectRoot, '.env')
  let text = fs.existsSync(file) ? await fsp.readFile(file, 'utf8') : ''
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}`
  }
  await fsp.writeFile(file, `${text.trimEnd()}\n`)
  return file
}

export function openInEditor (target, editor) {
  const cmd = editor || (IS_WIN ? 'code.cmd' : 'code')
  return run(cmd, [target], { allowFailure: true, timeout: 10_000 })
}
