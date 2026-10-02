/**
 * 결과 화면: 찍은 장면을 이어 붙여 보여 주고, 저장·복사·온비짱으로 넘기기를 한다.
 * 모든 처리는 이 화면 안에서 끝난다. 네트워크 요청은 없다.
 */
import { hydrateIcons } from './lib/icons.js'
import { buildPdf } from './lib/pdf.js'
import { A4_PT, captureFileName, footerMetrics, footerText, normalizeOrigin, pieceFileName, planPdfPages, planRegion, planStitch, sliceAcrossPieces } from './lib/plan.js'
import { HANDOVER, bytesToBase64, chunkCount, chunkRange } from './lib/protocol.js'
import { loadSettings, saveSettings } from './lib/settings.js'
import { getCapture, getShot, sweep } from './lib/store.js'

const $ = (id) => document.getElementById(id)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fmt = new Intl.NumberFormat('ko-KR')
const JPEG_QUALITY = 0.92

const buttons = { png: $('save-png'), jpg: $('save-jpg'), pdf: $('save-pdf'), copy: $('copy'), edit: $('edit') }

let meta = null
let settings = null
/** 이어 붙인 결과. 길면 여러 장이다. */
let pieces = []
let width = 0
let busy = false

hydrateIcons()

// ── 작은 도우미 ───────────────────────────────────────────
let toastTimer = 0
function toast(text) {
  document.querySelector('.toast')?.remove()
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = text
  document.body.appendChild(el)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.remove(), 4500)
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('이미지가 너무 커서 이 브라우저에서 그릴 수 없습니다.')
  return { canvas: c, ctx }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('이미지를 만들지 못했습니다.'))), type, quality)
  })
}

/** JPEG 는 투명한 곳이 검게 나오지 않도록 흰 바탕에 올린다. */
function onWhite(canvas) {
  const { canvas: out, ctx } = makeCanvas(canvas.width, canvas.height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(canvas, 0, 0)
  return out
}

function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 15000)
}

function setBusy(next, label, button) {
  busy = next
  for (const b of Object.values(buttons)) b.disabled = next || !pieces.length
  if (button) {
    button.setAttribute('aria-busy', next ? 'true' : 'false')
    const textNode = button.lastChild
    if (next) {
      button.dataset.label = button.dataset.label || textNode.textContent
      textNode.textContent = label
    } else if (button.dataset.label) {
      textNode.textContent = button.dataset.label
    }
  }
}

function setLabel(button, label) {
  button.lastChild.textContent = label
}

/** 버튼 하나의 작업을 감싼다: 중복 실행 방지, 진행 문구, 오류 알림 */
async function run(button, label, task) {
  if (busy) return
  setBusy(true, label, button)
  try {
    await task()
  } catch (err) {
    toast(err?.message || '작업을 끝내지 못했습니다. 다시 시도해 주세요.')
  } finally {
    setBusy(false, '', button)
  }
}

// ── 불러와 이어 붙이기 ────────────────────────────────────
function fail(title, text) {
  $('loading').hidden = true
  $('failed').hidden = false
  if (title) $('failed-title').textContent = title
  if (text) $('failed-text').textContent = text
}

