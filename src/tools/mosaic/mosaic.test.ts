import { describe, expect, it } from 'vitest'
import { findSensitive, maskPreview, normalizeDigits, snapToInk, type OcrLine, type PatternId } from './detect-text'
import { blurRadius, boxFromPoints, expandBox, hitHandle, hitRegion, mergeDetections, moveBox, pixelBlock, resizeBox, tileGrid } from './regions'

const ALL: Record<PatternId, boolean> = { phone: true, rrn: true, email: true, plate: true, digits: true }

/** 낱말마다 글자 수 × 10px 너비로 한 줄을 만든다. */
function line(text: string, y = 0): OcrLine {
  let x = 0
  return {
    words: text.split(' ').map((t) => {
      const w = { text: t, x0: x, y0: y, x1: x + t.length * 10, y1: y + 20 }
      x += t.length * 10 + 10
      return w
    }),
  }
}
const kinds = (text: string, enabled = ALL) => findSensitive([line(text)], enabled).map((f) => `${f.kind}:${f.text}`)

describe('findSensitive', () => {
  it('휴대전화·유선전화·대표번호', () => {
    expect(kinds('연락처 010-1234-5678 입니다')).toEqual(['phone:010-1234-5678'])
    expect(kinds('문의 01012345678')).toEqual(['phone:01012345678'])
    expect(kinds('010 1234 5678')).toEqual(['phone:010 1234 5678'])
    expect(kinds('+82 10-1234-5678')).toEqual(['phone:+82 10-1234-5678'])
    expect(kinds('TEL 02-345-6789')).toEqual(['phone:02-345-6789'])
    expect(kinds('031)123-4567')).toEqual(['phone:031)123-4567'])
    expect(kinds('고객센터 1588-1234')).toEqual(['phone:1588-1234'])
  })

  it('주민등록번호 형식(가려진 표기 포함)', () => {
    expect(kinds('900101-1234567')).toEqual(['rrn:900101-1234567'])
    expect(kinds('주민번호 9001011234567')).toEqual(['rrn:9001011234567'])
    expect(kinds('900101-1******')).toEqual(['rrn:900101-1******'])
  })

  it('생년월일이 될 수 없는 13자리는 긴 숫자로 본다', () => {
    expect(kinds('9913991234567')).toEqual(['digits:9913991234567'])
  })

  it('이메일', () => {
    expect(kinds('메일 hong.gildong@example.co.kr 로')).toEqual(['email:hong.gildong@example.co.kr'])
    expect(kinds('abc @ naver . com')).toEqual(['email:abc @ naver . com'])
  })

  it('차량번호', () => {
    expect(kinds('12가 3456')).toEqual(['plate:12가 3456'])
    expect(kinds('123허4567')).toEqual(['plate:123허4567'])
    expect(kinds('서울 12 가 3456')).toEqual(['plate:서울 12 가 3456'])
    // 번호판에 쓰이지 않는 글자는 고르지 않는다.
    expect(kinds('12개 3456')).toEqual([])
  })

  it('계좌·카드처럼 보이는 긴 숫자', () => {
    expect(kinds('국민 123456-78-901234')).toEqual(['digits:123456-78-901234'])
    expect(kinds('1234 5678 9012 3456')).toEqual(['digits:1234 5678 9012 3456'])
    // 짧은 숫자·날짜·금액은 고르지 않는다.
    expect(kinds('2024-10-01 12,000원 3개')).toEqual([])
  })

  it('끈 종류는 찾지 않고, 겹치면 앞선 종류만 남긴다', () => {
    expect(kinds('010-1234-5678', { ...ALL, phone: false })).toEqual(['digits:010-1234-5678'])
    expect(kinds('010-1234-5678', { ...ALL, phone: false, digits: false })).toEqual([])
    expect(kinds('010-1234-5678')).toHaveLength(1)
  })

  it('글자 인식이 헷갈린 O·l 을 숫자로 본다', () => {
    expect(normalizeDigits('O1O-l234-5678')).toBe('010-1234-5678')
    expect(normalizeDigits('Hello World')).toBe('Hello World')
    expect(kinds('O1O-1234-5678').map((k) => k.split(':')[0])).toEqual(['phone'])
  })

  it('낱말의 일부만 걸치면 상자를 그만큼 좁힌다', () => {
    // "전화:010-1234-5678" 은 한 낱말(16자, 160px). 번호는 3번째 글자부터.
    const [f] = findSensitive([line('전화:010-1234-5678')], ALL)
    expect(f.text).toBe('010-1234-5678')
    // 한글 2자(각 1) + 쌍점(0.35) = 2.35, 번호 = 숫자 11자(각 0.6) + 붙임표 2개(각 0.35) = 7.3
    expect(f.x).toBeCloseTo((160 * 2.35) / 9.65, 5)
    expect(f.w).toBeCloseTo((160 * 7.3) / 9.65, 5)
    expect(f.h).toBe(20)
  })

  it('여러 낱말에 걸친 번호는 낱말 상자를 합친다', () => {
    const [f] = findSensitive([line('번호 010 1234 5678 끝', 100)], ALL)
    expect(f.x).toBe(30)
    expect(f.x + f.w).toBe(30 + 30 + 10 + 40 + 10 + 40)
    expect(f.y).toBe(100)
  })

  it('가운데를 가린 미리보기', () => {
    expect(maskPreview('010-1234-5678')).toBe('010••••••••78')
    expect(maskPreview('12가')).toBe('12가')
  })
})

