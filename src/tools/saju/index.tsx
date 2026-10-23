import clsx from 'clsx'
import { CalendarDays, CheckCircle2, Copy, LogIn, RefreshCw, ScrollText, Sparkles, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLoginDialog } from '@/app/LoginDialog'
import { api } from '@/lib/api'
import { Badge, Button, Callout, Checkbox, Field, Panel, Segmented, Select, Spinner, TextInput, toast } from '@/ui'
import {
  branchElement,
  branchHanja,
  chartForAi,
  CITIES,
  computeChart,
  DAY_MASTER_NOTE,
  ELEMENTS,
  PILLAR_LABEL,
  stemElement,
  stemHanja,
  type Chart,
  type ChartInput,
  type Element,
} from './logic'

// ── 오행 색 ──────────────────────────────────────────────
const EL_TEXT: Record<Element, string> = { 목: 'text-wood', 화: 'text-fire', 토: 'text-earth', 금: 'text-metal', 수: 'text-water' }
const EL_BOX: Record<Element, string> = {
  목: 'bg-wood-soft border-wood/30',
  화: 'bg-fire-soft border-fire/30',
  토: 'bg-earth-soft border-earth/30',
  금: 'bg-metal-soft border-metal/30',
  수: 'bg-water-soft border-water/30',
}
const EL_BAR: Record<Element, string> = { 목: 'bg-wood', 화: 'bg-fire', 토: 'bg-earth', 금: 'bg-metal', 수: 'bg-water' }
const EL_NAME: Record<Element, string> = { 목: '목(木)', 화: '화(火)', 토: '토(土)', 금: '금(金)', 수: '수(水)' }

const FEATURES: Array<[string, string]> = [
  ['한국천문연구원 기준 만세력', '음력·윤달과 24절기를 한국천문연구원(KASI) 자료로 계산합니다. 중국 음력과 윤달이 다른 해도 한국 기준으로 맞습니다.'],
  ['절입 시각까지 분 단위로', '연주는 입춘, 월주는 절기가 들어오는 순간(분 단위)으로 나눕니다. 절기 근처에 태어난 사람도 정확합니다.'],
  ['진태양시·야자시 선택', '출생지 경도와 균시차, 과거 표준시·서머타임(1948~1988년)을 반영하는 진태양시 보정과, 자시(23시~1시) 관법 세 가지를 고를 수 있습니다.'],
  ['전문 원국표 한눈에', '천간·지지와 십신, 지장간, 12운성, 공망, 오행·음양 분포를 한 표로 보여 줍니다.'],
  ['대운·세운까지', '대운 순행·역행과 대운수(한국식 반올림), 10년 단위 대운 열 개와 지금 대운, 올해·내년 세운을 계산합니다.'],
  ['AI 한국어 풀이', '원국을 바탕으로 성격·재물·직업·연애·건강·대운 흐름·올해와 내년 운세를 자평명리 관점에서 쉬운 한국어로 풀어 줍니다.'],
  ['검증된 계산', '공개 만세력 엔진과 무작위 4천여 개 생년월일시를 대조해 연·월·일·시주가 모두 같은 것을 확인했습니다.'],
  ['개인정보 걱정 없이', '사주 계산은 내 브라우저 안에서만 합니다. AI 풀이 때도 이름·생일 원문은 보내지 않고 출생 연도와 원국만 보냅니다.'],
]

interface Reading {
  summary: string
  keywords: string[]
  sections: Array<{ key: string; title: string; body: string }>
  cached: boolean
  at: string
}

const thisYear = new Date().getFullYear()
const pad = (n: number) => String(n).padStart(2, '0')

