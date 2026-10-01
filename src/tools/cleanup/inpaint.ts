/**
 * 칠한 부분을 주변 무늬로 채우는 계산(순수 함수, Web Worker 에서 실행).
 *
 * 'texture' — 여러 해상도에서 주변의 비슷한 조각(7×7)을 찾아 이어 붙인다.
 *   작은 해상도에서 큰 구조를 먼저 맞추고, 해상도를 올리면서 조각 대응을 다듬는다
 *   (PatchMatch 방식의 근사 최근접 조각 탐색 + 겹치는 조각의 가중 평균). 직접 구현.
 * 'smooth' — 경계 색이 안쪽으로 부드럽게 번지도록 채운다(무늬 없는 하늘·벽에 알맞다).
 */

export type FillMode = 'texture' | 'smooth'

export interface InpaintInput {
  /** RGBA, width*height*4 */
  rgba: Uint8ClampedArray
  /** 1 = 지울 곳, width*height */
  mask: Uint8Array
  width: number
  height: number
  mode: FillMode
  /** 칠한 가장자리를 바깥으로 넓히는 px(브러시 경계의 흐릿한 부분까지 덮는다) */
  grow?: number
  seed?: number
}

interface Level {
  w: number
  h: number
  img: Uint8ClampedArray
  hole: Uint8Array
}

/** 조각 반지름(7×7) */
const R = 3

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 정사각 창으로 넓히기(체비쇼프 거리 r). 가로·세로로 나눠 계산한다. */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice()
  const tmp = new Uint8Array(w * h)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let last = -Infinity
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) last = x
      if (x - last <= r) tmp[row + x] = 1
    }
    last = Infinity
    for (let x = w - 1; x >= 0; x--) {
      if (mask[row + x]) last = x
      if (last - x <= r) tmp[row + x] = 1
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -Infinity
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y
      if (y - last <= r) out[y * w + x] = 1
    }
    last = Infinity
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y
      if (last - y <= r) out[y * w + x] = 1
    }
  }
  return out
}

/** 구멍 안에서 경계까지의 최대 거리(맨해튼 근사). 피라미드 단계 수를 정하는 데 쓴다. */
export function maxHoleDepth(hole: Uint8Array, w: number, h: number): number {
  const INF = 1 << 28
  const d = new Int32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!hole[i]) {
        d[i] = 0
        continue
      }
      let v = INF
      if (x > 0) v = Math.min(v, d[i - 1] + 1)
      if (y > 0) v = Math.min(v, d[i - w] + 1)
      // 사진 가장자리는 경계로 치지 않는다(바깥에는 가져올 색이 없다).
      d[i] = v
    }
  }
  let max = 0
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!hole[i]) continue
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1)
      if (y < h - 1) v = Math.min(v, d[i + w] + 1)
      d[i] = v
      if (v < INF && v > max) max = v
    }
  }
  return max
}

function downscale(lv: Level): Level {
  const w = Math.max(1, (lv.w + 1) >> 1)
  const h = Math.max(1, (lv.h + 1) >> 1)
  const img = new Uint8ClampedArray(w * h * 4)
  const hole = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      let holes = 0
      for (let dy = 0; dy < 2; dy++) {
        const sy = y * 2 + dy
        if (sy >= lv.h) continue
        for (let dx = 0; dx < 2; dx++) {
          const sx = x * 2 + dx
          if (sx >= lv.w) continue
          const si = sy * lv.w + sx
          if (lv.hole[si]) {
            holes++
            continue
          }
          r += lv.img[si * 4]
          g += lv.img[si * 4 + 1]
          b += lv.img[si * 4 + 2]
          a += lv.img[si * 4 + 3]
          n++
        }
      }
      const i = y * w + x
      // 하나라도 구멍이면 구멍으로 본다. 색은 구멍이 아닌 화소만 평균해 구멍 색이 번지지 않게 한다.
      hole[i] = holes > 0 ? 1 : 0
      if (n) {
        img[i * 4] = r / n
        img[i * 4 + 1] = g / n
        img[i * 4 + 2] = b / n
        img[i * 4 + 3] = a / n
      }
    }
  }
  return { w, h, img, hole }
}