describe('snapToInk', () => {
  /** 흰 바탕(240)에 주어진 가로 구간마다 검은 글자 기둥을 세운 띠 */
  function band(w: number, h: number, runs: Array<[number, number]>) {
    const lum = new Uint8Array(w * h).fill(240)
    for (const [a, b] of runs) for (let x = a; x < b; x++) for (let y = 2; y < h - 2; y++) lum[y * w + x] = 20
    return lum
  }

  it('상자 바로 옆에 붙어 있는 글자까지 넓힌다', () => {
    // 글자: 100–120, 124–144(상자 시작이 130 으로 어긋남), … 200–220 / 왼쪽 낱말은 60–84(틈 16)
    const lum = band(300, 20, [[60, 84], [100, 120], [124, 144], [148, 168], [200, 220]])
    const r = snapToInk(lum, 300, 20, 130, 160, 5, 60)
    expect(r.x0).toBe(100)
    expect(r.x1).toBe(168)
  })

  it('넓은 틈 너머의 낱말로는 넘어가지 않고, 한도보다 멀리 가지 않는다', () => {
    const lum = band(300, 20, [[60, 84], [100, 120]])
    expect(snapToInk(lum, 300, 20, 100, 120, 5, 60)).toEqual({ x0: 100, x1: 120 })
    const long = band(300, 20, [[0, 300]])
    expect(snapToInk(long, 300, 20, 150, 160, 5, 30)).toEqual({ x0: 120, x1: 190 })
  })

  it('어두운 바탕의 밝은 글자도 같은 방식으로 맞춘다', () => {
    const lum = new Uint8Array(200 * 10).fill(20)
    for (let x = 50; x < 90; x++) for (let y = 0; y < 10; y++) lum[y * 200 + x] = 230
    expect(snapToInk(lum, 200, 10, 60, 80, 4, 40)).toEqual({ x0: 50, x1: 90 })
  })
})

