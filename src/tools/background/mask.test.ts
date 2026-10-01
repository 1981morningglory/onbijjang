import { describe, expect, it } from 'vitest'
import { blurAlpha, boxMean, colorKeyMask, coverage, detectBackgroundColor, guidedUpsample, maskBounds, resizeBilinear, thumbLayout } from './mask'
import { modelInputSize, MODELS } from './models'

function image(w: number, h: number, color: (x: number, y: number) => [number, number, number, number?]) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = color(x, y)
      rgba.set([r, g, b, a], (y * w + x) * 4)
    }
  }
  return rgba
}

const WHITE: [number, number, number] = [255, 255, 255]
const RED: [number, number, number] = [200, 30, 30]

describe('detectBackgroundColor', () => {
  it('테두리에서 가장 흔한 색', () => {
    const rgba = image(40, 30, (x, y) => (x > 10 && x < 30 && y > 8 && y < 22 ? RED : [250, 250, 248]))
    expect(detectBackgroundColor(rgba, 40, 30)).toEqual({ r: 250, g: 250, b: 248 })
  })
  it('물건이 한쪽 가장자리에 닿아 있어도 배경색을 고른다', () => {
    const rgba = image(40, 30, (x) => (x < 8 ? RED : [20, 120, 60]))
    expect(detectBackgroundColor(rgba, 40, 30)).toEqual({ r: 20, g: 120, b: 60 })
  })
})

describe('colorKeyMask', () => {
  const w = 40
  const h = 30
  // 흰 배경 위 빨간 상자, 상자 안에 흰 구멍
  const rgba = image(w, h, (x, y) => {
    const inBox = x >= 10 && x < 30 && y >= 8 && y < 22
    const inHole = x >= 18 && x < 22 && y >= 13 && y < 17
    return inBox && !inHole ? RED : WHITE
  })
  const base = { color: { r: 255, g: 255, b: 255 }, tolerance: 20, softness: 10 }

  it('배경색은 지우고 다른 색은 남긴다', () => {
    const m = colorKeyMask(rgba, w, h, { ...base, contiguous: false })
    expect(m[0]).toBe(0)
    expect(m[15 * w + 12]).toBe(255)
    // 이어진 배경만 지우기를 끄면 안쪽 구멍도 지워진다.
    expect(m[15 * w + 20]).toBe(0)
  })

  it('가장자리와 이어진 배경만 지우면 물건 안쪽의 같은 색은 남는다', () => {
    const m = colorKeyMask(rgba, w, h, { ...base, contiguous: true })
    expect(m[0]).toBe(0)
    expect(m[15 * w + 12]).toBe(255)
    expect(m[15 * w + 20]).toBe(255)
    expect(m[29 * w + 39]).toBe(0)
  })

  it('허용 범위를 넓히면 조금 다른 색도 배경으로 본다', () => {
    const shaded = image(w, h, (x) => (x < 20 ? WHITE : [228, 228, 228]))
    const narrow = colorKeyMask(shaded, w, h, { color: { r: 255, g: 255, b: 255 }, tolerance: 5, softness: 0, contiguous: false })
    const wide = colorKeyMask(shaded, w, h, { color: { r: 255, g: 255, b: 255 }, tolerance: 40, softness: 0, contiguous: false })
    expect(narrow[30]).toBe(255)
    expect(wide[30]).toBe(0)
  })

  it('이미 투명한 화소는 그대로 투명', () => {
    const t = image(4, 4, () => [10, 10, 10, 0])
    expect(coverage(colorKeyMask(t, 4, 4, { ...base, contiguous: true }))).toBe(0)
  })
})

describe('resizeBilinear · boxMean · blurAlpha', () => {
  it('고른 값은 크기를 바꿔도 그대로', () => {
    const out = resizeBilinear(new Float32Array(12).fill(0.4), 4, 3, 9, 7)
    expect(out).toHaveLength(63)
    for (const v of out) expect(v).toBeCloseTo(0.4, 6)
  })
  it('가로 변화는 확대해도 단조롭게 이어진다', () => {
    const out = resizeBilinear(Float32Array.from([0, 1]), 2, 1, 8, 1)
    for (let i = 1; i < 8; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1])
    expect(out[0]).toBe(0)
    expect(out[7]).toBe(1)
  })
  it('상자 평균은 전체 합을 보존하는 평균값', () => {
    const src = Float32Array.from([0, 0, 0, 0, 9, 0, 0, 0, 0])
    const out = boxMean(src, 3, 3, 1)
    expect(out[4]).toBeCloseTo(1, 6)
    expect(out[0]).toBeCloseTo(9 / 4, 6)
  })
  it('흐리면 경계가 완만해지고 반지름 0 은 그대로', () => {
    const a = new Uint8Array(21)
    for (let i = 10; i < 21; i++) a[i] = 255
    expect(blurAlpha(a, 21, 1, 0)).toEqual(a)
    const b = blurAlpha(a, 21, 1, 4)
    expect(b[0]).toBe(0)
    expect(b[20]).toBe(255)
    expect(b[9]).toBeGreaterThan(0)
    expect(b[10]).toBeLessThan(255)
  })
})

