import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, DEV_ORIGIN, PRODUCTION_ORIGIN, cleanSaved, loadSettings, resetOrigin, saveOrigin, saveSettings, waitTimes } from '../../../extension/capture/lib/settings.js'

/** chrome.storage.local 흉내 */
function stubStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = structuredClone(initial)
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
        set: async (obj: Record<string, unknown>) => Object.assign(data, structuredClone(obj)),
      },
    },
  })
  return data
}

beforeEach(() => stubStorage())
afterEach(() => vi.unstubAllGlobals())

describe('확장 설정', () => {
  it('처음에는 배포 사이트로 연결된다', async () => {
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, origin: PRODUCTION_ORIGIN })
  })

  it('v1.0.0 이 다른 설정과 함께 저장해 둔 localhost 기본값은 무시한다', async () => {
    stubStorage({ settings: { origin: DEV_ORIGIN, footer: true, waitMode: 'slow' } })
    expect(await loadSettings()).toEqual({ origin: PRODUCTION_ORIGIN, footer: true, waitMode: 'slow' })
  })

  it('직접 고른 주소(개발용 포함)는 남는다', async () => {
    const data = stubStorage()
    await saveOrigin(DEV_ORIGIN)
    expect((await loadSettings()).origin).toBe(DEV_ORIGIN)
    // 다른 설정을 바꿔도 주소는 그대로
    await saveSettings({ footer: true })
    expect(await loadSettings()).toMatchObject({ origin: DEV_ORIGIN, footer: true })
    expect(data.settings).toMatchObject({ origin: DEV_ORIGIN, originSet: true, footer: true })
  })

  it('다른 설정만 바꾸면 주소는 저장하지 않아 기본값을 따라간다', async () => {
    const data = stubStorage()
    await saveSettings({ footer: true })
    expect(data.settings).toEqual({ footer: true })
  })

  it('기본 주소로 되돌리면 저장된 주소가 지워진다', async () => {
    const data = stubStorage()
    await saveOrigin('https://other.example')
    await saveSettings({ waitMode: 'slow' })
    const next = await resetOrigin()
    expect(next.origin).toBe(PRODUCTION_ORIGIN)
    expect(data.settings).toEqual({ waitMode: 'slow' })
  })

  it('저장소를 못 읽으면 기본값', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: async () => { throw new Error('x') } } } })
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS })
  })

  it('cleanSaved 는 이상한 값을 걸러 낸다', () => {
    expect(cleanSaved(null)).toEqual({})
    expect(cleanSaved([1])).toEqual({})
    expect(cleanSaved({ origin: 5, originSet: true })).toEqual({})
    expect(cleanSaved({ origin: 'https://a.b', originSet: true })).toEqual({ origin: 'https://a.b', originSet: true })
  })

  it('대기 시간', () => {
    expect(waitTimes('slow').images).toBeGreaterThan(waitTimes('normal').images)
    expect(waitTimes('anything')).toEqual(waitTimes('normal'))
  })
})
