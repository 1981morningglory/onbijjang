import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, commit, initHistory, redo, undo } from './history'
import { DEFAULT_INK, shouldAddPoint, strokeDots, strokeWidths, type Stroke } from './ink'
import { paginate, parseDefaultFontPt, parsePageSetup, A4_SETUP } from './paginate'
import { alphaBounds, whiteToAlpha } from './raster'
import { mulberry32, sealCells, sealChars, sealLayout } from './seal'
import { isAssetLike } from './store'

describe('되돌리기', () => {
  it('변경을 쌓고 되돌리고 다시 한다', () => {
    let h = initHistory<number[]>([])
    h = commit(h, [1])
    h = commit(h, [1, 2])
    expect(canUndo(h)).toBe(true)
    h = undo(h)
    expect(h.present).toEqual([1])
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(h.present).toEqual([1, 2])
    expect(canRedo(h)).toBe(false)
  })

  it('새 변경이 생기면 다시 하기는 사라진다', () => {
    let h = commit(commit(initHistory('a'), 'b'), 'c')
    h = undo(h)
    h = commit(h, 'd')
    expect(canRedo(h)).toBe(false)
    expect(undo(h).present).toBe('b')
  })

  it('같은 묶음의 연속 변경(끌기)은 한 단계', () => {
    let h = initHistory(0)
    h = commit(h, 1, 'drag-1', 1000)
    h = commit(h, 2, 'drag-1', 1100)
    h = commit(h, 3, 'drag-1', 1200)
    expect(h.past).toEqual([0])
    expect(undo(h).present).toBe(0)
  })

  it('묶음 이름이 다르거나 시간이 지나면 새 단계', () => {
    let h = initHistory(0)
    h = commit(h, 1, 'opacity', 1000)
    h = commit(h, 2, 'size', 1100)
    h = commit(h, 3, 'size', 5000)
    expect(h.past).toEqual([0, 1, 2])
  })

  it('같은 값이면 쌓지 않고, 끝에서는 그대로', () => {
    const h = initHistory('a')
    expect(commit(h, 'a')).toBe(h)
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })

  it('되돌린 뒤 같은 묶음 이름으로 이어 붙지 않는다', () => {
    let h = initHistory(0)
    h = commit(h, 1, 't', 1000)
    h = undo(h)
    h = commit(h, 2, 't', 1050)
    expect(h.past).toEqual([0])
    expect(h.present).toBe(2)
    h = commit(h, 3, 't', 1100)
    expect(h.past).toEqual([0])
  })
})

