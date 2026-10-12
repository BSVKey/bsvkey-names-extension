// BSVKey Names resolver: name -> owner address -> page, read straight from Bitcoin BSV.
// A dependency-free port of the resolver in bsvkey.com (chostResolveAny and friends), so the
// extension and the site always agree on who owns a name and which page it serves.

export const CHOST_PREFIX = 'CHOSTv1'
export const REGISTRY_ADDRESS = '1G6sLZX7FEsho13aei7iVygWaJhrSXDsrM'
export const NAME_RE = /^[a-z0-9-]{1,64}$/
const NAME_INDEX_JSON = 'https://bsvkey.github.io/name-index/names.json'
// bsvkey.com's keyed WhatsOnChain proxy first (higher rate limit), then WhatsOnChain directly.
const WOC_BASES = ['https://bsvkey.com/woc/v1/bsv/main', 'https://api.whatsonchain.com/v1/bsv/main']
const HISTORY_SCAN = 500
const REGISTRY_SCAN_MS = 25000

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const hexToBytes = (h) => Uint8Array.from((String(h).match(/../g) || []).map(x => parseInt(x, 16)))
const hexToUtf8 = (h) => new TextDecoder().decode(hexToBytes(h))
const isTxid = (s) => /^[0-9a-fA-F]{64}$/.test(s)
const isBsvAddr = (s) => /^1[a-km-zA-HJ-NP-Z1-9]{24,40}$/.test(s)

// ---- chain reads ----
async function wocGet(path, body){
  const init = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' } : { cache: 'no-store' }
  let lastErr = null
  for (const base of WOC_BASES){
    for (let i = 0; i < 4; i++){
      let r
      try { r = await fetch(base + path, init) } catch (e){ lastErr = e; break }                   // network error -> next base
      if (r.status === 429){ await sleep(1200 * (i + 1)); continue }
      const t = await r.text()
      if (r.status === 404) throw new Error('404 ' + t)
      if (!r.ok){ lastErr = new Error(r.status + ' ' + t); break }                                // 5xx -> next base
      try { return JSON.parse(t) } catch { return t }
    }
  }
  throw lastErr || new Error('chain read failed')
}
const txCache = new Map()
async function getTxDecoded(txid){
  if (txCache.has(txid)) return txCache.get(txid)
  const t = await wocGet(`/tx/hash/${txid}`); txCache.set(txid, t); return t
}
// Confirmed + mempool history, so a claim or page broadcast minutes ago resolves immediately.
// Uses the paginated /confirmed/history: the legacy /history endpoint returns only the newest 100
// transactions, which silently hides older name claims and pages.
const HISTORY_MAX_PAGES = 20
async function addressHistory(address){
  const list = (raw) => (Array.isArray(raw) ? raw : ((raw && raw.result) || [])).map(h => ({ txid: h.tx_hash, height: h.height }))
  const confirmed = []; let token = ''
  for (let page = 0; page < HISTORY_MAX_PAGES; page++){
    const raw = await wocGet(`/address/${address}/confirmed/history?limit=1000${token ? '&token=' + encodeURIComponent(token) : ''}`)
    confirmed.push(...list(raw)); token = raw && raw.nextPageToken; if (!token) break
  }
  const unconf = list(await wocGet(`/address/${address}/unconfirmed/history`).catch(() => []))
  const seen = new Set(); const out = []
  for (const h of [...confirmed, ...unconf]){ if (!seen.has(h.txid)){ seen.add(h.txid); out.push(h) } }
  return out
}
// Decode txs 20 at a time via WhatsOnChain's bulk endpoint (one request per 20, far under the rate
// limit), preserving order. Stops starting new reads after deadline.
async function decodeAll(hist, deadline = Infinity, parallel = 3){
  const need = [...new Set(hist.map(h => h.txid).filter(id => !txCache.has(id)))]
  const chunks = []; for (let i = 0; i < need.length; i += 20) chunks.push(need.slice(i, i + 20))
  let next = 0
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (next < chunks.length && Date.now() < deadline){ const chunk = chunks[next++]
      try { const arr = await wocGet('/txs', { txids: chunk })
        for (const t of (Array.isArray(arr) ? arr : [])){ const id = t && (t.txid || t.hash); if (id && t.vout) txCache.set(id, t) } } catch {} } }))
  return hist.map(h => txCache.get(h.txid) || null)
}
const ord = (h) => (h.height && h.height > 0) ? h.height : Number.MAX_SAFE_INTEGER   // unconfirmed = newest

