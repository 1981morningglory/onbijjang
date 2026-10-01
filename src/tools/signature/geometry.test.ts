import { describe, expect, it } from 'vitest'
import {
  boxCorners,
  cascadePosition,
  clampCenter,
  defaultItemSize,
  mapToPage,
  normalizeAngle,
  normalizeRotation,
  pdfImagePlacement,
  pdfToViewPoint,
  pdfViewSize,
  placementCorners,
  resizeFromCorner,
  rotationFromPointer,
  snapAngle,
  viewToPdfPoint,
  type Box,
  type PdfPageBox,
} from './geometry'

const ROTATIONS = [0, 90, 180, 270]
const cropped = (rotate: number, userUnit = 1): PdfPageBox => ({ view: [50, 80, 350, 480], rotate, userUnit })

describe('회전 값 정리', () => {
  it('음수·360 이상·90 의 배수가 아닌 값', () => {
    expect(normalizeRotation(-90)).toBe(270)
    expect(normalizeRotation(450)).toBe(90)
    expect(normalizeRotation(45)).toBe(0)
    expect(normalizeRotation(360)).toBe(0)
  })
  it('각도를 -180~180 으로', () => {
    expect(normalizeAngle(270)).toBe(-90)
    expect(normalizeAngle(-190)).toBe(170)
    expect(normalizeAngle(180)).toBe(180)
  })
})

describe('보이는 좌표 ↔ PDF 좌표', () => {
  it('회전에 따라 보이는 크기가 바뀐다', () => {
    expect(pdfViewSize(cropped(0))).toEqual({ width: 300, height: 400 })
    expect(pdfViewSize(cropped(90))).toEqual({ width: 400, height: 300 })
    expect(pdfViewSize(cropped(0, 2))).toEqual({ width: 600, height: 800 })
  })

  it('회전 없는 페이지: 왼쪽 위가 자르기 상자의 왼쪽 위', () => {
    expect(viewToPdfPoint(cropped(0), 0, 0)).toEqual({ x: 50, y: 480 })
    expect(viewToPdfPoint(cropped(0), 300, 400)).toEqual({ x: 350, y: 80 })
  })

  it('90도 페이지: 보이는 왼쪽 위는 PDF 의 왼쪽 아래', () => {
    expect(viewToPdfPoint(cropped(90), 0, 0)).toEqual({ x: 50, y: 80 })
    expect(viewToPdfPoint(cropped(90), 400, 300)).toEqual({ x: 350, y: 480 })
  })

  it('180·270도 페이지', () => {
    expect(viewToPdfPoint(cropped(180), 0, 0)).toEqual({ x: 350, y: 80 })
    expect(viewToPdfPoint(cropped(270), 0, 0)).toEqual({ x: 350, y: 480 })
  })

  it('왕복하면 제자리', () => {
    for (const rotate of ROTATIONS) {
      for (const userUnit of [1, 2.5]) {
        const page = cropped(rotate, userUnit)
        const p = viewToPdfPoint(page, 123.4, 56.7)
        const back = pdfToViewPoint(page, p.x, p.y)
        expect(back.x).toBeCloseTo(123.4, 6)
        expect(back.y).toBeCloseTo(56.7, 6)
      }
    }
  })

  it('뒤집힌 상자(x0 > x1)도 같은 결과', () => {
    const flipped: PdfPageBox = { view: [350, 480, 50, 80], rotate: 0, userUnit: 1 }
    expect(viewToPdfPoint(flipped, 0, 0)).toEqual({ x: 50, y: 480 })
  })
})

describe('PDF 이미지 배치', () => {
  const box: Box = { cx: 120, cy: 90, w: 80, h: 30, rot: 0 }

  it('회전 없는 경우 왼쪽 아래 모서리', () => {
    const p = pdfImagePlacement(cropped(0), box)
    expect(p.x).toBeCloseTo(50 + 120 - 40, 6)
    expect(p.y).toBeCloseTo(480 - 90 - 15, 6)
    expect(p.width).toBe(80)
    expect(p.height).toBe(30)
    expect(p.rotate).toBe(0)
  })

  it('어느 회전·기울기에서도 화면의 네 모서리와 일치한다', () => {
    for (const rotate of ROTATIONS) {
      for (const rot of [0, 30, -75, 90, 180]) {
        for (const userUnit of [1, 2]) {
          const page = cropped(rotate, userUnit)
          const item = { ...box, rot }
          const pdfCorners = placementCorners(pdfImagePlacement(page, item)).map((c) => pdfToViewPoint(page, c.x, c.y))
          const view = boxCorners(item)
          // 이미지의 (왼쪽 아래, 오른쪽 아래, 오른쪽 위, 왼쪽 위) = 화면 사각형의 (왼쪽 아래, 오른쪽 아래, 오른쪽 위, 왼쪽 위)
          const expected = [view[3], view[2], view[1], view[0]]
          pdfCorners.forEach((c, i) => {
            expect(c.x).toBeCloseTo(expected[i].x, 5)
            expect(c.y).toBeCloseTo(expected[i].y, 5)
          })
        }
      }
    }
  })
})

