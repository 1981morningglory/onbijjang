import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BATCH, EMPTY_EDITS, applyMatrix, boxCorners, clampRect, dragCrop, effectiveCrop, fitRatio, flipView, hashSeed, hitTest, inscribedRect,
  invert, isEdited, moveObject, mulberry32, orientationMatrix, orientedSize, photoSeed, planOutput, plannedSize, reorient, resizeBox, resolveBatch,
  rotateQuarter, setAngle, toLocal,
} from './geometry'
import type { Annotation, Box, LineObject, PhotoEdits, ShapeObject, TextObject } from './types'

const W = 400
const H = 300
const batch = (patch: Partial<typeof DEFAULT_BATCH> = {}) => resolveBatch({ ...DEFAULT_BATCH, ...patch })
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

const rect: ShapeObject = { id: 'r', type: 'rect', cx: 100, cy: 50, w: 40, h: 20, rotation: 0, color: '#ff0000', width: 4, fill: false }
const text: TextObject = { id: 't', type: 'text', cx: 300, cy: 200, rotation: 0, text: '가', font: 'gothic', size: 20, color: '#fff', bold: true, outline: 0, outlineColor: '#000', background: false, backgroundColor: '#000' }
const arrow: LineObject = { id: 'a', type: 'arrow', x1: 10, y1: 20, x2: 110, y2: 20, color: '#000', width: 4 }
const withObjects: PhotoEdits = { ...EMPTY_EDITS, crop: { x: 20, y: 30, w: 200, h: 100 }, objects: [rect, text, arrow] }

/** 물체의 기준점이 원본 사진의 어느 픽셀 위에 있는지 */
function sourcePoint(o: Annotation, e: PhotoEdits) {
  const inv = invert(orientationMatrix(W, H, e))
  return applyMatrix(inv, 'cx' in o ? { x: o.cx, y: o.cy } : { x: o.x2, y: o.y2 })
}