// ---- OP_RETURN parsing (from raw script hex; WhatsOnChain's asm is unreliable for small pushes) ----
export function scriptPushesFromHex(hex){
  const s = String(hex || '').toLowerCase(); const pushes = []; let i = 0, saw = false
  while (i + 2 <= s.length){ const op = parseInt(s.substr(i, 2), 16); i += 2
    if (!saw){ if (op === 0x6a) saw = true; continue }
    let len = 0
    if (op >= 0x01 && op <= 0x4b) len = op
    else if (op === 0x4c){ len = parseInt(s.substr(i, 2), 16) || 0; i += 2 }
    else if (op === 0x4d){ len = parseInt((s.substr(i, 4).match(/../g) || []).reverse().join(''), 16) || 0; i += 4 }
    else if (op === 0x4e){ len = parseInt((s.substr(i, 8).match(/../g) || []).reverse().join(''), 16) || 0; i += 8 }
    else continue
    pushes.push(s.substr(i, len * 2)); i += len * 2 }
  return pushes
}
function toRecord(pushes){
  pushes = pushes.filter(h => h && h.length); if (!pushes.length) return null
  const utf8 = pushes.map(hexToUtf8)
  return { text: utf8[0] ?? '', extra: utf8.slice(1) }
}
function extractOpReturns(t){
  const out = []
  for (const o of (t.vout || [])){ const hex = ((o.scriptPubKey || {}).hex || '').toLowerCase()
    if (!/^(00)?6a/.test(hex)) continue
    const r = toRecord(scriptPushesFromHex(hex)); if (r) out.push(r) }
  return out
}
// WhatsOnChain's decoded endpoint truncates scripts at 100000 hex chars (~50 KB), so big pages are
// re-read from the raw tx.
function opReturnsFromRawTx(rawhex){
  const raw = String(rawhex || '').toLowerCase(); const out = []
  const rev = (h) => (h.match(/../g) || []).reverse().join('')
  function varint(i){ const f = parseInt(raw.substr(i, 2), 16); i += 2
    if (f < 0xfd) return [f, i]; if (f === 0xfd) return [parseInt(rev(raw.substr(i, 4)), 16), i + 4]
    if (f === 0xfe) return [parseInt(rev(raw.substr(i, 8)), 16), i + 8]; return [Number(BigInt('0x' + rev(raw.substr(i, 16)))), i + 16] }
  try {
    let i = 8; let [vin, i2] = varint(i); i = i2
    for (let k = 0; k < vin; k++){ i += 64 + 8; const [sl, j] = varint(i); i = j + sl * 2 + 8 }
    let [vout, i3] = varint(i); i = i3
    for (let k = 0; k < vout; k++){ i += 16; const [sl, j] = varint(i); const script = raw.substr(j, sl * 2); i = j + sl * 2
      if (!/^(00)?6a/.test(script)) continue
      const r = toRecord(scriptPushesFromHex(script)); if (r) out.push(r) }
  } catch {}
  return out
}
async function extractOpReturnsFull(t){
  const capped = (t.vout || []).some(o => (((o.scriptPubKey || {}).hex || '').length >= 100000))
  if (!capped) return extractOpReturns(t)
  try { const full = opReturnsFromRawTx(await wocGet(`/tx/${t.txid || t.hash}/hex`)); if (full.length) return full } catch {}
  return extractOpReturns(t)
}
export function readRecord(o){
  if (o.text !== CHOST_PREFIX) return null
  if (o.extra[0] === 'PUB') return { type: 'PUB', html: o.extra[1], mediaType: o.extra[2] || 'text/html', site: (o.extra[3] || '').toLowerCase() }
  if (o.extra[0] === 'NAME') return { type: 'NAME', name: o.extra[1], owner: o.extra[2] }
  if (o.extra[0] === 'XFER') return { type: 'XFER', name: o.extra[1], newOwner: o.extra[2] }
  if (o.extra[0] === 'DEL') return { type: 'DEL', site: (o.extra[1] || '').toLowerCase() }
  return null
}

