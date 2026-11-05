import clsx from 'clsx'
import { BarChart3, BrainCircuit, Copy, FileSpreadsheet, FlaskConical, History, Info, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { Badge, Button, Callout, Dropzone, Panel, Segmented, Spinner, toast } from '@/ui'
import { backtest, ballColor, chiSquare, frequency, gaps, nextDraw, NUMS, numberWeights, recommend, shapeStats, topPairs, TOTAL_COMBOS, weekSeed, type Draw, type Pick } from './lotto'

interface LottoData {
  draws: Draw[]
  expectedLatest: number
  missing: number
  syncing: boolean
  lastSyncAt: string | null
  lastError: string | null
}

export function Ball({ n, size = 34, dim }: { n: number; size?: number; dim?: boolean }) {
  return (
    <span
      className={clsx('num inline-flex shrink-0 items-center justify-center rounded-full font-black text-white shadow-1', dim && 'opacity-35')}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,.45), transparent 45%), ${ballColor(n)}` }}
    >
      {n}
    </span>
  )
}

export default function LottoTab() {
  const [data, setData] = useState<LottoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () =>
    api<LottoData>('/lotto')
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '불러오지 못했습니다.'))
  useEffect(() => {
    void load()
  }, [])
  // 서버가 받아 오는 중이면 몇 초마다 다시 본다
  useEffect(() => {
    if (!data?.syncing) return
    const t = setTimeout(() => void load(), 4000)
    return () => clearTimeout(t)
  }, [data])

  const draws = data?.draws ?? []
  const ready = draws.length >= 100
  return (
    <div className="flex flex-col gap-5">
      <Notice />
      {!data && !error && (
        <Panel className="flex items-center justify-center gap-2 p-10 text-muted">
          <Spinner /> 당첨번호 불러오는 중
        </Panel>
      )}
      {error && <Callout tone="danger" title="당첨번호를 불러오지 못했습니다">{error}</Callout>}
      {data && <SyncStatus data={data} onReload={load} onImported={setData} />}
      {ready && <Analysis draws={draws} />}
    </div>
  )
}

function Notice() {
  return (
    <Callout tone="info" title="AI 추천 번호, 이렇게 만듭니다">
      <p>
        로또는 매 회 독립적인 무작위 추첨이라, 어떤 계산으로도 한 게임의 1등 확률(<b>1 / {TOTAL_COMBOS.toLocaleString()}</b>)을 바꿀 수는 없습니다. 그래서 이 추천은 ‘당첨 확률을 올린다’가 아니라 다음을 노립니다.
      </p>
      <ul className="mt-1 list-disc pl-5">
        <li>
          <b>지난 1등 번호들이 실제로 보여 온 모양</b>(합계 범위·홀짝·고저·AC값·연속번호·구간 분포)에 맞는, 흔히 나오는 꼴의 조합
        </li>
        <li>
          <b>사람들이 많이 고르는 꼴</b>(생일 숫자만, 일정한 간격, 같은 끝수, 용지 한 줄)을 피해, 당첨되면 <b>나눠 갖는 사람이 적은</b> 조합
        </li>
        <li>번호별 장기 빈도·최근 흐름·쉬어 간 회차는 아주 약하게만 반영(통계적으로 예측력이 거의 없음을 아래 검정·되짚어 보기에서 그대로 보여 드립니다)</li>
      </ul>
    </Callout>
  )
}

function SyncStatus({ data, onReload, onImported }: { data: LottoData; onReload: () => void; onImported: (d: LottoData) => void }) {
  const [busy, setBusy] = useState(false)
  const n = data.draws.length
  const importExcel = async (file: File) => {
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer())
      const draws: Draw[] = []
      for (const name of book.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, blankrows: false, defval: '', raw: true })
        for (const row of rows) {
          // 한 줄에서 ‘회차’ 다음에 1~45 숫자 7개(번호 6 + 보너스)가 이어지는 곳을 찾는다
          const v = (row as unknown[]).map((c) => (typeof c === 'number' ? c : Number(String(c).replace(/[^\d]/g, '')) || NaN))
          for (let i = 0; i + 7 < v.length; i++) {
            const nums = v.slice(i + 1, i + 8)
            if (Number.isInteger(v[i]) && v[i] > 0 && v[i] < 5000 && nums.every((x) => Number.isInteger(x) && x >= 1 && x <= 45) && new Set(nums).size === 7) {
              const date = (row as unknown[]).map(String).find((c) => /\d{4}[.\-/]\d{2}[.\-/]\d{2}/.test(c))?.replace(/[./]/g, '-') ?? ''
              draws.push({ round: v[i], date: date.slice(0, 10), numbers: nums.slice(0, 6), bonus: nums[6] })
              break
            }
          }
        }
      }
      if (!draws.length) throw new Error('회차와 번호 7개(보너스 포함)가 이어진 줄을 찾지 못했습니다.')
      const r = await api<LottoData & { added: number }>('/lotto/import', { method: 'POST', body: { draws } })
      onImported(r)
      toast.success(`${r.added}개 회차를 넣었습니다.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '엑셀을 넣지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  const resync = async () => {
    try {
      onImported(await api<LottoData>('/lotto/sync', { method: 'POST' }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '다시 받지 못했습니다.')
    }
  }
  const complete = data.missing === 0
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <History className="size-4 text-brand" aria-hidden />
        <b className="text-ink">당첨번호 자료</b>
        <span className="text-ink-2">
          {n ? `1회 ~ ${data.draws.at(-1)!.round}회 중 ${n.toLocaleString()}회` : '아직 없음'}
          {data.expectedLatest ? ` (최근 ${data.expectedLatest}회까지 있어야 함)` : ''}
        </span>
        {complete ? <Badge tone="brand">최신</Badge> : data.syncing ? <Badge tone="accent">동행복권에서 받는 중… {data.missing}회 남음</Badge> : <Badge tone="warn">{data.missing}회 비어 있음</Badge>}
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onReload}>
            새로 보기
          </Button>
          {!complete && !data.syncing && (
            <Button size="sm" icon={RefreshCw} onClick={() => void resync()} title="스탭 이상만">
              지금 다시 받기
            </Button>
          )}
        </div>
      </div>
      {data.syncing && n < 100 && <p className="text-sm text-muted">처음 한 번은 1회부터 모두 받느라 몇 분 걸립니다. 이 화면을 열어 두면 자동으로 새로 봅니다.</p>}
      {!complete && !data.syncing && data.lastError && (
        <Callout tone="warn" title="동행복권에서 자료를 받지 못했습니다">
          <p>
            서버가 동행복권에 닿지 못했거나 응답이 막혔습니다({data.lastError}). 잠시 뒤 ‘지금 다시 받기’를 누르거나, 동행복권 홈페이지 → 당첨결과 → 회차별 당첨번호에서 <b>엑셀로 내려받아</b> 아래에 올려 주세요(스탭 이상).
          </p>
          <Dropzone accept=".xlsx,.xls,.csv" multiple={false} paste={false} compact icon={FileSpreadsheet} title={busy ? '넣는 중…' : '당첨번호 엑셀 올리기'} hint="회차·번호 6개·보너스가 있는 파일" onFiles={(f) => void importExcel(f[0])} disabled={busy} className="mt-2" />
        </Callout>
      )}
    </Panel>
  )
}

