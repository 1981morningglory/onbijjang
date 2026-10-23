/**
 * 사주 그림 도표 — 오행 상생상극 오각형, 십신 도넛, 일간 힘 게이지, 레이더(AI 점수).
 * 색은 모두 app.css 의 오행 토큰(var(--color-wood) 등)을 쓴다.
 */
import clsx from 'clsx'
import { CloudDrizzle, Flame, Flower2, Gem, Mountain, Pickaxe, Sun, TreePine, WavesHorizontal, Wheat, type LucideIcon } from 'lucide-react'
import { GROUP_DETAIL } from './guide'
import { CONTROLS, ELEMENTS, GENERATES, TEN_GROUP_NOTE, TEN_GROUPS, stemElement, type Element, type TenGroup } from './logic'

export const EL_VAR: Record<Element, string> = { 목: 'var(--color-wood)', 화: 'var(--color-fire)', 토: 'var(--color-earth)', 금: 'var(--color-metal)', 수: 'var(--color-water)' }
export const EL_SOFT: Record<Element, string> = { 목: 'var(--color-wood-soft)', 화: 'var(--color-fire-soft)', 토: 'var(--color-earth-soft)', 금: 'var(--color-metal-soft)', 수: 'var(--color-water-soft)' }
export const EL_HANJA: Record<Element, string> = { 목: '木', 화: '火', 토: '土', 금: '金', 수: '水' }
export const EL_TEXT: Record<Element, string> = { 목: 'text-wood', 화: 'text-fire', 토: 'text-earth', 금: 'text-metal', 수: 'text-water' }
export const EL_BOX: Record<Element, string> = {
  목: 'bg-wood-soft border-wood/30',
  화: 'bg-fire-soft border-fire/30',
  토: 'bg-earth-soft border-earth/30',
  금: 'bg-metal-soft border-metal/30',
  수: 'bg-water-soft border-water/30',
}
export const EL_BAR: Record<Element, string> = { 목: 'bg-wood', 화: 'bg-fire', 토: 'bg-earth', 금: 'bg-metal', 수: 'bg-water' }
export const EL_NAME: Record<Element, string> = { 목: '목(木)', 화: '화(火)', 토: '토(土)', 금: '금(金)', 수: '수(水)' }

/** 일간(천간) 그림 */
export const STEM_ICON: Record<string, LucideIcon> = {
  갑: TreePine, 을: Flower2, 병: Sun, 정: Flame, 무: Mountain, 기: Wheat, 경: Pickaxe, 신: Gem, 임: WavesHorizontal, 계: CloudDrizzle,
}

/** 일간 그림 동그라미 */
export function StemBadge({ stem, size = 72 }: { stem: string; size?: number }) {
  const el = stemElement(stem)
  const Icon = STEM_ICON[stem]
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full border-2" style={{ width: size, height: size, background: EL_SOFT[el], borderColor: EL_VAR[el], color: EL_VAR[el] }}>
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.8} aria-hidden />
    </span>
  )
}

// ── 오행 상생상극 오각형 ─────────────────────────────────
const CX = 160
const CY = 150
const R = 104
const ANGLE: Record<Element, number> = { 목: -90, 화: -18, 토: 54, 금: 126, 수: 198 }
const pos = (e: Element) => {
  const a = (ANGLE[e] * Math.PI) / 180
  return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) }
}
const nodeR = (n: number) => 17 + Math.min(n, 5) * 6

/** 두 원 사이 선(가장자리에서 가장자리로) */
function edge(a: Element, b: Element, ra: number, rb: number, gap = 5) {
  const p = pos(a)
  const q = pos(b)
  const dx = q.x - p.x
  const dy = q.y - p.y
  const d = Math.hypot(dx, dy)
  const ux = dx / d
  const uy = dy / d
  return { x1: p.x + ux * (ra + gap), y1: p.y + uy * (ra + gap), x2: q.x - ux * (rb + gap + 4), y2: q.y - uy * (rb + gap + 4) }
}