// ---- signer address: base58check(0x00 + RIPEMD160(SHA256(pubkey))) of the first input's pubkey ----
export function ripemd160(msg){
  const zl = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13]
  const zr = [5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11]
  const sl = [11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6]
  const sr = [8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11]
  const kl = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e]
  const kr = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000]
  const f = (j, x, y, z) => j < 16 ? (x ^ y ^ z) : j < 32 ? ((x & y) | (~x & z)) : j < 48 ? ((x | ~y) ^ z) : j < 64 ? ((x & z) | (y & ~z)) : (x ^ (y | ~z))
  const rotl = (x, n) => (x << n) | (x >>> (32 - n))
  const len = msg.length; const padLen = ((len + 8) >> 6) * 64 + 64
  const buf = new Uint8Array(padLen); buf.set(msg); buf[len] = 0x80
  const bits = len * 8; const dv = new DataView(buf.buffer)
  dv.setUint32(padLen - 8, bits >>> 0, true); dv.setUint32(padLen - 4, Math.floor(bits / 0x100000000), true)
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const X = new Array(16)
  for (let off = 0; off < padLen; off += 64){
    for (let i = 0; i < 16; i++) X[i] = dv.getUint32(off + i * 4, true)
    let al = h0, bl = h1, cl = h2, dl = h3, el = h4, ar = h0, br = h1, cr = h2, dr = h3, er = h4
    for (let j = 0; j < 80; j++){
      let t = (rotl((al + f(j, bl, cl, dl) + X[zl[j]] + kl[j >> 4]) | 0, sl[j]) + el) | 0
      al = el; el = dl; dl = rotl(cl, 10); cl = bl; bl = t
      t = (rotl((ar + f(79 - j, br, cr, dr) + X[zr[j]] + kr[j >> 4]) | 0, sr[j]) + er) | 0
      ar = er; er = dr; dr = rotl(cr, 10); cr = br; br = t
    }
    const t = (h1 + cl + dr) | 0; h1 = (h2 + dl + er) | 0; h2 = (h3 + el + ar) | 0; h3 = (h4 + al + br) | 0; h4 = (h0 + bl + cr) | 0; h0 = t
  }
  const out = new Uint8Array(20); const odv = new DataView(out.buffer)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => odv.setUint32(i * 4, h >>> 0, true))
  return out
}
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58(bytes){
  let n = BigInt('0x' + (Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') || '0')); let s = ''
  while (n > 0n){ s = B58[Number(n % 58n)] + s; n /= 58n }
  for (const b of bytes){ if (b !== 0) break; s = '1' + s }
  return s
}
export async function pubkeyToAddress(pubHex){
  const payload = new Uint8Array(21); payload.set(ripemd160(await sha256(hexToBytes(pubHex))), 1)
  const check = (await sha256(await sha256(payload))).slice(0, 4)
  const full = new Uint8Array(25); full.set(payload); full.set(check, 21)
  return base58(full)
}
async function signerOf(t){
  try { const asm = (((t.vin || [])[0] || {}).scriptSig || {}).asm || ''
    const toks = asm.trim().split(/\s+/); const pub = toks[toks.length - 1]
    if (!/^0[23][0-9a-fA-F]{64}$|^04[0-9a-fA-F]{128}$/.test(pub)) return null
    return await pubkeyToAddress(pub) } catch { return null }
}

// ---- resolution (same rules as bsvkey.com) ----
async function resolveTxid(txid){
  const t = await getTxDecoded(txid)
  for (const o of await extractOpReturnsFull(t)){ const r = readRecord(o); if (r && r.type === 'PUB' && r.html != null) return { txid, html: r.html, site: r.site || '' } }
  return null
}
// Newest PUB/DEL record per site that this address SIGNED, walking newest first; minHeight limits
// the walk to txs at or above that block (plus mempool).
async function decidePages(address, wantName = null, minHeight = 0){
  let hist = (await addressHistory(address)).sort((a, b) => ord(b) - ord(a))
  hist = minHeight > 0 ? hist.filter(h => ord(h) >= minHeight) : hist.slice(0, HISTORY_SCAN)
  const decided = new Map()
  for (let i = 0; i < hist.length; i += 60){                    // decode in bulk batches (3 x 20), walk newest first
    const batch = await decodeAll(hist.slice(i, i + 60))
    for (let k = 0; k < batch.length; k++){ const t = batch[k]; if (!t) continue; const h = hist[i + k]
      if (await signerOf(t) !== address) continue
      for (const o of await extractOpReturnsFull(t)){ const r = readRecord(o); if (!r || (r.type !== 'PUB' && r.type !== 'DEL')) continue
        const key = r.site || ''
        if (!decided.has(key)) decided.set(key, (r.type === 'PUB' && r.html != null) ? { txid: h.txid, html: r.html, site: key } : null) }
    }
    if (wantName && decided.has(wantName)) break                 // newest record for this name already found
  }
  return decided
}
// Newest page this address SIGNED for wantName; else its default (untagged) page. A DEL tombstone
// for the name means "removed", with no fallback.
async function resolveAddress(address, wantName = null){
  const decided = await decidePages(address, wantName)
  if (wantName){ if (decided.has(wantName)) return decided.get(wantName); return decided.get('') || null }
  for (const rec of decided.values()){ if (rec) return rec }
  return null
}
let staticIdx = null, staticIdxAt = 0
async function staticIndex(){
  if (staticIdx && Date.now() - staticIdxAt < 120000) return staticIdx
  try { const r = await fetch(NAME_INDEX_JSON, { cache: 'no-cache' }); if (!r.ok) return null; const j = await r.json()
    if (j && j.names){ staticIdx = j; staticIdxAt = Date.now(); return j } } catch {}
  return null
}
// Global first-claim-wins: the index snapshot first, then a trustless scan of the registry address
// (first NAME claim owns it; an XFER counts only if signed by the then-current owner).
export async function resolveName(name){
  const want = String(name).toLowerCase()
  const idx = await staticIndex()
  if (idx){ const rec = idx.names[want]; if (rec && rec.owner) return { name: want, owner: rec.owner, txid: rec.txid, page: rec.page || null, via: 'index', idxHeight: idx.height || 0 } }
  // The index covers every registry tx up to idx.height, so only replay txs at >= that height
  // (plus mempool) to catch newer claims. Without an index, scan the whole registry.
  let arr = (await addressHistory(REGISTRY_ADDRESS)).sort((a, b) => ord(a) - ord(b))
  if (idx && idx.height > 0) arr = arr.filter(h => ord(h) >= idx.height)
  const decoded = await decodeAll(arr, Date.now() + REGISTRY_SCAN_MS)
  let owner = null, claimTxid = null
  for (let i = 0; i < arr.length; i++){ const t = decoded[i]; if (!t) continue
    for (const o of extractOpReturns(t)){ const r = readRecord(o); if (!r || !r.name || r.name.toLowerCase() !== want) continue
      if (r.type === 'NAME' && r.owner && !owner){ owner = r.owner; claimTxid = arr[i].txid }
      else if (r.type === 'XFER' && r.newOwner && owner){ const s = await signerOf(t); if (s && s === owner){ owner = r.newOwner; claimTxid = arr[i].txid } } }
  }
  return owner ? { name: want, owner, txid: claimTxid, via: 'chain' } : null
}
// name | address | txid -> { html, txid, name, address } | { notfound, name, address? }
export async function resolveAny(query){
  const q = String(query || '').trim().replace(/^@/, ''); if (!q) return null
  if (isTxid(q)) return await resolveTxid(q)
  if (isBsvAddr(q)) return await resolveAddress(q)
  const n = await resolveName(q); if (!n || !n.owner) return { notfound: true, name: q }
  // The index already applied the page rules up to idx.height; only the owner's newer txs can change it.
  if (n.via === 'index' && n.idxHeight > 0){
    const d = await decidePages(n.owner, q, n.idxHeight)
    let pick
    if (d.has(q)) pick = d.get(q)                                          // newer page or DEL for this name
    else {
      const base = n.page ? await resolveTxid(n.page).catch(() => null) : null
      pick = (d.has('') && (!base || base.site === '')) ? d.get('') : base   // newer default replaces only a default
    }
    return (pick && pick.html != null) ? { ...pick, name: q, address: n.owner, claimTxid: n.txid } : { notfound: true, name: q, address: n.owner, claimTxid: n.txid }
  }
  if (n.page){ const pg = await resolveTxid(n.page).catch(() => null); if (pg && pg.html != null) return { ...pg, name: q, address: n.owner, claimTxid: n.txid } }
  const r = await resolveAddress(n.owner, q)
  return r ? { ...r, name: q, address: n.owner, claimTxid: n.txid } : { notfound: true, name: q, address: n.owner, claimTxid: n.txid }
}
