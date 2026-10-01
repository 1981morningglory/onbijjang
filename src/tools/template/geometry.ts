/** 정렬·스냅 계산. fabric 과 무관한 순수 함수. 좌표는 모두 페이지(장면) 기준 px. */

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface Guide {
  /** x: 세로선(x 좌표가 pos), y: 가로선 */
  axis: 'x' | 'y'
  pos: number
  from: number
  to: number
}

export type AlignHow = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

export function unionBox(boxes: Box[]): Box {
  if (!boxes.length) return { left: 0, top: 0, width: 0, height: 0 }
  const l = Math.min(...boxes.map((b) => b.left))
  const t = Math.min(...boxes.map((b) => b.top))
  const r = Math.max(...boxes.map((b) => b.left + b.width))
  const btm = Math.max(...boxes.map((b) => b.top + b.height))
  return { left: l, top: t, width: r - l, height: btm - t }
}

/** box 를 target 안에서 정렬하려면 얼마나 옮겨야 하는지 */
export function alignDelta(box: Box, target: Box, how: AlignHow): { dx: number; dy: number } {
  switch (how) {
    case 'left':
      return { dx: target.left - box.left, dy: 0 }
    case 'hcenter':
      return { dx: target.left + target.width / 2 - (box.left + box.width / 2), dy: 0 }
    case 'right':
      return { dx: target.left + target.width - (box.left + box.width), dy: 0 }
    case 'top':
      return { dx: 0, dy: target.top - box.top }
    case 'vcenter':
      return { dx: 0, dy: target.top + target.height / 2 - (box.top + box.height / 2) }
    case 'bottom':
      return { dx: 0, dy: target.top + target.height - (box.top + box.height) }
  }
}

/** 양 끝 상자는 그대로 두고 사이 간격이 같아지도록 각 상자를 옮길 거리 */
export function distributeDeltas(boxes: Box[], axis: 'x' | 'y'): number[] {
  if (boxes.length < 3) return boxes.map(() => 0)
  const start = (b: Box) => (axis === 'x' ? b.left : b.top)
  const size = (b: Box) => (axis === 'x' ? b.width : b.height)
  const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => start(p.b) - start(q.b))
  const first = order[0].b
  const last = order[order.length - 1].b
  const span = start(last) + size(last) - start(first)
  const used = order.reduce((sum, o) => sum + size(o.b), 0)
  const gap = (span - used) / (order.length - 1)
  const out = boxes.map(() => 0)
  let cursor = start(first)
  for (const o of order) {
    out[o.i] = cursor - start(o.b)
    cursor += size(o.b) + gap
  }
  return out
}

interface SnapLine {
  pos: number
  /** 안내선을 그릴 범위를 정하기 위한, 이 선이 속한 상자의 반대 축 범위 */
  from: number
  to: number
}

function linesOf(box: Box, axis: 'x' | 'y'): SnapLine[] {
  if (axis === 'x') {
    const range = { from: box.top, to: box.top + box.height }
    return [box.left, box.left + box.width / 2, box.left + box.width].map((pos) => ({ pos, ...range }))
  }
  const range = { from: box.left, to: box.left + box.width }
  return [box.top, box.top + box.height / 2, box.top + box.height].map((pos) => ({ pos, ...range }))
}

function snapAxis(moving: Box, targets: Box[], axis: 'x' | 'y', threshold: number): { delta: number; guides: Guide[] } {
  const own = linesOf(moving, axis)
  let best: number | null = null
  for (const t of targets) {
    for (const tl of linesOf(t, axis)) {
      for (const ml of own) {
        const d = tl.pos - ml.pos
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d
      }
    }
  }
  if (best === null) return { delta: 0, guides: [] }
  const delta = best
  const guides = new Map<number, Guide>()
  for (const t of targets) {
    for (const tl of linesOf(t, axis)) {
      for (const ml of own) {
        if (Math.abs(tl.pos - (ml.pos + delta)) > 0.01) continue
        const key = Math.round(tl.pos * 100)
        const from = Math.min(tl.from, ml.from)
        const to = Math.max(tl.to, ml.to)
        const prev = guides.get(key)
        if (prev) {
          prev.from = Math.min(prev.from, from)
          prev.to = Math.max(prev.to, to)
        } else {
          guides.set(key, { axis, pos: tl.pos, from, to })
        }
      }
    }
  }
  return { delta, guides: [...guides.values()] }
}

/**
 * 옮기는 상자가 페이지나 다른 객체의 가장자리·가운데에 가까우면 달라붙을 거리와 안내선을 돌려준다.
 * threshold 는 장면 px(확대 배율로 나눈 값).
 */
export function computeSnap(moving: Box, others: Box[], page: { width: number; height: number }, threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const targets: Box[] = [{ left: 0, top: 0, width: page.width, height: page.height }, ...others]
  const x = snapAxis(moving, targets, 'x', threshold)
  // y 축 안내선의 범위는 x 보정이 끝난 위치로 잡는다.
  const y = snapAxis({ ...moving, left: moving.left + x.delta }, targets, 'y', threshold)
  const xGuides = y.delta ? snapAxis({ ...moving, top: moving.top + y.delta }, targets, 'x', threshold).guides : x.guides
  return { dx: x.delta, dy: y.delta, guides: [...xGuides, ...y.guides] }
}
