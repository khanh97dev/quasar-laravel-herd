import { IS_WIN, ARCH } from './platform.js'

/**
 * Where each runtime comes from. Kept as data (not code) so a new PHP release
 * is a one-line change, and so the UI can list what is installable before any
 * download happens.
 *
 * Linux PHP builds come from static-php-cli (fully static, no distro deps).
 * Windows PHP builds come from windows.php.net (NTS + TS variants).
 */
export const PHP_VERSIONS = ['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4']

export function phpSource (version) {
  if (IS_WIN) {
    return {
      id: `php-${version}`,
      // Windows builds are published per patch release; the app resolves the
      // newest patch from the releases feed before downloading.
      indexUrl: 'https://windows.php.net/downloads/releases/releases.json',
      fallbackUrl: `https://windows.php.net/downloads/releases/php-${version}-nts-Win32-vs16-x64.zip`,
      binary: 'php.exe',
      fpm: false
    }
  }
  const arch = ARCH === 'arm64' ? 'aarch64' : 'x86_64'
  // static-php.dev publishes per-patch archives only, so the exact filename is
  // resolved from the directory index at install time.
  return {
    id: `php-${version}`,
    indexUrl: 'https://dl.static-php.dev/static-php-cli/common/',
    pattern: sapi => new RegExp(`php-${version.replace('.', '\\.')}\\.\\d+-${sapi}-linux-${arch}\\.tar\\.gz`, 'g'),
    baseUrl: 'https://dl.static-php.dev/static-php-cli/common/',
    binary: 'php',
    fpm: true
  }
}

export const RUNTIMES = {
  nginx: IS_WIN
    ? { url: 'https://nginx.org/download/nginx-1.27.2.zip', binary: 'nginx.exe', stripDir: 'nginx-1.27.2' }
    : { system: 'nginx', binary: 'nginx' },

  mailpit: {
    url: IS_WIN
      ? 'https://github.com/axllent/mailpit/releases/latest/download/mailpit-windows-amd64.zip'
      : `https://github.com/axllent/mailpit/releases/latest/download/mailpit-linux-${ARCH === 'arm64' ? 'arm64' : 'amd64'}.tar.gz`,
    binary: IS_WIN ? 'mailpit.exe' : 'mailpit'
  },


  composer: { url: 'https://getcomposer.org/download/latest-stable/composer.phar', binary: 'composer.phar' },

  // Databases are large; on Linux we prefer the distro package and only offer
  // a download on Windows where there is no package manager to lean on.
  mysql: IS_WIN
    ? { url: 'https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-8.4.3-winx64.zip', binary: 'bin\\mysqld.exe' }
    : { system: 'mysqld', binary: 'mysqld' },

  postgres: IS_WIN
    ? { url: 'https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip', binary: 'pgsql\\bin\\postgres.exe' }
    : { system: 'postgres', binary: 'postgres' },

  redis: IS_WIN
    ? { url: 'https://github.com/redis-windows/redis-windows/releases/latest/download/Redis-8.0-Windows-x64-msys2.zip', binary: 'redis-server.exe' }
    : { system: 'redis-server', binary: 'redis-server' }
}
