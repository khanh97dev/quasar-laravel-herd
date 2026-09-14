import { boot } from 'quasar/wrappers'
import { Notify } from 'quasar'

/**
 * Every main-process call returns { ok, data | error }. Unwrapping it here
 * means pages can `await api.sites.list()` and get the payload directly, while
 * failures surface as one consistent toast.
 */
function unwrap (namespace) {
  return new Proxy(namespace, {
    get (target, prop) {
      const value = target[prop]
      if (typeof value !== 'function') return value
      if (String(prop).startsWith('on')) return value

      return async (...args) => {
        const result = await value(...args)
        if (result && typeof result === 'object' && 'ok' in result) {
          if (!result.ok) {
            Notify.create({ type: 'negative', message: result.error, timeout: 6000, actions: [{ icon: 'close', color: 'white' }] })
            throw new Error(result.error)
          }
          return result.data
        }
        return result
      }
    }
  })
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

  const api = Object.fromEntries(Object.entries(raw).map(([key, ns]) => [key, unwrap(ns)]))
  app.config.globalProperties.$herd = api
  app.provide('herd', api)
  window.$herd = api
})
