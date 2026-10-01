/**
 * 온비짱 캡처 — 서비스 워커.
 * 팝업에서 고른 방식대로 현재 탭을 찍어 임시 보관소(IndexedDB)에 넣고 결과 화면을 연다.
 * 이어 붙이기는 결과 화면이 한다. 어디에도 네트워크 요청을 보내지 않는다.
 */
import { LIMITS, maxCssHeight, waitBeforeCapture } from './lib/plan.js'
import { dataUrlToBlob } from './lib/protocol.js'
import { loadSettings, waitTimes } from './lib/settings.js'
import { deleteCapture, putCapture, putShot, sweep } from './lib/store.js'

const STATE_KEY = 'state'
const BRAND = '#0b7a53'
const DANGER = '#c22f1c'

/** 진행 중인 전체 캡처. 서비스 워커가 살아 있는 동안만 의미가 있다. */
let job = null
let lastCaptureAt = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

class CaptureError extends Error {
  constructor(message, kind = 'error') {
    super(message)
    this.kind = kind
  }
}

// 서비스 워커가 깨어날 때마다 오래된 임시 캡처를 치운다.
sweep()
chrome.runtime.onInstalled.addListener(() => sweep())
chrome.runtime.onStartup.addListener(() => sweep())

async function setState(state) {
  try {
    await chrome.storage.session.set({ [STATE_KEY]: { ...state, at: Date.now() } })
  } catch {
    // 상태 표시는 부가 기능이라 실패해도 캡처는 계속한다
  }
}

async function setBadge(text, color = BRAND) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color })
    await chrome.action.setBadgeText({ text })
  } catch {
    // 배지를 못 바꿔도 무시
  }
}

/** 페이지 안 도우미(content/agent.js)를 넣는다. 막힌 페이지면 여기서 실패한다. */
async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/agent.js'] })
  } catch {
    throw new CaptureError("이 페이지는 브라우저가 확장 프로그램의 접근을 막고 있어 전체 캡처와 영역 선택을 할 수 없습니다. '보이는 부분'으로 캡처해 주세요.", 'blocked')
  }
}

async function call(tabId, method, arg = null) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (m, a) => {
      const agent = globalThis.__onbijjangCaptureAgent
      return agent ? agent[m](a) : { ok: false, reason: 'no-agent' }
    },
    args: [method, arg],
  })
  return results?.[0]?.result ?? { ok: false, reason: 'no-result' }
}

/** 초당 2회 제한을 지키며 현재 보이는 화면을 찍는다. */
async function shoot(tab) {
  for (let attempt = 0; ; attempt++) {
    const wait = waitBeforeCapture(lastCaptureAt, Date.now())
    if (wait) await sleep(wait)
    const current = await chrome.tabs.get(tab.id).catch(() => null)
    if (!current) throw new CaptureError('캡처하던 탭이 닫혔습니다.')
    if (!current.active) throw new CaptureError('캡처하는 동안 다른 탭으로 옮겨 중단했습니다. 끝날 때까지 탭을 그대로 두고 다시 시도해 주세요.')
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
      lastCaptureAt = Date.now()
      if (!dataUrl) throw new Error('empty')
      return dataUrlToBlob(dataUrl)
    } catch (err) {
      lastCaptureAt = Date.now()
      const text = String(err?.message ?? err)
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(text) && attempt < 3) {
        await sleep(700)
        continue
      }
      if (/permission|activeTab|cannot access|not allowed/i.test(text)) {
        throw new CaptureError('이 탭을 캡처할 권한이 없습니다. 탭을 새로고침한 뒤 확장 아이콘을 다시 눌러 주세요.', 'blocked')
      }
      throw new CaptureError('화면을 찍지 못했습니다. 탭이 보이는 상태에서 다시 시도해 주세요.')
    }
  }
}

async function imageSize(blob) {
  const bmp = await createImageBitmap(blob)
  const size = { w: bmp.width, h: bmp.height }
  bmp.close()
  return size
}

