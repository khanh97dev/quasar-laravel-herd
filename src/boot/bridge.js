import { boot } from 'quasar/wrappers'
import { Notify } from 'quasar'

/**
 * Every main-process call returns { ok, data | error }. Unwrapping it here
 * means pages can `await api.sites.list()` and get the payload directly, while
 * failures surface as one consistent toast.
 *
 * This builds a plain object rather than proxying the bridge: contextBridge
 * exposes frozen, non-configurable properties, and a proxy `get` trap that
 * returns anything other than the original value violates the proxy invariant
 * and throws on first access.
 */
function wrapNamespace (namespace) {
  const wrapped = {}

  for (const key of Object.keys(namespace)) {
    const value = namespace[key]

    // Subscription helpers (onProgress, onDump, ...) return an unsubscribe
    // function and never the { ok, data } envelope, so pass them through.
    if (typeof value !== 'function' || key.startsWith('on')) {
      wrapped[key] = value
      continue
    }

    wrapped[key] = async (...args) => {
      const result = await value(...args)
      if (result && typeof result === 'object' && 'ok' in result) {
        if (!result.ok) {
          Notify.create({
            type: 'negative',
            message: result.error,
            timeout: 6000,
            actions: [{ icon: 'close', color: 'white' }]
          })
          throw new Error(result.error)
        }
        return result.data
      }
      return result
    }
  }

  return wrapped
}

export default boot(({ app }) => {
  const raw = window.herd
  if (!raw) {
    // Running in a plain browser (quasar dev -m spa) — fail loudly rather than
    // silently rendering an empty shell.
    console.error('Herd bridge unavailable: run this app with `quasar dev -m electron`.')
    app.config.globalProperties.$herd = null
    return
  }

  const api = {}
  for (const key of Object.keys(raw)) api[key] = wrapNamespace(raw[key])

  app.config.globalProperties.$herd = api
  app.provide('herd', api)
  window.$herd = api
})
