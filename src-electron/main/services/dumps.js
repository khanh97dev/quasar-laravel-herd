import { createServer } from 'node:net'
import { EventEmitter } from 'node:events'
import { settings } from '../core/config.js'
import { log } from '../core/logger.js'

/**
 * Symfony VarDumper can send dumps to a TCP "dump server" instead of rendering
 * them into the response. Pointing VAR_DUMPER_SERVER at us means dd()/dump()
 * in a Laravel app shows up in this window — Herd's Dumps panel.
 */
class DumpServer extends EventEmitter {
  #server = null
  #buffer = []
  #max = 500

  get running () { return Boolean(this.#server?.listening) }

  start () {
    if (this.running) return { running: true, port: this.port }
    const { port } = settings.get('dumpServer')

    this.#server = createServer(socket => {
      let chunk = ''
      socket.on('data', data => {
        chunk += data.toString()
        // VarDumper writes one newline-terminated JSON payload per dump.
        let index
        while ((index = chunk.indexOf('\n')) !== -1) {
          const line = chunk.slice(0, index)
          chunk = chunk.slice(index + 1)
          if (line.trim()) this.#push(line)
        }
      })
      socket.on('error', () => socket.destroy())
    })

    this.#server.on('error', err => log.error('dumps', err))
    this.#server.listen(port, '127.0.0.1', () =>
      log.info('dumps', `dump server listening on 127.0.0.1:${port}`))
    this.port = port
    return { running: true, port }
  }

  #push (line) {
    let payload
    try {
      const parsed = JSON.parse(line)
      payload = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      payload = [line]
    }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      raw: payload[0],
      context: payload[1] ?? {},
      source: payload[1]?.source ?? null
    }
    this.#buffer.unshift(entry)
    if (this.#buffer.length > this.#max) this.#buffer.pop()
    this.emit('dump', entry)
  }

  stop () {
    this.#server?.close()
    this.#server = null
    return { running: false }
  }

  list () { return this.#buffer }
  clear () { this.#buffer = []; return [] }
}

export const dumpServer = new DumpServer()

export function envSnippet () {
  const { port } = settings.get('dumpServer')
  return `VAR_DUMPER_FORMAT=server\nVAR_DUMPER_SERVER=127.0.0.1:${port}`
}
