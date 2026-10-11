// Routes .key (and .bsv) names to the viewer page. Two ways in:
//   1. Address bar URLs like http://alice.key/ are redirected before any DNS lookup happens.
//   2. Typing plain "alice.key" makes the browser search for it; if the user enabled it in the popup
//      (optional host permission for the search engine), that exact-name search is redirected too.
// Rules are dynamic because the redirect target contains this extension's id.

const VIEW = chrome.runtime.getURL('view.html')
const NAME = '([a-zA-Z0-9-]+)\\.(?:key|bsv)'   // no {1,64}: bounded repeats exceed the rule regex memory limit; view.js enforces length
const SEARCH_TAIL = `${NAME}(?:%2F|/)?(?:&.*)?$`

const rule = (id, regexFilter, suffix = '') => ({
  id, priority: 1,
  action: { type: 'redirect', redirect: { regexSubstitution: `${VIEW}#name=\\1${suffix}` } },
  condition: { regexFilter, resourceTypes: ['main_frame'] }
})
const RULES = [
  rule(1, `^https?://${NAME}\\.?(?::[0-9]+)?(?:[/?#].*)?$`),
  rule(2, `^https://(?:www\\.)?google\\.[a-z.]{2,6}/search\\?(?:.*&)?q=${SEARCH_TAIL}`, '&from=search'),
  rule(3, `^https://(?:www\\.)?bing\\.com/search\\?(?:.*&)?q=${SEARCH_TAIL}`, '&from=search'),
  rule(4, `^https://(?:html\\.)?duckduckgo\\.com/(?:html/)?\\?(?:.*&)?q=${SEARCH_TAIL}`, '&from=search'),
  rule(5, `^https://search\\.brave\\.com/search\\?(?:.*&)?q=${SEARCH_TAIL}`, '&from=search')
]

async function installRules(){
  const old = await chrome.declarativeNetRequest.getDynamicRules()
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map(r => r.id), addRules: RULES })
}
chrome.runtime.onInstalled.addListener(installRules)
chrome.runtime.onStartup.addListener(installRules)

// Omnibox: "key alice" + Enter opens alice.key
const normalize = (s) => String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/\.(key|bsv)\.?$/, '')
chrome.omnibox.setDefaultSuggestion({ description: 'Open <match>%s.key</match> from Bitcoin BSV' })
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  const name = normalize(text); if (!name) return
  const url = `${VIEW}#name=${encodeURIComponent(name)}`
  if (disposition === 'currentTab') chrome.tabs.update({ url })
  else chrome.tabs.create({ url, active: disposition === 'newForegroundTab' })
})
