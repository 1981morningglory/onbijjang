/**
 * 온비짱 캡처 — 순수 계산 모음.
 * DOM 이나 chrome API 를 쓰지 않는다. 확장 프로그램(서비스 워커·결과 화면)과
 * 사이트(src/tools/capture), 단위 테스트가 같은 파일을 가져다 쓴다.
 *
 * 단위: "CSS px" 는 페이지 좌표, "px" 는 캡처 이미지의 실제 픽셀이다.
 * scale = 캡처 이미지 너비 / window.innerWidth (기기 배율 × 브라우저 확대).
 */

export const LIMITS = Object.freeze({
  /** 결과 한 장의 최대 높이(px). 브라우저 캔버스 한계(16,384) 아래로 여유를 둔다. */
  PIECE_MAX_PX: 16000,
  /** 전체 최대 높이(px). 넘으면 여기까지만 담고 알린다. */
  TOTAL_MAX_PX: 96000,
  /** 스크롤 캡처 최대 장수 */
  MAX_SHOTS: 150,
  /** chrome.tabs.captureVisibleTab 은 초당 2회까지만 허용된다. */
  CAPTURE_GAP_MS: 600,
  /** 임시 보관 시간과 개수 */
  KEEP_MS: 60 * 60 * 1000,
  KEEP_COUNT: 3,
})

export const A4_PT = Object.freeze({ width: 595.28, height: 841.89 })

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** 다음 captureVisibleTab 호출까지 기다려야 하는 시간(ms) */
export function waitBeforeCapture(lastAt, now, gap = LIMITS.CAPTURE_GAP_MS) {
  if (!lastAt) return 0
  return Math.max(0, lastAt + gap - now)
}

/** 전체 높이 한도를 CSS px 로 바꾼다. */
export function maxCssHeight(scale, totalMaxPx = LIMITS.TOTAL_MAX_PX) {
  const s = scale > 0 ? scale : 1
  return Math.floor(totalMaxPx / s)
}

/**
 * 스크롤하며 찍은 여러 장에서 각 장이 맡을 페이지 구간을 정한다.
 * 먼저 찍힌 장이 우선이다(첫 장의 고정 머리말이 뒤 장에 덮이지 않는다).
 * @param {{y:number}[]} shots 각 장을 찍을 때 화면 맨 위가 가리킨 페이지 y(CSS px)
 * @param {number} viewH 한 장이 담는 높이(CSS px)
 * @param {number} [limit] 이 y 를 넘는 부분은 버린다
 * @returns {{shot:number, from:number, to:number}[]}
 */
export function planSegments(shots, viewH, limit = Infinity) {
  const out = []
  if (!(viewH > 0)) return out
  let covered = -Infinity
  for (let i = 0; i < shots.length; i++) {
    const y = Math.max(0, Number(shots[i].y) || 0)
    const from = Math.max(y, covered)
    const to = Math.min(y + viewH, limit)
    if (to - from < 0.5) continue
    out.push({ shot: i, from, to })
    covered = to
    if (covered >= limit) break
  }
  return out
}

/** 0..total 을 max 높이 조각으로 나눈다. */
export function splitHeights(total, max) {
  const out = []
  const t = Math.max(0, Math.floor(total))
  const m = Math.max(1, Math.floor(max))
  for (let y = 0; y < t; y += m) out.push({ y, height: Math.min(m, t - y) })
  return out
}

/**
 * 이어 붙이기 계획. 각 장에서 어느 부분을 잘라 결과의 어디에 그릴지 픽셀 단위로 돌려준다.
 * @param {object} p
 * @param {{y:number}[]} p.shots
 * @param {{x:number,y:number,w:number,h:number}} p.view 스크롤 영역이 화면에서 차지하는 자리(CSS px, 스크롤바 제외)
 * @param {number} p.scale
 * @param {number} p.imgW 캡처 이미지 너비(px)
 * @param {number} p.imgH 캡처 이미지 높이(px)
 * @param {number} [p.limitCss]
 * @param {number} [p.pieceMax]
 */
export function planStitch({ shots, view, scale, imgW, imgH, limitCss = Infinity, pieceMax = LIMITS.PIECE_MAX_PX }) {
  const s = scale > 0 ? scale : 1
  const px = (v) => Math.round(v * s)
  const segs = planSegments(shots, view.h, limitCss)
  const sx = clamp(px(view.x), 0, Math.max(0, imgW - 1))
  const width = Math.max(1, Math.min(px(view.w), imgW - sx))
  if (!segs.length) return { width, height: 0, pieces: [], ops: [] }

  const base = px(segs[0].from)
  const flat = []
  let height = 0
  for (const seg of segs) {
    const dy = px(seg.from) - base
    let sh = px(seg.to) - base - dy
    if (sh <= 0) continue
    let sy = px(view.y + (seg.from - Math.max(0, shots[seg.shot].y)))
    // 반올림 때문에 이미지 끝을 1px 넘으면 빈 줄을 남기지 않고 위로 당긴다.
    if (sy + sh > imgH) sy = Math.max(0, imgH - sh)
    sh = Math.min(sh, imgH - sy)
    if (sh <= 0) continue
    flat.push({ shot: seg.shot, sx, sy, sw: width, sh, dy })
    height = Math.max(height, dy + sh)
  }

  const pieces = splitHeights(height, pieceMax)
  const ops = []
  for (const op of flat) {
    let remaining = op.sh
    let srcY = op.sy
    let dstY = op.dy
    while (remaining > 0) {
      const piece = Math.floor(dstY / pieceMax)
      const room = (piece + 1) * pieceMax - dstY
      const h = Math.min(remaining, room)
      ops.push({ piece, shot: op.shot, sx: op.sx, sy: srcY, sw: op.sw, sh: h, dx: 0, dy: dstY - piece * pieceMax })
      remaining -= h
      srcY += h
      dstY += h
    }
  }
  return { width, height, pieces, ops }
}

