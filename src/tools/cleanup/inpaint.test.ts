import { describe, expect, it } from 'vitest'
import { dilate, inpaint, maxHoleDepth, planRegions } from './inpaint'

function makeImage(w: number, h: number, color: (x: number, y: number) => [number, number, number]) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = color(x, y)
      const i = (y * w + x) * 4
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = 255
    }
  }
  return rgba
}

function rectMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const mask = new Uint8Array(w * h)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1
  return mask
}

/** 구멍 안에서 기대 색과의 평균 차이(0–255) */
function holeError(out: Uint8ClampedArray, mask: Uint8Array, w: number, expected: (x: number, y: number) => [number, number, number]) {
  let sum = 0
  let n = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const [r, g, b] = expected(i % w, Math.floor(i / w))
    sum += Math.abs(out[i * 4] - r) + Math.abs(out[i * 4 + 1] - g) + Math.abs(out[i * 4 + 2] - b)
    n += 3
  }
  return sum / n
}

describe('dilate', () => {
  it('정사각 창으로 넓힌다', () => {
    const m = new Uint8Array(49)
    m[3 * 7 + 3] = 1
    const d = dilate(m, 7, 7, 2)
    expect(d.reduce((a, b) => a + b, 0)).toBe(25)
    expect(d[0]).toBe(0)
    expect(d[1 * 7 + 1]).toBe(1)
  })
})

describe('maxHoleDepth', () => {
  it('구멍 한가운데에서 경계까지의 거리', () => {
    const m = rectMask(40, 40, 10, 10, 30, 30)
    expect(maxHoleDepth(m, 40, 40)).toBe(10)
  })
})

describe('inpaint', () => {
  it('구멍 밖은 건드리지 않고 원본 배열도 바꾸지 않는다', () => {
    const w = 48
    const h = 40
    const paint = (x: number, y: number): [number, number, number] => [x * 5, y * 6, 90]
    const rgba = makeImage(w, h, paint)
    const copy = rgba.slice()
    const mask = rectMask(w, h, 20, 15, 28, 23)
    const out = inpaint({ rgba, mask, width: w, height: h, mode: 'texture' })
    expect(rgba).toEqual(copy)
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) continue
      expect(out[i * 4]).toBe(rgba[i * 4])
      expect(out[i * 4 + 3]).toBe(255)
    }
  })

  it('단색 배경의 얼룩은 같은 색으로 채운다', () => {
    const w = 64
    const h = 64
    const rgba = makeImage(w, h, () => [200, 120, 40])
    const mask = rectMask(w, h, 24, 24, 40, 40)
    // 구멍 안에 다른 색(지울 표시)을 넣어 둔다.
    for (let i = 0; i < mask.length; i++) if (mask[i]) rgba.set([0, 0, 0, 255], i * 4)
    for (const mode of ['texture', 'smooth'] as const) {
      const out = inpaint({ rgba, mask, width: w, height: h, mode })
      expect(holeError(out, mask, w, () => [200, 120, 40])).toBeLessThan(1)
    }
  })

  it('줄무늬를 끊기지 않게 이어 붙인다', () => {
    const w = 96
    const h = 96
    const stripe = (_x: number, y: number): [number, number, number] => (Math.floor(y / 4) % 2 ? [230, 230, 230] : [30, 60, 120])
    const rgba = makeImage(w, h, stripe)
    const mask = rectMask(w, h, 36, 34, 60, 62)
    for (let i = 0; i < mask.length; i++) if (mask[i]) rgba.set([255, 0, 0, 255], i * 4)
    const texture = inpaint({ rgba, mask, width: w, height: h, mode: 'texture' })
    const smooth = inpaint({ rgba, mask, width: w, height: h, mode: 'smooth' })
    const eTexture = holeError(texture, mask, w, stripe)
    const eSmooth = holeError(smooth, mask, w, stripe)
    expect(eTexture).toBeLessThan(12)
    // 무늬 방식이 번지게 채우는 방식보다 줄무늬를 훨씬 잘 살린다.
    expect(eTexture).toBeLessThan(eSmooth / 3)
  })

  it('가로 색 변화(그라데이션)는 매끈하게 채우면 거의 그대로 이어진다', () => {
    const w = 80
    const h = 60
    const grad = (x: number): [number, number, number] => [x * 3, 100, 255 - x * 3]
    const rgba = makeImage(w, h, grad)
    const mask = rectMask(w, h, 30, 20, 50, 40)
    for (let i = 0; i < mask.length; i++) if (mask[i]) rgba.set([0, 255, 0, 255], i * 4)
    const out = inpaint({ rgba, mask, width: w, height: h, mode: 'smooth' })
    expect(holeError(out, mask, w, grad)).toBeLessThan(4)
  })

  it('사진 모서리에 붙은 구멍도 채운다', () => {
    const w = 60
    const h = 60
    const rgba = makeImage(w, h, () => [10, 180, 90])
    const mask = rectMask(w, h, 0, 0, 14, 14)
    for (let i = 0; i < mask.length; i++) if (mask[i]) rgba.set([255, 255, 255, 255], i * 4)
    const out = inpaint({ rgba, mask, width: w, height: h, mode: 'texture' })
    expect(holeError(out, mask, w, () => [10, 180, 90])).toBeLessThan(1)
  })

  it('grow 만큼 가장자리를 넓혀 지운다', () => {
    const w = 40
    const h = 40
    const rgba = makeImage(w, h, () => [50, 50, 50])
    const mask = rectMask(w, h, 18, 18, 22, 22)
    // 칠한 곳 바로 바깥 한 줄에 남은 표시
    for (let y = 17; y < 23; y++) for (let x = 17; x < 23; x++) rgba.set([255, 255, 255, 255], (y * w + x) * 4)
    const out = inpaint({ rgba, mask, width: w, height: h, mode: 'texture', grow: 2 })
    expect(out[(17 * w + 17) * 4]).toBeLessThan(60)
  })

  it('진행률은 1 로 끝난다', () => {
    const w = 64
    const h = 64
    const rgba = makeImage(w, h, (x, y) => [(x * 7) % 255, (y * 11) % 255, 100])
    const mask = rectMask(w, h, 20, 20, 44, 44)
    const seen: number[] = []
    inpaint({ rgba, mask, width: w, height: h, mode: 'texture' }, (r) => seen.push(r))
    expect(seen.at(-1)).toBe(1)
    expect(seen.every((r, i) => i === 0 || r >= seen[i - 1])).toBe(true)
  })

  it('칠한 곳이 없으면 그대로 돌려준다', () => {
    const rgba = makeImage(8, 8, () => [1, 2, 3])
    const out = inpaint({ rgba, mask: new Uint8Array(64), width: 8, height: 8, mode: 'texture' })
    expect(out).toEqual(rgba)
  })
})

