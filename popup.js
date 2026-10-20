const SEARCH_ORIGINS = ['*://*.google.com/*', '*://*.bing.com/*', '*://*.duckduckgo.com/*', '*://search.brave.com/*']
const $ = (id) => document.getElementById(id)

$('go').addEventListener('submit', (e) => {
  e.preventDefault()
  const typed = $('name').value.trim().toLowerCase()
  const name = typed.replace(/\.(key|bsv)\.?$/, '')
  if (!/^[a-z0-9-]{1,64}$/.test(name)){ $('err').hidden = false; $('err').textContent = 'Use lowercase letters, numbers and hyphens.'; return }
  chrome.tabs.create({ url: chrome.runtime.getURL('view.html') + '#name=' + encodeURIComponent(name) + (/\.bsv\.?$/.test(typed) ? '&tld=bsv' : '') })
  window.close()
})

chrome.permissions.contains({ origins: SEARCH_ORIGINS }, (on) => { $('typed').checked = !!on })
$('typed').addEventListener('change', (e) => {
  const want = e.target.checked
  const done = (ok) => { if (!ok) e.target.checked = !want }
  if (want) chrome.permissions.request({ origins: SEARCH_ORIGINS }, done)
  else chrome.permissions.remove({ origins: SEARCH_ORIGINS }, done)
})