async function openResult(id, tab) {
  await sweep(id)
  await chrome.tabs.create({ url: chrome.runtime.getURL(`result.html?id=${encodeURIComponent(id)}`), index: tab.index + 1, openerTabId: tab.id })
}

function baseMeta(id, mode, tab, page) {
  return {
    id,
    createdAt: Date.now(),
    mode,
    status: 'capturing',
    url: page?.url || tab.url || '',
    title: page?.title || tab.title || '',
  }
}

// ── 보이는 부분 ───────────────────────────────────────────
async function captureVisible(tab) {
  const id = newId()
  const blob = await shoot(tab)
  const size = await imageSize(blob)
  await putShot(id, 0, blob)
  await putCapture({ ...baseMeta(id, 'visible', tab), status: 'ready', imgW: size.w, imgH: size.h, shots: [{ y: 0 }] })
  await openResult(id, tab)
}

// ── 영역 선택 ─────────────────────────────────────────────
async function startRegion(tab) {
  await inject(tab.id)
  const res = await call(tab.id, 'startRegionSelect')
  if (!res?.ok) throw new CaptureError('영역 선택 화면을 띄우지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.')
  await setState({ status: 'selecting', mode: 'region', tabId: tab.id })
}

async function finishRegion(tab, msg) {
  const rect = msg.rect
  const ok = rect && [rect.x, rect.y, rect.w, rect.h, msg.innerWidth, msg.innerHeight].every((n) => Number.isFinite(n)) && rect.w > 0 && rect.h > 0 && msg.innerWidth > 0
  if (!ok) throw new CaptureError('선택한 영역을 읽지 못했습니다. 다시 시도해 주세요.')
  const id = newId()
  const blob = await shoot(tab)
  const size = await imageSize(blob)
  await putShot(id, 0, blob)
  await putCapture({
    ...baseMeta(id, 'region', tab, { url: String(msg.url || ''), title: String(msg.title || '') }),
    status: 'ready',
    imgW: size.w,
    imgH: size.h,
    scale: size.w / msg.innerWidth,
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    shots: [{ y: 0 }],
  })
  await openResult(id, tab)
}

// ── 전체 페이지 ───────────────────────────────────────────
async function captureFull(tab, current) {
  const settings = await loadSettings()
  await inject(tab.id)
  const id = newId()
  current.id = id
  let prepared = false
  try {
    const page = await call(tab.id, 'prepare', waitTimes(settings.waitMode))
    if (!page?.ok) throw new CaptureError('페이지를 준비하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.')
    prepared = true

    const meta = { ...baseMeta(id, 'full', tab, page), view: page.view, innerWidth: page.innerWidth, innerHeight: page.innerHeight, kind: page.kind, shots: [], truncated: false }
    let limitCss = maxCssHeight(page.dpr)
    let prevEnd = 0
    let y = 0

    for (let i = 0; i < LIMITS.MAX_SHOTS; i++) {
      if (current.cancelled) throw new CaptureError('캡처를 취소했습니다.', 'cancelled')
      const pos = await call(tab.id, 'scrollTo', { y, index: i, prevEnd })
      if (pos?.cancelled || current.cancelled) throw new CaptureError('캡처를 취소했습니다.', 'cancelled')
      if (!pos?.ok) throw new CaptureError('페이지가 바뀌어 캡처를 이어갈 수 없습니다. 다시 시도해 주세요.')
      // 더 내려가지 못했으면 끝에 닿은 것이다.
      if (i > 0 && pos.y + pos.viewH <= prevEnd + 0.5) break

      const blob = await shoot(tab)
      if (i === 0) {
        const size = await imageSize(blob)
        meta.imgW = size.w
        meta.imgH = size.h
        meta.scale = size.w / page.innerWidth
        limitCss = maxCssHeight(meta.scale)
        meta.limitCss = limitCss
      }
      await putShot(id, i, blob)
      meta.shots.push({ y: pos.y })
      prevEnd = pos.y + pos.viewH

      const total = Math.min(Math.max(pos.endY, prevEnd), limitCss)
      const percent = Math.max(1, Math.min(99, Math.round((Math.min(prevEnd, limitCss) / total) * 100)))
      await setState({ status: 'capturing', mode: 'full', tabId: tab.id, progress: percent, shots: i + 1 })
      await setBadge(`${percent}%`)

      if (prevEnd >= limitCss) {
        meta.truncated = pos.endY > limitCss + 1
        break
      }
      if (pos.atEnd || prevEnd >= pos.endY - 1) break
      if (i === LIMITS.MAX_SHOTS - 1) meta.truncated = true
      y = prevEnd
    }

    if (!meta.shots.length) throw new CaptureError('캡처할 내용이 없습니다.')
    meta.status = 'ready'
    await putCapture(meta)
  } catch (err) {
    await deleteCapture(id).catch(() => {})
    throw err
  } finally {
    if (prepared) await call(tab.id, 'restore').catch(() => {})
  }
  await openResult(id, tab)
}