// ── 분석·추천 ─────────────────────────────────────────────
function Analysis({ draws }: { draws: Draw[] }) {
  const latest = draws.at(-1)!
  const next = nextDraw(latest)
  const [seed, setSeed] = useState(() => weekSeed(next.round))
  const picks = useMemo(() => recommend(draws, { games: 5, seed, samples: 20000 }), [draws, seed])
  const weekly = seed === weekSeed(next.round)
  const copy = () => {
    const text = [`제${next.round}회 AI 추천 번호`, ...picks.map((p, i) => `${String.fromCharCode(65 + i)}: ${p.numbers.join(' ')}`)].join('\n')
    void navigator.clipboard.writeText(text).then(() => toast.success('추천 번호를 복사했습니다.'))
  }
  return (
    <>
      <Panel className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-1.5 text-xl font-bold text-ink">
            <BrainCircuit className="size-5 text-accent" aria-hidden /> 제{next.round}회 AI 추천 번호
          </h2>
          <span className="text-sm text-muted">{next.date} 추첨 · 1~{latest.round}회 {draws.length.toLocaleString()}개 회차 분석</span>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" icon={Copy} onClick={copy}>
              번호 복사
            </Button>
            <Button size="sm" icon={Sparkles} onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>
              다른 조합 추천
            </Button>
            {!weekly && (
              <Button size="sm" variant="ghost" onClick={() => setSeed(weekSeed(next.round))}>
                이번 주 기본 추천
              </Button>
            )}
          </div>
        </div>
        <ul className="flex flex-col gap-2">
          {picks.map((p, i) => (
            <PickRow key={p.numbers.join()} p={p} label={String.fromCharCode(65 + i)} />
          ))}
        </ul>
        <p className="text-xs text-muted">{weekly ? '이번 주 기본 추천은 같은 주에는 누가 봐도 같습니다. ‘다른 조합 추천’으로 새로 뽑을 수 있습니다.' : '새로 뽑은 조합입니다.'} 지난 1등 조합과 같은 조합은 넣지 않습니다.</p>
      </Panel>

      <RecentDraws draws={draws} />
      <Charts draws={draws} />
      <Backtest draws={draws} />
    </>
  )
}