function progress(done, total) {
  $('loading-text').textContent = total > 1 ? `장면을 이어 붙이는 중 ${done}/${total}` : '캡처를 불러오는 중'
  $('loading-bar').style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`
}

async function loadShot(index) {
  const blob = await getShot(meta.id, index)
  if (!blob) throw new Error('missing-shot')
  return createImageBitmap(blob)
}

async function stitch() {
  if (meta.mode === 'full') {
    const plan = planStitch({ shots: meta.shots, view: meta.view, scale: meta.scale, imgW: meta.imgW, imgH: meta.imgH, limitCss: meta.limitCss })
    if (!plan.pieces.length) throw new Error('empty')
    const made = plan.pieces.map((p) => makeCanvas(plan.width, p.height))
    for (const m of made) {
      m.ctx.fillStyle = '#ffffff'
      m.ctx.fillRect(0, 0, m.canvas.width, m.canvas.height)
    }
    for (let s = 0; s < meta.shots.length; s++) {
      progress(s, meta.shots.length)
      const ops = plan.ops.filter((op) => op.shot === s)
      if (!ops.length) continue
      const bmp = await loadShot(s)
      for (const op of ops) made[op.piece].ctx.drawImage(bmp, op.sx, op.sy, op.sw, op.sh, op.dx, op.dy, op.sw, op.sh)
      bmp.close()
      // 긴 페이지에서도 화면이 멈춘 것처럼 보이지 않게 한 장마다 숨을 돌린다.
      await sleep(0)
    }
    width = plan.width
    return made.map((m) => m.canvas)
  }

  const bmp = await loadShot(0)
  const crop = meta.mode === 'region' ? planRegion({ rect: meta.rect, scale: meta.scale, imgW: bmp.width, imgH: bmp.height }) : { sx: 0, sy: 0, sw: bmp.width, sh: bmp.height }
  const { canvas, ctx } = makeCanvas(crop.sw, crop.sh)
  ctx.drawImage(bmp, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh)
  bmp.close()
  width = crop.sw
  return [canvas]
}

// ── 주소·시각 한 줄 ───────────────────────────────────────
function footerCanvas() {
  const m = footerMetrics(width)
  const { canvas, ctx } = makeCanvas(width, m.height)
  ctx.fillStyle = '#f2eee3'
  ctx.fillRect(0, 0, width, m.height)
  ctx.fillStyle = '#dfd8c6'
  ctx.fillRect(0, 0, width, Math.max(1, Math.round(m.fontPx / 12)))
  ctx.font = `600 ${m.fontPx}px 'Pretendard Variable', Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', system-ui, sans-serif`
  ctx.fillStyle = '#36443c'
  ctx.textBaseline = 'middle'
  const room = width - m.padX * 2
  // 주소가 길면 뒤를 줄여 시각이 잘리지 않게 한다.
  let url = meta.url || ''
  let text = footerText(url, meta.createdAt)
  while (url.length > 8 && ctx.measureText(text).width > room) {
    url = url.slice(0, Math.max(8, Math.floor(url.length * 0.9)))
    text = footerText(`${url}…`, meta.createdAt)
    if (url.length <= 8) break
  }
  ctx.fillText(text, m.padX, m.height / 2 + 1, room)
  return canvas
}

/** 저장·복사·보내기에 쓰는 최종 이미지들. 한 줄 옵션이 켜져 있으면 마지막 장 아래에 붙인다. */
function outputs() {
  if (!settings.footer || !pieces.length) return pieces
  const foot = footerCanvas()
  const last = pieces[pieces.length - 1]
  const { canvas, ctx } = makeCanvas(width, last.height + foot.height)
  ctx.drawImage(last, 0, 0)
  ctx.drawImage(foot, 0, last.height)
  return [...pieces.slice(0, -1), canvas]
}

function renderPreview() {
  const box = $('shots')
  box.replaceChildren()
  const cssWidth = Math.round(width / (meta.scale || window.devicePixelRatio || 1))
  box.style.maxWidth = `${cssWidth}px`
  pieces.forEach((canvas, i) => {
    if (i > 0) {
      const cut = document.createElement('div')
      cut.className = 'cut'
      cut.textContent = `${i + 1}번째 장`
      box.appendChild(cut)
    }
    box.appendChild(canvas)
  })
  if (settings.footer) box.appendChild(footerCanvas())
}

function renderFacts() {
  const total = pieces.reduce((sum, c) => sum + c.height, 0)
  const mode = meta.mode === 'full' ? '전체 페이지' : meta.mode === 'region' ? '영역 선택' : '보이는 부분'
  const facts = [mode, `${fmt.format(width)} × ${fmt.format(total)} px`]
  if (pieces.length > 1) facts.push(`${pieces.length}장으로 나눔`)
  facts.push(new Date(meta.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }))
  $('facts').replaceChildren(...facts.map((t) => Object.assign(document.createElement('span'), { textContent: t })))
  $('facts').hidden = false
}

const baseName = () => captureFileName(meta.title, meta.url, meta.createdAt)

// ── 저장·복사 ─────────────────────────────────────────────
async function saveImages(type) {
  const ext = type === 'image/png' ? 'png' : 'jpg'
  const list = outputs()
  for (let i = 0; i < list.length; i++) {
    const source = type === 'image/jpeg' ? onWhite(list[i]) : list[i]
    download(await toBlob(source, type, JPEG_QUALITY), pieceFileName(baseName(), i, list.length, ext))
    if (i < list.length - 1) await sleep(400)
  }
  toast(list.length > 1 ? `${list.length}개 파일로 저장했습니다.` : '저장했습니다.')
}

