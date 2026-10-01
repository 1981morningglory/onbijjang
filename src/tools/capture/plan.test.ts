import { describe, expect, it } from 'vitest'
import {
  A4_PT, LIMITS, captureFileName, footerMetrics, footerText, formatCaptureTime, maxCssHeight, normalizeOrigin, pickExpired, pieceFileName,
  planPdfPages, planRegion, planSegments, planStitch, safeName, sliceAcrossPieces, splitHeights, waitBeforeCapture,
} from '../../../extension/capture/lib/plan.js'

/** 스크롤 캡처를 흉내 낸다: 서비스 워커와 같은 규칙으로 위치를 정한다. */
function simulateShots(pageH: number, viewH: number) {
  const maxTop = Math.max(0, pageH - viewH)
  const shots: Array<{ y: number }> = []
  let y = 0
  for (let i = 0; i < LIMITS.MAX_SHOTS; i++) {
    const actual = Math.min(y, maxTop)
    shots.push({ y: actual })
    const end = actual + viewH
    if (end >= pageH - 1) break
    y = end
  }
  return shots
}

/**
 * 계획대로 그렸을 때 결과의 각 줄이 페이지의 몇 번째 줄(px)에서 왔는지 되짚는다.
 * 캡처 이미지의 줄 r 은 페이지 줄 (shot.y + (r/scale) - view.y) 에 해당한다.
 */
function reconstruct(plan: ReturnType<typeof planStitch>, shots: Array<{ y: number }>, view: { y: number }, scale: number, pieceMax: number) {
  const rows = new Array<number>(plan.height).fill(-1)
  for (const op of plan.ops) {
    for (let k = 0; k < op.sh; k++) {
      const dest = op.piece * pieceMax + op.dy + k
      expect(rows[dest], `줄 ${dest} 이 두 번 그려짐`).toBe(-1)
      rows[dest] = shots[op.shot].y * scale + (op.sy + k) - view.y * scale
    }
  }
  return rows
}

describe('waitBeforeCapture', () => {
  it('첫 호출은 기다리지 않는다', () => expect(waitBeforeCapture(0, 1000)).toBe(0))
  it('간격이 모자라면 남은 만큼 기다린다', () => {
    expect(waitBeforeCapture(1000, 1200, 600)).toBe(400)
    expect(waitBeforeCapture(1000, 1700, 600)).toBe(0)
  })
  it('기본 간격은 초당 2회 제한보다 길다', () => expect(LIMITS.CAPTURE_GAP_MS).toBeGreaterThan(500))
})

describe('maxCssHeight', () => {
  it('배율이 높을수록 담을 수 있는 높이가 줄어든다', () => {
    expect(maxCssHeight(1)).toBe(LIMITS.TOTAL_MAX_PX)
    expect(maxCssHeight(2)).toBe(LIMITS.TOTAL_MAX_PX / 2)
    expect(maxCssHeight(0)).toBe(LIMITS.TOTAL_MAX_PX)
  })
})

describe('planSegments', () => {
  it('한 화면에 다 들어오면 한 구간', () => {
    expect(planSegments([{ y: 0 }], 800)).toEqual([{ shot: 0, from: 0, to: 800 }])
  })
  it('마지막 장은 앞 장과 겹치는 부분을 빼고 아래쪽만 쓴다', () => {
    // 페이지 2000, 화면 800 → 0, 800, 1200(끝에 맞춤)
    expect(planSegments([{ y: 0 }, { y: 800 }, { y: 1200 }], 800)).toEqual([
      { shot: 0, from: 0, to: 800 },
      { shot: 1, from: 800, to: 1600 },
      { shot: 2, from: 1600, to: 2000 },
    ])
  })
  it('먼저 찍힌 장이 우선이라 첫 장(고정 머리말 포함)은 통째로 남는다', () => {
    const segs = planSegments([{ y: 0 }, { y: 300 }], 800)
    expect(segs[0]).toEqual({ shot: 0, from: 0, to: 800 })
    expect(segs[1]).toEqual({ shot: 1, from: 800, to: 1100 })
  })
  it('더 내려가지 못한 장은 버린다', () => {
    expect(planSegments([{ y: 0 }, { y: 0 }], 800)).toHaveLength(1)
  })
  it('한도를 넘는 부분은 자른다', () => {
    const segs = planSegments([{ y: 0 }, { y: 800 }, { y: 1600 }], 800, 1000)
    expect(segs).toEqual([
      { shot: 0, from: 0, to: 800 },
      { shot: 1, from: 800, to: 1000 },
    ])
  })
  it('화면 높이가 0 이면 빈 계획', () => expect(planSegments([{ y: 0 }], 0)).toEqual([]))
})