describe('도장 글자 배치', () => {
  it('공백을 없애고 "인" 을 붙인다', () => {
    expect(sealChars(' 홍 길동 ')).toEqual(['홍', '길', '동'])
    expect(sealChars('홍길동', true)).toEqual(['홍', '길', '동', '인'])
    expect(sealChars('', true)).toEqual([])
    expect(sealChars('가'.repeat(30)).length).toBe(16)
    expect(sealChars('가'.repeat(30), true).length).toBe(16)
  })

  it('1–3자는 세로 한 줄', () => {
    expect(sealLayout(['홍'])).toEqual([['홍']])
    expect(sealLayout(['홍', '길'])).toEqual([['홍', '길']])
    expect(sealLayout(['홍', '길', '동'])).toEqual([['홍', '길', '동']])
  })

  it('4자는 2×2, 오른쪽 줄부터 읽는다', () => {
    const cols = sealLayout(['홍', '길', '동', '인'])
    expect(cols).toEqual([['홍', '길'], ['동', '인']])
    const cells = sealCells(cols, 'square', 0.05)
    const at = (ch: string) => cells.find((c) => c.ch === ch)!
    // 홍·길 은 오른쪽 줄, 동·인 은 왼쪽 줄
    expect(at('홍').x).toBeGreaterThan(at('동').x)
    expect(at('홍').x).toBeCloseTo(at('길').x, 9)
    expect(at('홍').y).toBeLessThan(at('길').y)
    expect(at('동').y).toBeLessThan(at('인').y)
    expect(at('홍').y).toBeCloseTo(at('동').y, 9)
  })

  it('글자 수가 많으면 줄을 고르게 나눈다', () => {
    expect(sealLayout(Array.from('주식회사온'))).toEqual([['주', '식', '회'], ['사', '온']])
    expect(sealLayout(Array.from('주식회사온비짱')).map((c) => c.length)).toEqual([3, 2, 2])
    expect(sealLayout(Array.from('가나다라마바사아자')).map((c) => c.length)).toEqual([3, 3, 3])
    expect(sealLayout(Array.from('가나다라마바사아자차')).map((c) => c.length)).toEqual([4, 3, 3])
    expect(sealLayout(Array.from('가'.repeat(16))).map((c) => c.length)).toEqual([4, 4, 4, 4])
  })

  it('원형 도장의 글자 칸은 테두리 안쪽 원을 벗어나지 않는다', () => {
    for (const text of ['홍', '홍길', '홍길동', '홍길동인', '주식회사온비', '가나다라마바사아자차카타파하거너']) {
      const border = 0.05
      const cells = sealCells(sealLayout(Array.from(text)), 'round', border)
      for (const c of cells) {
        for (const [x, y] of [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]]) {
          expect(Math.hypot(x - 0.5, y - 0.5)).toBeLessThanOrEqual(0.5 - border + 1e-9)
        }
      }
    }
  })

  it('사각 도장의 글자 칸은 테두리 안쪽에 있다', () => {
    const cells = sealCells(sealLayout(Array.from('주식회사온비')), 'square', 0.06)
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0.06)
      expect(c.y).toBeGreaterThanOrEqual(0.06)
      expect(c.x + c.w).toBeLessThanOrEqual(0.94 + 1e-9)
      expect(c.y + c.h).toBeLessThanOrEqual(0.94 + 1e-9)
    }
    // 글자 수가 적은 줄은 칸이 길어져 줄 전체를 채운다
    const left = cells.filter((c) => c.ch === '온' || c.ch === '비')
    expect(left).toHaveLength(2)
  })

  it('닳은 무늬는 같은 씨앗이면 같다', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seq = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(seq)
    for (const v of seq) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('손글씨 선', () => {
  const line = (n: number, dx: number, dt: number): Stroke => Array.from({ length: n }, (_, i) => ({ x: 0.1 + i * dx, y: 0.2, t: i * dt }))

  it('빠르게 그으면 가늘고 천천히 그으면 굵다', () => {
    const slow = strokeWidths(line(20, 0.004, 16))
    const fast = strokeWidths(line(20, 0.04, 16))
    expect(slow[10]).toBeGreaterThan(fast[10] * 1.3)
  })

  it('굵기는 정해진 범위 안이고 이웃 점끼리 급하게 변하지 않는다', () => {
    const stroke: Stroke = []
    let x = 0.1
    for (let i = 0; i < 40; i++) {
      x += i % 7 === 0 ? 0.05 : 0.003
      stroke.push({ x, y: 0.3, t: i * 16 })
    }
    const widths = strokeWidths(stroke)
    const min = DEFAULT_INK.maxWidth * DEFAULT_INK.thin
    for (let i = 0; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(min - 1e-12)
      expect(widths[i]).toBeLessThanOrEqual(DEFAULT_INK.maxWidth + 1e-12)
      if (i > 0 && i < widths.length - 2) expect(Math.abs(widths[i] - widths[i - 1])).toBeLessThanOrEqual((DEFAULT_INK.maxWidth - min) * 0.5 + 1e-12)
    }
  })

  it('펜 필압이 있으면 필압을 따른다', () => {
    const stroke: Stroke = [
      { x: 0.1, y: 0.1, t: 0, p: 0.1 },
      { x: 0.2, y: 0.1, t: 16, p: 0.1 },
      { x: 0.3, y: 0.1, t: 32, p: 1 },
      { x: 0.4, y: 0.1, t: 48, p: 1 },
      { x: 0.5, y: 0.1, t: 64, p: 1 },
    ]
    const w = strokeWidths(stroke)
    expect(w[4]).toBeGreaterThan(w[0] * 1.5)
  })

  it('점 하나는 동그란 점이 된다', () => {
    const dots = strokeDots([{ x: 0.5, y: 0.25, t: 0 }])
    expect(dots).toHaveLength(1)
    expect(dots[0].r).toBeGreaterThan(0)
  })

  it('곡선 위의 원은 끊기지 않고 양 끝점을 지난다', () => {
    const stroke: Stroke = [
      { x: 0.1, y: 0.1, t: 0 },
      { x: 0.3, y: 0.25, t: 30 },
      { x: 0.5, y: 0.1, t: 60 },
      { x: 0.7, y: 0.3, t: 90 },
    ]
    const dots = strokeDots(stroke)
    expect(dots[0].x).toBeCloseTo(0.1, 9)
    expect(dots[0].y).toBeCloseTo(0.1, 9)
    expect(dots[dots.length - 1].x).toBeCloseTo(0.7, 9)
    expect(dots[dots.length - 1].y).toBeCloseTo(0.3, 9)
    for (let i = 1; i < dots.length; i++) {
      const gap = Math.hypot(dots[i].x - dots[i - 1].x, dots[i].y - dots[i - 1].y)
      expect(gap).toBeLessThanOrEqual(Math.max(dots[i].r, dots[i - 1].r) + 1e-9)
    }
  })

  it('너무 가까운 점은 버린다', () => {
    const stroke: Stroke = [{ x: 0.5, y: 0.5, t: 0 }]
    expect(shouldAddPoint(stroke, { x: 0.5005, y: 0.5, t: 5 })).toBe(false)
    expect(shouldAddPoint(stroke, { x: 0.51, y: 0.5, t: 5 })).toBe(true)
    expect(shouldAddPoint([], { x: 0, y: 0, t: 0 })).toBe(true)
  })
})

describe('이미지 픽셀 처리', () => {
  const px = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat())

  it('불투명한 영역만 찾는다', () => {
    // 4×3, (1,1) 과 (2,1) 만 불투명
    const data = new Uint8ClampedArray(4 * 3 * 4)
    data[(1 * 4 + 1) * 4 + 3] = 255
    data[(1 * 4 + 2) * 4 + 3] = 200
    expect(alphaBounds(data, 4, 3)).toEqual({ x: 1, y: 1, w: 2, h: 1 })
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull()
  })

  it('흰 배경은 투명, 검은 잉크는 그대로', () => {
    const data = px([255, 255, 255, 255], [250, 248, 252, 255], [10, 10, 10, 255], [20, 30, 160, 255])
    whiteToAlpha(data, 235)
    expect(data[3]).toBe(0)
    expect(data[7]).toBe(0)
    expect(Array.from(data.slice(8, 12))).toEqual([10, 10, 10, 255])
    // 파란 잉크(가장 어두운 채널이 낮음)도 남는다
    expect(Array.from(data.slice(12, 16))).toEqual([20, 30, 160, 255])
  })

  it('경계의 회색은 반투명한 검정으로 되돌린다', () => {
    // 검정이 50% 섞인 흰색(약 205) — threshold 235, soft 60 이면 keep = 0.5
    const data = px([205, 205, 205, 255])
    whiteToAlpha(data, 235, 60)
    expect(data[3]).toBeGreaterThan(110)
    expect(data[3]).toBeLessThan(145)
    expect(data[0]).toBeLessThan(160)
  })

  it('이미 투명한 픽셀은 건드리지 않는다', () => {
    const data = px([255, 255, 255, 0])
    whiteToAlpha(data, 200)
    expect(Array.from(data)).toEqual([255, 255, 255, 0])
  })
})

