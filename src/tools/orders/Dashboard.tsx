// 주문서만들기 — 통계 대시보드 탭
// 숫자는 서버(/api/orders/stats)가 기간별로 모아 준다(고객 개인정보 없음). 그래프는 SVG·HTML 로 직접 그리고,
// 처음 보일 때·기간이나 기준을 바꿀 때 막대가 자라고 선이 그려지며 숫자가 올라간다(움직임 줄이기 설정이면 바로 보인다).
// 색: 검증한 범주 색 순서(설문폼 그래프와 같은 SERIES). 글자는 늘 글자색, 색만으로 구분하지 않게 이름·값을 함께 적는다.
import clsx from 'clsx'
import { BarChart3, CalendarDays, ChartLine, Crown, MapPin, Package, Receipt, RefreshCw, ShoppingBag, Store, TrendingDown, TrendingUp, Undo2, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { Callout, EmptyState, IconButton, Segmented, Spinner, TextInput } from '@/ui'
import { SERIES } from '@/tools/forms/charts'
import { change, dayKind, daysBetween, HOLIDAYS, fmt, kstToday, METRIC_LABEL, metricText, niceScale, presetRange, PRESETS, shortDay, WEEK_ORDER, WEEKDAYS, won, type DayStat, type Metric, type NamedStat, type Preset, type ProductStat, type Stats, type WeekdayStat } from './stats'

/** 기준마다 한 색(한 그래프에는 한 기준만 그린다) */
const METRIC_COLOR: Record<Metric, string> = { orders: SERIES[0], qty: SERIES[1], amount: SERIES[2], lines: SERIES[3] }
/** 날짜별·요일별은 주문줄수까지, 거래처·상품·지역은 세 기준 */
const WITH_LINES: Metric[] = ['orders', 'lines', 'qty', 'amount']
const OTHER = '#a8a49a'

// ── 작은 도구 ─────────────────────────────────────────────
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
/** 숫자가 0(또는 이전 값)에서 목표까지 올라간다 */
function useCountUp(value: number, ms = 1000) {
  const [shown, setShown] = useState(reduced() ? value : 0)
  const from = useRef(shown)
  useEffect(() => {
    if (reduced()) {
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const e = 1 - (1 - k) ** 3
      const v = a + (value - a) * e
      from.current = v
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

function Card({ title, icon: Icon, right, children, className, delay = 0 }: { title: string; icon: LucideIcon; right?: ReactNode; children: ReactNode; className?: string; delay?: number }) {
  return (
    <section className={clsx('animate-rise flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-1 sm:p-5', className)} style={{ animationDelay: `${delay}ms` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand-ink">
          <Icon className="size-4" aria-hidden />
        </span>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </section>
  )
}

function MetricSwitch({ value, onValue, hasAmount, only }: { value: Metric; onValue: (m: Metric) => void; hasAmount: boolean; only?: Metric[] }) {
  const list = (only ?? (['orders', 'qty', 'amount'] as Metric[])).filter((m) => m !== 'amount' || hasAmount)
  if (list.length < 2) return null
  return <Segmented size="sm" label="기준" value={value} onValue={onValue} options={list.map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />
}

// ── 숫자 카드 ─────────────────────────────────────────────
/** 카드 큰 숫자 옆에 함께 보이는 둘째 숫자(예: 주문건수 옆 주문줄수) */
interface KpiExtra {
  label: string
  value: number
  before?: number | null
  format: (n: number) => string
}
function Kpi({ icon: Icon, label, value, format, before, sub, delay, invert, extra }: { icon: LucideIcon; label: string; value: number; format: (n: number) => string; before?: number | null; sub?: ReactNode; delay: number; invert?: boolean; extra?: KpiExtra }) {
  const shown = useCountUp(value)
  const shownExtra = useCountUp(extra?.value ?? 0)
  const pctExtra = extra ? change(extra.value, extra.before) : null
  const pct = change(value, before)
  const up = pct != null && pct > 0
  const good = pct == null || pct === 0 ? null : invert ? !up : up
  return (
    <div className="animate-rise relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-1" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-2 text-sm text-muted">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <div className="num flex min-w-0 items-baseline gap-1.5 truncate">
        <span className="text-2xl font-bold tracking-tight text-ink sm:text-[26px]">{format(shown)}</span>
        {extra && (
          <span className="truncate text-base font-semibold text-ink-2" title={extra.label}>
            / {extra.format(shownExtra)}
          </span>
        )}
      </div>
      <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        {pct != null ? (
          <span className={clsx('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold', good === null ? 'bg-sunken text-ink-2' : good ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
            {up ? <TrendingUp className="size-3" aria-hidden /> : pct < 0 ? <TrendingDown className="size-3" aria-hidden /> : null}
            {pct > 0 ? '+' : ''}
            {pct}%
          </span>
        ) : before === 0 && value > 0 ? (
          <span className="rounded-full bg-sunken px-1.5 py-0.5 font-semibold text-ink-2">새로</span>
        ) : null}
        {extra && pctExtra != null && (
          <span className="inline-flex items-center rounded-full bg-sunken px-1.5 py-0.5 font-semibold text-ink-2" title={`${extra.label} 지난 기간 대비`}>
            줄 {pctExtra > 0 ? '+' : ''}
            {pctExtra}%
          </span>
        )}
        {sub && <span className="truncate text-muted">{sub}</span>}
      </div>
    </div>
  )
}

/** 선 그래프를 왼쪽부터 드러내는 덮개 — 다 걷히면 아예 지운다 */
function WipeCover({ x, width, height }: { x: number; width: number; height: number }) {
  const [done, setDone] = useState(reduced())
  if (done) return null
  return <rect x={x} y={0} width={width} height={height} fill="var(--color-surface)" className="animate-wipe" style={{ transformBox: 'fill-box' }} onAnimationEnd={() => setDone(true)} />
}

// ── 날짜별 추이(선·막대) ──────────────────────────────────
/** 토요일 파랑·일요일과 공휴일 빨강(진하지 않게) */
const DAY_COLOR = { sat: '#3f74d0', sun: '#d24a3c', holiday: '#d24a3c' } as const
const dayColor = (date: string) => {
  const k = dayKind(date)
  return k === 'weekday' ? undefined : DAY_COLOR[k]
}
/** 위만 둥근 막대 */
const barPath = (x0: number, y0: number, bw: number, bh: number) => {
  const r = Math.min(3, bw / 2, bh)
  return `M${x0},${y0 + bh}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${y0 + bh}Z`
}
export type TrendView = 'line' | 'bar'

function TrendChart({ data, metric, view, animKey }: { data: DayStat[]; metric: Metric; view: TrendView; animKey: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const gid = useId().replace(/:/g, '')
  const n = data.length
  const pad = { l: 52, r: 12, t: 20, b: 50 }
  const H = 300
  const vals = data.map((d) => d[metric])
  const { max, step } = niceScale(Math.max(...vals, 0))
  const pw = Math.max(10, w - pad.l - pad.r)
  const ph = H - pad.t - pad.b
  // 하루 한 칸. 점·막대는 칸 가운데
  const slot = pw / Math.max(1, n)
  const x = (i: number) => pad.l + slot * (i + 0.5)
  const y = (v: number) => pad.t + (1 - v / max) * ph
  const base = y(0)
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const area = n > 1 ? `${line}L${x(n - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z` : ''
  const avg = n ? vals.reduce((s, v) => s + v, 0) / n : 0
  const peak = vals.indexOf(Math.max(...vals))
  // 날짜는 칸이 좁지 않으면 모두(아주 긴 기간만 건너뛰며), 요일 글자는 칸이 넉넉할 때
  const every = slot >= 13 ? 1 : Math.ceil(13 / slot)
  const showDow = slot >= 12
  const color = METRIC_COLOR[metric]
  const bw = Math.max(1, Math.min(26, slot * 0.66))
  const label = (v: number) => (metric === 'amount' ? (v >= 1e4 ? `${fmt(v / 1e4)}만` : fmt(v)) : fmt(v))
  const move = (clientX: number, rect: DOMRect) => {
    const i = Math.floor((clientX - rect.left - pad.l) / slot)
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const h = hover != null ? data[hover] : null
  return (
    <div ref={ref} className="relative w-full select-none">
      {w > 0 && (
        <svg
          width={w}
          height={H}
          role="img"
          aria-label={`${METRIC_LABEL[metric]} 날짜별 추이(${view === 'bar' ? '막대' : '선'}). 하루 평균 ${metricText(metric, avg)}, 가장 많은 날 ${shortDay(data[peak]?.date ?? '')} ${metricText(metric, vals[peak] ?? 0)}`}
          onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          className="touch-pan-y overflow-visible"
        >
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* 토·일·공휴일 칸은 아주 옅게 물들인다 */}
          {slot >= 3 &&
            data.map((d, i) => {
              const c = dayColor(d.date)
              return c ? <rect key={d.date} x={x(i) - slot / 2} y={pad.t} width={slot} height={ph} fill={c} opacity={0.07} /> : null
            })}
          {/* 날짜(아래 줄은 요일, 달이 바뀌는 날은 ‘11월’) */}
          {data.map((d, i) => {
            const day = Number(d.date.slice(8, 10))
            const c = dayColor(d.date)
            const first = i === 0 || day === 1
            const shown = i % every === 0 || first
            return (
              <g key={d.date} className={clsx(hover === i && 'font-bold')}>
                {shown && (
                  <text x={x(i)} y={base + 15} textAnchor="middle" fill={c ?? 'var(--color-muted)'} className="text-[10px] tabular-nums">
                    {day}
                  </text>
                )}
                {shown && showDow && (
                  <text x={x(i)} y={base + 28} textAnchor="middle" fill={c ?? 'var(--color-faint)'} className="text-[9.5px]">
                    {WEEKDAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}
                  </text>
                )}
                {first && (
                  <text x={x(i) - Math.min(slot / 2, 6)} y={base + 43} textAnchor="start" className="fill-ink-2 text-[10px] font-semibold">
                    {Number(d.date.slice(5, 7))}월
                  </text>
                )}
              </g>
            )
          })}
          <g key={`${animKey}|${view}`}>
            {view === 'line' ? (
              <>
                {area && <path d={area} fill={`url(#${gid})`} />}
                <path d={line} fill="none" stroke={color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
                {/* 바탕색 덮개가 오른쪽으로 걷히며 선·면이 왼쪽부터 드러난다 */}
                <WipeCover x={pad.l - 3} width={pw + pad.r + 3} height={base + 3} />
              </>
            ) : (
              vals.map((v, i) =>
                v > 0 ? (
                  <path
                    key={data[i].date}
                    d={barPath(x(i) - bw / 2, y(v), bw, base - y(v))}
                    fill={color}
                    className={clsx('animate-grow-y transition-opacity', hover != null && hover !== i && 'opacity-50')}
                    style={{ transformBox: 'fill-box', animationDelay: `${Math.round((i / Math.max(1, n)) * 700)}ms` }}
                  />
                ) : null,
              )
            )}
            {/* 눈금(흐리게) */}
            {Array.from({ length: Math.round(max / step) + 1 }, (_, k) => k * step).map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeDasharray={v ? '2 4' : undefined} />
                <text x={pad.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {label(v)}
                </text>
              </g>
            ))}
            {/* 평균선 */}
            {n > 1 && (
              <g className="animate-fade" style={{ animationDelay: '1.1s', animationDuration: '0.5s' }}>
                <line x1={pad.l} x2={w - pad.r} y1={y(avg)} y2={y(avg)} stroke="var(--color-ink-2)" strokeDasharray="5 4" strokeWidth={1} opacity={0.55} />
                <text x={pad.l + 6} y={y(avg) - 6} textAnchor="start" stroke="var(--color-surface)" strokeWidth={4} paintOrder="stroke" className="fill-ink-2 text-[11px] font-semibold">
                  하루 평균 {metricText(metric, avg)}
                </text>
              </g>
            )}
            {/* 가장 많은 날 */}
            {vals[peak] > 0 && (
              <g className="animate-pop" style={{ animationDelay: '1.3s' }}>
                {view === 'line' && <circle cx={x(peak)} cy={y(vals[peak])} r={5} fill={color} stroke="var(--color-surface)" strokeWidth={2} />}
                <text x={Math.min(Math.max(x(peak), pad.l + 40), w - pad.r - 40)} y={y(vals[peak]) - (view === 'line' ? 12 : 7)} textAnchor="middle" stroke="var(--color-surface)" strokeWidth={4} paintOrder="stroke" className="fill-ink text-[11px] font-bold">
                  최고 {metricText(metric, vals[peak])}
                </text>
              </g>
            )}
          </g>
          {h && hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={base} stroke="var(--color-ink-2)" strokeWidth={1} opacity={view === 'line' ? 0.4 : 0.2} />
              {view === 'line' && <circle cx={x(hover)} cy={y(vals[hover])} r={5} fill={color} stroke="var(--color-surface)" strokeWidth={2} />}
            </g>
          )}
        </svg>
      )}
      {h && hover != null && (
        <div className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-2" style={{ left: Math.min(Math.max(x(hover) - 72, 0), Math.max(0, w - 160)) }}>
          <div className="mb-1 font-semibold" style={{ color: dayColor(h.date) ?? 'var(--color-ink)' }}>
            {shortDay(h.date)}
            {HOLIDAYS[h.date] && <span className="ml-1 font-normal">· {HOLIDAYS[h.date]}</span>}
          </div>
          {WITH_LINES.filter((m) => m !== 'amount' || h.amount > 0).map((m) => (
            <div key={m} className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: METRIC_COLOR[m], opacity: m === metric ? 1 : 0.35 }} aria-hidden />
              <span className={clsx('text-muted', m === metric && 'font-semibold text-ink-2')}>{METRIC_LABEL[m]}</span>
              <span className="ml-auto pl-3 font-semibold tabular-nums text-ink">{metricText(m, h[m])}</span>
            </div>
          ))}
        </div>
      )}
      {/* 범례: 날짜 글자색 */}
      <div className="mt-1 flex flex-wrap justify-end gap-x-3 gap-y-1 text-2xs text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-[2px]" style={{ background: DAY_COLOR.sat, opacity: 0.6 }} aria-hidden />
          토요일
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-[2px]" style={{ background: DAY_COLOR.sun, opacity: 0.6 }} aria-hidden />
          일요일·공휴일
        </span>
      </div>
    </div>
  )
}

// ── 요일별(세로 막대) ─────────────────────────────────────
function WeekdayChart({ data, metric, animKey }: { data: WeekdayStat[]; metric: Metric; animKey: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const rows = WEEK_ORDER.map((d) => data[d])
  const max = Math.max(1, ...rows.map((r) => r[metric]))
  const best = rows.reduce((b, r) => (r[metric] > b[metric] ? r : b), rows[0])
  const color = METRIC_COLOR[metric]
  return (
    <div className="flex flex-col gap-2" key={animKey}>
      <div className="flex h-52 items-end gap-2 sm:gap-3">
        {rows.map((r, i) => {
          const v = r[metric]
          const avg = r.days ? v / r.days : 0
          return (
            <div key={r.dow} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" onPointerEnter={() => setHover(r.dow)} onPointerLeave={() => setHover(null)}>
              {best[metric] > 0 && r.dow === best.dow && (
                <span className="animate-pop inline-flex items-center gap-0.5 rounded-full bg-mark px-1.5 py-0.5 text-2xs font-bold whitespace-nowrap text-ink shadow-1" style={{ animationDelay: '1s' }}>
                  <Crown className="size-3" aria-hidden /> 최다
                </span>
              )}
              <span className="animate-fade text-xs font-semibold tabular-nums text-ink-2" style={{ animationDelay: `${600 + i * 70}ms` }}>
                {metric === 'amount' ? won(v).replace('원', '') : fmt(v)}
              </span>
              <div
                className={clsx('animate-grow-y w-full max-w-12 rounded-t-[4px] transition-opacity', hover != null && hover !== r.dow && 'opacity-45')}
                style={{ height: `${Math.max(v ? 3 : 0, (v / max) * 78)}%`, background: color, animationDelay: `${i * 70}ms` }}
                title={`${WEEKDAYS[r.dow]}요일: ${metricText(metric, v)} · 하루 평균 ${metricText(metric, avg)} (${r.days}일)`}
              />
              {hover === r.dow && (
                <div className="pointer-events-none absolute bottom-full z-10 mb-2 w-max rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-2">
                  <div className="font-semibold text-ink">{WEEKDAYS[r.dow]}요일</div>
                  <div className="text-muted">
                    합계 <b className="text-ink">{metricText(metric, v)}</b>
                  </div>
                  <div className="text-muted">
                    하루 평균 <b className="text-ink">{metricText(metric, avg)}</b> · {r.days}일
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex gap-2 border-t border-line pt-2 sm:gap-3">
        {rows.map((r) => (
          <span key={r.dow} className={clsx('flex-1 text-center text-sm font-semibold', r.dow === 0 ? 'text-danger' : r.dow === 6 ? 'text-info' : 'text-ink-2')}>
            {WEEKDAYS[r.dow]}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── 순위 막대(가로) ───────────────────────────────────────
function RankList({ items, metric, colorOf, total, animKey, limit = 10, sub }: { items: NamedStat[]; metric: Metric; colorOf: (name: string) => string; total: number; animKey: string; limit?: number; sub?: (it: NamedStat) => string }) {
  const sorted = [...items].sort((a, b) => b[metric] - a[metric]).slice(0, limit)
  const max = Math.max(1, ...sorted.map((s) => s[metric]))
  return (
    <ol className="flex flex-col gap-2.5" key={animKey}>
      {sorted.map((it, i) => {
        const v = it[metric]
        const share = total ? Math.round((v / total) * 1000) / 10 : 0
        return (
          <li key={it.name} className="group grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-sm sm:grid-cols-[1.75rem_minmax(5rem,8rem)_1fr]" title={`${it.name}: 주문 ${fmt(it.orders)}건 · 수량 ${fmt(it.qty)}개${it.amount ? ` · 매출 ${won(it.amount)}` : ''}`}>
            <span className={clsx('grid size-6 place-items-center rounded-full text-xs font-bold tabular-nums', i < 3 ? 'bg-ink text-surface' : 'bg-sunken text-ink-2')}>{i + 1}</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink">{it.name}</span>
              {sub && <span className="block truncate text-2xs text-muted">{sub(it)}</span>}
            </span>
            <span className="col-start-2 flex min-w-0 items-center gap-2 sm:col-start-auto">
              <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-r-[4px] bg-sunken/70">
                <span className="animate-grow-x absolute inset-y-0 left-0 rounded-r-[4px] transition-[filter] group-hover:brightness-110" style={{ width: `${Math.max(1.5, (v / max) * 100)}%`, background: colorOf(it.name), animationDelay: `${i * 60}ms` }} />
              </span>
              <span className="w-[7.5rem] shrink-0 text-right tabular-nums">
                <b className="text-ink">{metricText(metric, v)}</b>
                <span className="ml-1 text-xs text-muted">{share}%</span>
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** 거래처 비중(상위 5 + 기타) 한 줄 막대 + 범례 */
function ShareBar({ items, metric, colorOf, animKey }: { items: NamedStat[]; metric: Metric; colorOf: (name: string) => string; animKey: string }) {
  const total = items.reduce((s, it) => s + it[metric], 0)
  if (!total) return null
  const head = items.slice(0, 5)
  const restV = items.slice(5).reduce((s, it) => s + it[metric], 0)
  const parts = [...head.map((it) => ({ name: it.name, v: it[metric], color: colorOf(it.name) })), ...(restV ? [{ name: '기타', v: restV, color: OTHER }] : [])].filter((p) => p.v > 0)
  return (
    <div className="flex flex-col gap-2" key={animKey}>
      <div className="animate-grow-x flex h-3.5 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={parts.map((p) => `${p.name} ${Math.round((p.v / total) * 100)}%`).join(', ')}>
        {parts.map((p) => (
          <span key={p.name} className="h-full min-w-[3px]" style={{ width: `${(p.v / total) * 100}%`, background: p.color }} title={`${p.name}: ${metricText(metric, p.v)} (${Math.round((p.v / total) * 1000) / 10}%)`} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((p) => (
          <li key={p.name} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: p.color }} aria-hidden />
            <span className="text-ink-2">{p.name}</span>
            <span className="tabular-nums text-muted">{Math.round((p.v / total) * 1000) / 10}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── 베스트 상품(표 + 막대) ────────────────────────────────
function ProductTable({ items, metric, hasAmount, animKey }: { items: ProductStat[]; metric: Metric; hasAmount: boolean; animKey: string }) {
  const [more, setMore] = useState(false)
  const sorted = [...items].sort((a, b) => b[metric] - a[metric] || b.qty - a.qty)
  const shown = sorted.slice(0, more ? 30 : 10)
  const max = Math.max(1, ...sorted.map((s) => s[metric]))
  const color = METRIC_COLOR[metric]
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[540px] text-sm" key={animKey}>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="w-10 py-2 pr-2 font-semibold">순위</th>
              <th className="py-2 pr-2 font-semibold">제품명</th>
              <th className="w-[34%] py-2 pr-2 font-semibold">{METRIC_LABEL[metric]}</th>
              {metric !== 'qty' && <th className="py-2 pr-2 text-right font-semibold">수량</th>}
              {metric !== 'orders' && <th className="py-2 pr-2 text-right font-semibold">건수</th>}
              {hasAmount && metric !== 'amount' && <th className="py-2 text-right font-semibold">매출액</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => (
              <tr key={p.code || `${p.name}|${p.option}`} className="animate-rise border-b border-line/60 last:border-0" style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}>
                <td className="py-2 pr-2">
                  <span className={clsx('grid size-6 place-items-center rounded-full text-xs font-bold tabular-nums', i === 0 ? 'bg-mark text-ink' : i < 3 ? 'bg-ink text-surface' : 'bg-sunken text-ink-2')}>{i + 1}</span>
                </td>
                <td className="max-w-0 py-2 pr-2">
                  <div className="truncate font-semibold text-ink" title={p.name}>
                    {p.name}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {[p.option, p.code].filter(Boolean).join(' · ') || '-'}
                  </div>
                </td>
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="relative h-4 min-w-0 flex-1 overflow-hidden rounded-r-[4px] bg-sunken/70">
                      <span className="animate-grow-x absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${Math.max(1.5, (p[metric] / max) * 100)}%`, background: color, animationDelay: `${150 + Math.min(i, 12) * 45}ms` }} />
                    </span>
                    <b className="w-[4.75rem] shrink-0 text-right tabular-nums text-ink">{metricText(metric, p[metric])}</b>
                  </div>
                </td>
                {metric !== 'qty' && <td className="py-2 pr-2 text-right tabular-nums text-ink-2">{fmt(p.qty)}개</td>}
                {metric !== 'orders' && <td className="py-2 pr-2 text-right tabular-nums text-ink-2">{fmt(p.orders)}건</td>}
                {hasAmount && metric !== 'amount' && <td className="py-2 text-right tabular-nums text-ink-2">{won(p.amount)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 10 && (
        <button type="button" className="self-center text-sm font-semibold text-brand-ink hover:underline" onClick={() => setMore((v) => !v)}>
          {more ? '10위까지만 보기' : `${Math.min(30, sorted.length)}위까지 더 보기`}
        </button>
      )}
    </div>
  )
}

// ── 대시보드 ──────────────────────────────────────────────
export function Dashboard() {
  const [preset, setPreset] = useState<Preset>('month')
  const [range, setRange] = useState(() => presetRange('month'))
  const [data, setData] = useState<Stats | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trendM, setTrendM] = useState<Metric>('orders')
  // 날짜별 추이 모양(선·막대) — 고른 것을 기억
  const [trendView, setTrendViewState] = useState<TrendView>(() => {
    try {
      return localStorage.getItem('orders.trendView') === 'bar' ? 'bar' : 'line'
    } catch {
      return 'line'
    }
  })
  const setTrendView = (v: TrendView) => {
    setTrendViewState(v)
    try {
      localStorage.setItem('orders.trendView', v)
    } catch {
      // 저장 못 해도 화면은 바뀐다
    }
  }
  const [weekM, setWeekM] = useState<Metric>('orders')
  const [mallM, setMallM] = useState<Metric>('orders')
  const [prodM, setProdM] = useState<Metric>('qty')
  const [regionM, setRegionM] = useState<Metric>('orders')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    setBusy(true)
    api<Stats>(`/orders/stats?from=${range.from}&to=${range.to}`)
      .then((d) => {
        if (!live) return
        setData(d)
        setError(null)
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : '통계를 불러오지 못했습니다.'))
      .finally(() => live && setBusy(false))
    return () => {
      live = false
    }
  }, [range.from, range.to, tick])

  const pick = (p: Preset) => {
    setPreset(p)
    if (p !== 'custom') setRange(presetRange(p, data?.today ?? kstToday()))
  }
  // 거래처 색: 주문건수 순위 상위 5곳만 범주 색, 나머지는 회색(기준을 바꿔도 같은 거래처는 같은 색)
  const mallColor = useMemo(() => {
    const top = (data?.malls ?? []).slice(0, 5).map((m) => m.name)
    return (name: string) => {
      const i = top.indexOf(name)
      return i >= 0 ? SERIES[i] : OTHER
    }
  }, [data])
  const k = `${data?.from}|${data?.to}`

  if (error && !data) return <Callout tone="warn" title="통계를 불러오지 못했습니다">{error}</Callout>
  if (!data)
    return (
      <div className="flex items-center gap-2 py-10 text-muted">
        <Spinner /> 통계를 모으는 중
      </div>
    )
  const t = data.totals
  const p = data.prev.totals
  const len = daysBetween(data.from, data.to)
  const hasAmount = data.hasAmount
  const regionTotal = data.regions.reduce((s, r) => s + r[regionM], 0)
  const mallTotal = data.malls.reduce((s, r) => s + r[mallM], 0)
  const metricOr = (m: Metric): Metric => (m === 'amount' && !hasAmount ? 'orders' : m)

  return (
    <div className="flex flex-col gap-5">
      {/* 기간 */}
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-1">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays className="size-5 text-brand" aria-hidden />
          <h2 className="text-lg font-semibold text-ink">통계 대시보드</h2>
          {busy && <Spinner />}
          <IconButton icon={RefreshCw} label="새로 고침" className="ml-auto" onClick={() => setTick((v) => v + 1)} />
        </div>
        <div className="-mx-1 overflow-x-auto px-1">
          <Segmented label="조회 기간" value={preset} onValue={pick} options={PRESETS} className="[&_button]:whitespace-nowrap" />
        </div>
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <TextInput type="date" aria-label="시작 날짜" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} className="w-44!" />
            <span className="text-muted">~</span>
            <TextInput type="date" aria-label="끝 날짜" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} className="w-44!" />
          </div>
        )}
        <p className="text-sm text-muted">
          <b className="text-ink">
            {data.from} ~ {data.to}
          </b>{' '}
          ({len}일 · 주문서 {fmt(t.batches)}개 차수) · 비교: 바로 앞 같은 기간 {data.prev.from} ~ {data.prev.to}
        </p>
      </div>

      {!t.orders ? (
        <EmptyState icon={BarChart3} title="이 기간에는 저장한 주문서가 없습니다" className="py-14">
          {data.firstDate ? `처음 저장한 주문서는 ${data.firstDate}입니다. 기간을 바꿔 보세요.` : '주문서 만들기에서 사방넷 주문서를 올리면 통계가 쌓입니다.'}
        </EmptyState>
      ) : (
        <>
          {/* 숫자 카드 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi icon={Receipt} label="주문건수 / 주문줄수" value={t.orders} before={p.orders} format={(v) => `${fmt(v)}건`} extra={{ label: '주문줄수', value: t.lines, before: p.lines, format: (v) => `${fmt(v)}줄` }} sub={`하루 평균 ${fmt(t.orders / len)}건 · ${fmt(t.lines / len)}줄`} delay={0} />
            {hasAmount && t.amount != null ? (
              <Kpi icon={TrendingUp} label="매출액(결제금액)" value={t.amount} before={p.amount} format={won} sub={`지난 기간 ${p.amount != null ? won(p.amount) : '-'}`} delay={60} />
            ) : (
              <Kpi icon={Store} label="거래처(쇼핑몰)" value={t.malls ?? 0} format={(v) => `${fmt(v)}곳`} sub="주문이 들어온 곳" delay={60} />
            )}
            <Kpi icon={Package} label="판매수량" value={t.qty} before={p.qty} format={(v) => `${fmt(v)}개`} sub={`주문당 ${t.orders ? (t.qty / t.orders).toFixed(1) : 0}개`} delay={120} />
            {hasAmount && t.amount != null ? (
              <Kpi icon={ShoppingBag} label="객단가(주문당)" value={t.orders ? t.amount / t.orders : 0} before={p.amount != null && p.orders ? p.amount / p.orders : null} format={won} sub="매출액 ÷ 주문건수" delay={180} />
            ) : (
              <Kpi icon={ShoppingBag} label="판매 상품" value={t.products ?? 0} format={(v) => `${fmt(v)}종`} sub="상품코드 기준" delay={180} />
            )}
            <Kpi icon={Users} label="주문 고객" value={t.customers} before={p.customers} format={(v) => `${fmt(v)}명`} sub={`재구매 ${fmt(t.repeatCustomers)}명`} delay={240} />
            <Kpi icon={Undo2} label="취소" value={t.cancelled} before={p.cancelled} invert format={(v) => `${fmt(v)}건`} sub={`취소율 ${t.orders + t.cancelled ? ((t.cancelled / (t.orders + t.cancelled)) * 100).toFixed(1) : 0}%`} delay={300} />
          </div>

          {!hasAmount && (
            <Callout tone="info" title="매출 통계는 결제금액 칸이 있어야 나옵니다">
              이 기간 주문서에는 결제금액(주문금액·총금액·판매금액) 칸이 없습니다. 사방넷에서 주문서를 받을 때 ‘결제금액’ 칸을 함께 받아 올리면 매출액·객단가·거래처별·상품별 매출이 자동으로 함께 나옵니다.
            </Callout>
          )}

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="날짜별 추이" icon={TrendingUp} className="xl:col-span-2" delay={120} right={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Segmented
                    size="sm"
                    label="그래프 모양"
                    value={trendView}
                    onValue={setTrendView}
                    options={[
                      { value: 'line', label: '선', icon: ChartLine },
                      { value: 'bar', label: '막대', icon: BarChart3 },
                    ]}
                  />
                  <MetricSwitch value={metricOr(trendM)} onValue={setTrendM} hasAmount={hasAmount} only={WITH_LINES} />
                </div>
              }
            >
              <TrendChart data={data.daily} metric={metricOr(trendM)} view={trendView} animKey={`${k}|${trendM}`} />
            </Card>
            <Card title="요일별 주문" icon={CalendarDays} delay={180} right={<MetricSwitch value={metricOr(weekM)} onValue={setWeekM} hasAmount={hasAmount} only={WITH_LINES} />}>
              <WeekdayChart data={data.weekday} metric={metricOr(weekM)} animKey={`${k}|${weekM}`} />
              <p className="text-xs text-muted">막대에 마우스를 올리면 그 요일 하루 평균이 보입니다. 날짜는 주문서 날짜 기준입니다.</p>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-5">
            <Card title="상위 거래처 순위" icon={Store} delay={220} className="xl:col-span-2" right={<MetricSwitch value={metricOr(mallM)} onValue={setMallM} hasAmount={hasAmount} />}>
              <ShareBar items={[...data.malls].sort((a, b) => b[metricOr(mallM)] - a[metricOr(mallM)])} metric={metricOr(mallM)} colorOf={mallColor} animKey={`${k}|${mallM}`} />
              <RankList items={data.malls} metric={metricOr(mallM)} colorOf={mallColor} total={mallTotal} animKey={`${k}|${mallM}`} sub={(it) => [`주문 ${fmt(it.orders)}건`, `수량 ${fmt(it.qty)}개`, hasAmount ? `매출 ${won(it.amount)}` : ''].filter(Boolean).join(' · ')} />
            </Card>
            <Card title="베스트 판매 제품" icon={Crown} delay={260} className="xl:col-span-3" right={<MetricSwitch value={metricOr(prodM)} onValue={setProdM} hasAmount={hasAmount} />}>
              <ProductTable items={data.products} metric={metricOr(prodM)} hasAmount={hasAmount} animKey={`${k}|${prodM}`} />
            </Card>
          </div>

          <Card title="지역별 통계" icon={MapPin} delay={300} right={<MetricSwitch value={metricOr(regionM)} onValue={setRegionM} hasAmount={hasAmount} />}>
            <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold text-ink-2">시·도</h4>
                <RankList items={data.regions} metric={metricOr(regionM)} colorOf={() => METRIC_COLOR[metricOr(regionM)]} total={regionTotal} animKey={`${k}|${regionM}`} limit={18} />
              </div>
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold text-ink-2">많이 주문한 시·군·구</h4>
                <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {[...data.cities]
                    .sort((a, b) => b[metricOr(regionM)] - a[metricOr(regionM)])
                    .map((c, i) => (
                      <li key={c.name} className="animate-rise flex items-center gap-2 rounded-lg border border-line bg-paper/60 px-3 py-2 text-sm" style={{ animationDelay: `${200 + i * 40}ms` }}>
                        <span className="w-5 text-xs font-bold tabular-nums text-muted">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.name}</span>
                        <span className="tabular-nums text-ink-2">{metricText(metricOr(regionM), c[metricOr(regionM)])}</span>
                      </li>
                    ))}
                </ol>
                {data.regions.some((r) => r.name === '기타') && <p className="text-xs text-muted">‘기타’는 주소 첫머리에서 시·도를 알아보지 못한 주문입니다.</p>}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