/** 구멍 가장자리부터 한 겹씩 이웃 평균으로 채운다. 채울 수 없으면(전부 구멍) false. */
export function onionFill(lv: Level): boolean {
  const { w, h, img } = lv
  const todo = lv.hole.slice()
  let remaining = 0
  for (let i = 0; i < todo.length; i++) remaining += todo[i]
  if (remaining === w * h) return false
  let frontier: number[] = []
  const queued = new Uint8Array(w * h)
  const pushNeighbours = (i: number, into: number[]) => {
    const x = i % w
    const y = (i - x) / w
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= h) continue
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= w) continue
        const n = ny * w + nx
        if (todo[n] && !queued[n]) {
          queued[n] = 1
          into.push(n)
        }
      }
    }
  }
  for (let i = 0; i < w * h; i++) if (!todo[i]) pushNeighbours(i, frontier)
  while (frontier.length) {
    // 같은 겹은 이전 겹까지의 값만 써서 방향에 따른 번짐을 줄인다.
    const values = new Float32Array(frontier.length * 4)
    for (let k = 0; k < frontier.length; k++) {
      const i = frontier[k]
      const x = i % w
      const y = (i - x) / w
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const ni = ny * w + nx
          if (todo[ni]) continue
          r += img[ni * 4]
          g += img[ni * 4 + 1]
          b += img[ni * 4 + 2]
          a += img[ni * 4 + 3]
          n++
        }
      }
      values[k * 4] = r / n
      values[k * 4 + 1] = g / n
      values[k * 4 + 2] = b / n
      values[k * 4 + 3] = a / n
    }
    const next: number[] = []
    for (let k = 0; k < frontier.length; k++) {
      const i = frontier[k]
      img[i * 4] = values[k * 4]
      img[i * 4 + 1] = values[k * 4 + 1]
      img[i * 4 + 2] = values[k * 4 + 2]
      img[i * 4 + 3] = values[k * 4 + 3]
    }
    for (let k = 0; k < frontier.length; k++) todo[frontier[k]] = 0
    for (let k = 0; k < frontier.length; k++) pushNeighbours(frontier[k], next)
    frontier = next
  }
  return true
}

/** 한 단계 거친 결과를 구멍 자리에만 올려 놓는다(최근접). */
function upsampleHole(fine: Level, coarse: Level) {
  for (let y = 0; y < fine.h; y++) {
    const cy = Math.min(coarse.h - 1, y >> 1)
    for (let x = 0; x < fine.w; x++) {
      const i = y * fine.w + x
      if (!fine.hole[i]) continue
      const ci = (cy * coarse.w + Math.min(coarse.w - 1, x >> 1)) * 4
      fine.img[i * 4] = coarse.img[ci]
      fine.img[i * 4 + 1] = coarse.img[ci + 1]
      fine.img[i * 4 + 2] = coarse.img[ci + 2]
      fine.img[i * 4 + 3] = coarse.img[ci + 3]
    }
  }
}

/** 구멍 안을 이웃 네 칸의 평균으로 여러 번 고르게 편다. */
function relax(lv: Level, iterations: number) {
  const { w, h, img, hole } = lv
  const list: number[] = []
  for (let i = 0; i < w * h; i++) if (hole[i]) list.push(i)
  for (let it = 0; it < iterations; it++) {
    // 번갈아 방향을 바꿔 한쪽으로 쏠리지 않게 한다.
    const forward = it % 2 === 0
    for (let k = 0; k < list.length; k++) {
      const i = list[forward ? k : list.length - 1 - k]
      const x = i % w
      const y = (i - x) / w
      for (let c = 0; c < 4; c++) {
        let s = 0
        let n = 0
        if (x > 0) {
          s += img[(i - 1) * 4 + c]
          n++
        }
        if (x < w - 1) {
          s += img[(i + 1) * 4 + c]
          n++
        }
        if (y > 0) {
          s += img[(i - w) * 4 + c]
          n++
        }
        if (y < h - 1) {
          s += img[(i + w) * 4 + c]
          n++
        }
        if (n) img[i * 4 + c] = s / n
      }
    }
  }
}

