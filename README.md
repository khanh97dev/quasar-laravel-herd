# Quasar Herd

A local PHP development environment for **Linux and Windows**, built with Quasar
(Vue 3) and Electron — the same idea as Laravel Herd: park a folder, and every
project inside it is instantly served at `name.test` over HTTP or HTTPS.

![platform](https://img.shields.io/badge/platform-linux%20%7C%20windows-informational)
![license](https://img.shields.io/badge/license-MIT-green)

## What it does

| Feature | Detail |
| --- | --- |
| **Parked & linked sites** | Park a directory and every subfolder becomes a site — dropping a project in serves it within a second, no restart. Link individual projects from anywhere. |
| **Per-site PHP version** | Install PHP 7.4 – 8.5 side by side; pick a version per site from a dropdown. |
| **Automatic vhosts** | nginx configs are generated from your sites — document root, `try_files`, and FastCGI wiring are detected per project type. |
| **Local HTTPS** | A local certificate authority is minted on first run (pure JS, no OpenSSL needed) and per-site certificates are issued on demand. One click installs it into the system and browser trust stores. |
| **Hosts management** | `.test` domains are written into a clearly-marked managed block; your own entries are never touched. |
| **Services** | nginx, PHP-FPM, MySQL, PostgreSQL, Redis and Mailpit, each start/stop/restart-able with live status. |
| **Mail capture** | Every message your apps send is caught and readable in-app, with a one-click `.env` block. |
| **Dumps** | Point `VAR_DUMPER_SERVER` at the built-in dump server and `dump()` output arrives here instead of in your response body. |
| **Logs** | Live tail of nginx, PHP, database and per-project Laravel logs, with severity highlighting. |
| **Console** | Run `artisan`, `composer`, `tinker` and raw `php` against any project without leaving the app. |
| **Tray app** | Closing the window keeps serving; the tray menu opens sites and toggles services. |

## Requirements

- Node.js 20+ and npm 9+ (to build)
- **Linux**: `nginx` from your package manager. Optional: `libnss3-tools` so Chrome
  and Firefox trust the local CA, plus `mysql-server` / `postgresql` / `redis-server`
  if you want those services.
- **Windows**: nothing — nginx, PHP, MySQL, PostgreSQL, Redis and Mailpit are all
  downloaded by the app on demand.

## Getting started

```bash
npm install
npm run dev          # development, with hot reload
```

Build installers:

```bash
npm run build:linux  # AppImage + .deb
npm run build:win    # NSIS installer
```

On first launch the app creates `~/Herd`, parks it, and generates the local
certificate authority. Install a PHP version from the **PHP** page, press
**Start all**, and drop a project into `~/Herd`.

## How it works

```
┌── Renderer (Quasar/Vue) ──┐         ┌── Main process ──────────────────┐
│  Pages + Pinia store      │  IPC    │  supervisor  — process lifecycle │
│  window.herd.* bridge     │ ◄─────► │  php         — versions & pools  │
└───────────────────────────┘         │  nginx/sites — vhost generation  │
                                      │  ssl/hosts   — trust & DNS       │
                                      └──────────────────────────────────┘
```

- **`src-electron/main/core/`** — paths, settings, logging, shell helpers, and the
  batched privilege escalation used for the hosts file and trust store (one prompt,
  not one per operation).
- **`src-electron/main/services/`** — the supervisor plus every managed process.
  Children run in their own process group so stopping nginx or PHP-FPM takes their
  workers with them; pid files let a hard-killed app reap its own orphans on the
  next launch.
- **`src-electron/main/features/`** — sites, nginx config generation, certificates,
  hosts file, log tailing.
- **`src/`** — the Quasar UI. The renderer has no Node access; everything goes
  through the typed bridge in `electron-preload.js`.

### Platform differences

| | Linux | Windows |
| --- | --- | --- |
| PHP worker | PHP-FPM | pool of `php-cgi` FastCGI workers (Windows has no FPM) |
| PHP builds | static-php.dev (fully static, no distro deps) | windows.php.net |
| Elevation | `pkexec`, falling back to `sudo` | UAC via `Start-Process -Verb RunAs` |
| CA trust | `update-ca-certificates` / `update-ca-trust` + NSS for browsers | `certutil -addstore Root` |
| Ports 80/443 | `setcap cap_net_bind_service` on nginx | no restriction |

## Data locations

| | Path |
| --- | --- |
| Linux | `~/.local/share/quasar-herd` |
| Windows | `%LOCALAPPDATA%\QuasarHerd` |

Everything the app owns — runtimes, configs, certificates, databases, logs —
lives under that single directory.

## Licence

MIT