// ── 시작·취소 ─────────────────────────────────────────────
async function finishOk() {
  await setBadge('')
  await setState({ status: 'idle' })
}

async function finishError(err, mode) {
  if (err?.kind === 'cancelled') {
    await setBadge('')
    await setState({ status: 'idle', notice: err.message })
    return
  }
  const message = err instanceof CaptureError ? err.message : '캡처하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'
  await setBadge('!', DANGER)
  await setState({ status: 'error', mode, message })
}

async function start(msg) {
  if (job) return { ok: false, message: '이미 캡처하고 있습니다. 끝나거나 취소한 뒤 다시 시도해 주세요.' }
  const mode = msg.mode
  if (mode !== 'full' && mode !== 'visible' && mode !== 'region') return { ok: false, message: '알 수 없는 캡처 방식입니다.' }
  const tab = await chrome.tabs.get(msg.tabId).catch(() => null)
  if (!tab) return { ok: false, message: '캡처할 탭을 찾지 못했습니다.' }

  const current = { tabId: tab.id, mode, cancelled: false, id: null }
  job = current
  await setBadge(mode === 'full' ? '0%' : '')
  await setState({ status: mode === 'region' ? 'selecting' : 'capturing', mode, tabId: tab.id, progress: 0, shots: 0 })

  const run = mode === 'full' ? captureFull(tab, current) : mode === 'visible' ? captureVisible(tab) : startRegion(tab)
  const settled = run.then(
    () => (mode === 'region' ? setBadge('') : finishOk()),
    (err) => finishError(err, mode),
  ).finally(() => {
    if (job === current) job = null
  })

  // 전체 캡처는 오래 걸리므로 바로 답하고 뒤에서 계속한다. 나머지는 끝난 결과를 알려 준다.
  if (mode === 'full') return { ok: true }
  await settled
  const state = (await chrome.storage.session.get(STATE_KEY))[STATE_KEY]
  return state?.status === 'error' ? { ok: false, message: state.message } : { ok: true }
}

async function cancel() {
  if (job) job.cancelled = true
  else await finishOk()
  return { ok: true }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 이 확장 프로그램의 화면·스크립트가 보낸 것만 받는다.
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false

  if (msg.type === 'ob:start' && !sender.tab) {
    start(msg).then(sendResponse, () => sendResponse({ ok: false, message: '캡처를 시작하지 못했습니다.' }))
    return true
  }
  if (msg.type === 'ob:cancel' && !sender.tab) {
    cancel().then(sendResponse)
    return true
  }
  if (msg.type === 'ob:region' && sender.tab) {
    finishRegion(sender.tab, msg).then(finishOk, (err) => finishError(err, 'region'))
    sendResponse({ ok: true })
    return false
  }
  if (msg.type === 'ob:region-cancel' && sender.tab) {
    finishOk()
    sendResponse({ ok: true })
    return false
  }
  return false
})