function PickRow({ p, label }: { p: Pick; label: string }) {
  const s = p.shape
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2.5">
      <span className="w-6 text-lg font-black text-muted">{label}</span>
      <div className="flex gap-1.5">
        {p.numbers.map((n) => (
          <Ball key={n} n={n} size={38} />
        ))}
      </div>
      <div className="flex flex-wrap gap-1 text-xs">
        <Chip>합 {s.sum}</Chip>
        <Chip>
          홀{s.odd}:짝{6 - s.odd}
        </Chip>
        <Chip>
          고{s.high}:저{6 - s.high}
        </Chip>
        <Chip>AC {s.ac}</Chip>
        {s.consecutive > 0 && <Chip>연속 {s.consecutive}쌍</Chip>}
      </div>
    </li>
  )
}
const Chip = ({ children }: { children: ReactNode }) => <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-ink-2">{children}</span>

function RecentDraws({ draws }: { draws: Draw[] }) {
  const recent = [...draws].reverse().slice(0, 8)
  return (
    <Panel className="flex flex-col gap-3 p-4 sm:p-5">
      <h3 className="flex items-center gap-1.5 text-base font-bold text-ink">
        <History className="size-4 text-brand" aria-hidden /> 최근 당첨번호
      </h3>
      <ul className="flex flex-col divide-y divide-line">
        {recent.map((d) => (
          <li key={d.round} className="flex flex-wrap items-center gap-3 py-2">
            <span className="w-40 shrink-0 text-sm">
              <b className="text-ink">{d.round}회</b> <span className="text-muted">{d.date}</span>
            </span>
            <div className="flex gap-1">
              {d.numbers.map((n) => (
                <Ball key={n} n={n} size={30} />
              ))}
              <span className="mx-1 self-center text-muted">+</span>
              <Ball n={d.bonus} size={30} />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// ── 그래프 ───────────────────────────────────────────────
function Bars({ values, colors, height = 150, labels, line: refLine, format }: { values: number[]; colors: string[]; height?: number; labels: string[]; line?: number; format?: (v: number) => string }) {
  const max = Math.max(...values, refLine ?? 0) || 1
  const w = 100 / values.length
  return (
    <div>
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={values.map((v, i) => `${labels[i]} ${format ? format(v) : v}`).join(', ')}>
        {values.map((v, i) => {
          const h = (v / max) * (height / 3 - 1)
          return (
            <rect key={i} x={i * w + w * 0.12} width={w * 0.76} y={height / 3 - h} height={h} fill={colors[i]} rx="0.4">
              <title>{`${labels[i]}: ${format ? format(v) : v}`}</title>
            </rect>
          )
        })}
        {refLine != null && <line x1="0" x2="100" y1={height / 3 - (refLine / max) * (height / 3 - 1)} y2={height / 3 - (refLine / max) * (height / 3 - 1)} stroke="var(--color-ink)" strokeWidth="0.3" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="flex text-[9px] text-muted">
        {labels.map((l, i) => (
          <span key={i} className="num flex-1 text-center" style={{ minWidth: 0 }}>
            {values.length > 20 ? (i % 5 === 0 || i === values.length - 1 ? l : '') : l}
          </span>
        ))}
      </div>
    </div>
  )
}

function ChartCard({ title, hint, children, className }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('flex flex-col gap-2 rounded-lg border border-line bg-surface p-4', className)}>
      <h4 className="text-sm font-bold text-ink">
        {title} {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
      </h4>
      {children}
    </section>
  )
}

function Charts({ draws }: { draws: Draw[] }) {
  const [win, setWin] = useState<'all' | '100' | '30'>('all')
  const sorted = useMemo(() => [...draws].sort((a, b) => a.round - b.round), [draws])
  const part = win === 'all' ? sorted : sorted.slice(-Number(win))
  const freq = useMemo(() => frequency(part), [part])
  const weights = useMemo(() => numberWeights(sorted), [sorted])
  const g = useMemo(() => gaps(sorted), [sorted])
  const st = useMemo(() => shapeStats(sorted), [sorted])
  const chi = useMemo(() => chiSquare(sorted), [sorted])
  const pairs = useMemo(() => topPairs(sorted, 10), [sorted])
  const colors = NUMS.map(ballColor)
  const expected = (part.length * 6) / 45
  const hot = [...NUMS].sort((a, b) => freq[b] - freq[a]).slice(0, 6)
  const cold = [...NUMS].sort((a, b) => freq[a] - freq[b]).slice(0, 6)
  // 합계 히스토그램(10 단위)
  const sumBins = Array.from({ length: 24 }, (_, i) => st.sums.filter((s) => Math.floor(s / 10) === i + 2).length)
  const pct = (arr: number[]) => arr.map((v) => (v / st.n) * 100)
  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-base font-bold text-ink">
          <BarChart3 className="size-4 text-brand" aria-hidden /> 당첨번호 분석
        </h3>
        <Segmented
          label="기간"
          size="sm"
          value={win}
          onValue={setWin}
          options={[
            { value: 'all', label: '전체' },
            { value: '100', label: '최근 100회' },
            { value: '30', label: '최근 30회' },
          ]}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="번호별 출현 횟수" hint={`점선 = 고르게 나왔을 때 기대값 ${expected.toFixed(1)}회`} className="lg:col-span-2">
          <Bars values={NUMS.map((n) => freq[n])} colors={colors} labels={NUMS.map(String)} line={expected} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-fire">많이 나온 번호</span>
            {hot.map((n) => (
              <Ball key={n} n={n} size={26} />
            ))}
            <span className="ml-3 font-semibold text-water">적게 나온 번호</span>
            {cold.map((n) => (
              <Ball key={n} n={n} size={26} />
            ))}
          </div>
        </ChartCard>
        <ChartCard title="AI 번호 무게" hint="장기 빈도·최근 흐름·쉬어 간 회차를 섞은 값(1 = 보통). 차이가 아주 작게 되도록 설계">
          <Bars values={weights.map((w) => w.weight)} colors={colors} labels={NUMS.map(String)} line={1} format={(v) => v.toFixed(3)} />
        </ChartCard>
        <ChartCard title="쉬어 간 회차" hint="막대 = 지금까지 안 나온 회차 수, 점선 = 평균 간격(약 7.5회)">
          <Bars values={g.map((x) => x.current)} colors={colors} labels={NUMS.map(String)} line={g.reduce((s, x) => s + x.average, 0) / 45} />
        </ChartCard>
        <ChartCard title="당첨번호 합계 분포" hint={`가운데 80%: ${Math.round(st.sumBand[0])}~${Math.round(st.sumBand[1])} (추천은 이 안에서)`}>
          <Bars values={sumBins} colors={sumBins.map((_, i) => ((i + 2) * 10 + 9 >= st.sumBand[0] && (i + 2) * 10 <= st.sumBand[1] ? 'var(--color-brand)' : 'var(--color-line-strong)'))} labels={sumBins.map((_, i) => String((i + 2) * 10))} />
        </ChartCard>
        <ChartCard title="모양 분포" hint="지난 1등 번호가 이런 모양으로 나온 비율(%)">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="mb-1 font-semibold text-ink-2">홀수 개수(0~6)</p>
              <Bars values={pct(st.odd)} colors={st.odd.map((_, i) => (i >= 2 && i <= 4 ? 'var(--color-accent)' : 'var(--color-line-strong)'))} labels={st.odd.map((_, i) => String(i))} height={80} format={(v) => `${v.toFixed(1)}%`} />
            </div>
            <div>
              <p className="mb-1 font-semibold text-ink-2">23 이상 개수(0~6)</p>
              <Bars values={pct(st.high)} colors={st.high.map((_, i) => (i >= 2 && i <= 4 ? 'var(--color-accent)' : 'var(--color-line-strong)'))} labels={st.high.map((_, i) => String(i))} height={80} format={(v) => `${v.toFixed(1)}%`} />
            </div>
            <div>
              <p className="mb-1 font-semibold text-ink-2">AC값(0~10)</p>
              <Bars values={pct(st.ac)} colors={st.ac.map((_, i) => (i >= 7 ? 'var(--color-accent)' : 'var(--color-line-strong)'))} labels={st.ac.map((_, i) => String(i))} height={80} format={(v) => `${v.toFixed(1)}%`} />
            </div>
            <div>
              <p className="mb-1 font-semibold text-ink-2">전 회 번호가 다시 나온 수</p>
              <Bars values={pct(st.repeat)} colors={st.repeat.map((_, i) => (i <= 2 ? 'var(--color-accent)' : 'var(--color-line-strong)'))} labels={st.repeat.map((_, i) => String(i))} height={80} format={(v) => `${v.toFixed(1)}%`} />
            </div>
          </div>
          <p className="text-xs text-muted">주황 막대 = 추천이 허용하는 범위</p>
        </ChartCard>
        <ChartCard title="자주 함께 나온 번호 쌍" hint="전체 회차">
          <ul className="grid grid-cols-2 gap-1.5 text-sm">
            {pairs.map((p) => (
              <li key={`${p.a}-${p.b}`} className="flex items-center gap-1.5">
                <Ball n={p.a} size={24} />
                <Ball n={p.b} size={24} />
                <span className="num text-muted">{p.count}회</span>
              </li>
            ))}
          </ul>
        </ChartCard>
        <ChartCard title="무작위 검정(카이제곱)" hint="45개 번호가 고르게 나왔는지">
          <p className="text-sm text-ink-2">
            χ² = <b className="num">{chi.stat.toFixed(1)}</b> (자유도 {chi.df}), p = <b className="num">{chi.p.toFixed(3)}</b>
          </p>
          <p className="text-sm text-ink-2">
            {chi.p > 0.05
              ? 'p 값이 0.05보다 커서, 번호별 출현 횟수의 차이는 ‘우연히 생길 만한 정도’입니다. 즉 특정 번호가 더 잘 나온다고 볼 근거가 없습니다 — 그래서 번호 무게는 아주 약하게만 씁니다.'
              : 'p 값이 0.05보다 작아 출현 횟수 차이가 다소 큽니다. 다만 회차가 많으면 작은 차이도 이렇게 나올 수 있어, 이것만으로 다음 회차를 맞힐 수는 없습니다.'}
          </p>
        </ChartCard>
      </div>
    </Panel>
  )
}

function Backtest({ draws }: { draws: Draw[] }) {
  const [res, setRes] = useState<ReturnType<typeof backtest> | null>(null)
  const [busy, setBusy] = useState(false)
  const run = () => {
    setBusy(true)
    // 화면이 멈추지 않게 한 박자 뒤에
    setTimeout(() => {
      setRes(backtest(draws, 52))
      setBusy(false)
    }, 30)
  }
  return (
    <Panel className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-base font-bold text-ink">
          <FlaskConical className="size-4 text-brand" aria-hidden /> 되짚어 보기(백테스트)
        </h3>
        <span className="text-sm text-muted">최근 52회마다, 그 전 회차까지만 보고 추천 5게임을 만들어 실제 결과와 맞춰 봅니다</span>
        <Button size="sm" className="ml-auto" icon={FlaskConical} loading={busy} onClick={run}>
          {res ? '다시 해 보기' : '되짚어 보기'}
        </Button>
      </div>
      {res && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1">맞힌 개수</th>
                  {[0, 1, 2, 3, 4, 5, 6].map((k) => (
                    <th key={k} className="py-1 text-right">
                      {k}개{k === 3 ? ' (5등)' : k === 4 ? ' (4등)' : k === 5 ? ' (3등~)' : k === 6 ? ' (1등)' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  <td className="py-1.5 font-semibold">AI 추천 {res.games}게임</td>
                  {res.hits.map((v, k) => (
                    <td key={k} className="num py-1.5 text-right font-semibold">
                      {v}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-line text-muted">
                  <td className="py-1.5">무작위로 샀다면(기대값)</td>
                  {res.expected.map((v, k) => (
                    <td key={k} className="num py-1.5 text-right">
                      {v < 0.01 ? '≈0' : v.toFixed(1)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="flex items-start gap-1.5 text-sm text-ink-2">
            <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            한 게임 평균 {res.avg.toFixed(2)}개를 맞혔습니다(무작위 기대값 {res.expectedAvg.toFixed(2)}개). 두 줄이 비슷하게 나오는 것이 정상입니다 — 로또는 과거 결과로 다음 번호를 맞힐 수 없다는 뜻이고, 추천의 장점은 ‘흔한 모양’과 ‘나눠 갖는 사람이 적은 조합’에 있습니다.
          </p>
        </>
      )}
    </Panel>
  )
}
