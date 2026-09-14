/**
 * Remote images in untrusted content (captured mail, mostly) routinely point at
 * hosts that are gone, behind auth, or simply offline. Rendering them anyway
 * leaves broken-image glyphs, so every source is probed first and anything that
 * fails is swapped for a local placeholder.
 *
 * The placeholder is inlined as a data URI on purpose: a fallback that can
 * itself 404 is no fallback at all.
 */
export const FALLBACK_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90">
  <rect width="120" height="90" rx="8" fill="#1c1c22" stroke="#2a2a33"/>
  <path d="M60 30 L72 45 L60 60 L48 45 Z" fill="#ff2d20" opacity="0.85"/>
  <text x="60" y="78" font-family="system-ui, sans-serif" font-size="9"
        fill="#6b6b75" text-anchor="middle">image unavailable</text>
</svg>`.trim())

const DEFAULT_TIMEOUT = 6000

/**
 * Resolves true only when the browser can actually decode the image. A HEAD
 * request would not catch a 200 that returns an error page, and many mail hosts
 * reject HEAD outright.
 */
export function imageLoads (url, timeout = DEFAULT_TIMEOUT) {
  return new Promise(resolve => {
    if (!url) return resolve(false)
    // Already inline, nothing to fetch and nothing that can 404.
    if (url.startsWith('data:')) return resolve(true)
    // cid: references point at mail attachments the browser cannot resolve.
    if (url.startsWith('cid:')) return resolve(false)

    const img = new Image()
    let settled = false
    const finish = ok => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      img.onload = img.onerror = null
      resolve(ok)
    }

    const timer = setTimeout(() => {
      img.src = '' // stop a hanging host from holding the connection
      finish(false)
    }, timeout)

    img.onload = () => finish(img.naturalWidth > 0)
    img.onerror = () => finish(false)
    img.src = url
  })
}

/**
 * Rewrites an HTML fragment so every <img> either points at something that
 * loaded, or at the placeholder. Sources are probed in parallel.
 */
export async function withCheckedImages (html) {
  if (!html || !html.includes('<img')) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const images = [...doc.querySelectorAll('img')]
  if (images.length === 0) return html

  await Promise.all(images.map(async img => {
    const src = img.getAttribute('src')
    if (await imageLoads(src)) return

    img.setAttribute('src', FALLBACK_IMAGE)
    img.setAttribute('alt', img.getAttribute('alt') || 'Image unavailable')
    if (src) img.setAttribute('title', `Could not load ${src}`)
    // Original width/height would stretch the placeholder out of shape.
    img.removeAttribute('width')
    img.removeAttribute('height')
    img.setAttribute('style', `${img.getAttribute('style') ?? ''};max-width:120px;height:auto`)
  }))

  return doc.documentElement.outerHTML
}