describe('Word 쪽 나누기', () => {
  const lines = (count: number, height: number, gap: number) => Array.from({ length: count }, (_, i) => ({ top: i * (height + gap), bottom: i * (height + gap) + height }))

  it('한 쪽에 다 들어가면 한 쪽', () => {
    expect(paginate(lines(5, 20, 10), [], [], 150, 1000)).toEqual([{ start: 0, end: 150 }])
  })

  it('글줄 중간에서 자르지 않는다', () => {
    const hard = lines(10, 20, 10) // 0-20, 30-50, … 270-290
    const pages = paginate(hard, [], [], 300, 100)
    // 쪽 높이 100 이면 90-110 줄이 걸리므로 90 에서 자른다
    expect(pages[0]).toEqual({ start: 0, end: 90 })
    for (const p of pages) {
      expect(p.end - p.start).toBeLessThanOrEqual(100 + 1e-9)
      for (const l of hard) expect(l.top < p.end - 0.5 && l.bottom > p.end + 0.5).toBe(false)
    }
    expect(pages[pages.length - 1].end).toBe(300)
    // 빈틈없이 이어진다
    pages.slice(1).forEach((p, i) => expect(p.start).toBe(pages[i].end))
  })

  it('표의 행은 되도록 통째로 다음 쪽으로 넘긴다', () => {
    const hard = [{ top: 80, bottom: 95 }, { top: 100, bottom: 115 }]
    const soft = [{ top: 70, bottom: 130 }]
    expect(paginate(hard, soft, [], 300, 100)[0]).toEqual({ start: 0, end: 70 })
  })

  it('쪽보다 큰 행은 글줄만 지켜서 자른다', () => {
    const hard = lines(20, 20, 10)
    const soft = [{ top: 0, bottom: 590 }]
    const pages = paginate(hard, soft, [], 590, 100)
    expect(pages[0]).toEqual({ start: 0, end: 90 })
  })

  it('쪽보다 큰 그림은 어쩔 수 없이 쪽 높이에서 자른다', () => {
    const pages = paginate([{ top: 0, bottom: 250 }], [], [], 250, 100)
    expect(pages).toEqual([{ start: 0, end: 100 }, { start: 100, end: 200 }, { start: 200, end: 250 }])
  })

  it('문서의 쪽 나눔을 따른다', () => {
    const pages = paginate(lines(4, 20, 10), [], [60], 120, 100)
    expect(pages).toEqual([{ start: 0, end: 60 }, { start: 60, end: 120 }])
  })

  it('쪽 수 한도를 넘으면 멈춘다', () => {
    expect(paginate([], [], [], 100000, 100, 5)).toHaveLength(5)
  })

  it('용지 크기와 여백을 읽는다', () => {
    const xml = `<w:body><w:p/><w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1701" w:right="1440" w:bottom="1440" w:left="1134" w:header="851"/></w:sectPr></w:body>`
    expect(parsePageSetup(xml)).toEqual({ width: 1123, height: 794, margin: { top: 113, right: 96, bottom: 96, left: 76 } })
  })

  it('구역이 여러 개면 마지막 구역, 정보가 없으면 A4', () => {
    const xml = `<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>`
    expect(parsePageSetup(xml).width).toBe(794)
    expect(parsePageSetup('<w:body/>')).toEqual(A4_SETUP)
    expect(parsePageSetup('<w:sectPr><w:pgSz w:w="5" w:h="abc"/></w:sectPr>')).toMatchObject({ width: 794, height: 1123 })
  })

  it('기본 글자 크기를 읽는다', () => {
    expect(parseDefaultFontPt('<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>')).toBe(11)
    expect(parseDefaultFontPt('<w:styles/>')).toBe(10)
    expect(parseDefaultFontPt('<w:docDefaults><w:sz w:val="400"/></w:docDefaults>')).toBe(10)
  })
})

describe('보관함에서 온 서명 확인', () => {
  const ok = { src: 'data:image/png;base64,iVBORw0KGgo=', tint: '#c8102e', aspect: 1, kind: 'seal' }
  it('모양이 맞으면 통과', () => {
    expect(isAssetLike(ok)).toBe(true)
    expect(isAssetLike({ ...ok, tint: null })).toBe(true)
  })
  it('이미지가 아니거나 값이 이상하면 거른다', () => {
    expect(isAssetLike({ ...ok, src: 'https://example.com/a.png' })).toBe(false)
    expect(isAssetLike({ ...ok, src: 'data:image/svg+xml;base64,AAAA' })).toBe(false)
    expect(isAssetLike({ ...ok, src: 'data:image/png;base64,AAAA" onerror="x' })).toBe(false)
    expect(isAssetLike({ ...ok, tint: 'red' })).toBe(false)
    expect(isAssetLike({ ...ok, aspect: 0 })).toBe(false)
    expect(isAssetLike({ ...ok, kind: 'other' })).toBe(false)
    expect(isAssetLike(null)).toBe(false)
  })
})
