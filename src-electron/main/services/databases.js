import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { paths } from '../core/paths.js'
import { EXE } from '../core/platform.js'
import { run, which } from '../core/shell.js'
import { settings } from '../core/config.js'
import { log } from '../core/logger.js'
import { supervisor } from './supervisor.js'

function resolveBinary (runtime, name) {
  const bundled = path.join(paths.runtimes, runtime, 'bin', `${name}${EXE}`)
  if (fs.existsSync(bundled)) return bundled
  const flat = path.join(paths.runtimes, runtime, `${name}${EXE}`)
  if (fs.existsSync(flat)) return flat
  return null
}

async function binaryOrSystem (runtime, name) {
  return resolveBinary(runtime, name) ?? await which(name)
}

/* ------------------------------------------------------------------ MySQL */

const mysqlDataDir = () => path.join(paths.data, 'mysql')

async function initMysql () {
  const dir = mysqlDataDir()
  if (fs.existsSync(path.join(dir, 'mysql'))) return
  const mysqld = await binaryOrSystem('mysql', 'mysqld')
  if (!mysqld) throw new Error('mysqld not found. Install MySQL from the Services page.')

  await fsp.mkdir(dir, { recursive: true })
  log.info('mysql', 'initialising data directory (first run, this takes a moment)')
  const { code, stderr } = await run(mysqld, [
    '--initialize-insecure',
    `--datadir=${dir}`,
    '--user=' + (process.getuid?.() === 0 ? 'mysql' : (process.env.USER || 'root'))
  ], { allowFailure: true, timeout: 300_000 })
  if (code !== 0 && !fs.existsSync(path.join(dir, 'mysql'))) {
    throw new Error(`MySQL initialisation failed: ${stderr.slice(-500)}`)
  }
}

supervisor.register({
  id: 'mysql',
  label: 'MySQL',
  group: 'database',
  port: () => settings.get('services').mysql.port,
  readyPort: () => settings.get('services').mysql.port,
  readyTimeout: 60_000,
  prepare: initMysql,
  async command () {
    const mysqld = await binaryOrSystem('mysql', 'mysqld')
    const { port } = settings.get('services').mysql
    return {
      cmd: mysqld,
      args: [
        `--datadir=${mysqlDataDir()}`,
        `--port=${port}`,
        '--bind-address=127.0.0.1',
        `--socket=${path.join(paths.run, 'mysql.sock')}`,
        `--pid-file=${path.join(paths.run, 'mysql.pid')}`,
        `--log-error=${path.join(paths.logs, 'mysql.log')}`,
        '--skip-name-resolve'
      ]
    }
  }
})

/* --------------------------------------------------------------- Postgres */

const pgDataDir = () => path.join(paths.data, 'postgres')

async function initPostgres () {
  const dir = pgDataDir()
  if (fs.existsSync(path.join(dir, 'PG_VERSION'))) return
  const initdb = await binaryOrSystem('postgres', 'initdb')
  if (!initdb) throw new Error('initdb not found. Install PostgreSQL from the Services page.')

  await fsp.mkdir(dir, { recursive: true })
  const pwFile = path.join(paths.tmp, 'pg.pw')
  await fsp.writeFile(pwFile, settings.get('services').postgres.password, { mode: 0o600 })
  const { code, stderr } = await run(initdb, [
    '-D', dir, '-U', 'postgres', '--auth=scram-sha-256', `--pwfile=${pwFile}`, '-E', 'UTF8'
  ], { allowFailure: true, timeout: 180_000 })
  await fsp.rm(pwFile, { force: true })
  if (code !== 0) throw new Error(`initdb failed: ${stderr.slice(-500)}`)
}