async function savePdf(button) {
  const list = outputs()
  const heights = list.map((c) => c.height)
  const total = heights.reduce((a, b) => a + b, 0)
  const plan = planPdfPages(width, total)
  const pages = []
  for (let i = 0; i < plan.pages.length; i++) {
    setLabel(button, `PDF 만드는 중 ${i + 1}/${plan.pages.length}`)
    const page = plan.pages[i]
    const { canvas, ctx } = makeCanvas(width, page.h)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, page.h)
    for (const part of sliceAcrossPieces(heights, page.y, page.h)) {
      ctx.drawImage(list[part.piece], 0, part.sy, width, part.sh, 0, part.dy, width, part.sh)
    }
    const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', JPEG_QUALITY)).arrayBuffer())
    pages.push({ jpeg, pxW: width, pxH: page.h, pageW: A4_PT.width, pageH: A4_PT.height })
    await sleep(0)
  }
  const bytes = buildPdf(pages, { title: meta.title || '캡처', createdAt: meta.createdAt })
  download(new Blob([bytes], { type: 'application/pdf' }), `${baseName()}.pdf`)
  toast(`${pages.length}쪽 PDF 로 저장했습니다.`)
}

async function copyImage() {
  const list = outputs()
  const blob = await toBlob(list[0], 'image/png')
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  } catch {
    throw new Error('클립보드에 복사하지 못했습니다. 이미지가 너무 크면 PNG 로 저장해 주세요.')
  }
  toast(list.length > 1 ? `첫 번째 장만 복사했습니다. 나머지 ${list.length - 1}장은 저장해서 쓰세요.` : '클립보드에 복사했습니다.')
}

// ── 온비짱으로 넘기기 ─────────────────────────────────────
function exec(tabId, func, args) {
  return chrome.scripting.executeScript({ target: { tabId }, func, args }).then((r) => r?.[0]?.result)
}

/** 온비짱 탭이 열리고 받을 준비가 될 때까지 기다린다. */
async function waitReady(tabId) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab) throw new Error('온비짱 탭이 닫혀 보내지 못했습니다.')
    try {
      const ready = await exec(tabId, (attr, value) => document.documentElement.getAttribute(attr) === value, [HANDOVER.READY_ATTR, HANDOVER.READY_VALUE])
      if (ready === true) return
    } catch {
      // 아직 페이지가 뜨는 중이거나 다른 주소로 넘어간 경우 — 조금 뒤 다시 본다
    }
    await sleep(400)
  }
  throw new Error('온비짱 화면이 응답하지 않습니다. 옵션에서 온비짱 주소가 맞는지, 사이트가 열리는지 확인해 주세요.')
}

function showEditError(text) {
  $('edit-error').hidden = !text
  $('edit-error-text').textContent = text || ''
}

function editProgress(ratio) {
  $('edit-progress').hidden = ratio == null
  if (ratio != null) $('edit-bar').style.width = `${Math.round(ratio * 100)}%`
}

async function sendToOnbijjang(button) {
  showEditError('')
  const target = normalizeOrigin(settings.origin)
  if (!target.ok) throw new Error(`온비짱 주소가 올바르지 않습니다. 옵션에서 다시 적어 주세요. (${target.reason})`)

  // 권한 요청은 버튼을 누른 직후에 해야 브라우저가 받아 준다.
  const granted = await chrome.permissions.request({ origins: [target.pattern] })
  if (!granted) throw new Error('온비짱 주소에 접근하는 것을 허용해야 이미지를 넘길 수 있습니다. 다시 눌러 허용해 주세요.')

  // 한 줄은 온비짱에서 편집한 뒤에 붙도록 이미지에는 넣지 않고 내용만 함께 보낸다.
  setLabel(button, '이미지 준비 중')
  const files = []
  for (let i = 0; i < pieces.length; i++) {
    const blob = await toBlob(pieces[i], 'image/png')
    if (blob.size > HANDOVER.MAX_FILE_BYTES) throw new Error('이미지가 너무 커서 넘길 수 없습니다. PNG 로 저장한 뒤 온비짱에 끌어다 놓아 주세요.')
    files.push({ name: pieceFileName(baseName(), i, pieces.length, 'png'), mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()) })
  }

  setLabel(button, '온비짱 여는 중')
  const tab = await chrome.tabs.create({ url: `${target.origin}${HANDOVER.TOOL_PATH}`, active: true })
  await waitReady(tab.id)

  const id = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const post = (message) => {
    window.postMessage(message, location.origin)
    return true
  }
  const totalChunks = files.reduce((sum, f) => sum + chunkCount(f.bytes.length), 0)
  let sent = 0
  editProgress(0)
  setLabel(button, '이미지 보내는 중')
  await exec(tab.id, post, [
    {
      type: HANDOVER.BEGIN,
      v: HANDOVER.VERSION,
      id,
      files: files.map((f) => ({ name: f.name, mime: f.mime, size: f.bytes.length, chunks: chunkCount(f.bytes.length) })),
      meta: { url: meta.url || '', title: meta.title || '', capturedAt: meta.createdAt, footer: Boolean(settings.footer) },
    },
  ])
  for (let f = 0; f < files.length; f++) {
    const { bytes } = files[f]
    const count = chunkCount(bytes.length)
    for (let i = 0; i < count; i++) {
      const [from, to] = chunkRange(i, bytes.length)
      await exec(tab.id, post, [{ type: HANDOVER.CHUNK, id, file: f, index: i, data: bytesToBase64(bytes.subarray(from, to)) }])
      editProgress(++sent / totalChunks)
    }
  }
  const ack = await exec(
    tab.id,
    (message, ackType) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          window.removeEventListener('message', onMessage)
          resolve({ ok: false, reason: '' })
        }, 10000)
        function onMessage(e) {
          if (e.source !== window || !e.data || e.data.type !== ackType || e.data.id !== message.id) return
          clearTimeout(timer)
          window.removeEventListener('message', onMessage)
          resolve({ ok: Boolean(e.data.ok), reason: String(e.data.reason || '') })
        }
        window.addEventListener('message', onMessage)
        window.postMessage(message, location.origin)
      }),
    [{ type: HANDOVER.END, id }, HANDOVER.ACK],
  )
  if (!ack?.ok) throw new Error(ack?.reason || '온비짱이 이미지를 받지 못했습니다. 온비짱 화면을 새로고침한 뒤 다시 보내 주세요.')
  toast('온비짱으로 보냈습니다.')
}

