import clsx from 'clsx'
import { Dices, Eye, GitBranch, RefreshCw, RotateCw, Shuffle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Field, Panel, Textarea, toast } from '@/ui'
import { diceRanking, ladderResult, makeLadder, rollDie, spinAngle, spinPick, splitNames, tracePath, type DiceRow, type Ladder, type Slice } from './games'
import { shuffle } from './raffle'

const PALETTE = ['#e5484d', '#3a9ad9', '#f5b800', '#4caf50', '#8e5bd8', '#f07f2e', '#1fa39a', '#d6409f', '#6b7280', '#0b7a53', '#a0522d', '#2f6fde']

export default function GamesTab() {
  return (
    <div className="flex flex-col gap-5">
      <LadderGame />
      <div className="grid gap-5 xl:grid-cols-2">
        <Roulette />
        <DiceGame />
      </div>
    </div>
  )
}

function GameHead({ icon: Icon, title, hint }: { icon: typeof Dices; title: string; hint: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h2 className="flex items-center gap-1.5 text-lg font-bold text-ink">
        <Icon className="size-5 text-brand" aria-hidden /> {title}
      </h2>
      <span className="text-sm text-muted">{hint}</span>
    </div>
  )
}

// ── 사다리타기 ────────────────────────────────────────────
const COL_W = 96
const ROW_H = 30
const TOP = 46

function ladderPoints(l: Ladder, start: number): Array<[number, number]> {
  const path = tracePath(l, start)
  const x = (c: number) => COL_W / 2 + c * COL_W
  const pts: Array<[number, number]> = [[x(start), TOP]]
  l.rungs.forEach((_, lv) => {
    const y = TOP + (lv + 0.5) * ROW_H + ROW_H / 2
    pts.push([x(path[lv]), y])
    if (path[lv + 1] !== path[lv]) pts.push([x(path[lv + 1]), y])
  })
  pts.push([x(path.at(-1)!), TOP + (l.levels + 1) * ROW_H])
  return pts
}
const lengthOf = (pts: Array<[number, number]>) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)

