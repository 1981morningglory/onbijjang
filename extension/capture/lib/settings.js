/** 확장 프로그램 설정(chrome.storage.local). 이 브라우저에만 저장된다. */

/** 팀이 쓰는 온비짱 주소(배포 사이트) */
export const PRODUCTION_ORIGIN = 'https://onbijjang-production.up.railway.app'
/** 개발할 때 쓰는 주소. 옵션에서 고를 수 있게 보여 준다. */
export const DEV_ORIGIN = 'http://localhost:5173'

export const DEFAULT_SETTINGS = Object.freeze({
  /** 온비짱 사이트 주소 */
  origin: PRODUCTION_ORIGIN,
  /** 이미지 아래에 주소·시각 한 줄 넣기 */
  footer: false,
  /** 스크롤마다 기다리는 정도: normal | slow */
  waitMode: 'normal',
})

const KEY = 'settings'

/**
 * 저장된 값 중 사용자가 직접 바꾼 것만 남긴다.
 * v1.0.0 은 다른 설정을 저장할 때 기본 주소(localhost)까지 함께 저장했으므로,
 * 주소를 직접 저장한 표시(originSet)가 없으면 저장된 주소를 무시하고 기본값을 쓴다.
 */
export function cleanSaved(raw) {
  const saved = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
  if (saved.originSet !== true || typeof saved.origin !== 'string') {
    delete saved.origin
    delete saved.originSet
  }
  return saved
}

async function readSaved() {
  try {
    const got = await chrome.storage.local.get(KEY)
    return cleanSaved(got?.[KEY])
  } catch {
    return {}
  }
}

export async function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(await readSaved()) }
}

/** 바꾼 항목만 저장한다(기본값은 저장하지 않아 나중에 기본값이 바뀌면 따라간다). */
export async function saveSettings(patch) {
  const saved = { ...(await readSaved()), ...patch }
  await chrome.storage.local.set({ [KEY]: saved })
  return { ...DEFAULT_SETTINGS, ...cleanSaved(saved) }
}

/** 온비짱 주소를 직접 정했을 때 */
export function saveOrigin(origin) {
  return saveSettings({ origin, originSet: true })
}

/** 온비짱 주소를 기본값으로 되돌릴 때 */
export async function resetOrigin() {
  const saved = await readSaved()
  delete saved.origin
  delete saved.originSet
  await chrome.storage.local.set({ [KEY]: saved })
  return { ...DEFAULT_SETTINGS, ...saved }
}

/** 스크롤 뒤 기다리는 시간(ms) */
export function waitTimes(waitMode) {
  return waitMode === 'slow' ? { settle: 500, images: 4000 } : { settle: 150, images: 1500 }
}