supervisor.register({
  id: 'postgres',
  label: 'PostgreSQL',
  group: 'database',
  port: () => settings.get('services').postgres.port,
  readyPort: () => settings.get('services').postgres.port,
  readyTimeout: 60_000,
  prepare: initPostgres,
  async command () {
    const postgres = await binaryOrSystem('postgres', 'postgres')
    const { port } = settings.get('services').postgres
    return {
      cmd: postgres,
      args: ['-D', pgDataDir(), '-p', String(port), '-k', paths.run, '-c', 'listen_addresses=127.0.0.1']
    }
  }
})

/* ------------------------------------------------------------------ Redis */

supervisor.register({
  id: 'redis',
  label: 'Redis',
  group: 'database',
  port: () => settings.get('services').redis.port,
  readyPort: () => settings.get('services').redis.port,
  async prepare () {
    await fsp.mkdir(path.join(paths.data, 'redis'), { recursive: true })
  },
  async command () {
    const redis = await binaryOrSystem('redis', 'redis-server')
    if (!redis) throw new Error('redis-server not found. Install Redis from the Services page.')
    const { port } = settings.get('services').redis
    return {
      cmd: redis,
      args: [
        '--port', String(port),
        '--bind', '127.0.0.1',
        '--dir', path.join(paths.data, 'redis'),
        '--logfile', path.join(paths.logs, 'redis.log'),
        '--daemonize', 'no',
        '--save', '900', '1'
      ]
    }
  }
})


/* -------------------------------------------------------------- utilities */

export async function mysqlDatabases () {
  const mysql = await binaryOrSystem('mysql', 'mysql')
  if (!mysql) return []
  const { port, rootPassword } = settings.get('services').mysql
  const args = ['-h', '127.0.0.1', '-P', String(port), '-u', 'root', '-N', '-B', '-e', 'SHOW DATABASES']
  if (rootPassword) args.splice(6, 0, `-p${rootPassword}`)
  const { code, stdout } = await run(mysql, args, { allowFailure: true, timeout: 15_000 })
  if (code !== 0) return []
  return stdout.split(/\r?\n/).filter(Boolean)
    .filter(db => !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(db))
}

export async function createMysqlDatabase (name) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Database names may only contain letters, numbers, _ and -')
  const mysql = await binaryOrSystem('mysql', 'mysql')
  const { port, rootPassword } = settings.get('services').mysql
  const args = ['-h', '127.0.0.1', '-P', String(port), '-u', 'root', '-e',
    `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]
  if (rootPassword) args.splice(6, 0, `-p${rootPassword}`)
  const { code, stderr } = await run(mysql, args, { allowFailure: true })
  if (code !== 0) throw new Error(stderr)
  return mysqlDatabases()
}

export async function dropMysqlDatabase (name) {
  const mysql = await binaryOrSystem('mysql', 'mysql')
  const { port, rootPassword } = settings.get('services').mysql
  const args = ['-h', '127.0.0.1', '-P', String(port), '-u', 'root', '-e', `DROP DATABASE \`${name}\``]
  if (rootPassword) args.splice(6, 0, `-p${rootPassword}`)
  const { code, stderr } = await run(mysql, args, { allowFailure: true })
  if (code !== 0) throw new Error(stderr)
  return mysqlDatabases()
}

export async function postgresDatabases () {
  const psql = await binaryOrSystem('postgres', 'psql')
  if (!psql) return []
  const { port, password } = settings.get('services').postgres
  const { code, stdout } = await run(psql, [
    '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-At', '-c',
    'SELECT datname FROM pg_database WHERE datistemplate = false'
  ], { allowFailure: true, env: { PGPASSWORD: password }, timeout: 15_000 })
  return code === 0 ? stdout.split(/\r?\n/).filter(Boolean) : []
}

export async function connectionInfo () {
  const s = settings.get('services')
  return {
    mysql: { host: '127.0.0.1', port: s.mysql.port, user: 'root', password: s.mysql.rootPassword || '(empty)' },
    postgres: { host: '127.0.0.1', port: s.postgres.port, user: 'postgres', password: s.postgres.password },
    redis: { host: '127.0.0.1', port: s.redis.port }
  }
}

export async function ping (port) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.setTimeout(1500)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
  })
}