export function ElementCycle({ counts, dayEl }: { counts: Record<Element, number>; dayEl: Element }) {
  return (
    <figure className="flex flex-col items-center gap-2">
      <svg viewBox="-20 -6 360 320" className="w-full max-w-[22rem]" role="img" aria-label={`오행 분포: ${ELEMENTS.map((e) => `${e} ${counts[e]}개`).join(', ')}`}>
        <defs>
          {ELEMENTS.map((e) => (
            <marker key={e} id={`arr-${e}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill={EL_VAR[e]} />
            </marker>
          ))}
          <marker id="arr-ctl" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--color-faint)" />
          </marker>
        </defs>
        {/* 상극(점선 별) */}
        {ELEMENTS.map((e) => {
          const t = CONTROLS[e]
          const l = edge(e, t, nodeR(counts[e]), nodeR(counts[t]), 3)
          return <line key={`c${e}`} {...l} stroke="var(--color-faint)" strokeWidth="1.4" strokeDasharray="4 4" markerEnd="url(#arr-ctl)" opacity="0.7" />
        })}
        {/* 상생(바깥 굵은 화살) */}
        {ELEMENTS.map((e) => {
          const t = GENERATES[e]
          const l = edge(e, t, nodeR(counts[e]), nodeR(counts[t]))
          // 바깥쪽으로 살짝 휜 곡선
          const mx = (l.x1 + l.x2) / 2
          const my = (l.y1 + l.y2) / 2
          const ox = mx - CX
          const oy = my - CY
          const od = Math.hypot(ox, oy) || 1
          const cx = mx + (ox / od) * 18
          const cy = my + (oy / od) * 18
          return <path key={`g${e}`} d={`M${l.x1} ${l.y1} Q${cx} ${cy} ${l.x2} ${l.y2}`} fill="none" stroke={EL_VAR[e]} strokeWidth="3" markerEnd={`url(#arr-${e})`} opacity="0.85" />
        })}
        {/* 오행 동그라미 */}
        {ELEMENTS.map((e) => {
          const p = pos(e)
          const r = nodeR(counts[e])
          const empty = counts[e] === 0
          return (
            <g key={e}>
              {e === dayEl && <circle cx={p.x} cy={p.y} r={r + 6} fill="none" stroke={EL_VAR[e]} strokeWidth="2" strokeDasharray="3 3" />}
              <circle cx={p.x} cy={p.y} r={r} fill={empty ? 'var(--color-surface)' : EL_SOFT[e]} stroke={EL_VAR[e]} strokeWidth={empty ? 1.5 : 2.5} strokeDasharray={empty ? '4 3' : undefined} />
              <text x={p.x} y={p.y + 2} textAnchor="middle" dominantBaseline="middle" fontSize={r > 30 ? 24 : 18} fontWeight="700" fill={EL_VAR[e]}>
                {EL_HANJA[e]}
              </text>
              {(() => {
                // 이름표는 가운데에서 바깥쪽으로 밀어 화살표·점선과 겹치지 않게
                const a = (ANGLE[e] * Math.PI) / 180
                const d = r + (e === dayEl ? 22 : 15)
                const lx = p.x + d * Math.cos(a)
                const ly = p.y + d * Math.sin(a)
                const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end'
                return (
                  <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize="13.5" fontWeight="700" fill="var(--color-ink-2)">
                    {e} {counts[e]}
                    {e === dayEl ? ' · 나' : ''}
                  </text>
                )
              })()}
            </g>
          )
        })}
      </svg>
      <figcaption className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <b className="text-ink-2">━▶</b> 상생: 도와주는 흐름
        </span>
        <span>
          <b className="text-faint">┅▶</b> 상극: 눌러 주는 관계
        </span>
        <span>동그라미 크기 = 글자 수</span>
      </figcaption>
    </figure>
  )
}

// ── 십신 다섯 갈래 도넛 ─────────────────────────────────
/** 일간 오행에서 본 각 갈래의 오행 */
export function groupElement(group: TenGroup, dayEl: Element): Element {
  const gen = GENERATES
  const ctl = CONTROLS
  const genBy = ELEMENTS.find((e) => gen[e] === dayEl)!
  const ctlBy = ELEMENTS.find((e) => ctl[e] === dayEl)!
  return { 비겁: dayEl, 식상: gen[dayEl], 재성: ctl[dayEl], 관성: ctlBy, 인성: genBy }[group]
}

export function TenGroupDonut({ counts, dayEl, hourKnown }: { counts: Record<TenGroup, number>; dayEl: Element; hourKnown: boolean }) {
  const total = TEN_GROUPS.reduce((a, g) => a + counts[g], 0) || 1
  const rr = 48
  const C = 2 * Math.PI * rr
  let acc = 0
  const max = Math.max(...TEN_GROUPS.map((x) => counts[x]))
  const top = TEN_GROUPS.filter((g) => counts[g] === max)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
        <svg viewBox="0 0 120 120" className="size-32 shrink-0" role="img" aria-label={`십신 분포: ${TEN_GROUPS.map((g) => `${g} ${counts[g]}개`).join(', ')}`}>
          <circle cx="60" cy="60" r={rr} fill="none" stroke="var(--color-sunken)" strokeWidth="18" />
          {TEN_GROUPS.map((g) => {
            const len = (counts[g] / total) * C
            const el = groupElement(g, dayEl)
            const seg = (
              <circle key={g} cx="60" cy="60" r={rr} fill="none" stroke={EL_VAR[el]} strokeWidth="18" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)" />
            )
            acc += len
            return seg
          })}
          <text x="60" y="56" textAnchor="middle" fontSize={top.length > 1 ? 13 : 16.5} fontWeight="800" fill="var(--color-ink)">
            {top.length > 2 ? `${top[0]} 외` : top.join('·')}
          </text>
          <text x="60" y="73" textAnchor="middle" fontSize="10.5" fill="var(--color-muted)">
            가장 많아요
          </text>
        </svg>
        <p className="text-sm leading-relaxed text-ink-2">
          <b>숫자는 글자 수입니다.</b> 내 사주 {hourKnown ? '여덟' : '여섯'} 글자 중 ‘나’(일간)를 뺀 <b>{total}글자</b>가 나와 어떤 관계인지 다섯 갈래로 나눠 셌습니다. 많을수록 그 성향이 강하게 드러납니다.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
        {TEN_GROUPS.map((g) => {
          const el = groupElement(g, dayEl)
          const d = GROUP_DETAIL[g]
          const n = counts[g]
          return (
            <li key={g} className={clsx('grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 px-3 py-2.5', n === 0 && 'bg-paper')}>
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: EL_VAR[el] }} />
                  <b className="text-base text-ink">{g}</b>
                  <span className="text-xs text-faint">{d.hanja}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="flex gap-0.5" aria-hidden>
                    {Array.from({ length: Math.max(total, 5) }, (_, i) => (
                      <span key={i} className="size-2 rounded-full" style={{ background: i < n ? EL_VAR[el] : 'var(--color-sunken)' }} />
                    ))}
                  </span>
                </span>
                <span className={clsx('num text-sm font-bold', n === 0 ? 'text-faint' : 'text-ink')}>{n}개</span>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm font-semibold text-ink">
                  {TEN_GROUP_NOTE[g].short}{' '}
                  <span className="font-normal text-muted">
                    · {d.members} · {d.relation}(<b style={{ color: EL_VAR[el] }}>{EL_HANJA[el]}</b>)
                  </span>
                </p>
                <p className="text-sm leading-relaxed text-ink-2">{d.meaning}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── 일간 힘 게이지(반원) ─────────────────────────────────
export function StrengthGauge({ score, label }: { score: number; label: string }) {
  const arc = (from: number, to: number) => {
    const a = (v: number) => Math.PI * (1 - v / 100)
    const p = (v: number) => ({ x: 70 + 54 * Math.cos(a(v)), y: 70 - 54 * Math.sin(a(v)) })
    const s = p(from)
    const e = p(to)
    return `M${s.x} ${s.y} A54 54 0 0 1 ${e.x} ${e.y}`
  }
  const ang = Math.PI * (1 - Math.min(100, Math.max(0, score)) / 100)
  return (
    <svg viewBox="0 0 140 86" className="w-40" role="img" aria-label={`일간의 힘 ${score}점, ${label}`}>
      <path d={arc(0, 40)} fill="none" stroke="var(--color-water)" strokeWidth="12" opacity="0.75" />
      <path d={arc(41, 54)} fill="none" stroke="var(--color-brand)" strokeWidth="12" opacity="0.75" />
      <path d={arc(55, 100)} fill="none" stroke="var(--color-fire)" strokeWidth="12" opacity="0.75" />
      <line x1="70" y1="70" x2={70 + 44 * Math.cos(ang)} y2={70 - 44 * Math.sin(ang)} stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="70" cy="70" r="5" fill="var(--color-ink)" />
      <text x="12" y="84" fontSize="10.5" fill="var(--color-muted)">
        신약
      </text>
      <text x="62" y="12" fontSize="10.5" fill="var(--color-muted)">
        중화
      </text>
      <text x="112" y="84" fontSize="10.5" fill="var(--color-muted)">
        신강
      </text>
    </svg>
  )
}

// ── 레이더(AI 점수 1~5) ─────────────────────────────────
export function Radar({ items }: { items: Array<{ label: string; value: number }> }) {
  const n = items.length
  const c = 110
  const rad = 78
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return { x: c + rad * (v / 5) * Math.cos(a), y: c + rad * (v / 5) * Math.sin(a) }
  }
  const poly = (v: (i: number) => number) => items.map((_, i) => pt(i, v(i))).map((p) => `${p.x},${p.y}`).join(' ')
  return (
    <svg viewBox="0 0 220 220" className="w-full max-w-[17rem]" role="img" aria-label={items.map((x) => `${x.label} ${x.value}점`).join(', ')}>
      {[1, 2, 3, 4, 5].map((lv) => (
        <polygon key={lv} points={poly(() => lv)} fill={lv === 5 ? 'var(--color-paper)' : 'none'} stroke="var(--color-line)" strokeWidth="1" />
      ))}
      {items.map((_, i) => {
        const p = pt(i, 5)
        return <line key={i} x1={c} y1={c} x2={p.x} y2={p.y} stroke="var(--color-line)" />
      })}
      <polygon points={poly((i) => items[i].value)} fill="var(--color-accent)" fillOpacity="0.22" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinejoin="round" />
      {items.map((x, i) => {
        const p = pt(i, x.value)
        return <circle key={x.label} cx={p.x} cy={p.y} r="3.5" fill="var(--color-accent)" />
      })}
      {items.map((x, i) => {
        const p = pt(i, 6.15)
        return (
          <text key={x.label} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="12.5" fontWeight="700" fill="var(--color-ink-2)">
            {x.label} {x.value}
          </text>
        )
      })}
    </svg>
  )
}

/** 별점(1~5) */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={clsx('inline-flex gap-0.5', className)} aria-label={`5점 중 ${value}점`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 20 20" className="size-3.5" aria-hidden>
          <path d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z" fill={i <= value ? 'var(--color-mark)' : 'var(--color-sunken)'} stroke={i <= value ? 'var(--color-warn)' : 'var(--color-line-strong)'} strokeWidth="1" />
        </svg>
      ))}
    </span>
  )
}
