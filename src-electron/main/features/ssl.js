import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import forge from 'node-forge'
import { paths } from '../core/paths.js'
import { IS_WIN } from '../core/platform.js'
import { runElevated } from '../core/elevate.js'
import { log } from '../core/logger.js'

const CA_NAME = 'Quasar Herd Local CA'
const caKeyFile = () => path.join(paths.certs, 'ca.key')
const caCrtFile = () => path.join(paths.certs, 'ca.crt')

export function caExists () {
  return fs.existsSync(caCrtFile()) && fs.existsSync(caKeyFile())
}

export function certFiles (domain) {
  return {
    key: path.join(paths.certs, `${domain}.key`),
    crt: path.join(paths.certs, `${domain}.crt`)
  }
}

/** Creates the root CA once; every site certificate is signed by it. */
export async function createCa () {
  if (caExists()) return { key: caKeyFile(), crt: caCrtFile() }

  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = serial()
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000)

  const attrs = [
    { name: 'commonName', value: CA_NAME },
    { name: 'organizationName', value: 'Quasar Herd' },
    { shortName: 'OU', value: 'Local Development' }
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' }
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())

  await fsp.writeFile(caKeyFile(), forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 })
  await fsp.writeFile(caCrtFile(), forge.pki.certificateToPem(cert))
  log.info('ssl', 'generated local root CA')
  return { key: caKeyFile(), crt: caCrtFile() }
}

/** Issues (or reuses) a leaf certificate for one domain plus its wildcard. */
export async function issue (domain) {
  await createCa()
  const files = certFiles(domain)
  if (fs.existsSync(files.crt) && !isExpiring(files.crt)) return files

  const caKey = forge.pki.privateKeyFromPem(await fsp.readFile(caKeyFile(), 'utf8'))
  const caCert = forge.pki.certificateFromPem(await fsp.readFile(caCrtFile(), 'utf8'))

  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = serial()
  cert.validity.notBefore = new Date()
  // Browsers reject leaf certs valid for more than ~398 days.
  cert.validity.notAfter = new Date(Date.now() + 397 * 24 * 3600 * 1000)
  cert.setSubject([{ name: 'commonName', value: domain }])
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: domain },
        { type: 2, value: `*.${domain}` },
        { type: 7, ip: '127.0.0.1' }
      ]
    }
  ])
  cert.sign(caKey, forge.md.sha256.create())

  await fsp.writeFile(files.key, forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 })
  await fsp.writeFile(files.crt, forge.pki.certificateToPem(cert))
  log.info('ssl', `issued certificate for ${domain}`)
  return files
}

export async function revoke (domain) {
  const files = certFiles(domain)
  await Promise.allSettled([fsp.rm(files.key, { force: true }), fsp.rm(files.crt, { force: true })])
}

function isExpiring (crtFile) {
  try {
    const cert = forge.pki.certificateFromPem(fs.readFileSync(crtFile, 'utf8'))
    return cert.validity.notAfter.getTime() - Date.now() < 30 * 24 * 3600 * 1000
  } catch { return true }
}

function serial () {
  return forge.util.bytesToHex(forge.random.getBytesSync(16)).replace(/^0/, '1')
}

/* -------------------------------------------------- system trust store */

export async function isTrusted () {
  if (!caExists()) return false
  const marker = path.join(paths.certs, '.trusted')
  return fs.existsSync(marker)
}

export async function trustCa () {
  await createCa()
  const crt = caCrtFile()

  const lines = IS_WIN
    ? [`certutil -addstore -f "Root" "${crt}"`]
    : [
        // Debian/Ubuntu and Fedora/Arch keep anchors in different places; try both.
        'if [ -d /usr/local/share/ca-certificates ]; then',
        `  cp "${crt}" /usr/local/share/ca-certificates/quasar-herd.crt`,
        '  update-ca-certificates',
        'elif [ -d /etc/pki/ca-trust/source/anchors ]; then',
        `  cp "${crt}" /etc/pki/ca-trust/source/anchors/quasar-herd.crt`,
        '  update-ca-trust extract',
        'else',
        '  echo "Unknown trust store layout" >&2; exit 1',
        'fi'
      ]

  const result = await runElevated(lines, { reason: 'Trust the Quasar Herd local certificate authority' })
  if (result.code === 0) {
    await fsp.writeFile(path.join(paths.certs, '.trusted'), new Date().toISOString())
    await trustInNss(crt)
  }
  return result
}

export async function untrustCa () {
  const lines = IS_WIN
    ? [`certutil -delstore "Root" "${CA_NAME}"`]
    : [
        'rm -f /usr/local/share/ca-certificates/quasar-herd.crt /etc/pki/ca-trust/source/anchors/quasar-herd.crt',
        'command -v update-ca-certificates >/dev/null && update-ca-certificates --fresh || update-ca-trust extract'
      ]
  const result = await runElevated(lines, { reason: 'Remove the Quasar Herd certificate authority' })
  await fsp.rm(path.join(paths.certs, '.trusted'), { force: true })
  return result
}

/**
 * Firefox and Chrome on Linux read their own NSS database, not the system
 * anchors — without this the padlock stays broken even after trustCa().
 */
async function trustInNss (crt) {
  if (IS_WIN) return
  const { run, which } = await import('../core/shell.js')
  if (!(await which('certutil'))) {
    log.warn('ssl', 'libnss3-tools not installed; browsers may not trust the CA')
    return
  }
  const home = process.env.HOME || ''
  const dbs = [
    path.join(home, '.pki', 'nssdb'),
    ...safeGlob(path.join(home, '.mozilla', 'firefox'))
  ]
  for (const db of dbs) {
    if (!fs.existsSync(db)) continue
    await run('certutil', ['-A', '-n', CA_NAME, '-t', 'C,,', '-i', crt, '-d', `sql:${db}`], { allowFailure: true })
  }
}

function safeGlob (dir) {
  try {
    return fs.readdirSync(dir).filter(n => n.includes('.')).map(n => path.join(dir, n))
  } catch { return [] }
}