// ── 연결 ──────────────────────────────────────────────────
buttons.png.addEventListener('click', () => run(buttons.png, '저장하는 중', () => saveImages('image/png')))
buttons.jpg.addEventListener('click', () => run(buttons.jpg, '저장하는 중', () => saveImages('image/jpeg')))
buttons.pdf.addEventListener('click', () => run(buttons.pdf, 'PDF 만드는 중', () => savePdf(buttons.pdf)))
buttons.copy.addEventListener('click', () => run(buttons.copy, '복사하는 중', copyImage))
buttons.edit.addEventListener('click', async () => {
  if (busy) return
  setBusy(true, '권한 확인 중', buttons.edit)
  try {
    await sendToOnbijjang(buttons.edit)
  } catch (err) {
    showEditError(err?.message || '온비짱으로 보내지 못했습니다. 다시 시도해 주세요.')
  } finally {
    editProgress(null)
    setBusy(false, '', buttons.edit)
  }
})

$('footer').addEventListener('change', async (e) => {
  settings = await saveSettings({ footer: e.target.checked })
  if (pieces.length) renderPreview()
})
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage())
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.settings) return
  // 저장소에는 바꾼 항목만 있으므로 기본값과 합친 값을 다시 읽는다.
  settings = await loadSettings()
  $('origin').textContent = settings.origin
  $('footer').checked = Boolean(settings.footer)
  if (pieces.length) renderPreview()
})

async function init() {
  settings = await loadSettings()
  $('origin').textContent = settings.origin
  $('footer').checked = Boolean(settings.footer)

  const id = new URLSearchParams(location.search).get('id')
  meta = id ? await getCapture(id).catch(() => null) : null
  if (!meta || meta.status !== 'ready') return fail()
  sweep(meta.id)

  $('page-title').textContent = meta.title || '캡처 결과'
  $('page-url').textContent = meta.url || ''
  document.title = `${meta.title || '캡처 결과'} · 온비짱 캡처`

  try {
    pieces = await stitch()
  } catch (err) {
    if (err?.message === 'missing-shot' || err?.message === 'empty') return fail()
    return fail('캡처를 이어 붙이지 못했습니다', err?.message || '페이지가 너무 길거나 메모리가 부족할 수 있습니다. 창을 줄이거나 다시 캡처해 주세요.')
  }

  $('loading').hidden = true
  $('stage').classList.remove('center')
  $('shots').hidden = false
  renderPreview()
  renderFacts()
  if (meta.truncated) {
    $('truncated').hidden = false
    $('truncated-text').textContent = `페이지가 너무 길어 위에서부터 ${fmt.format(pieces.reduce((s, c) => s + c.height, 0))}px 까지만 담았습니다. 나머지는 그 위치로 스크롤한 뒤 '보이는 부분'이나 '영역 선택'으로 캡처해 주세요.`
  }
  if (pieces.length > 1) {
    $('split-note').hidden = false
    $('split-text').textContent = `긴 페이지라 ${pieces.length}장으로 나눴습니다. PNG·JPG 는 파일이 ${pieces.length}개 저장됩니다. 브라우저가 여러 파일 저장을 물으면 허용해 주세요. PDF 는 한 파일로 저장됩니다.`
  }
  setBusy(false)
}

init()
