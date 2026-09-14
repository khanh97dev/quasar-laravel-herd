import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { app } from 'electron'
import { IS_WIN } from './platform.js'

/**
 * Everything the app owns lives under one root so uninstalling is a single
 * directory removal — same idea as ~/Library/Application Support/Herd.
 */
const ROOT = IS_WIN
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'QuasarHerd')
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'quasar-herd')

export const paths = {
  root: ROOT,
  bin: path.join(ROOT, 'bin'),
  runtimes: path.join(ROOT, 'runtimes'),
  config: path.join(ROOT, 'config'),
  data: path.join(ROOT, 'data'),
  logs: path.join(ROOT, 'logs'),
  run: path.join(ROOT, 'run'),
  certs: path.join(ROOT, 'certs'),
  tmp: path.join(ROOT, 'tmp'),

  nginxConf: path.join(ROOT, 'config', 'nginx'),
  nginxSites: path.join(ROOT, 'config', 'nginx', 'sites'),
  phpConf: path.join(ROOT, 'config', 'php'),

  settingsFile: path.join(ROOT, 'config', 'settings.json'),
  sitesFile: path.join(ROOT, 'config', 'sites.json'),

  /** Where user projects are parked by default (Herd's ~/Herd). */
  parkRoot: path.join(os.homedir(), 'Herd')
}

const DIRS = [
  paths.root, paths.bin, paths.runtimes, paths.config, paths.data,
  paths.logs, paths.run, paths.certs, paths.tmp,
  paths.nginxConf, paths.nginxSites, paths.phpConf
]

export function ensureDirs () {
  for (const dir of DIRS) fs.mkdirSync(dir, { recursive: true })
}

/** Resources shipped inside the packaged app (templates, helper scripts). */
export function resourcePath (...parts) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'app-resources')
    : path.join(import.meta.dirname, '..', '..', 'resources')
  return path.join(base, ...parts)
}

export function logFile (name) {
  return path.join(paths.logs, `${name}.log`)
}