export default function SajuTool() {
  const [name, setName] = useState('')
  const [gender, setGender] = useState<'male' | 'female'>('female')
  const [calendar, setCalendar] = useState<'solar' | 'lunar'>('solar')
  const [leap, setLeap] = useState(false)
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('1')
  const [day, setDay] = useState('1')
  const [time, setTime] = useState('12:00')
  const [timeUnknown, setTimeUnknown] = useState(false)
  const [city, setCity] = useState('')
  const [boundary, setBoundary] = useState<ChartInput['dayBoundary']>('midnight')
  const [chart, setChart] = useState<Chart | null>(null)
  const [shownName, setShownName] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const y = Number(year)
    if (!Number.isInteger(y) || y < 1800 || y > 2300) return toast.error('태어난 해를 네 자리로 넣어 주세요. 예: 1985')
    if (calendar === 'lunar' && y > 2100) return toast.error('음력은 2100년까지 계산할 수 있습니다.')
    const [hh, mm] = time.split(':').map(Number)
    const input: ChartInput = {
      calendar,
      leap: calendar === 'lunar' && leap,
      year: y,
      month: Number(month),
      day: Number(day),
      hour: timeUnknown ? null : (hh ?? 12),
      minute: timeUnknown ? 0 : (mm ?? 0),
      gender,
      longitude: city ? (CITIES.find((c) => c.name === city)?.lon ?? null) : null,
      dayBoundary: boundary,
    }
    try {
      setChart(computeChart(input))
      setShownName(name.trim())
      requestAnimationFrame(() => document.getElementById('saju-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (err) {
      toast.error(err instanceof RangeError ? '없는 날짜입니다. 생년월일(음력이면 윤달 여부)을 확인해 주세요.' : err instanceof Error ? err.message : '계산하지 못했습니다.')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Intro />
      <Panel className="p-4 sm:p-5">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Field label="이름" hint="선택 · 화면에만 표시(어디에도 보내지 않음)">
              {(id) => <TextInput id={id} value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="예: 홍길동" />}
            </Field>
            <Field label="성별">
              {() => (
                <Segmented
                  label="성별"
                  value={gender}
                  onValue={setGender}
                  options={[
                    { value: 'female', label: '여' },
                    { value: 'male', label: '남' },
                  ]}
                />
              )}
            </Field>
            <Field label="달력">
              {() => (
                <Segmented
                  label="양력·음력"
                  value={calendar}
                  onValue={setCalendar}
                  options={[
                    { value: 'solar', label: '양력' },
                    { value: 'lunar', label: '음력' },
                  ]}
                />
              )}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[8rem_6rem_6rem_minmax(0,1fr)]">
            <Field label="태어난 해">
              {(id) => <TextInput id={id} value={year} inputMode="numeric" maxLength={4} placeholder="1985" onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} required />}
            </Field>
            <Field label="월">{(id) => <Select id={id} value={month} onValue={setMonth} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}월` }))} />}</Field>
            <Field label="일">{(id) => <Select id={id} value={day} onValue={setDay} options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}일` }))} />}</Field>
            <Field label="태어난 시각" hint={timeUnknown ? '시주 없이 세 기둥으로 봅니다' : '24시간제(오후 3시 = 15:00)'}>
              {(id) => (
                <div className="flex flex-wrap items-center gap-3">
                  <input id={id} type="time" value={time} disabled={timeUnknown} onChange={(e) => setTime(e.target.value)} className="h-10 rounded-md border border-line-strong bg-surface px-3 text-sm disabled:opacity-50" />
                  <Checkbox checked={timeUnknown} onChange={setTimeUnknown} label="시간 모름" />
                </div>
              )}
            </Field>
          </div>
          {calendar === 'lunar' && <Checkbox checked={leap} onChange={setLeap} label="윤달(윤월)에 태어났어요" />}
          <details className="rounded-md border border-line bg-paper px-3 py-2 text-sm">
            <summary className="cursor-pointer font-semibold text-ink-2">세부 설정 · 진태양시 보정, 자시 관법</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="출생지(진태양시 보정)" hint="고르면 경도·균시차·과거 서머타임을 반영해 시주를 정합니다. 기본은 표준시 그대로.">
                {(id) => <Select id={id} value={city} onValue={setCity} options={[{ value: '', label: '보정 안 함(표준시 그대로)' }, ...CITIES.map((c) => ({ value: c.name, label: `${c.name} (동경 ${c.lon}°)` }))]} />}
              </Field>
              <Field label="자시(23시~1시) 관법" hint="학파마다 다릅니다. 잘 모르면 기본값으로.">
                {(id) => (
                  <Select
                    id={id}
                    value={boundary}
                    onValue={setBoundary}
                    options={[
                      { value: 'midnight', label: '자정 기준(기본) — 0시에 날이 바뀜' },
                      { value: 'jasi', label: '자시 기준 — 23시부터 다음 날' },
                      { value: 'splitJasi', label: '야자시·조자시 — 23시는 당일 일주, 시주는 다음 날' },
                    ]}
                  />
                )}
              </Field>
            </div>
          </details>
          <div>
            <Button type="submit" variant="primary" icon={ScrollText}>
              사주 보기
            </Button>
          </div>
        </form>
      </Panel>
      {chart && (
        <div id="saju-result" className="flex scroll-mt-20 flex-col gap-5">
          <ChartView chart={chart} name={shownName} />
          <AiReading key={JSON.stringify(chartForAi(chart))} chart={chart} name={shownName} />
        </div>
      )}
    </div>
  )
}