describe('splitHeights', () => {
  it('최대 높이로 나누고 마지막은 나머지', () => {
    expect(splitHeights(2500, 1000)).toEqual([
      { y: 0, height: 1000 },
      { y: 1000, height: 1000 },
      { y: 2000, height: 500 },
    ])
  })
  it('딱 떨어지면 빈 조각이 생기지 않는다', () => expect(splitHeights(2000, 1000)).toHaveLength(2))
  it('0 이면 조각 없음', () => expect(splitHeights(0, 1000)).toEqual([]))
})

describe('planStitch', () => {
  const view = { x: 0, y: 0, w: 1265, h: 800 }

  it.each([1, 2, 3])('배율 %i: 페이지의 모든 줄이 빠짐없이, 한 번씩, 제 위치에 그려진다', (scale) => {
    const pageH = 4321
    const shots = simulateShots(pageH, view.h)
    const plan = planStitch({ shots, view, scale, imgW: 1280 * scale, imgH: view.h * scale })
    expect(plan.width).toBe(1265 * scale)
    expect(plan.height).toBe(pageH * scale)
    const rows = reconstruct(plan, shots, view, scale, LIMITS.PIECE_MAX_PX)
    rows.forEach((src, dest) => expect(src).toBe(dest))
  })

  it.each([1.25, 1.5, 1.1, 0.9])('소수 배율 %f: 틈이나 겹침 없이 이어지고 오차는 1px 이내', (scale) => {
    const pageH = 5003
    const shots = simulateShots(pageH, view.h)
    const imgH = Math.round(view.h * scale)
    const plan = planStitch({ shots, view, scale, imgW: Math.round(1280 * scale), imgH })
    expect(plan.height).toBe(Math.round(pageH * scale))
    const rows = reconstruct(plan, shots, view, scale, LIMITS.PIECE_MAX_PX)
    rows.forEach((src, dest) => {
      expect(src).toBeGreaterThanOrEqual(0)
      expect(Math.abs(src - dest)).toBeLessThanOrEqual(1.0001)
    })
    for (const op of plan.ops) {
      expect(op.sy).toBeGreaterThanOrEqual(0)
      expect(op.sy + op.sh).toBeLessThanOrEqual(imgH)
    }
  })

  it('스크롤바 영역(화면 오른쪽 끝)은 결과에 넣지 않는다', () => {
    const plan = planStitch({ shots: [{ y: 0 }], view, scale: 2, imgW: 2560, imgH: 1600 })
    expect(plan.ops[0]).toMatchObject({ sx: 0, sw: 2530 })
  })

  it('본문만 따로 스크롤되는 페이지: 그 영역만 잘라 이어 붙인다', () => {
    const inner = { x: 240, y: 64, w: 1000, h: 600 }
    const shots = simulateShots(1500, inner.h)
    const plan = planStitch({ shots, view: inner, scale: 2, imgW: 2560, imgH: 1440 })
    expect(plan.width).toBe(2000)
    expect(plan.height).toBe(3000)
    for (const op of plan.ops) expect(op.sx).toBe(480)
    expect(plan.ops[0]).toMatchObject({ shot: 0, sy: 128, sh: 1200, dy: 0 })
    const rows = reconstruct(plan, shots, inner, 2, LIMITS.PIECE_MAX_PX)
    rows.forEach((src, dest) => expect(src).toBe(dest))
  })

  it('캔버스 한계를 넘으면 여러 장으로 나누고, 경계에 걸친 구간은 둘로 쪼갠다', () => {
    const pieceMax = 2000
    const shots = simulateShots(5300, view.h)
    const plan = planStitch({ shots, view, scale: 1, imgW: 1280, imgH: 800, pieceMax })
    expect(plan.pieces).toEqual([
      { y: 0, height: 2000 },
      { y: 2000, height: 2000 },
      { y: 4000, height: 1300 },
    ])
    for (const op of plan.ops) expect(op.dy + op.sh).toBeLessThanOrEqual(plan.pieces[op.piece].height)
    const rows = reconstruct(plan, shots, view, 1, pieceMax)
    rows.forEach((src, dest) => expect(src).toBe(dest))
  })

  it('기본 조각 높이는 캔버스 안전 한계(16,384px) 안이다', () => {
    const shots = simulateShots(40000, view.h)
    const plan = planStitch({ shots, view, scale: 1, imgW: 1280, imgH: 800 })
    expect(plan.pieces).toHaveLength(3)
    for (const p of plan.pieces) expect(p.height).toBeLessThanOrEqual(16384)
  })

  it('높이 한도를 주면 거기까지만 담는다', () => {
    const shots = simulateShots(10000, view.h)
    const plan = planStitch({ shots, view, scale: 2, imgW: 2560, imgH: 1600, limitCss: 3000 })
    expect(plan.height).toBe(6000)
  })

  it('찍힌 장이 없으면 빈 결과', () => {
    expect(planStitch({ shots: [], view, scale: 1, imgW: 1280, imgH: 800 })).toMatchObject({ height: 0, pieces: [], ops: [] })
  })
})

