import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import https from 'node:https'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { paths } from './paths.js'
import { log } from './logger.js'

/**
 * Streaming download with progress callbacks so the UI can show a real bar
 * instead of a spinner. Follows redirects (GitHub release assets need it).
 */
export function download (url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error(`Too many redirects for ${url}`))

    https.get(url, { headers: { 'User-Agent': 'quasar-laravel-herd' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume()
        return resolve(download(res.headers.location, dest, onProgress, redirects + 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }

      const total = Number(res.headers['content-length'] || 0)
      let received = 0
      res.on('data', chunk => {
        received += chunk.length
        onProgress?.({ received, total, percent: total ? received / total : 0 })
      })

      fs.mkdirSync(path.dirname(dest), { recursive: true })
      pipeline(res, fs.createWriteStream(dest)).then(() => resolve(dest)).catch(reject)
    }).on('error', reject)
  })
}

export async function verifySha256 (file, expected) {
  if (!expected) return true
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(file), hash)
  const actual = hash.digest('hex')
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${path.basename(file)}: expected ${expected}, got ${actual}`)
  }
  return true
}

export async function extract (archive, destDir) {
  await fsp.mkdir(destDir, { recursive: true })
  if (archive.endsWith('.zip')) {
    const unzipper = (await import('unzipper')).default
    await fs.createReadStream(archive).pipe(unzipper.Extract({ path: destDir })).promise()
  } else if (/\.(tar\.gz|tgz|tar\.xz|txz)$/.test(archive)) {
    const tar = await import('tar')
    await tar.x({ file: archive, cwd: destDir })
  } else {
    // Single binary (mailpit) — just move it into place executable.
    const target = path.join(destDir, path.basename(archive))
    await fsp.copyFile(archive, target)
    await fsp.chmod(target, 0o755).catch(() => {})
  }
  log.info('download', `extracted ${path.basename(archive)} -> ${destDir}`)
  return destDir
}

export async function fetchAndInstall (spec, onProgress) {
  const tmpFile = path.join(paths.tmp, path.basename(new URL(spec.url).pathname))
  await download(spec.url, tmpFile, onProgress)
  await verifySha256(tmpFile, spec.sha256)
  await extract(tmpFile, spec.destDir)
  await fsp.rm(tmpFile, { force: true })
  return spec.destDir
}