describe('크기 바꾸기', () => {
  const box: Box = { cx: 100, cy: 100, w: 80, h: 40, rot: 0 }

  it('오른쪽 아래를 끌면 왼쪽 위는 그대로, 비율 유지', () => {
    const next = resizeFromCorner(box, 1, 1, { x: 220, y: 160 }, 5)
    expect(next.w / next.h).toBeCloseTo(2, 6)
    expect(next.cx - next.w / 2).toBeCloseTo(60, 6)
    expect(next.cy - next.h / 2).toBeCloseTo(80, 6)
    expect(next.w).toBeGreaterThan(80)
  })

  it('기울어진 상태에서도 반대쪽 모서리가 고정된다', () => {
    const tilted = { ...box, rot: 37 }
    const anchor = boxCorners(tilted)[0]
    const next = resizeFromCorner(tilted, 1, 1, { x: 190, y: 210 }, 5)
    const after = boxCorners(next)[0]
    expect(after.x).toBeCloseTo(anchor.x, 6)
    expect(after.y).toBeCloseTo(anchor.y, 6)
    expect(next.rot).toBe(37)
    expect(next.w / next.h).toBeCloseTo(2, 6)
  })

  it('왼쪽 위를 끌면 오른쪽 아래가 고정된다', () => {
    const next = resizeFromCorner(box, -1, -1, { x: 20, y: 40 }, 5)
    expect(next.cx + next.w / 2).toBeCloseTo(140, 6)
    expect(next.cy + next.h / 2).toBeCloseTo(120, 6)
  })

  it('최소 크기 아래로 줄지 않는다', () => {
    const next = resizeFromCorner(box, 1, 1, { x: 0, y: 0 }, 10)
    expect(Math.min(next.w, next.h)).toBeCloseTo(10, 6)
  })
})

describe('회전', () => {
  it('손잡이가 위에 있으면 0도, 오른쪽이면 90도', () => {
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(0)
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(90)
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe(-90)
    expect(Math.abs(rotationFromPointer({ x: 0, y: 0 }, { x: 0, y: 10 }))).toBe(180)
  })
  it('수직·수평 근처에서 달라붙는다', () => {
    expect(snapAngle(2)).toBe(0)
    expect(snapAngle(88.5)).toBe(90)
    expect(snapAngle(10)).toBe(10)
    expect(snapAngle(22, 3, 15)).toBe(15)
    expect(snapAngle(-178)).toBe(180)
  })
})

describe('배치 도우미', () => {
  it('중심은 페이지 안에 머문다', () => {
    expect(clampCenter({ cx: -5, cy: 900 }, 600, 800)).toEqual({ cx: 0, cy: 800 })
  })

  it('같은 크기의 쪽에는 그대로 복사', () => {
    const box: Box = { cx: 10, cy: 20, w: 30, h: 40, rot: 5 }
    expect(mapToPage(box, { width: 595, height: 842 }, { width: 595.2, height: 842 })).toBe(box)
  })

  it('크기가 다른 쪽에는 비율로 옮긴다', () => {
    const box: Box = { cx: 100, cy: 200, w: 50, h: 20, rot: 0 }
    const moved = mapToPage(box, { width: 400, height: 800 }, { width: 800, height: 400 })
    expect(moved).toMatchObject({ cx: 200, cy: 100, w: 100, h: 40 })
  })

  it('처음 크기: 서명은 너비의 28%, 글자는 줄 높이 기준', () => {
    const sign = defaultItemSize('sign', 2.5, 600, 800)
    expect(sign.w).toBeCloseTo(168, 6)
    expect(sign.h).toBeCloseTo(67.2, 6)
    const text = defaultItemSize('text', 6, 600, 800)
    expect(text.h).toBeCloseTo(18, 6)
    expect(text.w).toBeCloseTo(108, 6)
  })

  it('처음 크기는 페이지의 90% 를 넘지 않는다', () => {
    const wide = defaultItemSize('text', 80, 600, 800)
    expect(wide.w).toBeCloseTo(540, 6)
    const tall = defaultItemSize('sign', 0.05, 600, 800)
    expect(tall.h).toBeCloseTo(720, 6)
  })

  it('같은 자리에 이미 있으면 비켜 놓는다', () => {
    const p = cascadePosition({ x: 100, y: 100 }, [{ x: 100, y: 100 }, { x: 120, y: 120 }], 20, 600, 800)
    expect(p).toEqual({ x: 140, y: 140 })
    expect(cascadePosition({ x: 100, y: 100 }, [], 20, 600, 800)).toEqual({ x: 100, y: 100 })
  })
})