describe('planRegion', () => {
  it('화면 좌표를 배율만큼 키운다', () => {
    expect(planRegion({ rect: { x: 10, y: 20, w: 300, h: 200 }, scale: 2, imgW: 2560, imgH: 1600 })).toEqual({ sx: 20, sy: 40, sw: 600, sh: 400 })
  })
  it('이미지 밖으로 나간 부분은 잘라 맞춘다', () => {
    expect(planRegion({ rect: { x: 1200, y: 700, w: 300, h: 300 }, scale: 1, imgW: 1280, imgH: 800 })).toEqual({ sx: 1200, sy: 700, sw: 80, sh: 100 })
  })
  it('아무리 작아도 1px 은 남긴다', () => {
    const r = planRegion({ rect: { x: 5000, y: 5000, w: 0, h: 0 }, scale: 1, imgW: 100, imgH: 100 })
    expect(r.sw).toBeGreaterThanOrEqual(1)
    expect(r.sh).toBeGreaterThanOrEqual(1)
    expect(r.sx + r.sw).toBeLessThanOrEqual(100)
    expect(r.sy + r.sh).toBeLessThanOrEqual(100)
  })
})

describe('planPdfPages', () => {
  it('A4 비율로 한 쪽 높이를 정한다', () => {
    const { sliceH, pages } = planPdfPages(1000, 3000)
    expect(sliceH).toBe(Math.floor((1000 * A4_PT.height) / A4_PT.width))
    expect(sliceH).toBe(1414)
    expect(pages).toEqual([
      { y: 0, h: 1414 },
      { y: 1414, h: 1414 },
      { y: 2828, h: 172 },
    ])
  })
  it('쪽을 다 합치면 원래 높이', () => {
    const { pages } = planPdfPages(1265, 54321)
    expect(pages.reduce((s, p) => s + p.h, 0)).toBe(54321)
    pages.forEach((p, i) => i > 0 && expect(p.y).toBe(pages[i - 1].y + pages[i - 1].h))
  })
  it('한 쪽보다 짧으면 한 쪽', () => expect(planPdfPages(1000, 500).pages).toEqual([{ y: 0, h: 500 }]))
})

describe('sliceAcrossPieces', () => {
  it('한 조각 안의 구간', () => {
    expect(sliceAcrossPieces([1000, 1000], 100, 300)).toEqual([{ piece: 0, sy: 100, sh: 300, dy: 0 }])
  })
  it('두 조각에 걸친 구간은 둘로 나뉜다', () => {
    expect(sliceAcrossPieces([1000, 1000], 900, 300)).toEqual([
      { piece: 0, sy: 900, sh: 100, dy: 0 },
      { piece: 1, sy: 0, sh: 200, dy: 100 },
    ])
  })
  it('끝을 넘는 부분은 없다', () => {
    expect(sliceAcrossPieces([1000], 900, 300)).toEqual([{ piece: 0, sy: 900, sh: 100, dy: 0 }])
  })
})

describe('footer', () => {
  it('글자 크기는 폭에 비례하되 너무 작거나 크지 않다', () => {
    expect(footerMetrics(200).fontPx).toBe(11)
    expect(footerMetrics(1280).fontPx).toBe(14)
    expect(footerMetrics(2560).fontPx).toBe(28)
    expect(footerMetrics(20000).fontPx).toBe(44)
    expect(footerMetrics(1280).height).toBe(35)
  })
  it('주소와 시각을 한 줄로', () => {
    const at = new Date(2026, 9, 1, 14, 5).getTime()
    expect(formatCaptureTime(at)).toBe('2026-10-01 14:05')
    expect(footerText('https://example.com/a', at)).toBe('https://example.com/a · 2026-10-01 14:05 캡처')
    expect(footerText('', at)).toBe('2026-10-01 14:05 캡처')
  })
})

