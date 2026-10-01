/** 옵션 화면: 온비짱 주소, 대기 시간, 주소·시각 한 줄, 임시 보관 비우기 */
import { hydrateIcons } from './lib/icons.js'
import { normalizeOrigin } from './lib/plan.js'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './lib/settings.js'
import { deleteAll, listCaptures, sweep } from './lib/store.js'

const $ = (id) => document.getElementById(id)
const originInput = $('origin')
const originError = $('origin-error')

hydrateIcons()
$('version').textContent = `v${chrome.runtime.getManifest().version}`

let toastTimer = 0
function toast(text) {
  document.querySelector('.toast')?.remove()
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = text
  document.body.appendChild(el)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.remove(), 4000)
}

function setOriginError(text) {
  originError.hidden = !text
  originError.textContent = text || ''
  originInput.setAttribute('aria-invalid', text ? 'true' : 'false')
}

async function saveOrigin(value) {
  const parsed = normalizeOrigin(value)
  if (!parsed.ok) {
    setOriginError(parsed.reason)
    return
  }
  setOriginError('')
  const before = await loadSettings()
  await saveSettings({ origin: parsed.origin })
  originInput.value = parsed.origin
  // 주소가 바뀌면 예전 주소에 받아 둔 접근 권한은 돌려준다.
  const old = normalizeOrigin(before.origin)
  if (old.ok && old.pattern !== parsed.pattern) {
    try {
      await chrome.permissions.remove({ origins: [old.pattern] })
    } catch {
      // 받은 적이 없는 권한이면 그냥 넘어간다
    }
  }
  toast('온비짱 주소를 저장했습니다.')
}

async function refreshStored() {
  try {
    await sweep()
    const list = await listCaptures()
    $('stored').textContent = list.length ? `보관 중인 캡처 ${list.length}개` : '보관 중인 캡처가 없습니다'
    $('clear').disabled = list.length === 0
  } catch {
    $('stored').textContent = '보관 상태를 확인하지 못했습니다'
  }
}

$('save-origin').addEventListener('click', () => saveOrigin(originInput.value))
originInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveOrigin(originInput.value)
})
originInput.addEventListener('input', () => setOriginError(''))
$('reset-origin').addEventListener('click', () => saveOrigin(DEFAULT_SETTINGS.origin))

for (const radio of document.querySelectorAll('input[name="wait"]')) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return
    await saveSettings({ waitMode: radio.value })
    toast('저장했습니다.')
  })
}

$('footer').addEventListener('change', async (e) => {
  await saveSettings({ footer: e.target.checked })
  toast('저장했습니다.')
})

$('clear').addEventListener('click', async () => {
  $('clear').disabled = true
  try {
    await deleteAll()
    toast('보관 중인 캡처를 모두 지웠습니다. 열려 있는 결과 화면은 그대로 쓸 수 있습니다.')
  } catch {
    toast('지우지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  }
  refreshStored()
})

async function init() {
  const s = await loadSettings()
  originInput.value = s.origin
  const wait = document.querySelector(`input[name="wait"][value="${s.waitMode === 'slow' ? 'slow' : 'normal'}"]`)
  if (wait) wait.checked = true
  $('footer').checked = Boolean(s.footer)
  refreshStored()
}

init()
