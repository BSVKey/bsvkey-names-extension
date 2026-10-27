import { resolveAny, NAME_RE } from './resolver.js'

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.hash.slice(1))
const name = String(params.get('name') || '').trim().toLowerCase().replace(/\.(key|bsv)\.?$/, '')
const fromSearch = params.get('from') === 'search'
// .key is the main ending; .bsv is an alias for the same name. Show whichever was typed.
const tld = String(params.get('tld') || '').toLowerCase() === 'bsv' || /\.bsv\.?$/i.test(String(params.get('name') || '')) ? 'bsv' : 'key'
const full = () => `${name}.${tld}`
const frame = $('site')
const short = (s) => s.length > 16 ? s.slice(0, 8) + '…' + s.slice(-6) : s

// A different #name= on this same page (link from a site, popup) re-runs the lookup.
window.addEventListener('hashchange', () => location.reload())

function el(tag, attrs = {}, ...kids){
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)){ if (k === 'class') e.className = v; else if (k === 'onclick') e.onclick = v; else e.setAttribute(k, v) }
  for (const k of kids) if (k != null) e.append(k)
  return e
}
const nameH1 = () => {
  const h = el('h1', {}, name, el('span', { class: 'tld' }, '.' + tld))
  if (tld === 'bsv') h.title = `${name}.bsv is the same name as ${name}.key`
  return h
}
function panel(...kids){ frame.hidden = true; const s = $('state'); s.hidden = false; s.replaceChildren(el('div', { class: 'box' }, ...kids)) }
const actions = (...btns) => el('div', { class: 'actions' }, ...btns)
const claimBtn = () => el('a', { class: 'btn primary', href: 'https://bsvkey.com/', target: '_blank', rel: 'noopener' }, 'Claim a name on bsvkey.com')
// Store policy: say plainly that claiming is paid, and that the payment happens on bsvkey.com, not here.
const feeNote = () => el('p', { class: 'note' }, 'Claiming a name is a paid Bitcoin BSV transaction (20,000 satoshis plus a small miner fee), made on the bsvkey.com website with your own wallet. This extension is free and never makes payments, holds keys or connects to a wallet.')
const searchBtn = () => el('button', { class: 'btn', onclick: () => chrome.search.query({ text: `"${full()}"`, disposition: 'CURRENT_TAB' }) }, `Search the web for “${full()}”`)
const txLink = (txid, label) => el('a', { href: `https://whatsonchain.com/tx/${txid}`, target: '_blank', rel: 'noopener', title: txid }, label)

function setMeta(r){
  const m = $('meta'); m.replaceChildren()
  if (r.address) m.append('owner ', el('a', { href: `https://whatsonchain.com/address/${r.address}`, target: '_blank', rel: 'noopener', title: r.address }, short(r.address)))
  if (r.txid) m.append('  ·  page ', txLink(r.txid, short(r.txid)))
}

// ---- share: a bsvkey.com link anyone can open, plus the name.key form for extension users ----
const shareLink = 'https://bsvkey.com/#site=' + encodeURIComponent(name)
let pageTitle = ''
const shareText = () => pageTitle ? `${pageTitle} (${name}.key), a website on Bitcoin BSV` : `${name}.key, a website on Bitcoin BSV`
function openShare(open){
  $('sharePop').hidden = !open; $('shareBtn').setAttribute('aria-expanded', String(open))
  if (open){
    $('shareX').href = 'https://x.com/intent/post?text=' + encodeURIComponent(shareText()) + '&url=' + encodeURIComponent(shareLink)
    $('shareMail').href = 'mailto:?subject=' + encodeURIComponent(shareText()) + '&body=' + encodeURIComponent(shareLink)
    $('shareUrl').select()
  }
}
async function copy(text, btn){
  try { await navigator.clipboard.writeText(text) } catch { const i = btn.previousElementSibling; i.select(); document.execCommand('copy') }
  const was = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = was }, 1500)
}
function setupShare(){
  $('shareName').textContent = name + '.key'
  $('shareUrl').value = shareLink
  $('shareKey').value = name + '.key/'
  $('shareBtn').hidden = false
  $('shareBtn').onclick = (e) => { e.stopPropagation(); openShare($('sharePop').hidden) }
  $('copyUrl').onclick = () => copy(shareLink, $('copyUrl'))
  $('copyKey').onclick = () => copy(name + '.key/', $('copyKey'))
  if (navigator.share){ $('nativeShare').hidden = false; $('nativeShare').onclick = () => navigator.share({ title: shareText(), url: shareLink }).catch(() => {}) }
  document.addEventListener('click', (e) => { if (!$('sharePop').hidden && !$('sharePop').contains(e.target)) openShare(false) })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sharePop').hidden){ openShare(false); $('shareBtn').focus() } })
  window.addEventListener('blur', () => { if (!$('sharePop').hidden && document.activeElement === frame) openShare(false) })   // a click into the page frame
}