describe('파일 이름', () => {
  const at = new Date(2026, 9, 1, 9, 7).getTime()
  it('페이지 제목과 날짜로 만든다', () => {
    expect(captureFileName('네이버', 'https://www.naver.com', at)).toBe('네이버_20261001-0907')
  })
  it('쓸 수 없는 문자를 뺀다', () => {
    expect(safeName('a/b:c*d?"e<f>g|h')).toBe('a b c d e f g h')
    expect(safeName('  끝에 점...  ')).toBe('끝에 점')
    expect(captureFileName('가격: 1/2 <할인>', '', at)).toBe('가격 1 2 할인_20261001-0907')
  })
  it('제목이 없으면 주소의 호스트, 그것도 없으면 "캡처"', () => {
    expect(captureFileName('', 'https://shop.example.com/x', at)).toBe('shop.example.com_20261001-0907')
    expect(captureFileName('', 'not a url', at)).toBe('캡처_20261001-0907')
    expect(captureFileName(null, null, at)).toBe('캡처_20261001-0907')
  })
  it('너무 긴 제목은 줄인다', () => {
    expect(captureFileName('가'.repeat(200), '', at).length).toBeLessThanOrEqual(60 + 14)
  })
  it('여러 장이면 번호를 붙인다', () => {
    expect(pieceFileName('a', 0, 1, 'png')).toBe('a.png')
    expect(pieceFileName('a', 1, 3, 'jpg')).toBe('a_2.jpg')
  })
})

describe('normalizeOrigin', () => {
  it('기본 주소', () => {
    expect(normalizeOrigin('http://localhost:5173')).toEqual({ ok: true, origin: 'http://localhost:5173', pattern: 'http://localhost/*' })
  })
  it('경로·끝 슬래시는 버리고 권한 패턴에는 포트를 넣지 않는다', () => {
    expect(normalizeOrigin(' https://tools.example.co.kr:8443/tools/capture?x=1 ')).toEqual({ ok: true, origin: 'https://tools.example.co.kr:8443', pattern: 'https://tools.example.co.kr/*' })
  })
  it('http:// 를 빼고 적어도 알아듣는다', () => {
    expect(normalizeOrigin('localhost:5173')).toMatchObject({ ok: true, origin: 'http://localhost:5173' })
    expect(normalizeOrigin('192.168.0.10:8080')).toMatchObject({ ok: true, origin: 'http://192.168.0.10:8080' })
    expect(normalizeOrigin('onbijjang.example.com')).toMatchObject({ ok: true, origin: 'https://onbijjang.example.com' })
  })
  it('웹 주소가 아니면 거절하고 이유를 알려 준다', () => {
    for (const bad of ['', '   ', 'ftp://example.com', 'chrome://extensions', 'javascript://x', 'http://', 'https://user:pw@example.com']) {
      const r = normalizeOrigin(bad)
      expect(r.ok, bad).toBe(false)
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
    }
  })
  it('권한 패턴은 manifest 의 optional_host_permissions 범위 안이다', () => {
    for (const input of ['http://localhost:5173', 'https://a.b.c']) {
      const r = normalizeOrigin(input)
      expect(r.ok && /^https?:\/\/[^/*:]+\/\*$/.test(r.pattern)).toBe(true)
    }
  })
})

describe('pickExpired', () => {
  const now = 10_000_000
  it('오래된 것을 지운다', () => {
    const list = [
      { id: 'new', createdAt: now - 1000 },
      { id: 'old', createdAt: now - LIMITS.KEEP_MS - 1 },
    ]
    expect(pickExpired(list, now)).toEqual(['old'])
  })
  it('최신 몇 개만 남긴다', () => {
    const list = [1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, createdAt: now - n * 1000 }))
    expect(pickExpired(list, now, LIMITS.KEEP_MS, 3)).toEqual(['c4', 'c5'])
  })
  it('지울 것이 없으면 빈 목록', () => expect(pickExpired([{ id: 'a', createdAt: now }], now)).toEqual([]))
})
