// 설문폼 요약 그래프 — 화면과 PDF(화면 그대로 담음)에 같이 쓴다.
// 색: 검증한 범주 색 순서(고정, 돌려 쓰지 않음). 색만으로 구분하지 않도록 늘 이름·개수·비율을 글로 함께 적는다.
import clsx from 'clsx'

/** 범주 색(정해진 순서로만 쓴다). 6개를 넘는 보기는 막대 그래프(한 색)로 바꾼다 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']
/** 한 계열 그래프(체크박스·점수)의 색 */
export const ONE = '#2a78d6'
const OTHER = '#a8a49a'

type Count = { label: string; n: number }
const pct = (n: number, base: number) => (base ? Math.round((n / base) * 1000) / 10 : 0)
const fmtPct = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`

/**
 * 하나만 고르는 질문(객관식·드롭다운): 한 줄로 나눈 막대 + 범례(이름·명·%).
 * 보기가 6개를 넘으면 많은 순 막대로.
 */
export function ChoiceChart({ counts, answered }: { counts: Count[]; answered: number }) {
  const real = counts.filter((c) => c.label !== '기타' || c.n > 0)
  if (real.length > SERIES.length) return <RankBars counts={real} base={answered} />
  const shown = real.filter((c) => c.n > 0)
  const color = (label: string) => (label === '기타' ? OTHER : SERIES[real.findIndex((c) => c.label === label) % SERIES.length])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-8 w-full gap-[2px] overflow-hidden rounded-[4px] bg-sunken" role="img" aria-label={shown.map((c) => `${c.label} ${c.n}명`).join(', ')}>
        {shown.map((c) => {
          const p = pct(c.n, answered)
          return (
            <div key={c.label} className="flex h-full min-w-[3px] items-center justify-center overflow-hidden text-xs font-semibold text-white" style={{ width: `${p}%`, background: color(c.label) }} title={`${c.label}: ${c.n}명 (${fmtPct(p)})`}>
              {p >= 9 && <span className="truncate px-1 [text-shadow:0_1px_1px_rgb(0_0_0/0.25)]">{fmtPct(p)}</span>}
            </div>
          )
        })}
      </div>
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {real.map((c) => {
          const p = pct(c.n, answered)
          return (
            <li key={c.label} className={clsx('flex items-center gap-2 text-sm', !c.n && 'opacity-55')}>
              <span className="size-3 shrink-0 rounded-[3px]" style={{ background: color(c.label) }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ink-2" title={c.label}>
                {c.label}
              </span>
              <span className="shrink-0 tabular-nums text-ink">{c.n}명</span>
              <span className="w-12 shrink-0 text-right tabular-nums text-muted">{fmtPct(p)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** 여러 개 고르는 질문(체크박스)·보기가 많은 질문: 많은 순 막대(한 색). base: 비율의 기준(응답자 수) */
export function RankBars({ counts, base }: { counts: Count[]; base: number }) {
  const sorted = [...counts].sort((a, b) => (a.label === '기타' ? 1 : b.label === '기타' ? -1 : b.n - a.n))
  const max = Math.max(1, ...sorted.map((c) => c.n))
  return (
    <div className="flex flex-col gap-2">
      {sorted.map((c) => {
        const p = pct(c.n, base)
        return (
          <div key={c.label} className="grid grid-cols-[minmax(80px,180px)_1fr_auto] items-center gap-3 text-sm" title={`${c.label}: ${c.n}명 (${fmtPct(p)})`}>
            <span className="truncate text-ink-2">{c.label}</span>
            <span className="relative h-5 border-l border-line-strong">
              <span className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${c.n ? Math.max(1.5, (c.n / max) * 100) : 0}%`, background: c.label === '기타' ? OTHER : ONE }} />
            </span>
            <span className="w-24 text-right tabular-nums">
              <span className="text-ink">{c.n}명</span> <span className="text-muted">{fmtPct(p)}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** 점수 질문: 점수별 세로 막대 + 평균(큰 숫자) */
export function ScaleChart({ counts, average, answered, scale }: { counts: Count[]; average?: number; answered: number; scale: { min: number; max: number; minLabel: string; maxLabel: string } }) {
  const max = Math.max(1, ...counts.map((c) => c.n))
  const H = 120
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
      <div className="flex flex-col">
        <span className="text-xs text-muted">평균</span>
        <span className="text-4xl font-bold tabular-nums leading-none text-ink">
          {average ?? '-'}
          <span className="ml-1 text-base font-medium text-muted">/ {scale.max}</span>
        </span>
        {average !== undefined && (
          <span className="mt-2 block h-1.5 w-40 overflow-hidden rounded-full bg-sunken" aria-hidden>
            <span className="block h-full rounded-full" style={{ width: `${((average - scale.min) / Math.max(1, scale.max - scale.min)) * 100}%`, background: ONE }} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-end gap-2 border-b border-line" style={{ height: H + 22 }}>
          {counts.map((c) => {
            const h = c.n ? Math.max(3, (c.n / max) * H) : 0
            return (
              <div key={c.label} className="flex min-w-0 flex-1 flex-col items-center justify-end" title={`${c.label}점: ${c.n}명 (${fmtPct(pct(c.n, answered))})`}>
                <span className="mb-1 text-xs tabular-nums text-ink-2">{c.n ? `${c.n}명` : ''}</span>
                <span className="w-full max-w-12 rounded-t-[4px]" style={{ height: h, background: ONE }} />
              </div>
            )
          })}
        </div>
        <div className="mt-1 flex gap-2">
          {counts.map((c) => (
            <span key={c.label} className="flex-1 text-center text-xs tabular-nums text-muted">
              {c.label}
            </span>
          ))}
        </div>
        {(scale.minLabel || scale.maxLabel) && (
          <div className="mt-1 flex justify-between text-xs text-muted">
            <span>← {scale.minLabel}</span>
            <span>{scale.maxLabel} →</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** 요약 맨 위: 큰 숫자 몇 개 */
export function StatTiles({ items }: { items: Array<{ label: string; value: string; note?: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-line bg-paper px-3 py-2.5">
          <p className="text-xs text-muted">{it.label}</p>
          <p className="text-xl font-bold tabular-nums text-ink">{it.value}</p>
          {it.note && <p className="truncate text-xs text-muted">{it.note}</p>}
        </div>
      ))}
    </div>
  )
}