describe('guidedUpsample', () => {
  it('거친 마스크의 경계를 사진의 실제 경계로 끌어당긴다', () => {
    // 사진: 왼쪽 37% 어두운 물건, 나머지 밝은 배경(경계 x=59). 거친 마스크(16칸)는 경계를 x=6/16=60 근처로만 안다.
    const w = 160
    const h = 96
    const edge = 59
    const guide = image(w, h, (x) => (x < edge ? [30, 30, 30] : [235, 235, 235]))
    const cw = 16
    const ch = 10
    const coarse = new Float32Array(cw * ch)
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) coarse[y * cw + x] = x < 6 ? 1 : x === 6 ? 0.4 : 0
    const out = guidedUpsample(coarse, cw, ch, guide, w, h)
    const row = 48 * w
    expect(out[row + 20]).toBe(255)
    expect(out[row + 120]).toBe(0)
    // 경계 바로 안쪽은 남기고 바로 바깥은 지운다(단순 확대라면 바깥 3px 지점이 절반 넘게 남는다).
    expect(out[row + edge - 3]).toBeGreaterThan(200)
    const plain = resizeBilinear(coarse, cw, ch, w, h)
    expect(plain[row + edge + 3] * 255).toBeGreaterThan(140)
    expect(out[row + edge + 3]).toBeLessThan(90)
  })

  it('확신하는 곳은 사진 무늬가 있어도 그대로 둔다', () => {
    const w = 64
    const h = 64
    const guide = image(w, h, (x, y) => ((x + y) % 2 ? [0, 0, 0] : [255, 255, 255]))
    const ones = guidedUpsample(new Float32Array(64).fill(1), 8, 8, guide, w, h)
    const zeros = guidedUpsample(new Float32Array(64).fill(0), 8, 8, guide, w, h)
    expect(coverage(ones)).toBe(1)
    expect(coverage(zeros)).toBe(0)
  })
})

describe('maskBounds · thumbLayout', () => {
  it('남는 부분을 둘러싼 상자', () => {
    const a = new Uint8Array(100)
    a[3 * 10 + 2] = 255
    a[6 * 10 + 7] = 200
    a[9 * 10 + 9] = 10 // 기준보다 옅은 값은 무시
    expect(maskBounds(a, 10, 10)).toEqual({ x: 2, y: 3, w: 6, h: 4 })
    expect(maskBounds(new Uint8Array(100), 10, 10)).toBeNull()
  })
  it('RGBA 배열의 알파 채널에서도 구한다', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4)
    rgba[(1 * 4 + 2) * 4 + 3] = 255
    expect(maskBounds(rgba, 4, 4, 24, 4)).toEqual({ x: 2, y: 1, w: 1, h: 1 })
  })
  it('여백을 두고 가운데에 맞춘다', () => {
    // 세로로 긴 물건(200×400)을 1000×1000 에 여백 10%
    const l = thumbLayout({ x: 50, y: 20, w: 200, h: 400 }, 1000, 1000, 10)
    expect(l.scale).toBe(2)
    expect(l.h).toBe(800)
    expect(l.w).toBe(400)
    expect(l.x).toBe(300)
    expect(l.y).toBe(100)
  })
  it('가로로 긴 출력에도 넘치지 않는다', () => {
    const l = thumbLayout({ x: 0, y: 0, w: 300, h: 300 }, 1200, 600, 0)
    expect(l.w).toBe(600)
    expect(l.x).toBe(300)
    expect(l.y).toBe(0)
  })
})

describe('modelInputSize', () => {
  it('정사각 입력 모델은 사진 비율과 상관없이 고정 크기', () => {
    expect(modelInputSize(MODELS.fast, 4000, 3000)).toEqual({ width: 320, height: 320 })
    expect(modelInputSize(MODELS.precise, 800, 1200)).toEqual({ width: 1024, height: 1024 })
  })
  it('인물 모델은 짧은 변 512 · 32의 배수 · 긴 변 1024 이하', () => {
    expect(modelInputSize(MODELS.person, 4000, 3000)).toEqual({ width: 672, height: 512 })
    expect(modelInputSize(MODELS.person, 1000, 1000)).toEqual({ width: 512, height: 512 })
    const tall = modelInputSize(MODELS.person, 500, 3000)
    expect(tall.height).toBe(1024)
    expect(tall.width % 32).toBe(0)
    expect(tall.width).toBeGreaterThanOrEqual(160)
  })
})
