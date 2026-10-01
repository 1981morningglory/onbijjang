/** 팝업: 캡처 방식 고르기, 진행 표시, 취소. 실제 캡처는 서비스 워커가 한다. */
import { hydrateIcons } from './lib/icons.js'

const $ = (id) => document.getElementById(id)
const menu = $('menu')
const busy = $('busy')
const notice = $('notice')
const limited = $('limited')
const modeButtons = [...document.querySelectorAll('.mode')]

let tab = null
let starting = false

hydrateIcons()
$('version').textContent = `v${chrome.runtime.getManifest().version}`
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage())

function showNotice(text) {
  notice.hidden = !text
  $('notice-text').textContent = text || ''
}

function render(state) {
  const capturing = state?.status === 'capturing' && state.mode === 'full'
  menu.hidden = capturing
  busy.hidden = !capturing
  if (capturing) {
    const percent = Math.max(0, Math.min(100, Number(state.progress) || 0))
    $('busy-percent').textContent = `${percent}%`
    $('busy-bar').setAttribute('aria-valuenow', String(percent))
    $('busy-bar').firstElementChild.style.width = `${percent}%`
    limited.hidden = true
    showNotice('')
    return
  }
  if (state?.status === 'error' && state.message) showNotice(state.message)
}

/** 확장이 스크립트를 넣을 수 없는 페이지인지(주소를 알 수 있을 때만 판단) */
function isLimitedPage(url) {
  if (!url) return false
  return !/^(https?|file):/i.test(url) || /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)/i.test(url)
}

async function start(mode) {
  if (starting || !tab) return
  starting = true
  showNotice('')
  for (const b of modeButtons) b.disabled = true
  try {
    if (mode === 'full') render({ status: 'capturing', mode: 'full', progress: 0 })
    const pending = chrome.runtime.sendMessage({ type: 'ob:start', mode, tabId: tab.id })
    const res = await pending
    if (!res?.ok) {
      render({ status: 'idle' })
      showNotice(res?.message || '캡처를 시작하지 못했습니다.')
      return
    }
    // 영역 선택은 페이지를 직접 끌어야 하므로 팝업을 닫는다.
    if (mode === 'region') window.close()
  } catch {
    render({ status: 'idle' })
    showNotice('캡처를 시작하지 못했습니다. 확장 프로그램을 새로고침한 뒤 다시 시도해 주세요.')
  } finally {
    starting = false
    applyLimits()
  }
}

function applyLimits() {
  const isLimited = isLimitedPage(tab?.url)
  limited.hidden = !isLimited || !busy.hidden
  for (const b of modeButtons) b.disabled = !tab || (isLimited && b.dataset.mode !== 'visible')
}

for (const b of modeButtons) b.addEventListener('click', () => start(b.dataset.mode))

$('cancel').addEventListener('click', async () => {
  $('cancel').disabled = true
  try {
    await chrome.runtime.sendMessage({ type: 'ob:cancel' })
  } finally {
    $('cancel').disabled = false
  }
})

chrome.storage.session.onChanged.addListener((changes) => {
  if (!changes.state) return
  const next = changes.state.newValue
  render(next)
  applyLimits()
  // 전체 캡처가 끝나면 결과 탭이 열리므로 팝업은 닫는다.
  if (changes.state.oldValue?.status === 'capturing' && next?.status === 'idle' && !next.notice) window.close()
  if (next?.status === 'idle' && next.notice) showNotice('')
})

async function init() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    tab = tabs[0] ?? null
  } catch {
    tab = null
  }
  const { state } = await chrome.storage.session.get('state')
  // 다른 탭에서 진행 중인 캡처도 여기서 보고 취소할 수 있다.
  render(state)
  applyLimits()
  if (state?.status === 'error') {
    // 한 번 보여 준 오류는 지운다(배지도 함께).
    chrome.action.setBadgeText({ text: '' })
    chrome.storage.session.set({ state: { status: 'idle', at: Date.now() } })
    showNotice(state.message)
  }
  if (!tab) showNotice('캡처할 탭을 찾지 못했습니다.')
}

init()
