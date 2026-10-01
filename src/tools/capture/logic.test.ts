import { describe, expect, it } from 'vitest'
import { MAX_SPLIT_PIECES, MIN_SIDE, NO_TRIM, baseNameOf, clampTrim, dragRect, isTrimmed, outputName, pdfPageSize, rectFromPoints, rectToTrim, splitByHeight, trimToRect } from './logic'

describe('clampTrim', () => {
  it('음수·소수·숫자가 아닌 값을 정리한다', () => {
    expect(clampTrim({ top: -5, bottom: 10.6, left: Number.NaN, right: 3 }, 1000, 2000)).toEqual({ top: 0, bottom: 11, left: 0, right: 3 })
  })
  it('위·아래를 합쳐 이미지보다 크게 잘라낼 수 없다', () => {
    const t = clampTrim({ top: 1500, bottom: 1500, left: 0, right: 0 }, 1000, 2000)
    expect(t.top).toBe(1500)
    expect(2000 - t.top - t.bottom).toBe(MIN_SIDE)
  })
  it('아주 작은 이미지도 0 보다 작아지지 않는다', () => {
    const t = clampTrim({ top: 99, bottom: 99, left: 99, right: 99 }, 4, 4)
    const r = trimToRect(t, 4, 4)
    expect(r.w).toBeGreaterThan(0)
    expect(r.h).toBeGreaterThan(0)
  })
})

describe('trim ↔ rect', () => {
  it('서로 되돌릴 수 있다', () => {
    const trim = { top: 100, bottom: 250, left: 30, right: 40 }
    const rect = trimToRect(trim, 1280, 5000)
    expect(rect).toEqual({ x: 30, y: 100, w: 1210, h: 4650 })
    expect(rectToTrim(rect, 1280, 5000)).toEqual(trim)
  })
  it('자르지 않았는지 알 수 있다', () => {
    expect(isTrimmed(NO_TRIM)).toBe(false)
    expect(isTrimmed({ ...NO_TRIM, bottom: 1 })).toBe(true)
  })
})

describe('rectFromPoints', () => {
  it('어느 방향으로 끌어도 같은 사각형', () => {
    expect(rectFromPoints({ x: 300, y: 400 }, { x: 100, y: 50 }, 1000, 1000)).toEqual({ x: 100, y: 50, w: 200, h: 350 })
  })
  it('이미지 밖으로 끌면 가장자리에 맞춘다', () => {
    expect(rectFromPoints({ x: -50, y: 900 }, { x: 500, y: 1500 }, 1000, 1000)).toEqual({ x: 0, y: 900, w: 500, h: 100 })
  })
})

describe('dragRect', () => {
  const start = { x: 100, y: 100, w: 400, h: 300 }
  it('통째로 옮길 때 크기는 그대로, 밖으로 나가지 않는다', () => {
    expect(dragRect(start, 'move', 50, -20, 1000, 1000)).toEqual({ x: 150, y: 80, w: 400, h: 300 })
    expect(dragRect(start, 'move', 9999, 9999, 1000, 1000)).toEqual({ x: 600, y: 700, w: 400, h: 300 })
    expect(dragRect(start, 'move', -9999, -9999, 1000, 1000)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
  })
  it('위쪽 가장자리를 끌면 아래쪽은 그대로', () => {
    expect(dragRect(start, 'n', 0, 50, 1000, 1000)).toEqual({ x: 100, y: 150, w: 400, h: 250 })
  })
  it('아래쪽 가장자리는 이미지 끝을 넘지 않는다', () => {
    expect(dragRect(start, 's', 0, 9999, 1000, 1000)).toEqual({ x: 100, y: 100, w: 400, h: 900 })
  })
  it('모서리는 두 방향을 함께 바꾼다', () => {
    expect(dragRect(start, 'se', 100, 100, 1000, 1000)).toEqual({ x: 100, y: 100, w: 500, h: 400 })
    expect(dragRect(start, 'nw', -50, -50, 1000, 1000)).toEqual({ x: 50, y: 50, w: 450, h: 350 })
  })
  it('반대편을 넘어 끌어도 뒤집히지 않고 최소 크기를 지킨다', () => {
    const r = dragRect(start, 'w', 9999, 0, 1000, 1000)
    expect(r.w).toBe(MIN_SIDE)
    expect(r.x + r.w).toBe(500)
    const r2 = dragRect(start, 's', 0, -9999, 1000, 1000)
    expect(r2).toEqual({ x: 100, y: 100, w: 400, h: MIN_SIDE })
  })
})

describe('splitByHeight', () => {
  it('같은 높이로 나누고 마지막은 나머지', () => {
    expect(splitByHeight(5000, 2000)).toEqual([
      { y: 0, h: 2000 },
      { y: 2000, h: 2000 },
      { y: 4000, h: 1000 },
    ])
  })
  it('높이보다 크면 한 장', () => expect(splitByHeight(800, 2000)).toEqual([{ y: 0, h: 800 }]))
  it('조각이 너무 많으면 null', () => {
    expect(splitByHeight(100 * (MAX_SPLIT_PIECES + 1), 100)).toBeNull()
    expect(splitByHeight(100 * MAX_SPLIT_PIECES, 100)).toHaveLength(MAX_SPLIT_PIECES)
  })
})

describe('결과 이름', () => {
  it('원본 이름을 살린다', () => {
    expect(baseNameOf('네이버_20261001-0907.png')).toBe('네이버_20261001-0907')
    expect(outputName('네이버', 0, 1, 'png')).toBe('네이버_편집.png')
    expect(outputName('네이버', 2, 5, 'jpg')).toBe('네이버_분할_3.jpg')
  })
  it('이름이 비면 "캡처"', () => expect(baseNameOf('???.png')).toBe('캡처'))
})

describe('pdfPageSize', () => {
  it('96dpi 기준으로 pt 로 바꾼다', () => {
    expect(pdfPageSize(1280, 800)).toEqual({ pageW: 960, pageH: 600 })
  })
  it('PDF 한계(14,400pt)를 넘으면 비율대로 줄인다', () => {
    const { pageW, pageH } = pdfPageSize(1000, 40000)
    expect(pageH).toBeCloseTo(14400)
    expect(pageW / pageH).toBeCloseTo(1000 / 40000)
  })
})