function patchDist(img: Uint8ClampedArray, w: number, h: number, px: number, py: number, qx: number, qy: number, best: number): number {
  let d = 0
  for (let dy = -R; dy <= R; dy++) {
    const ty = py + dy
    if (ty < 0 || ty >= h) continue
    let ti = (ty * w + px - R) * 4
    let si = ((qy + dy) * w + qx - R) * 4
    for (let dx = -R; dx <= R; dx++, ti += 4, si += 4) {
      const tx = px + dx
      if (tx < 0 || tx >= w) continue
      const a = img[ti] - img[si]
      const b = img[ti + 1] - img[si + 1]
      const c = img[ti + 2] - img[si + 2]
      d += a * a + b * b + c * c
    }
    if (d >= best) return d
  }
  return d
}

interface Field {
  /** 대상 화소마다 가져올 조각의 중심(화소 번호). 대상이 아니면 -1 */
  nnf: Int32Array
  dist: Float64Array
  target: Uint8Array
  valid: Uint8Array
  sources: Int32Array
  targets: Int32Array
}

function prepareField(lv: Level): Field {
  const { w, h } = lv
  const target = dilate(lv.hole, w, h, R)
  const valid = new Uint8Array(w * h)
  let ns = 0
  let nt = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (target[i]) nt++
      else if (x >= R && y >= R && x < w - R && y < h - R) {
        valid[i] = 1
        ns++
      }
    }
  }
  const sources = new Int32Array(ns)
  const targets = new Int32Array(nt)
  ns = 0
  nt = 0
  for (let i = 0; i < w * h; i++) {
    if (valid[i]) sources[ns++] = i
    else if (target[i]) targets[nt++] = i
  }
  return { nnf: new Int32Array(w * h).fill(-1), dist: new Float64Array(w * h), target, valid, sources, targets }
}

function countSources(lv: Level): number {
  const { w, h } = lv
  const target = dilate(lv.hole, w, h, R)
  let n = 0
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) if (!target[y * w + x]) n++
  return n
}

function initField(lv: Level, f: Field, rand: () => number, coarse?: { lv: Level; f: Field }) {
  const { w, h } = lv
  for (let k = 0; k < f.targets.length; k++) {
    const p = f.targets[k]
    let q = -1
    if (coarse) {
      const x = p % w
      const y = (p - x) / w
      const cq = coarse.f.nnf[Math.min(coarse.lv.h - 1, y >> 1) * coarse.lv.w + Math.min(coarse.lv.w - 1, x >> 1)]
      if (cq >= 0) {
        const cqx = cq % coarse.lv.w
        const cqy = (cq - cqx) / coarse.lv.w
        const qx = Math.min(w - 1 - R, Math.max(R, cqx * 2 + (x & 1)))
        const qy = Math.min(h - 1 - R, Math.max(R, cqy * 2 + (y & 1)))
        if (f.valid[qy * w + qx]) q = qy * w + qx
      }
    }
    if (q < 0) q = f.sources[(rand() * f.sources.length) | 0]
    f.nnf[p] = q
  }
}

function refreshDist(lv: Level, f: Field) {
  const { w, h, img } = lv
  for (let k = 0; k < f.targets.length; k++) {
    const p = f.targets[k]
    const q = f.nnf[p]
    const px = p % w
    const qx = q % w
    f.dist[p] = patchDist(img, w, h, px, (p - px) / w, qx, (q - qx) / w, Infinity)
  }
}