/** 영역 선택: 화면 좌표(CSS px) 사각형을 캡처 이미지 픽셀로 바꾸고 이미지 안으로 맞춘다. */
export function planRegion({ rect, scale, imgW, imgH }) {
  const s = scale > 0 ? scale : 1
  const x0 = clamp(Math.round(rect.x * s), 0, Math.max(0, imgW - 1))
  const y0 = clamp(Math.round(rect.y * s), 0, Math.max(0, imgH - 1))
  const x1 = clamp(Math.round((rect.x + rect.w) * s), x0 + 1, imgW)
  const y1 = clamp(Math.round((rect.y + rect.h) * s), y0 + 1, imgH)
  return { sx: x0, sy: y0, sw: x1 - x0, sh: y1 - y0 }
}

/**
 * PDF 쪽 나누기: 이미지 폭을 종이 폭에 맞추고, 종이 한 장 높이만큼씩 자른다.
 * @returns {{ sliceH:number, pages:{y:number,h:number}[] }} px 단위
 */
export function planPdfPages(width, height, pageW = A4_PT.width, pageH = A4_PT.height) {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const sliceH = Math.max(1, Math.floor((w * pageH) / pageW))
  const pages = []
  for (let y = 0; y < h; y += sliceH) pages.push({ y, h: Math.min(sliceH, h - y) })
  return { sliceH, pages }
}

/** 여러 조각(세로로 이어진 이미지들) 위에서 [y, y+h) 구간이 걸치는 조각별 범위 */
export function sliceAcrossPieces(pieceHeights, y, h) {
  const out = []
  let top = 0
  for (let i = 0; i < pieceHeights.length; i++) {
    const bottom = top + pieceHeights[i]
    const from = Math.max(y, top)
    const to = Math.min(y + h, bottom)
    if (to > from) out.push({ piece: i, sy: from - top, sh: to - from, dy: from - y })
    top = bottom
  }
  return out
}

/** 이미지 아래 한 줄(주소·시각) 띠의 크기. 이미지 폭에 비례한다. */
export function footerMetrics(width) {
  const fontPx = clamp(Math.round(width / 90), 11, 44)
  return { fontPx, height: Math.round(fontPx * 2.5), padX: Math.round(fontPx * 1.1) }
}

const pad2 = (n) => String(n).padStart(2, '0')

/** 2026-10-01 14:05 */
export function formatCaptureTime(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 이미지 아래에 넣는 한 줄 */
export function footerText(url, ms) {
  const time = `${formatCaptureTime(ms)} 캡처`
  return url ? `${url} · ${time}` : time
}

/** Windows 에서 쓸 수 없는 문자를 뺀 파일명 조각 */
export function safeName(name, fallback = '캡처') {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return cleaned || fallback
}

/** 확장자를 뺀 결과 파일명: "페이지 제목_20261001-1405" */
export function captureFileName(title, url, ms) {
  let base = safeName(title, '')
  if (!base) {
    try {
      base = safeName(new URL(url).hostname, '')
    } catch {
      base = ''
    }
  }
  if (!base) base = '캡처'
  if (base.length > 60) base = base.slice(0, 60).trim()
  const d = new Date(ms)
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`
  return `${base}_${stamp}`
}

/** 여러 장일 때 "_1", "_2" 를 붙인다. */
export function pieceFileName(base, index, count, ext) {
  return count > 1 ? `${base}_${index + 1}.${ext}` : `${base}.${ext}`
}

/**
 * 옵션에 적은 온비짱 주소를 정리한다.
 * @returns {{ok:true, origin:string, pattern:string} | {ok:false, reason:string}}
 */
export function normalizeOrigin(input) {
  let text = String(input ?? '').trim()
  if (!text) return { ok: false, reason: '주소를 입력해 주세요.' }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(text)
    text = `${local ? 'http' : 'https'}://${text}`
  }
  let u
  try {
    u = new URL(text)
  } catch {
    return { ok: false, reason: '주소 형식이 올바르지 않습니다. 예: http://localhost:5173' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'http:// 또는 https:// 로 시작하는 주소만 쓸 수 있습니다.' }
  if (u.username || u.password) return { ok: false, reason: '아이디·비밀번호가 들어간 주소는 쓸 수 없습니다.' }
  if (!u.hostname) return { ok: false, reason: '주소 형식이 올바르지 않습니다. 예: http://localhost:5173' }
  // 권한 패턴에는 포트를 넣지 않는다(같은 호스트의 모든 포트에 해당).
  return { ok: true, origin: u.origin, pattern: `${u.protocol}//${u.hostname}/*` }
}

/**
 * 지울 임시 캡처를 고른다: 오래된 것, 그리고 최신 keep 개를 넘는 것.
 * @param {{id:string, createdAt:number}[]} list
 * @returns {string[]} 지울 id
 */
export function pickExpired(list, now, maxAgeMs = LIMITS.KEEP_MS, keep = LIMITS.KEEP_COUNT) {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt)
  const out = []
  sorted.forEach((item, i) => {
    if (i >= keep || now - item.createdAt > maxAgeMs) out.push(item.id)
  })
  return out
}