describe('회전·반전 좌표', () => {
  it('90° 돌리면 가로·세로가 바뀐다', () => {
    expect(orientedSize(W, H, { ...EMPTY_EDITS, quarter: 1 })).toEqual({ w: 300, h: 400 })
    expect(orientedSize(W, H, { ...EMPTY_EDITS, quarter: 2 })).toEqual({ w: 400, h: 300 })
  })

  it('시계 방향 90°: 원본 왼쪽 위가 오른쪽 위로 간다', () => {
    const m = orientationMatrix(W, H, { ...EMPTY_EDITS, quarter: 1 })
    expect(applyMatrix(m, { x: 0, y: 0 })).toEqual({ x: 300, y: 0 })
    expect(applyMatrix(m, { x: 400, y: 300 })).toEqual({ x: 0, y: 400 })
  })

  it('좌우 반전: 원본 왼쪽 위가 오른쪽 위로 간다', () => {
    const m = orientationMatrix(W, H, { ...EMPTY_EDITS, flipH: true })
    expect(applyMatrix(m, { x: 0, y: 0 })).toEqual({ x: 400, y: 0 })
  })

  it('미세 회전하면 사진 전체를 담는 상자가 커진다', () => {
    const s = orientedSize(W, H, { ...EMPTY_EDITS, angle: 10 })
    expect(s.w).toBeGreaterThan(W)
    expect(s.h).toBeGreaterThan(H)
  })

  it('네 번 돌리면 자르기와 물체가 제자리로 온다', () => {
    let e = withObjects
    for (let i = 0; i < 4; i++) e = rotateQuarter(W, H, e, 1)
    expect(e.quarter).toBe(0)
    close(e.crop!.x, 20)
    close(e.crop!.y, 30)
    close(e.crop!.w, 200)
    close(e.crop!.h, 100)
    const r = e.objects[0] as ShapeObject
    close(r.cx, 100)
    close(r.cy, 50)
    close(r.rotation, 0)
  })

  it('한 번 돌리면 자르기 영역도 같이 돈다', () => {
    const e = rotateQuarter(W, H, withObjects, 1)
    // 원본 (20,30)-(220,130) → 시계 방향 90°: x' = 300 - y, y' = x
    close(e.crop!.x, 170)
    close(e.crop!.y, 20)
    close(e.crop!.w, 100)
    close(e.crop!.h, 200)
  })

  it('돌리거나 뒤집어도 물체는 사진의 같은 자리를 가리킨다', () => {
    const before = withObjects.objects.map((o) => sourcePoint(o, withObjects))
    const steps: Array<(e: PhotoEdits) => PhotoEdits> = [
      (e) => rotateQuarter(W, H, e, 1),
      (e) => flipView(W, H, e, 'h'),
      (e) => setAngle(W, H, e, 12.5),
      (e) => flipView(W, H, e, 'v'),
      (e) => rotateQuarter(W, H, e, -1),
      (e) => setAngle(W, H, e, -30),
    ]
    let e = withObjects
    for (const step of steps) {
      e = step(e)
      e.objects.forEach((o, i) => {
        const p = sourcePoint(o, e)
        close(p.x, before[i].x, 1e-6)
        close(p.y, before[i].y, 1e-6)
      })
    }
  })

  it('좌우 반전을 두 번 하면 원래대로', () => {
    const base = setAngle(W, H, rotateQuarter(W, H, withObjects, 1), 7)
    const twice = flipView(W, H, flipView(W, H, base, 'h'), 'h')
    expect(twice.quarter).toBe(base.quarter)
    expect(twice.angle).toBe(base.angle)
    expect(twice.flipH).toBe(base.flipH)
    twice.objects.forEach((o, i) => {
      const a = sourcePoint(o, twice)
      const b = sourcePoint(base.objects[i], base)
      close(a.x, b.x)
      close(a.y, b.y)
    })
  })

  it('보이는 화면 기준으로 뒤집는다(90° 돌린 상태에서도 좌우가 바뀐다)', () => {
    const turned = rotateQuarter(W, H, { ...EMPTY_EDITS, objects: [rect] }, 1)
    const r0 = turned.objects[0] as ShapeObject
    const flipped = flipView(W, H, turned, 'h')
    const r1 = flipped.objects[0] as ShapeObject
    const size = orientedSize(W, H, flipped)
    close(r1.cx, size.w - r0.cx)
    close(r1.cy, r0.cy)
  })

  it('뒤집어도 글자는 거울상·거꾸로가 되지 않는다', () => {
    const tilted = { ...EMPTY_EDITS, objects: [{ ...text, rotation: 30 }] }
    expect((flipView(W, H, { ...EMPTY_EDITS, objects: [text] }, 'h').objects[0] as TextObject).rotation).toBe(0)
    expect((flipView(W, H, { ...EMPTY_EDITS, objects: [text] }, 'v').objects[0] as TextObject).rotation).toBe(0)
    close((flipView(W, H, tilted, 'h').objects[0] as TextObject).rotation, -30)
    close((flipView(W, H, tilted, 'v').objects[0] as TextObject).rotation, -30)
  })

  it('사진을 돌리면 글자도 같이 돈다', () => {
    const e = rotateQuarter(W, H, { ...EMPTY_EDITS, objects: [text] }, 1)
    close((e.objects[0] as TextObject).rotation, 90)
  })

  it('화살표는 양 끝이 함께 옮겨진다', () => {
    const e = flipView(W, H, { ...EMPTY_EDITS, objects: [arrow] }, 'h')
    const a = e.objects[0] as LineObject
    expect([a.x1, a.y1, a.x2, a.y2]).toEqual([390, 20, 290, 20])
  })
})