function LadderGame() {
  const [playersText, setPlayersText] = useState('민수\n지영\n철수\n영희\n동현')
  const [resultsText, setResultsText] = useState('커피 쏘기\n꽝\n꽝\n당첨!\n꽝')
  const [ladder, setLadder] = useState<Ladder | null>(null)
  const [names, setNames] = useState<string[]>([])
  const [results, setResults] = useState<string[]>([])
  /** 길을 그린 사람(출발 번호) */
  const [shown, setShown] = useState<number[]>([])
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const build = () => {
    const ps = splitNames(playersText).slice(0, 12)
    if (ps.length < 2) return toast.error('참가자를 두 명 이상 넣어 주세요.')
    const rs = splitNames(resultsText)
    // 결과가 모자라면 ‘꽝’으로 채우고, 남으면 자른다. 결과 자리는 섞는다(어디에 무엇이 있는지 모르게)
    const filled = Array.from({ length: ps.length }, (_, i) => rs[i] ?? '꽝')
    timers.current.forEach(clearTimeout)
    setNames(ps)
    setResults(shuffle(filled))
    setLadder(makeLadder(ps.length))
    setShown([])
  }
  const reveal = (i: number) => setShown((s) => (s.includes(i) ? s : [...s, i]))
  const revealAll = () => {
    if (!ladder) return
    timers.current.forEach(clearTimeout)
    names.forEach((_, i) => timers.current.push(window.setTimeout(() => reveal(i), i * 900)))
  }
  const end = ladder ? ladderResult(ladder) : []
  const width = (ladder?.n ?? 0) * COL_W
  const height = ladder ? TOP + (ladder.levels + 1) * ROW_H + 44 : 0

  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <GameHead icon={GitBranch} title="사다리타기" hint="참가자와 결과를 넣고 사다리를 만든 뒤, 이름을 누르거나 ‘모두 공개’" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="참가자(한 줄에 한 명, 최대 12명)">{(id) => <Textarea id={id} value={playersText} onChange={(e) => setPlayersText(e.target.value)} className="min-h-28!" />}</Field>
        <Field label="결과(모자라면 ‘꽝’으로 채움)">{(id) => <Textarea id={id} value={resultsText} onChange={(e) => setResultsText(e.target.value)} className="min-h-28!" />}</Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Shuffle} onClick={build}>
          {ladder ? '사다리 새로 만들기' : '사다리 만들기'}
        </Button>
        {ladder && (
          <Button icon={Eye} onClick={revealAll} disabled={shown.length === names.length}>
            모두 공개
          </Button>
        )}
      </div>
      {ladder && (
        <div className="overflow-x-auto rounded-lg border border-line bg-paper p-3">
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mx-auto block" role="img" aria-label="사다리">
            {/* 세로줄 */}
            {names.map((_, i) => (
              <line key={`v${i}`} x1={COL_W / 2 + i * COL_W} y1={TOP} x2={COL_W / 2 + i * COL_W} y2={TOP + (ladder.levels + 1) * ROW_H} stroke="var(--color-line-strong)" strokeWidth="4" strokeLinecap="round" />
            ))}
            {/* 가로줄 */}
            {ladder.rungs.flatMap((row, lv) =>
              row.map((on, i) =>
                on ? <line key={`h${lv}-${i}`} x1={COL_W / 2 + i * COL_W} x2={COL_W / 2 + (i + 1) * COL_W} y1={TOP + (lv + 1) * ROW_H} y2={TOP + (lv + 1) * ROW_H} stroke="var(--color-line-strong)" strokeWidth="4" strokeLinecap="round" /> : null,
              ),
            )}
            {/* 지나간 길 */}
            {shown.map((i) => {
              const pts = ladderPoints(ladder, i)
              const len = lengthOf(pts)
              return (
                <polyline
                  key={`p${i}`}
                  points={pts.map((p) => p.join(',')).join(' ')}
                  fill="none"
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth="5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={len}
                  strokeDashoffset={len}
                  style={{ animation: 'ladder-draw 0.9s ease-in-out forwards' }}
                />
              )
            })}
            {/* 위: 이름(누르면 길 보기) */}
            {names.map((n, i) => (
              <g key={`n${i}`} onClick={() => reveal(i)} className="cursor-pointer">
                <rect x={i * COL_W + 6} y={4} width={COL_W - 12} height={30} rx={15} fill={PALETTE[i % PALETTE.length]} />
                <text x={COL_W / 2 + i * COL_W} y={24} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">
                  {n.length > 7 ? `${n.slice(0, 6)}…` : n}
                </text>
              </g>
            ))}
            {/* 아래: 결과(길이 닿으면 열림) */}
            {results.map((r, j) => {
              const who = end.indexOf(j)
              const open = shown.includes(who)
              return (
                <g key={`r${j}`}>
                  <rect x={j * COL_W + 6} y={height - 38} width={COL_W - 12} height={30} rx={8} fill={open ? PALETTE[who % PALETTE.length] : 'var(--color-sunken)'} stroke="var(--color-line-strong)" />
                  <text x={COL_W / 2 + j * COL_W} y={height - 18} textAnchor="middle" fontSize="13" fontWeight="700" fill={open ? '#fff' : 'var(--color-muted)'}>
                    {open ? (r.length > 7 ? `${r.slice(0, 6)}…` : r) : '?'}
                  </text>
                </g>
              )
            })}
          </svg>
          <style>{'@keyframes ladder-draw { to { stroke-dashoffset: 0 } }'}</style>
        </div>
      )}
      {ladder && shown.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {shown.map((i) => (
            <li key={i} className="rounded-full border border-line bg-surface px-3 py-1 text-sm">
              <b style={{ color: PALETTE[i % PALETTE.length] }}>{names[i]}</b> → <b>{results[end[i]]}</b>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ── 룰렛 ─────────────────────────────────────────────────
/** 칸 글자를 바퀴 반지름 방향으로, 왼쪽 반에서도 뒤집히지 않게 */
const textTurn = (mid: number) => {
  const deg = (mid * 180) / Math.PI
  return deg < 180 ? deg - 90 : deg + 90
}
function parseSlices(text: string): Slice[] {
  return splitNames(text)
    .slice(0, 24)
    .map((line) => {
      const m = /^(.*?)\s*[*×x]\s*(\d{1,2})$/.exec(line)
      return m ? { label: m[1], weight: Math.max(1, Number(m[2])) } : { label: line, weight: 1 }
    })
}

function Roulette() {
  const [text, setText] = useState('아메리카노\n라떼\n꽝\n한 번 더\n케이크*2\n꽝')
  const slices = useMemo(() => parseSlices(text), [text])
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [removeHit, setRemoveHit] = useState(false)
  const pending = useRef<number | null>(null)
  const total = slices.reduce((s, x) => s + x.weight, 0)

  const spin = () => {
    if (slices.length < 2) return toast.error('칸을 두 개 이상 넣어 주세요.')
    const pick = spinPick(slices)
    pending.current = pick
    setResult(null)
    setSpinning(true)
    setRotation((r) => spinAngle(slices, pick, r))
  }
  const done = () => {
    setSpinning(false)
    const i = pending.current
    if (i == null) return
    setResult(slices[i].label)
    if (removeHit) {
      // 맞은 칸을 목록에서 한 번 뺀다(다음 사람용)
      const lines = splitNames(text)
      lines.splice(i, 1)
      setTimeout(() => setText(lines.join('\n')), 1200)
    }
  }
  const R = 150
  let acc = 0
  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <GameHead icon={RotateCw} title="룰렛" hint="칸 이름 뒤에 *2 처럼 쓰면 그 칸이 두 배로 커집니다" />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-2">
          <Field label="칸(한 줄에 하나, 최대 24칸)">{(id) => <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} className="min-h-40!" disabled={spinning} />}</Field>
          <Checkbox checked={removeHit} onChange={setRemoveHit} label="맞은 칸은 빼고 다음 판" />
          <Button variant="primary" icon={RotateCw} onClick={spin} disabled={spinning}>
            {spinning ? '도는 중…' : '돌리기'}
          </Button>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="relative" style={{ width: R * 2 + 8, height: R * 2 + 8 }}>
            <svg viewBox={`${-R - 4} ${-R - 4} ${R * 2 + 8} ${R * 2 + 8}`} width={R * 2 + 8} height={R * 2 + 8} style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? 'transform 4.6s cubic-bezier(.12,.66,.15,1)' : 'none' }} onTransitionEnd={done} role="img" aria-label="룰렛 판">
              {slices.map((s, i) => {
                const a0 = (acc / total) * 2 * Math.PI
                acc += s.weight
                const a1 = (acc / total) * 2 * Math.PI
                // 0도 = 위쪽, 시계방향
                const p = (a: number) => [R * Math.sin(a), -R * Math.cos(a)]
                const [x0, y0] = p(a0)
                const [x1, y1] = p(a1)
                const mid = (a0 + a1) / 2
                const large = a1 - a0 > Math.PI ? 1 : 0
                const tx = 0.62 * R * Math.sin(mid)
                const ty = -0.62 * R * Math.cos(mid)
                return (
                  <g key={i}>
                    <path d={`M0 0 L${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`} fill={PALETTE[i % PALETTE.length]} stroke="#fff" strokeWidth="2" />
                    <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize={slices.length > 12 ? 10 : 13} fontWeight="700" fill="#fff" transform={`rotate(${textTurn(mid)} ${tx} ${ty})`}>
                      {s.label.length > 8 ? `${s.label.slice(0, 7)}…` : s.label}
                    </text>
                  </g>
                )
              })}
              <circle r="18" fill="#fff" stroke="var(--color-line-strong)" strokeWidth="3" />
            </svg>
            {/* 바늘(위) */}
            <div className="absolute top-[-6px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[22px] border-x-transparent border-t-ink" aria-hidden />
          </div>
          <p className={clsx('min-h-8 text-2xl font-black', result ? 'text-accent' : 'text-faint')} aria-live="polite">
            {result ? `🎉 ${result}` : spinning ? '…' : '돌려 보세요'}
          </p>
        </div>
      </div>
    </Panel>
  )
}

