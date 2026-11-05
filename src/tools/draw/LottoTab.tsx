import clsx from 'clsx'
import { BarChart3, BrainCircuit, Copy, Database, Download, FlaskConical, History, Info, PencilLine, RefreshCw, Sparkles, Upload } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { downloadBlob } from '@/lib/files'
import { writeTable } from '@/tools/orders/excel'
import { Badge, Button, Callout, Dialog, Field, Panel, Segmented, Spinner, TextInput, toast } from '@/ui'
import { backtest, ballColor, chiSquare, dateMismatches, parseLottoRows, rangesText, roundDate, visitorId, frequency, gaps, nextDraw, NUMS, numberWeights, recommend, shapeStats, topPairs, TOTAL_COMBOS, weekSeed, type Draw, type Pick } from './lotto'

interface LottoData {
  draws: Draw[]
  expectedLatest: number
  missing: number
  syncing: boolean
  lastSyncAt: string | null
  lastError: string | null
  updatedAt?: string | null
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
        // 자료가 그대로면 그래프를 다시 계산하지 않는다
        setData((cur) => (cur && cur.draws.length === d.draws.length && cur.updatedAt === d.updatedAt && cur.syncing === d.syncing && cur.missing === d.missing ? cur : d))
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '불러오지 못했습니다.'))
  useEffect(() => {
    void load()
  }, [])
  // 서버가 받아 오는 중이면 몇 초마다, 아니면 1분마다·창으로 돌아올 때 새 자료가 있는지 본다
  // (누가 한 주 자료를 넣으면 열어 둔 화면에도 그래프·추천이 저절로 바뀐다)
  useEffect(() => {
    const t = setTimeout(() => document.visibilityState === 'visible' && void load(), data?.syncing ? 4000 : 60_000)
    return () => clearTimeout(t)
  }, [data])
  useEffect(() => {
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

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
  const [entry, setEntry] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const n = data.draws.length
  const have = new Set(data.draws.map((d) => d.round))
  const missing = Array.from({ length: data.expectedLatest }, (_, i) => i + 1).filter((r) => !have.has(r))
  const send = async (draws: Draw[], source: 'excel' | 'manual' = 'excel') => {
    const r = await api<LottoData & { added: number }>('/lotto/import', { method: 'POST', body: { draws, source } })
    onImported(r)
    return r.added
  }
  const importExcel = async (file: File) => {
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer(), { cellDates: true })
      const rows = book.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, blankrows: false, defval: '', raw: true }))
      const draws = parseLottoRows(rows, data.expectedLatest + 2)
      if (!draws.length) throw new Error('회차와 번호 6개·보너스가 들어 있는 줄을 찾지 못했습니다. 양식의 번호 칸을 채웠는지 확인해 주세요.')
      toast.success(`${await send(draws)}개 회차를 넣었습니다.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '엑셀을 넣지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  /** 양식: 비어 있는 회차(없으면 다음 회차)의 회차·추첨일을 미리 채운다 */
  const template = async () => {
    const rounds = missing.length ? missing : [(data.draws.at(-1)?.round ?? 0) + 1]
    const rows = rounds.map((r) => [r, null, null, null, null, null, null, null, roundDate(r)])
    downloadBlob(await writeTable('로또 당첨번호', ['회차', '번호1', '번호2', '번호3', '번호4', '번호5', '번호6', '보너스', '추첨일'], rows, [8, 8, 8, 8, 8, 8, 8, 8, 12]), '로또_당첨번호_입력양식.xlsx')
  }
  const resync = async () => {
    try {
      onImported(await api<LottoData>('/lotto/sync', { method: 'POST' }))
      toast.info('동행복권에서 다시 받는 중입니다.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '다시 받지 못했습니다.')
    }
  }
  const complete = missing.length === 0
  return (
    <Panel className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-base font-bold text-ink">
          <Database className="size-4 text-brand" aria-hidden /> 당첨번호 자료 관리
        </h3>
        {complete ? <Badge tone="brand">최신</Badge> : data.syncing ? <Badge tone="accent">동행복권에서 받는 중… {missing.length}회 남음</Badge> : <Badge tone="warn">{missing.length}회 비어 있음</Badge>}
        <Button size="sm" variant="ghost" className="ml-auto" icon={RefreshCw} onClick={onReload}>
          새로 보기
        </Button>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted">가지고 있는 자료</dt>
        <dd className="text-ink-2">{n ? `${n.toLocaleString()}개 회차 (1회 ~ ${data.draws.at(-1)!.round}회)` : '아직 없음'}</dd>
        <dt className="text-muted">최근 추첨 회차</dt>
        <dd className="text-ink-2">
          {data.expectedLatest}회 ({roundDate(data.expectedLatest)} 토요일)
        </dd>
        <dt className="text-muted">비어 있는 회차</dt>
        <dd className={complete ? 'text-brand' : 'font-semibold text-warn'}>{complete ? '없음' : rangesText(missing).slice(0, 300)}</dd>
        <dt className="text-muted">자동으로 받은 때</dt>
        <dd className="text-ink-2">{data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString('ko-KR') : '아직 없음'}</dd>
      </dl>
      {data.lastError && !complete && !data.syncing && (
        <Callout tone="warn" title="동행복권에서 자동으로 받지 못했습니다">
          {data.lastError} — 잠시 뒤 ‘동행복권에서 다시 받기’를 누르거나, 아래 양식·건별 입력으로 채워 주세요.
        </Callout>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={PencilLine} onClick={() => setEntry(true)}>
          지난회차 자료 입력하기
        </Button>
        <Button icon={Download} onClick={() => void template()}>
          엑셀 양식 받기
        </Button>
        <Button icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}>
          엑셀로 한꺼번에 넣기
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void importExcel(f)
          }}
        />
        <Button variant="ghost" icon={RefreshCw} onClick={() => void resync()} disabled={data.syncing}>
          동행복권에서 다시 받기
        </Button>
      </div>
      <p className="text-xs text-muted">
        엑셀 양식에는 비어 있는 회차의 회차·추첨일이 미리 들어 있습니다. 번호 6개와 보너스만 채워 올리면 됩니다. 동행복권 홈페이지의 ‘회차별 당첨번호’ 엑셀을 그대로 올려도 됩니다. 이미 있는 회차를 넣으면 새 값으로 고칩니다. 입력·올리기는 스탭 이상만 됩니다.
      </p>
      <DrawList draws={data.draws} />
      {entry && <EntryDialog draws={data.draws} suggest={missing.at(-1) ?? (data.draws.at(-1)?.round ?? 0) + 1} max={data.expectedLatest + 1} onClose={() => setEntry(false)} onSave={(d) => send(d, 'manual')} />}
    </Panel>
  )
}


/** 한 회차씩 입력(지난 회차 넣기·잘못 들어간 회차 고치기) */
function EntryDialog({ draws, suggest, max, onClose, onSave }: { draws: Draw[]; suggest: number; max: number; onClose: () => void; onSave: (d: Draw[]) => Promise<number> }) {
  const [round, setRound] = useState(String(suggest))
  const r = Number(round)
  const existing = draws.find((d) => d.round === r)
  const [nums, setNums] = useState<string[]>(() => (existing ? [...existing.numbers.map(String), String(existing.bonus)] : Array(7).fill('')))
  const [busy, setBusy] = useState(false)
  // 회차를 바꾸면 그 회차 값(있으면)으로 채운다
  useEffect(() => {
    const d = draws.find((x) => x.round === Number(round))
    setNums(d ? [...d.numbers.map(String), String(d.bonus)] : Array(7).fill(''))
  }, [round, draws])
  const values = nums.map((v) => Number(v))
  const filled = nums.every((v) => v.trim())
  const invalid = filled && (!values.every((v) => Number.isInteger(v) && v >= 1 && v <= 45) || new Set(values).size !== 7)
  const okRound = Number.isInteger(r) && r >= 1 && r <= max
  const save = async () => {
    if (!okRound) return toast.error(`회차는 1~${max} 사이로 넣어 주세요.`)
    if (!filled || invalid) return toast.error('번호 6개와 보너스를 1~45 사이 서로 다른 수로 넣어 주세요.')
    setBusy(true)
    try {
      await onSave([{ round: r, date: roundDate(r), numbers: values.slice(0, 6), bonus: values[6] }])
      toast.success(`${r}회 당첨번호를 ${existing ? '고쳤습니다' : '넣었습니다'}.`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="지난회차 자료 입력하기"
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {existing ? '고쳐 저장' : '저장'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm whitespace-normal">
        <Field label="회차" hint={okRound ? `${roundDate(r)} 토요일 추첨${existing ? ' · 이미 있는 회차 — 저장하면 고칩니다' : ''}` : `1~${max} 사이`}>
          {(id) => <TextInput id={id} type="number" min={1} max={max} value={round} onChange={(e) => setRound(e.target.value)} className="w-32!" />}
        </Field>
        <div>
          <p className="mb-1.5 font-semibold text-ink-2">당첨번호 6개 + 보너스</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {nums.map((v, i) => (
              <Fragment key={i}>
                {i === 6 && <span className="mx-1 text-muted">+</span>}
                <input
                  aria-label={i === 6 ? '보너스 번호' : `번호 ${i + 1}`}
                  inputMode="numeric"
                  maxLength={2}
                  value={v}
                  onChange={(e) => setNums((list) => list.map((x, j) => (j === i ? e.target.value.replace(/\D/g, '').slice(0, 2) : x)))}
                  className="num h-11 w-11 rounded-full border-2 text-center text-base font-black text-white outline-none focus:ring-2 focus:ring-brand"
                  style={{ background: Number(v) >= 1 && Number(v) <= 45 ? ballColor(Number(v)) : 'var(--color-sunken)', borderColor: i === 6 ? 'var(--color-accent)' : 'transparent', color: Number(v) >= 1 && Number(v) <= 45 ? '#fff' : 'var(--color-ink)' }}
                />
              </Fragment>
            ))}
          </div>
          {invalid && <p className="mt-1.5 text-xs font-semibold text-danger">1~45 사이 서로 다른 수 7개여야 합니다.</p>}
        </div>
      </div>
    </Dialog>
  )
}

// ── 분석·추천 ─────────────────────────────────────────────
function Analysis({ draws }: { draws: Draw[] }) {
  const latest = draws.at(-1)!
  const next = nextDraw(latest)
  const me = useMemo(() => visitorId(), [])
  const mine = weekSeed(next.round, me)
  const [seed, setSeed] = useState(mine)
  useEffect(() => setSeed(weekSeed(next.round, me)), [next.round, me])
  const picks = useMemo(() => recommend(draws, { games: 5, seed, samples: 20000, mode: 'spread' }), [draws, seed])
  const weekly = seed === mine
  const copy = () => {
    const text = [`제${next.round}회 AI 추천 번호`, ...picks.map((p, i) => `${String.fromCharCode(65 + i)}: ${p.numbers.join(' ')}`)].join('\n')
    void navigator.clipboard.writeText(text).then(() => toast.success('추천 번호를 복사했습니다.'))
  }
  const first = draws[0]
  const gapsInData = latest.round - first.round + 1 - draws.length
  return (
    <>
      <Callout tone={gapsInData ? 'warn' : 'success'} title={`분석 기준: ${first.round}회 ~ ${latest.round}회, ${draws.length.toLocaleString()}개 회차`}>
        아래 추천·그래프·검정·되짚어 보기는 모두 서버에 저장된 이 자료로 계산합니다{gapsInData ? ` (중간에 빠진 회차 ${gapsInData}개 — 위 ‘당첨번호 자료 관리’에서 채워 주세요)` : ''}. 새 회차를 넣으면 열어 둔 화면도 1분 안에 저절로 다시 계산합니다.
      </Callout>
      <Panel className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-1.5 text-xl font-bold text-ink">
            <BrainCircuit className="size-5 text-accent" aria-hidden /> 제{next.round}회 AI 추천 번호
          </h2>
          <span className="text-sm text-muted">{next.date} 추첨</span>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" icon={Copy} onClick={copy}>
              번호 복사
            </Button>
            <Button size="sm" icon={Sparkles} onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>
              다른 조합 추천
            </Button>
            {!weekly && (
              <Button size="sm" variant="ghost" onClick={() => setSeed(mine)}>
                이번 주 내 추천
              </Button>
            )}
          </div>
        </div>
        <ul className="flex flex-col gap-2">
          {picks.map((p, i) => (
            <PickRow key={p.numbers.join()} p={p} label={String.fromCharCode(65 + i)} />
          ))}
        </ul>
        <p className="text-xs text-muted">{weekly ? '이번 주 내 추천은 접속한 사람마다 다르게 뽑고(점수 위쪽 조합들 가운데서), 같은 사람은 그 주 내내 같은 번호를 봅니다. ‘다른 조합 추천’으로 새로 뽑을 수 있습니다.' : '새로 뽑은 조합입니다.'} 지난 1등 조합과 같은 조합은 넣지 않습니다.</p>
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

/** 회차별 당첨번호 전체(최신부터) + 자료 점검 */
function DrawList({ draws }: { draws: Draw[] }) {
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(30)
  const bad = useMemo(() => dateMismatches(draws), [draws])
  const list = useMemo(() => {
    const t = q.trim()
    const all = [...draws].reverse()
    if (!t) return all
    const n = Number(t)
    return all.filter((d) => String(d.round).includes(t) || (Number.isInteger(n) && (d.numbers.includes(n) || d.bonus === n)) || d.date.includes(t))
  }, [draws, q])
  const SRC: Record<string, string> = { seed: '기본 자료(동행복권 엑셀)', auto: '동행복권 자동', excel: '엑셀', manual: '직접 입력' }
  return (
    <details className="rounded-md border border-line bg-paper px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold text-ink-2">
        회차별 당첨번호 전체 보기 · 자료 점검 ({draws.length.toLocaleString()}개 회차){bad.length > 0 && <span className="ml-1 text-danger"> — 추첨일이 회차와 맞지 않는 줄 {bad.length}개</span>}
      </summary>
      <div className="mt-3 flex flex-col gap-2">
        {bad.length > 0 && (
          <Callout tone="danger" title={`추첨일이 회차와 맞지 않는 줄 ${bad.length}개`}>
            엑셀을 올릴 때 회차가 한 칸씩 밀려 들어갔을 수 있습니다. 예: {bad.slice(0, 5).map((d) => `${d.round}회(자료 ${d.date} / 실제 ${roundDate(d.round)})`).join(', ')}. 바른 엑셀을 다시 올리면 덮어씁니다.
          </Callout>
        )}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="회차·번호·날짜로 찾기 (예: 1150, 7, 2024-12)" className="h-9 w-full max-w-sm rounded-md border border-line-strong bg-surface px-3 text-sm" aria-label="당첨번호 찾기" />
        <div className="max-h-[28rem] overflow-auto rounded border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
              <tr>
                <th className="px-2 py-1.5">회차</th>
                <th className="px-2 py-1.5">추첨일</th>
                <th className="px-2 py-1.5">당첨번호 + 보너스</th>
                <th className="px-2 py-1.5">출처</th>
                <th className="px-2 py-1.5">넣은 때</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, limit).map((d) => (
                <tr key={d.round} className={clsx('border-t border-line', bad.includes(d) && 'bg-danger-soft/60')}>
                  <td className="num px-2 py-1 font-semibold">{d.round}</td>
                  <td className="num px-2 py-1 text-muted">{d.date || roundDate(d.round)}</td>
                  <td className="px-2 py-1">
                    <span className="flex items-center gap-1">
                      {d.numbers.map((n) => (
                        <Ball key={n} n={n} size={24} />
                      ))}
                      <span className="mx-0.5 text-muted">+</span>
                      <Ball n={d.bonus} size={24} />
                    </span>
                  </td>
                  <td className="px-2 py-1 text-xs text-muted">{SRC[d.src ?? 'auto']}</td>
                  <td className="px-2 py-1 text-xs text-muted">{d.at ? new Date(d.at).toLocaleDateString('ko-KR') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length > limit && (
          <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + 100)}>
            더 보기 ({(list.length - limit).toLocaleString()}개 남음)
          </Button>
        )}
      </div>
    </details>
  )
}