describe('영역 계산', () => {
  it('끌어서 그린 상자는 사진 안으로 잘린다', () => {
    expect(boxFromPoints(50, 60, -10, 20, 100, 100)).toEqual({ x: 0, y: 20, w: 50, h: 40 })
    expect(boxFromPoints(90, 90, 150, 150, 100, 100)).toEqual({ x: 90, y: 90, w: 10, h: 10 })
  })

  it('이동은 사진 밖으로 나가지 않는다', () => {
    expect(moveBox({ x: 10, y: 10, w: 30, h: 20 }, -50, 5, 100, 100)).toEqual({ x: 0, y: 15, w: 30, h: 20 })
    expect(moveBox({ x: 10, y: 10, w: 30, h: 20 }, 500, 500, 100, 100)).toEqual({ x: 70, y: 80, w: 30, h: 20 })
  })

  it('손잡이 8개로 크기를 바꾸고 최소 크기를 지킨다', () => {
    const b = { x: 20, y: 20, w: 40, h: 40 }
    expect(resizeBox(b, 'se', 10, 5, 100, 100)).toEqual({ x: 20, y: 20, w: 50, h: 45 })
    expect(resizeBox(b, 'nw', -10, -5, 100, 100)).toEqual({ x: 10, y: 15, w: 50, h: 45 })
    expect(resizeBox(b, 'n', 99, -5, 100, 100)).toEqual({ x: 20, y: 15, w: 40, h: 45 })
    expect(resizeBox(b, 'e', 999, 0, 100, 100)).toEqual({ x: 20, y: 20, w: 80, h: 40 })
    // 반대쪽 변을 넘겨 끌어도 뒤집히지 않는다.
    expect(resizeBox(b, 'w', 100, 0, 100, 100)).toEqual({ x: 54, y: 20, w: 6, h: 40 })
    expect(resizeBox(b, 's', 0, -100, 100, 100)).toEqual({ x: 20, y: 20, w: 40, h: 6 })
  })

  it('타원은 모서리를 누르면 잡히지 않는다', () => {
    const r = { x: 0, y: 0, w: 100, h: 60, shape: 'ellipse' as const }
    expect(hitRegion(r, 50, 30)).toBe(true)
    expect(hitRegion(r, 3, 3)).toBe(false)
    expect(hitRegion({ ...r, shape: 'rect' }, 3, 3)).toBe(true)
    expect(hitRegion({ ...r, shape: 'rect' }, 101, 3)).toBe(false)
  })

  it('가까운 손잡이를 찾는다', () => {
    const b = { x: 10, y: 10, w: 100, h: 50 }
    expect(hitHandle(b, 11, 9, 6)).toBe('nw')
    expect(hitHandle(b, 60, 61, 6)).toBe('s')
    expect(hitHandle(b, 110, 35, 6)).toBe('e')
    expect(hitHandle(b, 60, 35, 6)).toBeNull()
  })

  it('여백 %만큼 넓히되 사진을 넘지 않는다', () => {
    expect(expandBox({ x: 40, y: 40, w: 20, h: 20 }, 50, 100, 100)).toEqual({ x: 30, y: 30, w: 40, h: 40 })
    expect(expandBox({ x: 0, y: 0, w: 20, h: 20 }, 50, 100, 100)).toEqual({ x: 0, y: 0, w: 30, h: 30 })
  })

  it('같은 얼굴을 여러 번 찾으면 하나만 남긴다', () => {
    const merged = mergeDetections([
      { x: 100, y: 100, w: 50, h: 50, score: 0.9 },
      { x: 104, y: 98, w: 50, h: 52, score: 0.8 },
      { x: 300, y: 100, w: 40, h: 40, score: 0.7 },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0].score).toBe(0.9)
  })

  it('조각 가장자리에서 잘린 작은 상자 대신 온전한 큰 상자를 남긴다', () => {
    const merged = mergeDetections([
      { x: 100, y: 100, w: 20, h: 40, score: 0.95 },
      { x: 90, y: 95, w: 50, h: 50, score: 0.7 },
    ])
    expect(merged).toEqual([{ x: 90, y: 95, w: 50, h: 50, score: 0.7 }])
  })

  it('조각 목록은 전체 사진으로 시작하고 사진을 벗어나지 않는다', () => {
    const tiles = tileGrid(4000, 3000)
    expect(tiles[0]).toEqual({ x: 0, y: 0, w: 4000, h: 3000 })
    expect(tiles.length).toBeGreaterThan(10)
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.x + t.w).toBeLessThanOrEqual(4000)
      expect(t.y + t.h).toBeLessThanOrEqual(3000)
    }
    // 작은 사진은 전체 한 번만
    expect(tileGrid(200, 150)).toHaveLength(1)
  })

  it('가장 약한 세기에서도 충분히 가린다', () => {
    const face = { x: 0, y: 0, w: 240, h: 300 }
    expect(pixelBlock(face, 1)).toBe(20) // 짧은 변에 12칸
    expect(pixelBlock(face, 10)).toBe(80) // 3칸
    expect(pixelBlock({ x: 0, y: 0, w: 30, h: 30 }, 1)).toBe(6) // 작은 영역도 최소 6px
    expect(blurRadius(face, 1)).toBe(24)
    expect(blurRadius(face, 10)).toBeCloseTo(78, 5)
    expect(blurRadius({ x: 0, y: 0, w: 30, h: 30 }, 1)).toBe(8)
    // 범위를 벗어난 값은 잘린다.
    expect(pixelBlock(face, 0)).toBe(pixelBlock(face, 1))
    expect(blurRadius(face, 99)).toBe(blurRadius(face, 10))
  })
})