// ── 주사위 두 개 ─────────────────────────────────────────
const PIPS: Record<number, Array<[number, number]>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
}
function Die({ v, size = 34 }: { v: number; size?: number }) {
  return (
    <svg viewBox="0 0 30 30" width={size} height={size} role="img" aria-label={`주사위 ${v}`}>
      <rect x="1" y="1" width="28" height="28" rx="6" fill="#fff" stroke="var(--color-line-strong)" strokeWidth="1.5" />
      {PIPS[v]?.map(([cx, cy], i) => (
        <circle key={i} cx={7 + cx * 8} cy={7 + cy * 8} r="2.8" fill={v === 1 ? '#e5484d' : 'var(--color-ink)'} />
      ))}
    </svg>
  )
}

function DiceGame() {
  const [text, setText] = useState('민수\n지영\n철수\n영희')
  const [rows, setRows] = useState<DiceRow[] | null>(null)
  const [rolling, setRolling] = useState<Array<[number, number]> | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => void (timer.current && clearInterval(timer.current)), [])
  const names = splitNames(text).slice(0, 30)
  const roll = () => {
    if (names.length < 2) return toast.error('두 명 이상 넣어 주세요.')
    setRows(null)
    let n = 0
    timer.current && clearInterval(timer.current)
    timer.current = window.setInterval(() => {
      setRolling(names.map(() => [rollDie(), rollDie()]))
      if (++n > 14) {
        clearInterval(timer.current!)
        setRolling(null)
        setRows(diceRanking(names))
      }
    }, 70)
  }
  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <GameHead icon={Dices} title="주사위 두 개 합으로 순위" hint="합이 큰 사람이 1등, 같으면 그 사람들끼리 다시 굴려 가립니다" />
      <Field label="참가자(한 줄에 한 명)">{(id) => <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} className="min-h-28!" />}</Field>
      <div>
        <Button variant="primary" icon={rows ? RefreshCw : Dices} onClick={roll} disabled={Boolean(rolling)}>
          {rows ? '다시 굴리기' : '굴리기'}
        </Button>
      </div>
      {rolling && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {names.map((n, i) => (
            <li key={n + i} className="flex items-center gap-2 rounded-md border border-line bg-paper px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{n}</span>
              <Die v={rolling[i][0]} size={26} />
              <Die v={rolling[i][1]} size={26} />
            </li>
          ))}
        </ul>
      )}
      {rows && (
        <ol className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const [a, b] = r.rolls[0]
            return (
              <li key={r.name + r.rank} className={clsx('flex flex-wrap items-center gap-3 rounded-md border px-3 py-2', r.rank === 1 ? 'border-mark bg-mark-soft' : 'border-line bg-paper')}>
                <span className="w-10 text-lg font-black">{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}등`}</span>
                <span className="min-w-0 flex-1 truncate text-base font-bold text-ink">{r.name}</span>
                <Die v={a} />
                <Die v={b} />
                <span className="num w-10 text-right text-lg font-black text-ink">{a + b}</span>
                {r.rolls.length > 1 && (
                  <span className="w-full text-xs text-muted sm:w-auto">
                    동점 재굴림 {r.rolls.slice(1).map(([x, y]) => `${x}+${y}=${x + y}`).join(' → ')}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}