describe('planRegions', () => {
  it('떨어진 덩어리는 따로, 가까운 덩어리는 합쳐서 구역을 만든다', () => {
    const w = 1000
    const h = 600
    const mask = new Uint8Array(w * h)
    for (let y = 100; y < 120; y++) for (let x = 100; x < 130; x++) mask[y * w + x] = 1
    for (let y = 110; y < 125; y++) for (let x = 150; x < 170; x++) mask[y * w + x] = 1
    for (let y = 450; y < 470; y++) for (let x = 800; x < 830; x++) mask[y * w + x] = 1
    const regions = planRegions(mask, w, h)
    expect(regions).toHaveLength(2)
    for (const r of regions) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(w)
      expect(r.y + r.h).toBeLessThanOrEqual(h)
    }
    const first = regions.find((r) => r.x < 200)!
    expect(first.x).toBeLessThanOrEqual(100 - 48)
    expect(first.x + first.w).toBeGreaterThanOrEqual(170 + 40)
  })

  it('마스크 조각의 위치(offset)를 사진 전체 좌표로 옮긴다', () => {
    const mask = new Uint8Array(40 * 40).fill(1)
    const [r] = planRegions(mask, 40, 40, 500, 300, 2000, 1000)
    expect(r.x).toBeLessThan(500)
    expect(r.y).toBeLessThan(300)
    expect(r.x + r.w).toBeGreaterThan(540)
    expect(r.y + r.h).toBeGreaterThan(340)
    expect(r.x + r.w).toBeLessThanOrEqual(2000)
  })

  it('칠한 곳이 없으면 빈 목록', () => {
    expect(planRegions(new Uint8Array(100), 10, 10)).toEqual([])
  })
})
