import os from 'node:os'

export const IS_WIN = process.platform === 'win32'
export const IS_LINUX = process.platform === 'linux'
export const IS_MAC = process.platform === 'darwin'

export const ARCH = os.arch() === 'arm64' ? 'arm64' : 'x86_64'
export const EXE = IS_WIN ? '.exe' : ''

/** Shell used to run helper one-liners. */
export const SHELL = IS_WIN ? 'powershell.exe' : '/bin/bash'

export function hostsFile () {
  return IS_WIN
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts'
}

/** Only one of these exists per platform; used to pick a download asset. */
export function assetKey () {
  return `${IS_WIN ? 'win' : 'linux'}-${ARCH}`
}
