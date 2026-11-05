/**
 * 게임 — 사다리타기·룰렛·주사위 두 개 합 순위. 모두 암호용 난수(randomInt)로 뽑는다.
 */
import { randomInt } from './raffle'

/** 줄 나누기: 줄바꿈·쉼표 */
export const splitNames = (text: string) =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)

// ── 사다리 ───────────────────────────────────────────────
export interface Ladder {
  /** 세로줄 수 */
  n: number
  /** 가로 칸(층) 수 */
  levels: number
  /** rungs[층][i] = i 번과 i+1 번 세로줄 사이에 가로줄이 있는지 */
  rungs: boolean[][]
}

/** 가로줄 무작위로 놓기: 한 층에서 이웃한 가로줄은 붙지 않게, 모든 사이에 적어도 하나 */
export function makeLadder(n: number, levels = Math.max(8, n * 2 + 2)): Ladder {
  const rungs: boolean[][] = []
  for (let l = 0; l < levels; l++) {
    const row: boolean[] = []
    for (let i = 0; i < n - 1; i++) row.push(!row[i - 1] && randomInt(100) < 42)
    rungs.push(row)
  }
  // 비어 있는 사이가 있으면 그 사이에 하나 넣는다(이웃과 붙지 않는 층에)
  for (let i = 0; i < n - 1; i++) {
    if (rungs.some((r) => r[i])) continue
    const free = rungs.map((r, l) => (!r[i - 1] && !r[i + 1] ? l : -1)).filter((l) => l >= 0)
    const l = free.length ? free[randomInt(free.length)] : randomInt(levels)
    rungs[l][i] = true
    if (rungs[l][i - 1]) rungs[l][i - 1] = false
    if (rungs[l][i + 1]) rungs[l][i + 1] = false
  }
  return { n, levels, rungs }
}

/** 한 세로줄에서 내려가는 길: 층마다 [세로줄 번호] (처음 + 층마다 지난 뒤), 마지막이 도착 */
export function tracePath(ladder: Ladder, start: number): number[] {
  const path = [start]
  let c = start
  for (const row of ladder.rungs) {
    if (row[c]) c += 1
    else if (row[c - 1]) c -= 1
    path.push(c)
  }
  return path
}

/** 출발 i → 도착 번호 */
export const ladderResult = (ladder: Ladder) => Array.from({ length: ladder.n }, (_, i) => tracePath(ladder, i).at(-1)!)

// ── 룰렛 ─────────────────────────────────────────────────
export interface Slice {
  label: string
  weight: number
}
/** 무게(칸 크기)에 비례해 하나 고르기 */
export function spinPick(slices: Slice[]): number {
  const total = slices.reduce((s, x) => s + Math.max(0, x.weight), 0)
  if (total <= 0) throw new Error('칸이 없습니다.')
  let r = randomInt(total)
  for (let i = 0; i < slices.length; i++) {
    r -= Math.max(0, slices[i].weight)
    if (r < 0) return i
  }
  return slices.length - 1
}
/** 고른 칸의 가운데쯤(조금 흔들어)이 위쪽 바늘에 오도록 돌릴 각도(도) */
export function spinAngle(slices: Slice[], pick: number, from: number, turns = 6): number {
  const total = slices.reduce((s, x) => s + Math.max(0, x.weight), 0)
  const before = slices.slice(0, pick).reduce((s, x) => s + Math.max(0, x.weight), 0)
  const size = (Math.max(0, slices[pick].weight) / total) * 360
  const jitter = (randomInt(600) / 1000 - 0.3) * size // 칸 안 ±30%
  const center = (before / total) * 360 + size / 2 + jitter
  // 바퀴가 시계방향으로 돌면 바늘(위) 아래에 오는 각도 = 360 - center
  const target = (360 - center + 360) % 360
  const base = from - (from % 360)
  return base + turns * 360 + target
}

// ── 주사위 두 개 ─────────────────────────────────────────
export interface DiceRow {
  name: string
  /** 굴린 기록: [[주사위1, 주사위2], …] — 첫째가 본 굴림, 그 뒤는 동점 재굴림 */
  rolls: Array<[number, number]>
  rank: number
}
export const rollDie = () => randomInt(6) + 1
const sumOf = (r: [number, number]) => r[0] + r[1]

/**
 * 모두 두 개씩 굴려 합이 큰 순서로 순위. 합이 같으면 그 사람들끼리 다시 굴려 가린다(동점이 없어질 때까지).
 */
export function diceRanking(names: string[], roll: () => number = rollDie): DiceRow[] {
  const rows: DiceRow[] = names.map((name) => ({ name, rolls: [[roll(), roll()]], rank: 0 }))
  const order = (group: DiceRow[], depth: number): DiceRow[] => {
    if (group.length <= 1) return group
    const by = new Map<number, DiceRow[]>()
    for (const r of group) {
      const s = sumOf(r.rolls[depth])
      by.set(s, [...(by.get(s) ?? []), r])
    }
    const out: DiceRow[] = []
    for (const s of [...by.keys()].sort((a, b) => b - a)) {
      const tied = by.get(s)!
      if (tied.length > 1) {
        for (const t of tied) t.rolls.push([roll(), roll()])
        out.push(...order(tied, depth + 1))
      } else out.push(tied[0])
    }
    return out
  }
  const ranked = order(rows, 0)
  ranked.forEach((r, i) => (r.rank = i + 1))
  return ranked
}