describe('자르기', () => {
  it('회전이 없으면 자동 영역은 사진 전체', () => {
    expect(inscribedRect(W, H, EMPTY_EDITS)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
    expect(effectiveCrop(W, H, { ...EMPTY_EDITS, quarter: 1 })).toEqual({ x: 0, y: 0, w: 300, h: 400 })
  })

  it('기울이면 자동 영역이 빈 모서리를 포함하지 않는다', () => {
    for (const angle of [3, -12, 30, 45]) {
      for (const quarter of [0, 1] as const) {
        const e = { ...EMPTY_EDITS, angle, quarter }
        const r = inscribedRect(W, H, e)
        const inv = invert(orientationMatrix(W, H, e))
        for (const p of [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]) {
          const s = applyMatrix(inv, p)
          expect(s.x).toBeGreaterThan(-1e-6)
          expect(s.x).toBeLessThan(W + 1e-6)
          expect(s.y).toBeGreaterThan(-1e-6)
          expect(s.y).toBeLessThan(H + 1e-6)
        }
        // 사진과 같은 비율
        close(r.w / r.h, quarter ? H / W : W / H)
      }
    }
  })

  it('직접 정한 영역은 사진 밖으로 나가지 않는다', () => {
    expect(effectiveCrop(W, H, { ...EMPTY_EDITS, crop: { x: 350, y: -20, w: 200, h: 100 } })).toEqual({ x: 200, y: 0, w: 200, h: 100 })
    expect(clampRect({ x: 0, y: 0, w: 900, h: 900 }, 400, 300)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
  })

  it('비율 맞춤은 가운데에서 가장 크게', () => {
    expect(fitRatio({ x: 0, y: 0, w: 400, h: 300 }, 1)).toEqual({ x: 50, y: 0, w: 300, h: 300 })
    const wide = fitRatio({ x: 0, y: 0, w: 400, h: 300 }, 16 / 9)
    close(wide.w, 400)
    close(wide.h, 225)
    close(wide.y, 37.5)
  })

  const bounds = { w: 400, h: 300 }
  const start = { x: 100, y: 100, w: 100, h: 100 }

  it('자유 비율: 끈 변만 움직이고 사진 밖으로 못 나간다', () => {
    expect(dragCrop(start, 'e', 50, 999, bounds, null)).toEqual({ x: 100, y: 100, w: 150, h: 100 })
    expect(dragCrop(start, 'se', 999, 999, bounds, null)).toEqual({ x: 100, y: 100, w: 300, h: 200 })
    expect(dragCrop(start, 'nw', -999, -999, bounds, null)).toEqual({ x: 0, y: 0, w: 200, h: 200 })
    expect(dragCrop(start, 'w', 999, 0, bounds, null, 8)).toEqual({ x: 192, y: 100, w: 8, h: 100 })
  })

  it('옮기기는 크기를 유지한다', () => {
    expect(dragCrop(start, 'move', 999, -999, bounds, null)).toEqual({ x: 300, y: 0, w: 100, h: 100 })
  })

  it('비율 고정: 어느 손잡이를 끌어도 비율과 경계를 지킨다', () => {
    const ratio = 16 / 9
    const s = fitRatio({ x: 50, y: 50, w: 200, h: 200 }, ratio)
    for (const handle of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
      for (const [dx, dy] of [[40, 25], [-60, -10], [999, 999], [-999, -999], [3, -200]]) {
        const r = dragCrop(s, handle, dx, dy, bounds, ratio)
        close(r.w / r.h, ratio, 1e-6)
        expect(r.x).toBeGreaterThan(-1e-6)
        expect(r.y).toBeGreaterThan(-1e-6)
        expect(r.x + r.w).toBeLessThan(bounds.w + 1e-6)
        expect(r.y + r.h).toBeLessThan(bounds.h + 1e-6)
        expect(r.w).toBeGreaterThan(0)
      }
    }
  })

  it('비율 고정 모서리: 맞은편 모서리는 제자리', () => {
    const r = dragCrop(start, 'se', 50, 10, bounds, 1)
    expect(r).toEqual({ x: 100, y: 100, w: 150, h: 150 })
    const l = dragCrop(start, 'nw', -50, -10, bounds, 1)
    expect(l).toEqual({ x: 50, y: 50, w: 150, h: 150 })
  })
})

describe('물체 조작', () => {
  it('회전한 상자의 크기를 바꿔도 맞은편 모서리는 제자리', () => {
    const box: Box = { cx: 100, cy: 100, w: 80, h: 40, rotation: 30 }
    const anchor = boxCorners(box)[0] // 왼쪽 위
    const next = resizeBox(box, 'se', { x: 190, y: 170 })
    const after = boxCorners(next)[0]
    close(after.x, anchor.x)
    close(after.y, anchor.y)
    expect(next.rotation).toBe(30)
    // 끌고 간 점이 새 오른쪽 아래 모서리
    const se = boxCorners(next)[2]
    close(se.x, 190)
    close(se.y, 170)
  })

  it('너무 작아지지 않는다', () => {
    const next = resizeBox({ cx: 0, cy: 0, w: 80, h: 40, rotation: 0 }, 'e', { x: -500, y: 0 }, 4)
    expect(next.w).toBe(4)
    expect(next.h).toBe(40)
  })

  it('toLocal 은 회전을 푼다', () => {
    const p = toLocal({ x: 10, y: 0 }, { cx: 0, cy: 0, rotation: 90 })
    close(p.x, 0)
    close(p.y, -10)
  })

  const measure = (o: Annotation): Box => ('w' in o ? o : { cx: 0, cy: 0, w: 0, h: 0, rotation: 0 })

  it('선은 가까이 눌러야 잡힌다', () => {
    expect(hitTest(arrow, { x: 60, y: 24 }, 6, measure)).toBe(true)
    expect(hitTest(arrow, { x: 60, y: 40 }, 6, measure)).toBe(false)
    expect(hitTest(arrow, { x: 130, y: 20 }, 6, measure)).toBe(false)
  })

  it('속이 빈 사각형은 테두리만, 채운 사각형은 안쪽도 잡힌다', () => {
    expect(hitTest({ ...rect, w: 100, h: 60 }, { x: 100, y: 50 }, 4, measure)).toBe(false)
    expect(hitTest({ ...rect, w: 100, h: 60 }, { x: 51, y: 50 }, 4, measure)).toBe(true)
    expect(hitTest({ ...rect, w: 100, h: 60, fill: true }, { x: 100, y: 50 }, 4, measure)).toBe(true)
    expect(hitTest({ ...rect, w: 100, h: 60, fill: true }, { x: 200, y: 50 }, 4, measure)).toBe(false)
  })

  it('옮기기', () => {
    expect(moveObject(arrow, 5, -5)).toMatchObject({ x1: 15, y1: 15, x2: 115, y2: 15 })
    expect(moveObject(rect, 5, -5)).toMatchObject({ cx: 105, cy: 45 })
  })

  it('편집 여부', () => {
    expect(isEdited(EMPTY_EDITS)).toBe(false)
    expect(isEdited({ ...EMPTY_EDITS, flipH: true })).toBe(true)
    expect(isEdited({ ...EMPTY_EDITS, objects: [rect] })).toBe(true)
  })
})

describe('출력 크기', () => {
  it('변경 없음', () => {
    expect(planOutput(4000, 3000, batch(), 1)).toMatchObject({ width: 4000, height: 3000, padded: false })
  })

  it('가로·세로·긴 변 기준은 비율을 유지한다', () => {
    expect(planOutput(4000, 3000, batch({ resizeMode: 'width', width: 860 }), 1)).toMatchObject({ width: 860, height: 645 })
    expect(planOutput(4000, 3000, batch({ resizeMode: 'height', height: 600 }), 1)).toMatchObject({ width: 800, height: 600 })
    expect(planOutput(3000, 4000, batch({ resizeMode: 'long', long: 1200 }), 1)).toMatchObject({ width: 900, height: 1200 })
  })

  it('작은 사진: 기본은 키우고, 키우지 않기를 켜면 그대로', () => {
    expect(planOutput(500, 400, batch({ resizeMode: 'width', width: 1000 }), 1)).toMatchObject({ width: 1000, height: 800 })
    expect(planOutput(500, 400, batch({ resizeMode: 'width', width: 1000, noUpscale: true }), 1)).toMatchObject({ width: 500, height: 400 })
  })

  it('정확한 크기 + 여백: 사진 전체가 가운데 들어간다', () => {
    const p = planOutput(4000, 3000, batch({ resizeMode: 'exact', width: 1000, height: 1000, fit: 'contain' }), 1)
    expect(p).toMatchObject({ width: 1000, height: 1000, padded: true })
    expect(p.dest).toEqual({ x: 0, y: 125, w: 1000, h: 750 })
    expect(p.src).toEqual({ x: 0, y: 0, w: 4000, h: 3000 })
  })

  it('정확한 크기 + 여백 + 키우지 않기: 작은 사진은 원래 크기로 가운데', () => {
    const p = planOutput(200, 100, batch({ resizeMode: 'exact', width: 1000, height: 1000, fit: 'contain', noUpscale: true }), 1)
    expect(p.dest).toEqual({ x: 400, y: 450, w: 200, h: 100 })
  })

  it('정확한 크기 + 채우기: 가운데를 잘라 꽉 채운다', () => {
    const p = planOutput(4000, 3000, batch({ resizeMode: 'exact', width: 1000, height: 1000, fit: 'cover' }), 1)
    expect(p).toMatchObject({ width: 1000, height: 1000, padded: false })
    expect(p.dest).toEqual({ x: 0, y: 0, w: 1000, h: 1000 })
    expect(p.src).toEqual({ x: 500, y: 0, w: 3000, h: 3000 })
  })

  it('랜덤 자르기: 정한 만큼 줄고, 씨앗이 같으면 같은 자리', () => {
    const b = batch({ randomCrop: true, cropPctW: 10, cropPctH: 5 })
    const a = planOutput(1000, 800, b, 42)
    expect(a.width).toBe(900)
    expect(a.height).toBe(760)
    expect(planOutput(1000, 800, b, 42)).toEqual(a)
    expect(a.src.x).toBeGreaterThanOrEqual(0)
    expect(a.src.x + a.src.w).toBeLessThanOrEqual(1000)
    expect(a.src.y).toBeGreaterThanOrEqual(0)
    expect(a.src.y + a.src.h).toBeLessThanOrEqual(800)
  })

  it('랜덤 자르기: 사진(씨앗)마다 자리가 다르다', () => {
    const b = batch({ randomCrop: true, cropPctW: 20, cropPctH: 20 })
    const offsets = new Set(Array.from({ length: 30 }, (_, i) => planOutput(1000, 1000, b, photoSeed(`p${i}`, 1)).src.x))
    expect(offsets.size).toBeGreaterThan(10)
    // 다시 섞기
    expect(photoSeed('p1', 1)).not.toBe(photoSeed('p1', 2))
  })

  it('랜덤 자르기 뒤에 크기 맞춤이 적용된다', () => {
    const p = planOutput(1000, 1000, batch({ randomCrop: true, cropPctW: 10, cropPctH: 10, resizeMode: 'width', width: 450 }), 7)
    expect(p).toMatchObject({ width: 450, height: 450 })
  })

  it('정밀 편집의 자르기·회전이 반영된 크기', () => {
    expect(plannedSize(4000, 3000, { ...EMPTY_EDITS, quarter: 1 }, batch({ resizeMode: 'width', width: 600 }), 1)).toEqual({ width: 600, height: 800 })
    expect(plannedSize(4000, 3000, { ...EMPTY_EDITS, crop: { x: 0, y: 0, w: 1000, h: 500 } }, batch(), 1)).toEqual({ width: 1000, height: 500 })
  })
})

describe('설정 정리', () => {
  it('빈 칸·범위 밖 값을 그릴 수 있는 값으로 바꾼다', () => {
    const r = resolveBatch({ ...DEFAULT_BATCH, width: null, height: 99999, borderWidth: null, brightness: Number.NaN, padColor: 'red', cropPctW: 80 })
    expect(r.width).toBe(1000)
    expect(r.height).toBe(10000)
    expect(r.borderWidth).toBe(0)
    expect(r.brightness).toBe(100)
    expect(r.padColor).toBe('#ffffff')
    expect(r.cropPctW).toBe(30)
  })

  it('난수는 씨앗이 같으면 같다', () => {
    const a = mulberry32(hashSeed('abc'))
    const b = mulberry32(hashSeed('abc'))
    const seqA = [a(), a(), a()]
    expect(seqA).toEqual([b(), b(), b()])
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
