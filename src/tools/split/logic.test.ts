import { describe, expect, it } from 'vitest'
import { MAX_PIECES, countToGrid, evenCuts, everyCuts, everyPieceCount, moveCut, pieceName, pieceRects, planCuts, rescaleCuts, sanitizeCuts, scaledSize } from './logic'

describe('countToGrid', () => {
  it('세로 우선(stack)은 행이 더 많다', () => {
    expect(countToGrid(2, 'stack')).toEqual({ rows: 2, cols: 1 })
    expect(countToGrid(4, 'stack')).toEqual({ rows: 2, cols: 2 })
    expect(countToGrid(8, 'stack')).toEqual({ rows: 4, cols: 2 })
    expect(countToGrid(16, 'stack')).toEqual({ rows: 4, cols: 4 })
  })
  it('가로 우선(side)은 열이 더 많다', () => {
    expect(countToGrid(2, 'side')).toEqual({ rows: 1, cols: 2 })
    expect(countToGrid(8, 'side')).toEqual({ rows: 2, cols: 4 })
  })
})

describe('evenCuts', () => {
  it('고르게 나눈다', () => {
    expect(evenCuts(1000, 4)).toEqual([250, 500, 750])
    expect(evenCuts(100, 3)).toEqual([33, 67])
    expect(evenCuts(100, 1)).toEqual([])
  })
  it('나눌 수 없을 만큼 작으면 가능한 만큼만', () => {
    expect(evenCuts(3, 8)).toEqual([1, 2])
    expect(evenCuts(1, 4)).toEqual([])
  })
})

describe('everyCuts', () => {
  it('마지막 조각은 남는 만큼', () => {
    expect(everyCuts(2500, 1000)).toEqual([1000, 2000])
    expect(everyCuts(2000, 1000)).toEqual([1000])
    expect(everyCuts(900, 1000)).toEqual([])
  })
  it('잘못된 간격은 나누지 않는다', () => {
    expect(everyCuts(1000, 0)).toEqual([])
    expect(everyCuts(1000, Number.NaN)).toEqual([])
  })
  it('조각 수 제한을 넘지 않는다', () => {
    expect(everyCuts(100000, 1).length).toBe(MAX_PIECES - 1)
    expect(everyPieceCount(100000, 1)).toBe(100000)
    expect(everyPieceCount(2500, 1000)).toBe(3)
  })
})

describe('sanitizeCuts / moveCut / rescaleCuts', () => {
  it('범위 밖·중복을 버리고 정렬한다', () => {
    expect(sanitizeCuts([500, 0, 1000, 250.4, 250, -3, 999], 1000)).toEqual([250, 500, 999])
  })
  it('옆 분할선을 넘지 못한다', () => {
    expect(moveCut([250, 500, 750], 1, 900, 1000)).toEqual([250, 749, 750])
    expect(moveCut([250, 500, 750], 1, 10, 1000)).toEqual([250, 251, 750])
    expect(moveCut([250, 500, 750], 0, -50, 1000)).toEqual([1, 500, 750])
    expect(moveCut([250, 500, 750], 2, 5000, 1000)).toEqual([250, 500, 999])
    expect(moveCut([250], 0, 300.6, 1000)).toEqual([301])
  })
  it('없는 분할선이면 그대로', () => {
    expect(moveCut([250], 3, 10, 1000)).toEqual([250])
  })
  it('크기가 바뀌면 같은 비율로 옮긴다', () => {
    expect(rescaleCuts([100, 300], 1000, 2000)).toEqual([200, 600])
    expect(rescaleCuts([1, 2], 1000, 10)).toEqual([])
  })
})

describe('pieceRects', () => {
  it('행 우선 순서로 빈틈·겹침 없이 덮는다', () => {
    const rects = pieceRects([400], [300, 600], 1000, 900)
    expect(rects).toHaveLength(6)
    expect(rects[0]).toEqual({ index: 0, row: 0, col: 0, x: 0, y: 0, w: 400, h: 300 })
    expect(rects[1]).toEqual({ index: 1, row: 0, col: 1, x: 400, y: 0, w: 600, h: 300 })
    expect(rects[5]).toEqual({ index: 5, row: 2, col: 1, x: 400, y: 600, w: 600, h: 300 })
    expect(rects.reduce((sum, r) => sum + r.w * r.h, 0)).toBe(1000 * 900)
  })
  it('분할선이 없으면 한 조각', () => {
    expect(pieceRects([], [], 10, 20)).toEqual([{ index: 0, row: 0, col: 0, x: 0, y: 0, w: 10, h: 20 }])
  })
})

describe('pieceName', () => {
  it('원본명_01 규칙, 조각이 많으면 자릿수가 늘어난다', () => {
    expect(pieceName('상세', 0, 4, 'png')).toBe('상세_01.png')
    expect(pieceName('상세', 11, 12, 'jpg')).toBe('상세_12.jpg')
    expect(pieceName('상세', 0, 120, 'webp')).toBe('상세_001.webp')
  })
})

describe('scaledSize', () => {
  it('배율과 너비 지정 모두 비율을 유지한다', () => {
    expect(scaledSize(800, 600, { kind: 'factor', factor: 2 })).toEqual({ width: 1600, height: 1200, scale: 2 })
    expect(scaledSize(800, 600, { kind: 'width', width: 400 })).toEqual({ width: 400, height: 300, scale: 0.5 })
  })
  it('잘못된 값은 원본 크기', () => {
    expect(scaledSize(800, 600, { kind: 'width', width: 0 })).toEqual({ width: 800, height: 600, scale: 1 })
  })
})

describe('planCuts', () => {
  const base = { count: 8, direction: 'stack' as const, rows: 3, cols: 5, everyAxis: 'height' as const, everyPx: 1000 }
  it('조각 수 모드', () => {
    expect(planCuts({ ...base, mode: 'count' }, 800, 1600)).toEqual({ xCuts: [400], yCuts: [400, 800, 1200], capped: false })
  })
  it('행×열 모드는 1–20 으로 제한한다', () => {
    const plan = planCuts({ ...base, mode: 'grid', rows: 99, cols: 0 }, 2000, 2000)
    expect(plan.yCuts).toHaveLength(19)
    expect(plan.xCuts).toHaveLength(0)
  })
  it('높이 기준·가로 기준 자르기', () => {
    expect(planCuts({ ...base, mode: 'every' }, 860, 2500)).toEqual({ xCuts: [], yCuts: [1000, 2000], capped: false })
    expect(planCuts({ ...base, mode: 'every', everyAxis: 'width', everyPx: 300 }, 860, 2500)).toEqual({ xCuts: [300, 600], yCuts: [], capped: false })
    expect(planCuts({ ...base, mode: 'every', everyPx: 1 }, 860, 2500).capped).toBe(true)
  })
})
