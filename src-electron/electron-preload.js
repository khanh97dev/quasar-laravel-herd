import { contextBridge, ipcRenderer } from 'electron'

/**
 * The renderer never touches Node. Everything it can do is listed here, one
 * namespaced object per domain, mirroring the IPC channels in main/ipc.js.
 */
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

const on = (channel, handler) => {
  const listener = (_event, payload) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('herd', {
  app: {
    info: () => invoke('app:info'),
    openExternal: url => invoke('app:openExternal', url),
    openPath: target => invoke('app:openPath', target),
    showItem: target => invoke('app:showItem', target),
    copy: text => invoke('app:copy', text),
    pickDirectory: title => invoke('app:pickDirectory', title),
    quit: () => invoke('app:quit'),
    onReady: handler => on('app:ready', handler),
    onError: handler => on('app:error', handler)
  },

  settings: {
    get: () => invoke('settings:get'),
    set: patch => invoke('settings:set', patch),
    reset: () => invoke('settings:reset'),
    defaults: () => invoke('settings:defaults')
  },

  php: {
    installed: () => invoke('php:installed'),
    available: () => invoke('php:available'),
    install: version => invoke('php:install', version),
    uninstall: version => invoke('php:uninstall', version),
    setDefault: version => invoke('php:setDefault', version),
    ini: version => invoke('php:ini', version),
    saveIni: (version, values) => invoke('php:saveIni', version, values),
    extensions: version => invoke('php:extensions', version),
    restartPool: version => invoke('php:restartPool', version),
    run: (version, args, cwd) => invoke('php:run', version, args, cwd),
    onProgress: handler => on('php:progress', handler)
  },

  sites: {
    list: () => invoke('sites:list'),
    link: (root, options) => invoke('sites:link', root, options),
    unlink: domain => invoke('sites:unlink', domain),
    park: dir => invoke('sites:park', dir),
    unpark: dir => invoke('sites:unpark', dir),
    setPhp: (domain, version) => invoke('sites:setPhp', domain, version),
    setSecure: (domain, secure) => invoke('sites:setSecure', domain, secure),
    rename: (domain, name) => invoke('sites:rename', domain, name),
    apply: () => invoke('sites:apply'),
    create: options => invoke('sites:create', options),
    vhost: domain => invoke('sites:vhost', domain)
  },

  services: {
    list: () => invoke('services:list'),
    start: id => invoke('services:start', id),
    stop: id => invoke('services:stop', id),
    restart: id => invoke('services:restart', id),
    reload: id => invoke('services:reload', id),
    status: () => invoke('services:status'),
    startAll: () => invoke('services:startAll'),
    stopAll: () => invoke('services:stopAll'),
    install: id => invoke('services:install', id),
    onChange: handler => on('services:changed', handler),
    onProgress: handler => on('services:progress', handler)
  },

  db: {
    connections: () => invoke('db:connections'),
    mysqlList: () => invoke('db:mysqlList'),
    mysqlCreate: name => invoke('db:mysqlCreate', name),
    mysqlDrop: name => invoke('db:mysqlDrop', name),
    postgresList: () => invoke('db:postgresList'),
    ping: port => invoke('db:ping', port)
  },

  mail: {
    list: options => invoke('mail:list', options),
    get: id => invoke('mail:get', id),
    remove: id => invoke('mail:delete', id),
    clear: () => invoke('mail:clear'),
    read: (id, read) => invoke('mail:read', id, read),
    url: () => invoke('mail:url'),
    env: () => invoke('mail:env')
  },

  dumps: {
    list: () => invoke('dumps:list'),
    clear: () => invoke('dumps:clear'),
    start: () => invoke('dumps:start'),
    stop: () => invoke('dumps:stop'),
    env: () => invoke('dumps:env'),
    onDump: handler => on('dumps:new', handler)
  },

  ssl: {
    status: () => invoke('ssl:status'),
    createCa: () => invoke('ssl:createCa'),
    trust: () => invoke('ssl:trust'),
    untrust: () => invoke('ssl:untrust'),
    issue: domain => invoke('ssl:issue', domain)
  },

  hosts: {
    path: () => invoke('hosts:path'),
    entries: () => invoke('hosts:entries'),
    sync: () => invoke('hosts:sync'),
    remove: () => invoke('hosts:remove')
  },

  nginx: {
    test: () => invoke('nginx:test'),
    config: () => invoke('nginx:config')
  },

  logs: {
    list: () => invoke('logs:list'),
    read: (file, lines) => invoke('logs:read', file, lines),
    clear: file => invoke('logs:clear', file),
    tail: (id, file) => invoke('logs:tail', id, file),
    untail: id => invoke('logs:untail', id),
    onLine: handler => on('logs:line', handler),
    onApp: handler => on('logs:app', handler)
  },

  tool: {
    composer: (args, options) => invoke('tool:composer', args, options),
    composerInstalled: () => invoke('tool:composerInstalled'),
    installComposer: () => invoke('tool:installComposer'),
    artisan: (args, options) => invoke('tool:artisan', args, options),
    tinker: (code, options) => invoke('tool:tinker', code, options),
    node: () => invoke('tool:node'),
    patchEnv: (root, entries) => invoke('tool:patchEnv', root, entries),
    openEditor: (target, editor) => invoke('tool:openEditor', target, editor)
  }
})
