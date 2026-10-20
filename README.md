# BSVKey Names (.key)

A browser extension that opens BSVKey names as `.key` addresses. Type `moonbase.key/` in the address bar and the page loads straight from Bitcoin BSV: the name comes from the BSVKey registry, and the page from the owner's on-chain publish.

Works in Chrome, Edge, Brave and other Chromium browsers (Manifest V3).

## Install

**From the store:**

- **Microsoft Edge:** [BSVKey Names on Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/nmeeppefbhcadepjblmbajoibambbhhn)
- **Chrome, Brave and other Chromium browsers:** in review at the Chrome Web Store. Until it is approved, install from GitHub below.

**From GitHub:**

1. Download this repository: green **Code** button, then **Download ZIP**, and unzip it.
2. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the unzipped folder (the one with `manifest.json`).

If you install from a store, remove any unpacked copy first: two copies would both try to handle `.key` addresses.

## Use

| You type | What happens |
|---|---|
| `moonbase.key/` or `http://moonbase.key` | Opens the name. The slash tells the browser it's an address, not a search. |
| `key moonbase` | Omnibox keyword, then Enter |
| `moonbase.key` | Works after you tick **"Let me type plain name.key"** in the extension popup. That option asks for permission to see Google, Bing, DuckDuckGo and Brave searches, and redirects only searches that are exactly a `.key` name. |
| Toolbar icon | Popup with a name box |
| **Share** button (top bar of a name) | Copy a `bsvkey.com/#site=name` link that opens in any browser, copy `name.key/` for people with the extension, or share via your system share sheet, X or email |

`.bsv` works as an alias (`moonbase.bsv/`): it opens the same name, and the page shows the ending you typed. `.key` stays the main ending.

Inside a `.key` page, links to other `.key` names (or `bsvkey.com/#site=name`) stay in the viewer. Other web links open in the tab normally.

## How it resolves

The resolver (`resolver.js`) uses the same rules as bsvkey.com:

1. **Name to owner:** the BSVKey name index snapshot first, then a trustless scan of the registry address `1G6sLZX7…SDsrM`. The first `NAME` claim wins, and a transfer counts only if it's signed by the current owner. It includes unconfirmed transactions, so a fresh claim works right away.
2. **Owner to page:** the newest page the owner *signed* for that name, falling back to their default page. A delete tombstone removes the page.
3. **Reads:** chain reads go through bsvkey.com's WhatsOnChain proxy, using the bulk endpoint (20 transactions per request), with WhatsOnChain directly as a fallback.

## Security model

- On-chain HTML renders in a manifest **sandbox page**. It runs in an opaque origin with no extension APIs, no access to your wallet or bsvkey.com storage, and its own content security policy.
- Page authorship is checked by deriving the signer address from the transaction's input public key (SHA-256 + RIPEMD-160 + Base58Check, implemented in `resolver.js` and tested against known vectors). A transaction that merely pays an address can't inject a page.
- Install permissions: `*.key` / `*.bsv` addresses only. Search-engine access is optional, and you can turn it off in the popup.

## Known limits

- The address bar shows the extension's viewer URL (`chrome-extension://…/view.html#name=moonbase`), not `moonbase.key`. Browsers only show a custom hostname when a real DNS or proxy answers for it.
- A link to `http://name.key` on an ordinary website isn't redirected, because the extension has no permission on that site. Typed addresses, the omnibox, the popup and links inside `.key` pages all work.
- `.key` is not an ICANN top-level domain today. If ICANN ever delegates it, real `.key` sites would be shadowed while this extension is installed.

## Files

`manifest.json` · `background.js` (redirect rules + omnibox) · `resolver.js` (chain lookup) · `view.html/js` (viewer) · `sandbox.html/js` (page renderer) · `popup.html/js` · `style.css` · `icons/`

## Building a site for your name

Pages render here in a sandbox: they can't reach your wallet, storage or cookies, and they load only inline code. In this extension, outside images, stylesheets, fonts, embeds (YouTube, maps) and CORS web APIs also work. The bsvkey.com viewer is stricter.

- What works in each viewer (tested), what kinds of sites thrive, and copy-paste code: [bsvkey.com/sites](https://bsvkey.com/sites)
- Take payments from any wallet (BRC-100, the BSVKey wallet, or any wallet by QR code): link to `https://bsvkey.com/pay?to=yourname&sats=5000&label=Tip`. Normal web links open in a regular tab, so the pay page works from here.

## More

- Names, the market and publishing: [bsvkey.com](https://bsvkey.com) and [bsvkey.com/market](https://bsvkey.com/market)
- Privacy policy: [bsvkey.com/extension-privacy.html](https://bsvkey.com/extension-privacy.html)
- License: MIT