function Intro() {
  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-bold text-ink">사주풀이란?</h2>
        <p className="text-sm leading-relaxed text-ink-2">
          사주(四柱)는 태어난 <b>해·달·날·시</b>를 네 기둥(연주·월주·일주·시주)으로 세우고, 기둥마다 천간과 지지 두 글자씩 모두 여덟 글자(팔자)로 타고난 기운을 읽는 한국·동양의 전통 명리학입니다. 생년월일시만 넣으면 <b>만세력으로 원국을 정확히 세우고</b>, 십신·오행·대운까지 한눈에 보여 준 뒤 <b>AI가 한국어로 풀이</b>해 드립니다.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {FEATURES.map(([title, body]) => (
          <li key={title} className="flex gap-2 rounded-md border border-line bg-paper p-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-faint">사주풀이는 전통 명리학에 따른 참고용 해석입니다. 건강·법률·투자 같은 중요한 결정은 전문가와 상의하세요.</p>
    </Panel>
  )
}

// ── 원국표 ───────────────────────────────────────────────
function GanjiChar({ ch, el, hanja, size = 'lg' }: { ch: string; el: Element; hanja: string; size?: 'lg' | 'md' }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center rounded-md border', EL_BOX[el], size === 'lg' ? 'h-20 w-full' : 'h-14 w-full')}>
      <span className={clsx('leading-none font-bold', EL_TEXT[el], size === 'lg' ? 'text-3xl' : 'text-xl')}>{hanja}</span>
      <span className={clsx('mt-1 text-xs font-semibold', EL_TEXT[el])}>
        {ch} · {el}
      </span>
    </div>
  )
}

function ChartView({ chart, name }: { chart: Chart; name: string }) {
  const c = chart
  const total = Object.values(c.elements).reduce((a, b) => a + b, 0)
  const inp = c.input
  const birth =
    inp.calendar === 'lunar'
      ? `음력 ${inp.year}.${pad(inp.month)}.${pad(inp.day)}${inp.leap ? '(윤)' : ''} → 양력 ${c.solar.year}.${pad(c.solar.month)}.${pad(c.solar.day)}`
      : `양력 ${inp.year}.${pad(inp.month)}.${pad(inp.day)}`
  const timeText = inp.hour == null ? '시간 모름' : `${pad(inp.hour)}:${pad(inp.minute)}${inp.longitude != null ? ' (진태양시 보정)' : ''}`
  const missing = ELEMENTS.filter((e) => c.elements[e] === 0)
  const most = ELEMENTS.filter((e) => c.elements[e] === Math.max(...Object.values(c.elements)))
  return (
    <Panel className="flex flex-col gap-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <h2 className="text-xl font-bold text-ink">{name ? `${name} 님의 사주` : '사주 원국'}</h2>
        <span className="text-sm text-muted">
          {inp.gender === 'male' ? '남' : '여'} · {birth} · {timeText} · 만 {c.age}세
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] table-fixed border-separate border-spacing-1.5 text-center text-sm">
          <thead>
            <tr>
              <th className="w-16" />
              {c.pillars.map((p) => (
                <th key={p.key} className={clsx('py-1 text-sm font-bold', p.key === 'day' ? 'text-brand' : 'text-ink-2')}>
                  {PILLAR_LABEL[p.key]}
                  {p.key === 'day' && <span className="ml-1 text-2xs font-semibold">(나)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="text-xs font-semibold text-muted">십신</th>
              {c.pillars.map((p) => (
                <td key={p.key} className={clsx('text-xs font-semibold', p.key === 'day' ? 'text-brand' : 'text-ink-2')}>
                  {p.stemTenGod}
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-xs font-semibold text-muted">천간</th>
              {c.pillars.map((p) => (
                <td key={p.key}>
                  <GanjiChar ch={p.stem} el={stemElement(p.stem)} hanja={stemHanja(p.stem)} />
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-xs font-semibold text-muted">지지</th>
              {c.pillars.map((p) => (
                <td key={p.key}>
                  <GanjiChar ch={p.branch} el={branchElement(p.branch)} hanja={branchHanja(p.branch)} />
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-xs font-semibold text-muted">십신</th>
              {c.pillars.map((p) => (
                <td key={p.key} className="text-xs font-semibold text-ink-2">
                  {p.branchTenGod}
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-xs font-semibold text-muted">지장간</th>
              {c.pillars.map((p) => (
                <td key={p.key} className="text-xs text-ink-2">
                  {p.hidden.map((h) => (
                    <span key={h.stem} className={clsx('mx-0.5 font-semibold', EL_TEXT[stemElement(h.stem)])} title={h.tenGod}>
                      {h.stem}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-xs font-semibold text-muted">12운성</th>
              {c.pillars.map((p) => (
                <td key={p.key} className="text-xs text-ink-2">
                  {p.stage}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-md border border-line bg-paper p-3">
          <p className="text-sm font-bold text-ink">
            일간 <span className={EL_TEXT[stemElement(c.dayMaster)]}>{c.dayMaster}({stemHanja(c.dayMaster)})</span> — 나를 나타내는 글자
          </p>
          <p className="text-sm text-ink-2">{DAY_MASTER_NOTE[c.dayMaster]}</p>
          <p className="text-xs text-muted">
            공망 {c.voidBranches.join('·')} · 음양 양 {c.yinYang.yang} / 음 {c.yinYang.yin}
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-md border border-line bg-paper p-3">
          <p className="text-sm font-bold text-ink">오행 분포 <span className="text-xs font-normal text-muted">(천간·지지 {total}자)</span></p>
          <div className="flex flex-col gap-1.5">
            {ELEMENTS.map((e) => (
              <div key={e} className="flex items-center gap-2 text-xs">
                <span className={clsx('w-12 font-semibold', EL_TEXT[e])}>{EL_NAME[e]}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-sunken">
                  <div className={clsx('h-full rounded-full', EL_BAR[e])} style={{ width: `${(c.elements[e] / Math.max(total, 1)) * 100}%` }} />
                </div>
                <span className="num w-6 text-right text-ink-2">{c.elements[e]}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">
            {most.map((e) => EL_NAME[e]).join('·')} 기운이 가장 많고{missing.length ? `, ${missing.map((e) => EL_NAME[e]).join('·')} 기운이 없습니다` : ', 다섯 기운이 모두 있습니다'}.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-ink">
          대운 <span className="text-xs font-normal text-muted">({c.luck.forward ? '순행' : '역행'} · 대운수 {c.luck.startAge} · 10년마다 바뀌는 큰 운)</span>
        </p>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {c.luck.list.map((l, i) => (
            <div key={l.age} className={clsx('flex w-16 shrink-0 flex-col items-center gap-1 rounded-md border p-1.5 text-center', i === c.luck.current ? 'border-brand bg-brand-soft' : 'border-line bg-surface')}>
              <span className="num text-xs font-bold text-ink-2">{l.age}세</span>
              <span className={clsx('text-lg leading-none font-bold', EL_TEXT[stemElement(l.stem)])}>{stemHanja(l.stem)}</span>
              <span className={clsx('text-lg leading-none font-bold', EL_TEXT[branchElement(l.branch)])}>{branchHanja(l.branch)}</span>
              <span className="text-2xs text-muted">{l.stemTenGod}</span>
              {i === c.luck.current && <Badge tone="brand">지금</Badge>}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-ink">
          세운 <span className="text-xs font-normal text-muted">(해마다 들어오는 운)</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {c.years.map((y, i) => (
            <div key={y.year} className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
              <CalendarDays className="size-4 text-muted" aria-hidden />
              <span className="text-sm font-semibold text-ink">
                {y.year}년 {i === 0 ? '(올해)' : '(내년)'}
              </span>
              <span className="text-lg font-bold">
                <span className={EL_TEXT[stemElement(y.stem)]}>{stemHanja(y.stem)}</span>
                <span className={EL_TEXT[branchElement(y.branch)]}>{branchHanja(y.branch)}</span>
              </span>
              <span className="text-xs text-muted">
                {y.stem}
                {y.branch} · {y.stemTenGod}/{y.branchTenGod}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

// ── AI 풀이 ──────────────────────────────────────────────
function AiReading({ chart, name }: { chart: Chart; name: string }) {
  const showLogin = useLoginDialog((s) => s.show)
  const [status, setStatus] = useState<{ allowed: boolean; ai: boolean } | null>(null)
  const [reading, setReading] = useState<Reading | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const payload = useMemo(() => chartForAi(chart), [chart])
  useEffect(() => {
    api<{ allowed: boolean; ai: boolean }>('/saju/status')
      .then(setStatus)
      .catch(() => setStatus({ allowed: false, ai: false }))
  }, [])
  useEffect(() => {
    if (!busy) return
    const t0 = Date.now()
    const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(t)
  }, [busy])
  const run = async () => {
    setBusy(true)
    setElapsed(0)
    try {
      setReading(await api<Reading>('/saju/interpret', { method: 'POST', body: { chart: payload } }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI 풀이를 받지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!reading) return
    const text = [`${name ? `${name} 님의 ` : ''}사주풀이`, '', reading.summary, '', ...reading.sections.flatMap((s) => [`■ ${s.title}`, s.body, ''])].join('\n')
    await navigator.clipboard.writeText(text).then(
      () => toast.success('풀이를 복사했습니다.'),
      () => toast.error('복사하지 못했습니다.'),
    )
  }
  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-xl font-bold text-ink">
          <Sparkles className="size-5 text-accent" aria-hidden /> AI 사주풀이
        </h2>
        {reading && (
          <span className="text-xs text-muted">
            {reading.cached ? '같은 원국의 지난 풀이' : '방금 풀이'} · {new Date(reading.at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
        )}
        <div className="ml-auto flex gap-1.5">
          {reading && (
            <Button size="sm" icon={Copy} onClick={() => void copy()}>
              풀이 복사
            </Button>
          )}
        </div>
      </div>
      {!status ? (
        <div className="flex items-center gap-2 text-muted">
          <Spinner /> 확인 중
        </div>
      ) : !status.allowed ? (
        <Callout tone="info" title="AI 풀이는 직원 계정으로 쓸 수 있습니다">
          원국표는 누구나 볼 수 있고, AI 풀이는 로그인한 직원(또는 팀 코드로 들어온 사람)만 쓸 수 있습니다.
          <div className="mt-2">
            <Button size="sm" variant="primary" icon={LogIn} onClick={showLogin}>
              로그인
            </Button>
          </div>
        </Callout>
      ) : !status.ai ? (
        <Callout tone="warn" title="AI 키가 아직 연결되지 않았습니다">
          관리자 화면 → ‘SNS 연결’에서 AI 키를 넣으면 AI 풀이를 쓸 수 있습니다(체험단 선발과 같은 키).
        </Callout>
      ) : !reading ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-ink-2">위 원국을 바탕으로 성격·재물·직업·연애·건강·대운 흐름·올해와 내년 운세를 풀이합니다. 30초~1분쯤 걸립니다.</p>
          <Button variant="primary" icon={Wand2} loading={busy} onClick={() => void run()}>
            {busy ? `풀이하는 중… ${elapsed}초` : 'AI 사주풀이 받기'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-brand/30 bg-brand-soft/60 p-4">
            <p className="text-base leading-relaxed font-semibold text-ink">{reading.summary}</p>
            {reading.keywords.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {reading.keywords.map((k) => (
                  <Badge key={k} tone="brand">
                    {k}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {reading.sections.map((s) => (
              <section key={s.key} className="rounded-md border border-line bg-paper p-4">
                <h3 className="mb-1.5 text-sm font-bold text-ink">{s.title}</h3>
                <p className="text-sm leading-relaxed whitespace-pre-line text-ink-2">{s.body}</p>
              </section>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy} onClick={() => void run()} title="같은 원국은 저장해 둔 풀이를 보여 줍니다">
              다시 불러오기
            </Button>
            <span className="text-xs text-faint">전통 명리학에 따른 참고용 풀이입니다.</span>
          </div>
        </div>
      )}
    </Panel>
  )
}
