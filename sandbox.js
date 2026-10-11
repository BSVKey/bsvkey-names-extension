// Runs in a manifest sandbox page: opaque origin, no chrome.* APIs, its own CSP. Receives the
// on-chain HTML once from view.html and writes it in as this document.
let rendered = false

// Links to other .key names (or bsvkey.com/#site=name) stay in the viewer; other web links open
// in the top-level tab instead of inside this frame (most sites refuse to be framed).
function onClick(e){
  if (e.defaultPrevented || e.button !== 0) return
  const a = e.target && e.target.closest && e.target.closest('a[href]'); if (!a) return
  let u; try { u = new URL(a.getAttribute('href')) } catch { return }        // relative links: leave to the page
  const newTab = a.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey
  const host = u.hostname.toLowerCase()
  const m = host.match(/^([a-z0-9-]{1,64})\.(key|bsv)\.?$/)
  const site = /(^|\.)bsvkey\.com$/.test(host) && (u.hash.match(/site=([^&]+)/) || [])[1]
  if (m || site){ e.preventDefault(); parent.postMessage({ type: 'nav', name: m ? m[1] : decodeURIComponent(site).toLowerCase(), newTab }, '*'); return }
  if (/^(https?|mailto):$/.test(u.protocol)){ e.preventDefault(); parent.postMessage({ type: 'open', url: u.href, newTab }, '*') }
}

window.addEventListener('message', (e) => {
  if (rendered || e.source !== parent) return
  const d = e.data || {}; if (d.type !== 'render') return
  rendered = true
  document.open(); document.write(String(d.html || '')); document.close()
  document.addEventListener('click', onClick, true)                         // document.open() cleared earlier listeners
  const report = () => parent.postMessage({ type: 'title', title: document.title || '' }, '*')
  report(); window.addEventListener('load', report)
})
parent.postMessage({ type: 'ready' }, '*')
