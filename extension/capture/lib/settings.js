/** 확장 프로그램 설정(chrome.storage.local). 이 브라우저에만 저장된다. */

export const DEFAULT_SETTINGS = Object.freeze({
  /** 온비짱 사이트 주소 */
  origin: 'http://localhost:5173',
  /** 이미지 아래에 주소·시각 한 줄 넣기 */
  footer: false,
  /** 스크롤마다 기다리는 정도: normal | slow */
  waitMode: 'normal',
})

const KEY = 'settings'

export async function loadSettings() {
  try {
    const got = await chrome.storage.local.get(KEY)
    const saved = got && typeof got[KEY] === 'object' && got[KEY] ? got[KEY] : {}
    return { ...DEFAULT_SETTINGS, ...saved }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch }
  await chrome.storage.local.set({ [KEY]: next })
  return next
}

/** 스크롤 뒤 기다리는 시간(ms) */
export function waitTimes(waitMode) {
  return waitMode === 'slow' ? { settle: 500, images: 4000 } : { settle: 150, images: 1500 }
}