/** 한 번 훑으며 이웃의 대응을 물려받고(전파) 주변을 무작위로 뒤져(탐색) 더 비슷한 조각으로 바꾼다. */
function patchMatchPass(lv: Level, f: Field, reverse: boolean, rand: () => number, tick: (done: number) => void) {
  const { w, h, img } = lv
  const { nnf, dist, target, valid } = f
  const n = f.targets.length
  const step = reverse ? 1 : -1 // 물려받을 이웃 방향(정방향이면 왼쪽·위)
  const maxR = Math.max(w, h)
  for (let k = 0; k < n; k++) {
    const p = f.targets[reverse ? n - 1 - k : k]
    const px = p % w
    const py = (p - px) / w
    let bq = nnf[p]
    let bqx = bq % w
    let bqy = (bq - bqx) / w
    let bd = patchDist(img, w, h, px, py, bqx, bqy, Infinity)

    // 전파: 가로 이웃
    const nx = px + step
    if (nx >= 0 && nx < w && target[p + step]) {
      const cq = nnf[p + step] - step
      if (cq >= 0 && cq < w * h && valid[cq] && cq !== bq) {
        const cx = cq % w
        const d = patchDist(img, w, h, px, py, cx, (cq - cx) / w, bd)
        if (d < bd) {
          bd = d
          bq = cq
        }
      }
    }
    // 전파: 세로 이웃
    const ny = py + step
    if (ny >= 0 && ny < h && target[p + step * w]) {
      const cq = nnf[p + step * w] - step * w
      if (cq >= 0 && cq < w * h && valid[cq] && cq !== bq) {
        const cx = cq % w
        const d = patchDist(img, w, h, px, py, cx, (cq - cx) / w, bd)
        if (d < bd) {
          bd = d
          bq = cq
        }
      }
    }
    // 무작위 탐색: 범위를 절반씩 줄여 가며
    bqx = bq % w
    bqy = (bq - bqx) / w
    for (let r = maxR; r >= 1; r = r >> 1) {
      const cx = Math.min(w - 1 - R, Math.max(R, bqx + Math.round((rand() * 2 - 1) * r)))
      const cy = Math.min(h - 1 - R, Math.max(R, bqy + Math.round((rand() * 2 - 1) * r)))
      const cq = cy * w + cx
      if (!valid[cq] || cq === bq) continue
      const d = patchDist(img, w, h, px, py, cx, cy, bd)
      if (d < bd) {
        bd = d
        bq = cq
        bqx = cx
        bqy = cy
      }
    }
    nnf[p] = bq
    dist[p] = bd
    if ((k & 2047) === 2047) tick(2048)
  }
  tick(n & 2047)
}