// The sandbox page renders the on-chain HTML in its own opaque origin, with no extension access.
let pendingHtml = null, sandboxReady = false
function render(html){ pendingHtml = html; if (sandboxReady) send() }
function send(){ $('state').hidden = true; frame.hidden = false; frame.contentWindow.postMessage({ type: 'render', html: pendingHtml }, '*'); pendingHtml = null }
window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow) return
  const d = e.data || {}
  if (d.type === 'ready'){ sandboxReady = true; if (pendingHtml != null) send() }
  else if (d.type === 'title' && typeof d.title === 'string'){ pageTitle = d.title.trim().slice(0, 80); document.title = pageTitle ? `${pageTitle} · ${full()}` : full() }
  else if (d.type === 'nav' && NAME_RE.test(String(d.name || ''))){ const url = `view.html#name=${encodeURIComponent(d.name)}`; if (d.newTab) window.open(url, '_blank'); else location.href = url }
  else if (d.type === 'open' && typeof d.url === 'string' && /^(https?|mailto):/i.test(d.url)){ if (d.newTab) window.open(d.url, '_blank', 'noopener'); else location.href = d.url }
})

async function main(){
  $('nm').textContent = name || '?'
  $('nm').nextElementSibling.textContent = '.' + tld
  document.title = `${name || '?'}.${tld}`
  $('onsite').href = 'https://bsvkey.com/#site=' + encodeURIComponent(name)
  if (!NAME_RE.test(name)){
    $('onsite').hidden = true
    return panel(el('p', { class: 'eyebrow' }, 'Not a valid name'), nameH1(), el('p', {}, '.key names use lowercase letters, numbers and hyphens only (up to 64 characters).'))
  }
  panel(el('div', { class: 'spin' }), el('p', { class: 'eyebrow' }, 'Resolving'), nameH1(), el('p', {}, 'Looking up this name in the BSVKey registry on Bitcoin BSV…'))
  let r
  try { r = await resolveAny(name) }
  catch (e){
    return panel(el('p', { class: 'eyebrow' }, 'Couldn’t reach the chain'), nameH1(), el('p', {}, 'The blockchain lookup failed. Check your connection and try again.'), el('p', { class: 'mono' }, String(e && e.message || e).slice(0, 200)),
      actions(el('button', { class: 'btn primary', onclick: () => location.reload() }, 'Try again')))
  }
  setMeta(r || {})
  if (r && r.address) setupShare()                         // claimed names only; nothing to share for an unclaimed one
  if (r && r.html != null) return render(r.html)
  if (r && r.address){
    return panel(el('p', { class: 'eyebrow' }, 'Claimed, no page yet'), nameH1(),
      el('p', {}, 'This name is registered on Bitcoin BSV, but its owner hasn’t published a page for it yet.'),
      el('p', { class: 'mono' }, 'Owner: ' + r.address),
      actions(r.claimTxid ? el('a', { class: 'btn', href: `https://whatsonchain.com/tx/${r.claimTxid}`, target: '_blank', rel: 'noopener' }, 'View claim transaction') : null))
  }
  panel(el('p', { class: 'eyebrow' }, 'Available'), nameH1(),
    el('p', {}, fromSearch ? 'No one has claimed this name. If you meant to search the web, use the button below.' : 'No one has claimed this name yet. Claim it on bsvkey.com and it’s yours, first claim wins.'),
    actions(fromSearch ? searchBtn() : claimBtn(), fromSearch ? claimBtn() : searchBtn()),
    feeNote())
}
main()
