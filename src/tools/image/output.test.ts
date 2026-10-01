import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT, outputName, resolveExport, shrinkStep } from './output'
import { adjustPixels } from './render'

const team = { team: { base: '상품', start: 1, digits: 3 } }

describe('파일 이름', () => {
  it('원본 이름에 꼬리말과 저장 형식 확장자를 붙인다', () => {
    expect(outputName('여름 신상.JPG', 0, DEFAULT_EXPORT, team)).toBe('여름 신상_편집.jpg')
    expect(outputName('photo.png', 3, { ...DEFAULT_EXPORT, format: 'image/webp', suffix: '' }, team)).toBe('photo.webp')
    expect(outputName('a.b.c.jpeg', 0, { ...DEFAULT_EXPORT, format: 'image/png', suffix: '-1000' }, team)).toBe('a.b.c-1000.png')
  })

  it('파일 이름에 쓸 수 없는 문자는 뺀다', () => {
    expect(outputName('a:b?.jpg', 0, { ...DEFAULT_EXPORT, suffix: '/x*' }, team)).toBe('abx.jpg')
    expect(outputName('.jpg', 0, { ...DEFAULT_EXPORT, suffix: '' }, team)).toBe('.jpg.jpg')
  })

  it('번호 붙이기: 팀 규칙(이름·시작 번호·자릿수)을 기본으로 쓴다', () => {
    const e = { ...DEFAULT_EXPORT, naming: 'sequence' as const }
    expect(outputName('x.jpg', 0, e, team)).toBe('상품_001.jpg')
    expect(outputName('x.jpg', 11, e, team)).toBe('상품_012.jpg')
    expect(outputName('x.jpg', 2, { ...e, seqBase: ' 가방 ', seqStart: 10, format: 'image/webp' }, team)).toBe('가방_012.webp')
    expect(outputName('x.jpg', 0, e, { team: { base: '티셔츠', start: 100, digits: 2 } })).toBe('티셔츠_100.jpg')
  })
})

describe('저장 설정 정리', () => {
  it('품질은 0–1, 용량 제한은 켰을 때만 바이트로', () => {
    expect(resolveExport(DEFAULT_EXPORT)).toEqual({ format: 'image/jpeg', quality: 0.9, maxBytes: null, shrinkToFit: false })
    expect(resolveExport({ ...DEFAULT_EXPORT, limitSize: true, targetKB: 300 }).maxBytes).toBe(307200)
    expect(resolveExport({ ...DEFAULT_EXPORT, limitSize: true, targetKB: null }).maxBytes).toBeNull()
    expect(resolveExport({ ...DEFAULT_EXPORT, quality: 500 }).quality).toBe(1)
  })
})

describe('목표 용량에 맞춰 줄이기', () => {
  it('넘은 만큼 줄이되 한 번에 절반 넘게 줄이지 않는다', () => {
    expect(shrinkStep(100, 200)).toBe(1)
    expect(shrinkStep(400, 100)).toBe(0.5)
    expect(shrinkStep(10_000, 100)).toBe(0.5)
    expect(shrinkStep(101, 100)).toBe(0.95)
    const s = shrinkStep(200, 100)
    expect(s).toBeGreaterThan(0.6)
    expect(s).toBeLessThan(0.71)
  })
})

describe('보정(대체 경로)', () => {
  const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255])

  it('100% 면 그대로', () => {
    const d = px(10, 120, 250)
    adjustPixels(d, { brightness: 100, contrast: 100, saturation: 100 })
    expect([...d]).toEqual([10, 120, 250, 255])
  })

  it('밝기는 곱하고, 채도 0 은 회색', () => {
    const d = px(100, 50, 20)
    adjustPixels(d, { brightness: 150, contrast: 100, saturation: 100 })
    expect([...d]).toEqual([150, 75, 30, 255])
    const g = px(200, 100, 0)
    adjustPixels(g, { brightness: 100, contrast: 100, saturation: 0 })
    expect(g[0]).toBe(g[1])
    expect(g[1]).toBe(g[2])
    expect(g[3]).toBe(255)
  })

  it('대비는 중간 밝기를 기준으로 벌린다', () => {
    const d = px(200, 128, 50)
    adjustPixels(d, { brightness: 100, contrast: 150, saturation: 100 })
    expect(d[0]).toBeGreaterThan(200)
    expect(Math.abs(d[1] - 128)).toBeLessThanOrEqual(1)
    expect(d[2]).toBeLessThan(50)
  })
})