/** 겹치는 조각들이 가리키는 색을 비슷한 정도로 가중 평균해 구멍을 다시 칠한다. */
function vote(lv: Level, f: Field, sharp: boolean) {
  const { w, h, img, hole } = lv
  const acc = new Float32Array(w * h * 4)
  const wsum = new Float32Array(w * h)
  const PATCH = (2 * R + 1) * (2 * R + 1) * 3
  let mean = 0
  for (let k = 0; k < f.targets.length; k++) mean += f.dist[f.targets[k]] / PATCH
  mean /= Math.max(1, f.targets.length)
  const sigma2 = sharp ? Math.max(9, mean / 4) : Math.max(16, mean)
  for (let k = 0; k < f.targets.length; k++) {
    const p = f.targets[k]
    const q = f.nnf[p]
    const px = p % w
    const py = (p - px) / w
    const wgt = Math.exp(-f.dist[p] / PATCH / (2 * sigma2)) + 1e-6
    for (let dy = -R; dy <= R; dy++) {
      const ty = py + dy
      if (ty < 0 || ty >= h) continue
      for (let dx = -R; dx <= R; dx++) {
        const tx = px + dx
        if (tx < 0 || tx >= w) continue
        const t = ty * w + tx
        if (!hole[t]) continue
        const s = (q + dy * w + dx) * 4
        acc[t * 4] += wgt * img[s]
        acc[t * 4 + 1] += wgt * img[s + 1]
        acc[t * 4 + 2] += wgt * img[s + 2]
        acc[t * 4 + 3] += wgt * img[s + 3]
        wsum[t] += wgt
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (!hole[i] || wsum[i] === 0) continue
    const k = 1 / wsum[i]
    img[i * 4] = acc[i * 4] * k
    img[i * 4 + 1] = acc[i * 4 + 1] * k
    img[i * 4 + 2] = acc[i * 4 + 2] * k
    img[i * 4 + 3] = acc[i * 4 + 3] * k
  }
}

/** 최소한 이만큼은 가져올 조각이 있어야 그 단계에서 조각 찾기를 한다. */
const MIN_SOURCES = 24

/**
 * 칠한 부분을 채운 새 RGBA 를 돌려준다. 원본 배열은 바꾸지 않는다.
 * onProgress 는 0–1.
 */
export function inpaint(input: InpaintInput, onProgress?: (ratio: number) => void): Uint8ClampedArray {
  const { width: w, height: h } = input
  const hole = dilate(input.mask, w, h, input.grow ?? 0)
  let holeCount = 0
  for (let i = 0; i < hole.length; i++) holeCount += hole[i]
  const out = new Uint8ClampedArray(input.rgba)
  if (holeCount === 0 || holeCount === w * h) {
    onProgress?.(1)
    return out
  }

  const base: Level = { w, h, img: out, hole }
  const depth = maxHoleDepth(hole, w, h)
  const wanted = Math.max(0, Math.min(7, Math.ceil(Math.log2(Math.max(1, depth) / 2))))
  const levels: Level[] = [base]
  for (let l = 0; l < wanted; l++) {
    const prev = levels[levels.length - 1]
    if (prev.w < 8 || prev.h < 8) break
    const next = downscale(prev)
    let holes = 0
    for (let i = 0; i < next.hole.length; i++) holes += next.hole[i]
    if (holes === next.w * next.h) break
    if (input.mode === 'texture' && countSources(next) < MIN_SOURCES) break
    levels.push(next)
  }

  // 가장 거친 단계는 가장자리부터 번지게 채워 출발점으로 삼는다.
  const top = levels[levels.length - 1]
  onionFill(top)

  if (input.mode === 'smooth') {
    relax(top, 40)
    for (let l = levels.length - 2; l >= 0; l--) {
      upsampleHole(levels[l], levels[l + 1])
      relax(levels[l], l === 0 ? 24 : 30)
      onProgress?.((levels.length - 1 - l) / Math.max(1, levels.length - 1))
    }
    onProgress?.(1)
    return out
  }

  const rand = mulberry32(input.seed ?? 20240917)
  const fields: Array<Field | null> = levels.map(() => null)
  const iterations = levels.map((_, l) => (l === levels.length - 1 ? 6 : Math.max(2, 5 - (levels.length - 1 - l))))
  // 진행률: 단계마다 (대상 화소 수 × 반복 × 2번 훑기)
  const targetCounts = levels.map((lv) => {
    const t = dilate(lv.hole, lv.w, lv.h, R)
    let n = 0
    for (let i = 0; i < t.length; i++) n += t[i]
    return n
  })
  const totalWork = levels.reduce((s, _, l) => s + targetCounts[l] * iterations[l] * 2, 0) || 1
  let done = 0
  let lastReport = 0
  const tick = (n: number) => {
    done += n
    const ratio = Math.min(1, done / totalWork)
    if (ratio - lastReport >= 0.01) {
      lastReport = ratio
      onProgress?.(ratio)
    }
  }

  for (let l = levels.length - 1; l >= 0; l--) {
    const lv = levels[l]
    const coarseLv = levels[l + 1]
    const coarseField = fields[l + 1]
    if (coarseLv) upsampleHole(lv, coarseLv)
    const f = prepareField(lv)
    if (f.sources.length < MIN_SOURCES) {
      // 가져올 곳이 거의 없으면(구멍이 영역 대부분) 부드럽게 채운 결과로 둔다.
      if (!coarseLv) relax(lv, 40)
      else relax(lv, 8)
      tick(targetCounts[l] * iterations[l] * 2)
      continue
    }
    fields[l] = f
    initField(lv, f, rand, coarseLv && coarseField ? { lv: coarseLv, f: coarseField } : undefined)
    if (coarseLv && coarseField) {
      refreshDist(lv, f)
      vote(lv, f, false)
    }
    for (let it = 0; it < iterations[l]; it++) {
      patchMatchPass(lv, f, false, rand, tick)
      patchMatchPass(lv, f, true, rand, tick)
      vote(lv, f, l === 0 && it === iterations[l] - 1)
    }
  }
  onProgress?.(1)
  return out
}

// ── 작업 구역 나누기 ──────────────────────────────────────
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const CELL = 8

/**
 * 칠한 곳을 서로 떨어진 덩어리로 나누고, 덩어리마다 주변을 넉넉히 포함한 작업 구역을 돌려준다.
 * 겹치는 구역은 하나로 합친다. 사진 전체가 아니라 필요한 곳만 계산하기 위한 것.
 */
export function planRegions(mask: Uint8Array, w: number, h: number, offsetX = 0, offsetY = 0, fullW = w, fullH = h): Rect[] {
  const gw = Math.ceil(w / CELL)
  const gh = Math.ceil(h / CELL)
  const grid = new Uint8Array(gw * gh)
  for (let y = 0; y < h; y++) {
    const gy = (y / CELL) | 0
    for (let x = 0; x < w; x++) if (mask[y * w + x]) grid[gy * gw + ((x / CELL) | 0)] = 1
  }
  const seen = new Uint8Array(gw * gh)
  const boxes: Rect[] = []
  const stack: number[] = []
  for (let s = 0; s < gw * gh; s++) {
    if (!grid[s] || seen[s]) continue
    let x0 = gw
    let y0 = gh
    let x1 = -1
    let y1 = -1
    stack.push(s)
    seen[s] = 1
    while (stack.length) {
      const i = stack.pop()!
      const x = i % gw
      const y = (i - x) / gw
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= gh) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= gw) continue
          const n = ny * gw + nx
          if (grid[n] && !seen[n]) {
            seen[n] = 1
            stack.push(n)
          }
        }
      }
    }
    const bw = (x1 - x0 + 1) * CELL
    const bh = (y1 - y0 + 1) * CELL
    // 구멍 두께만큼은 주변이 있어야 거친 단계에서도 가져올 조각이 남는다.
    const pad = Math.round(Math.max(48, Math.min(400, Math.min(bw, bh) * 1.5)))
    // 넘겨받은 마스크가 사진의 일부(offset 위치)일 수 있으므로 사진 전체 좌표로 바꿔 주변을 붙인다.
    const rx = Math.max(0, offsetX + x0 * CELL - pad)
    const ry = Math.max(0, offsetY + y0 * CELL - pad)
    const rx1 = Math.min(fullW, offsetX + Math.min(w, (x1 + 1) * CELL) + pad)
    const ry1 = Math.min(fullH, offsetY + Math.min(h, (y1 + 1) * CELL) + pad)
    boxes.push({ x: rx, y: ry, w: rx1 - rx, h: ry1 - ry })
  }
  // 겹치는 구역 합치기
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          const x = Math.min(a.x, b.x)
          const y = Math.min(a.y, b.y)
          boxes[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
          boxes.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }
  return boxes
}
