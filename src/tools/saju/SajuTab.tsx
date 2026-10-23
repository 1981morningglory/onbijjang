import clsx from 'clsx'
import {
  BookOpen,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Coins,
  Compass,
  Copy,
  Heart,
  HeartPulse,
  Lightbulb,
  LogIn,
  Palette,
  RefreshCw,
  ScrollText,
  Shield,
  Sparkles,
  TrendingUp,
  UserRound,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useLoginDialog } from '@/app/LoginDialog'
import { api } from '@/lib/api'
import { Badge, Button, Callout, Checkbox, Field, Panel, Segmented, Select, Spinner, TextInput, toast } from '@/ui'
import {
  branchElement,
  branchHanja,
  chartForAi,
  CITIES,
  computeChart,
  DAY_MASTER_NAME,
  DAY_MASTER_NOTE,
  dayStrength,
  ELEMENT_TIPS,
  ELEMENTS,
  lunarOptions,
  PILLAR_LABEL,
  stemElement,
  stemHanja,
  TEN_GROUP_NOTE,
  TEN_GROUP_OF,
  tenGroupCounts,
  ZODIAC,
  type Chart,
  type ChartInput,
  type Element,
  type SolarYmd,
} from './logic'
import { isClash, isHarmony, PILLAR_PLACE, TEN_GOD_NOTE } from './guide'
import { GLOSSARY, GROUP_LUCK, GROUP_LUCK_SHORT, GROUP_MANY, GROUP_NONE, STAGE_NOTE, STEM_READING, STRENGTH_TEXT } from './guide'
import { safeName, sajuQuery } from './share'
import { ShareButtons, ShareDialog, useShare, type ShareTarget } from './ShareUI'
import { EL_BOX, EL_HANJA, EL_NAME, EL_SOFT, EL_TEXT, EL_VAR, ElementCycle, ElementTable, CycleGuide, groupElement, Radar, Stars, StemBadge, StrengthGauge, TenGroupDonut } from './visuals'

const FEATURES: Array<[string, string]> = [
  ['한국천문연구원 기준 만세력', '음력·윤달과 24절기를 한국천문연구원(KASI) 자료로, 한국 시간 기준으로 계산합니다.'],
  ['윤달은 알아서', '음력 생일만 넣으면 그해 윤달이 있는지 스스로 찾아 양력으로 바꿉니다.'],
  ['그림으로 보는 사주', '내 일간 그림, 오행 상생상극 도표, 십신 도넛, 일간의 힘 게이지, 대운 흐름까지 한눈에.'],
  ['AI 한국어 풀이', '분야별 점수 레이더와 한 줄 요약, 핵심 포인트로 읽기 쉽게 풀어 줍니다.'],
]

interface Reading {
  summary: string
  keywords: string[]
  scores: Record<string, number>
  sections: Array<{ key: string; title: string; headline: string; points: string[]; body: string }>
  cached: boolean
  at: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: SolarYmd) => `${d.year}.${pad(d.month)}.${pad(d.day)}`
const c2s = (c: Chart) => `${c.solar.year}-${pad(c.solar.month)}-${pad(c.solar.day)}`

export default function SajuTab() {
  const [name, setName] = useState('')
  const [gender, setGender] = useState<'male' | 'female'>('female')
  const [calendar, setCalendar] = useState<'solar' | 'lunar'>('solar')
  const [leapChoice, setLeapChoice] = useState<'normal' | 'leap'>('normal')
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('1')
  const [day, setDay] = useState('1')
  const [time, setTime] = useState('12:00')
  const [timeUnknown, setTimeUnknown] = useState(false)
  const [city, setCity] = useState('')
  const [boundary, setBoundary] = useState<ChartInput['dayBoundary']>('midnight')
  const [chart, setChart] = useState<Chart | null>(null)
  const [shownName, setShownName] = useState('')
  const [shareOpen, setShareOpen] = useState(false)

  const target: ShareTarget | null = chart
    ? {
        containerId: 'saju-result',
        filename: `${safeName(`사주_${shownName || '결과'}_${c2s(chart)}`)}.pdf`,
        title: `${shownName ? `${shownName} 님의 ` : ''}사주풀이`,
        kind: 'saju',
        query: sajuQuery(chart.input, shownName),
      }
    : null
  const share = useShare(target)

  // 음력이면 그해 윤달이 있는지 자동으로 찾는다
  const y = Number(year)
  const lunar = useMemo(() => (calendar === 'lunar' && year.length === 4 && y >= 1391 && y <= 2100 ? lunarOptions(y, Number(month), Number(day)) : null), [calendar, year, y, month, day])
  const bothLeap = Boolean(lunar?.normal && lunar?.leap)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!Number.isInteger(y) || y < 1800 || y > 2300) return toast.error('태어난 해를 네 자리로 넣어 주세요. 예: 1985')
    if (calendar === 'lunar' && y > 2100) return toast.error('음력은 2100년까지 계산할 수 있습니다.')
    if (calendar === 'lunar' && lunar && !lunar.normal && !lunar.leap) return toast.error(`음력 ${y}년 ${month}월에는 ${day}일이 없습니다.`)
    const [hh, mm] = time.split(':').map(Number)
    // 평달이 없고 윤달만 되는 날(드묾)은 윤달로
    const leap = calendar === 'lunar' && Boolean(lunar?.leap) && (leapChoice === 'leap' || !lunar?.normal)
    const input: ChartInput = {
      calendar,
      leap,
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
      toast.error(err instanceof RangeError ? '없는 날짜입니다. 생년월일을 확인해 주세요.' : err instanceof Error ? err.message : '계산하지 못했습니다.')
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
            <Field label="태어난 시각" hint={timeUnknown ? '시주 없이 세 기둥으로 봅니다' : `24시간으로 ${time} · 오전 12시 = 밤 12시(자정), 오후 12시 = 낮 12시(정오)`}>
              {(id) => (
                <div className="flex flex-wrap items-center gap-2">
                  <TimePicker id={id} value={time} onValue={setTime} disabled={timeUnknown} />
                  <Checkbox checked={timeUnknown} onChange={setTimeUnknown} label="시간 모름" />
                </div>
              )}
            </Field>
          </div>
          {lunar && <LunarNote lunar={lunar} both={bothLeap} month={Number(month)} choice={leapChoice} onChoice={setLeapChoice} />}
          <details className="rounded-md border border-line bg-paper px-3 py-2 text-base">
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
          <ChartView chart={chart} name={shownName} actions={<ShareButtons share={share} />} />
          <AiReading key={JSON.stringify(chartForAi(chart))} chart={chart} name={shownName} onDone={() => setShareOpen(true)} />
        </div>
      )}
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        heading="AI 사주풀이가 완료됐어요"
        target={target}
        share={share}
        note="PDF에는 원국·도표와 AI 풀이가 모두 담깁니다. 짧은 링크를 받은 사람은 메뉴 없이 이 결과(원국·도표·AI 풀이)만 볼 수 있고, 링크 주소에는 생년월일이 드러나지 않습니다."
      />
    </div>
  )
}

/** 태어난 시각: 오전/오후 · 시 · 분 고르기(값은 24시간 "HH:MM") */
function TimePicker({ id, value, onValue, disabled }: { id: string; value: string; onValue: (v: string) => void; disabled?: boolean }) {
  const [h, m] = value.split(':').map(Number)
  const pm = h >= 12
  const h12 = h % 12 === 0 ? 12 : h % 12
  const set = (nextPm: boolean, nextH12: number, nextM: number) => onValue(`${pad((nextH12 % 12) + (nextPm ? 12 : 0))}:${pad(nextM)}`)
  return (
    <div className="flex items-center gap-1.5">
      <Select
        id={id}
        aria-label="오전·오후"
        disabled={disabled}
        value={pm ? 'pm' : 'am'}
        onValue={(v) => set(v === 'pm', h12, m)}
        options={[
          { value: 'am', label: '오전' },
          { value: 'pm', label: '오후' },
        ]}
        className="w-[5.5rem]"
      />
      <Select aria-label="시" disabled={disabled} value={String(h12)} onValue={(v) => set(pm, Number(v), m)} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}시` }))} className="w-[5.5rem]" />
      <Select aria-label="분" disabled={disabled} value={String(m)} onValue={(v) => set(pm, h12, Number(v))} options={Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: `${pad(i)}분` }))} className="w-[5.5rem]" />
    </div>
  )
}

/** 음력 입력 안내: 양력 날짜를 바로 보여 주고, 그해 같은 달에 윤달이 있을 때만 고르게 한다 */
function LunarNote({ lunar, both, month, choice, onChoice }: { lunar: { normal: SolarYmd | null; leap: SolarYmd | null }; both: boolean; month: number; choice: 'normal' | 'leap'; onChoice: (v: 'normal' | 'leap') => void }) {
  if (!lunar.normal && !lunar.leap) return <p className="text-base font-semibold text-danger">음력으로 없는 날짜입니다(그달은 29일까지).</p>
  if (!both) {
    const d = (lunar.normal ?? lunar.leap)!
    return (
      <p className="flex items-center gap-1.5 text-base text-ink-2">
        <CheckCircle2 className="size-4 text-brand" aria-hidden />
        양력으로 <b>{ymd(d)}</b>
        {!lunar.normal && ' (윤달)'} · 윤달은 자동으로 확인했어요
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-mark bg-mark-soft/60 p-3">
      <p className="text-base text-ink">
        이 해에는 <b>윤{month}월</b>이 있어서 같은 음력 날짜가 두 번 있습니다. 어느 쪽인지 골라 주세요. <span className="text-muted">(모르면 보통 평달)</span>
      </p>
      <Segmented
        label="평달·윤달"
        value={choice}
        onValue={onChoice}
        options={[
          { value: 'normal', label: `평달 → 양력 ${ymd(lunar.normal!)}` },
          { value: 'leap', label: `윤달 → 양력 ${ymd(lunar.leap!)}` },
        ]}
      />
    </div>
  )
}

function Intro() {
  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-bold text-ink">사주풀이란?</h2>
        <p className="text-base leading-relaxed text-ink-2">
          사주(四柱)는 태어난 <b>해·달·날·시</b>를 네 기둥으로 세우고, 기둥마다 두 글자씩 모두 여덟 글자(팔자)로 타고난 기운을 읽는 전통 명리학입니다. 생년월일시만 넣으면 <b>한국 기준 만세력으로 정확히 계산</b>해 <b>그림과 도표</b>로 보여 주고, <b>AI가 한국어로 풀이</b>해 드립니다.
        </p>
      </div>
      <div className="flex flex-col gap-2 rounded-md border border-brand/25 bg-brand-soft/50 p-4">
        <p className="text-base font-bold text-ink">🇰🇷 중국식이 아닌 ‘한국식 사주’라 더 정확합니다</p>
        <p className="text-sm leading-relaxed text-ink-2">
          사주는 태어난 순간의 <b>달력(음력·절기)</b>과 <b>시각</b>으로 여덟 글자를 정합니다. 그런데 많은 사주 앱과 프로그램이 쓰는 중국 만세력은 <b>베이징 시간(동경 120°)</b>을 기준으로 만들어져 한국에서 태어난 사람에게는 조금씩 어긋날 수 있습니다. 이 앱은 처음부터 끝까지 한국 기준으로 계산합니다.
        </p>
        <ul className="grid gap-2 text-sm leading-relaxed text-ink-2 md:grid-cols-2">
          <li className="rounded bg-surface/70 px-3 py-2">
            <b className="text-ink">한국 달력 그대로</b> — 한국과 중국은 음력 초하루·윤달이 다른 해가 있습니다. 한국천문연구원(KASI)이 발표한 <b>한국 음력</b>으로 계산해 음력 생일이 정확히 바뀝니다.
          </li>
          <li className="rounded bg-surface/70 px-3 py-2">
            <b className="text-ink">절기가 드는 순간을 한국 시간으로</b> — 해·달 기둥은 입춘·경칩 같은 절기가 드는 순간에 바뀝니다. 중국 시간과는 1시간 차이가 나는데, 이 앱은 <b>한국 시간 기준 분 단위</b>로 나눠 절기 무렵에 태어난 분도 정확합니다.
          </li>
          <li className="rounded bg-surface/70 px-3 py-2">
            <b className="text-ink">한국의 시간 역사 반영</b> — 한국은 표준시가 바뀐 적(1954~1961년 동경 127.5°)과 서머타임(1948~1988년 중 여러 해)이 있었습니다. 출생지를 고르면 이런 한국만의 시간 이력과 실제 해의 위치(진태양시)까지 반영해 시주를 정합니다.
          </li>
          <li className="rounded bg-surface/70 px-3 py-2">
            <b className="text-ink">한국 명리 관례대로</b> — 대운 나이(대운수)는 한국식 반올림, 지장간은 한국 만세력 표를 따르고, 밤 11시~새벽 1시(자시) 출생은 한국에서 쓰는 세 가지 보는 법 중에서 고를 수 있습니다.
          </li>
        </ul>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {FEATURES.map(([title, body]) => (
          <li key={title} className="flex gap-2 rounded-md border border-line bg-paper p-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <div>
              <p className="text-base font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-sm text-faint">사주풀이는 전통 명리학에 따른 참고용 해석입니다. 계산은 내 브라우저 안에서 하고, AI 풀이 때도 이름·생일 원문은 보내지 않습니다.</p>
    </Panel>
  )
}

// ── 원국 ─────────────────────────────────────────────────
function GanjiChar({ ch, el, hanja, sub }: { ch: string; el: Element; hanja: string; sub?: string }) {
  return (
    <div className={clsx('relative flex h-20 w-full flex-col items-center justify-center rounded-md border', EL_BOX[el])}>
      {sub && (
        <span className="absolute top-1 right-1.5 text-lg leading-none" aria-hidden>
          {sub}
        </span>
      )}
      <span className={clsx('text-4xl leading-none font-bold', EL_TEXT[el])}>{hanja}</span>
      <span className={clsx('mt-1 text-sm font-semibold', EL_TEXT[el])}>
        {ch} · {el}
      </span>
    </div>
  )
}

function Card({ title, hint, icon: Icon, children, className }: { title: string; hint?: string; icon: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('flex flex-col gap-3 rounded-lg border border-line bg-surface p-4', className)}>
      <h3 className="flex items-center gap-1.5 text-base font-bold text-ink">
        <Icon className="size-4 text-brand" aria-hidden />
        {title}
        {hint && <span className="text-sm font-normal text-muted">{hint}</span>}
      </h3>
      {children}
    </section>
  )
}

export function ChartView({ chart, name, actions }: { chart: Chart; name: string; actions?: ReactNode }) {
  const c = chart
  const inp = c.input
  const dayEl = stemElement(c.dayMaster)
  const yearBranch = c.pillars.find((p) => p.key === 'year')!.branch
  const z = ZODIAC[yearBranch]
  const strength = dayStrength(c)
  const groups = tenGroupCounts(c)
  const gMax = Math.max(...Object.values(groups))
  const topGroups = (Object.keys(groups) as Array<keyof typeof groups>).filter((g) => groups[g] === gMax)
  const noGroups = (Object.keys(groups) as Array<keyof typeof groups>).filter((g) => groups[g] === 0)
  const max = Math.max(...Object.values(c.elements))
  const min = Math.min(...Object.values(c.elements))
  const most = ELEMENTS.filter((e) => c.elements[e] === max)
  const least = ELEMENTS.filter((e) => c.elements[e] === min)
  const birth =
    inp.calendar === 'lunar'
      ? `음력 ${inp.year}.${pad(inp.month)}.${pad(inp.day)}${inp.leap ? '(윤)' : ''} → 양력 ${ymd(c.solar)}`
      : `양력 ${inp.year}.${pad(inp.month)}.${pad(inp.day)}`
  const timeText = inp.hour == null ? '시간 모름' : `${pad(inp.hour)}:${pad(inp.minute)}${inp.longitude != null ? ' (진태양시 보정)' : ''}`

  return (
    <Panel data-pdf-block className="flex flex-col gap-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <h2 className="text-2xl font-bold text-ink">{name ? `${name} 님의 사주` : '사주 원국'}</h2>
        <span className="text-base text-muted">
          {inp.gender === 'male' ? '남' : '여'} · {birth} · {timeText} · 만 {c.age}세
        </span>
        <div className="ml-auto">{actions}</div>
      </div>

      {/* 나를 나타내는 카드 */}
      <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]" style={{ background: EL_SOFT[dayEl], borderColor: EL_VAR[dayEl] }}>
        <div className="flex items-center gap-3">
          <StemBadge stem={c.dayMaster} size={84} />
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-1.5">
          <p className="text-sm font-semibold text-muted">나를 나타내는 글자 · 일간(日干)</p>
          <p className="text-3xl font-extrabold text-ink">
            <span className={EL_TEXT[dayEl]}>
              {c.dayMaster}
              {dayEl}({stemHanja(c.dayMaster)}
              {EL_HANJA[dayEl]})
            </span>{' '}
            · {DAY_MASTER_NAME[c.dayMaster]}
          </p>
          <p className="text-base font-semibold text-ink-2">{DAY_MASTER_NOTE[c.dayMaster]}</p>
          <p className="text-base leading-relaxed text-ink-2">{STEM_READING[c.dayMaster]}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Chip>
              <span aria-hidden>{z.emoji}</span> {z.animal}띠
            </Chip>
            <Chip>
              강한 기운 {most.map((e) => <b key={e} className={EL_TEXT[e]}>{EL_HANJA[e]}</b>)}
            </Chip>
            <Chip>
              {min === 0 ? '없는 기운' : '약한 기운'} {least.map((e) => <b key={e} className={EL_TEXT[e]}>{EL_HANJA[e]}</b>)}
            </Chip>
            <Chip>
              {c.yinYang.yang > c.yinYang.yin ? '☀️ 양이 많은 편' : c.yinYang.yang < c.yinYang.yin ? '🌙 음이 많은 편' : '☯️ 음양 균형'}
            </Chip>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center">
          <StrengthGauge score={strength.score} label={strength.label} />
          <p className="text-base font-bold text-ink">
            {strength.label} <span className="num text-sm font-normal text-muted">({strength.score}점 · 간이)</span>
          </p>
          <p className="max-w-[15rem] text-center text-sm leading-relaxed text-ink-2">{STRENGTH_TEXT[strength.label]}</p>
        </div>
      </div>

      {/* 원국표 */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] table-fixed border-separate border-spacing-1.5 text-center text-base">
          <thead>
            <tr>
              <th className="w-16" />
              {c.pillars.map((p) => (
                <th key={p.key} className={clsx('py-1 text-base font-bold', p.key === 'day' ? 'text-brand' : 'text-ink-2')}>
                  {PILLAR_LABEL[p.key]}
                  {p.key === 'day' && <span className="ml-1 text-xs font-semibold">(나)</span>}
                  <span className="block text-xs font-normal text-faint">{{ hour: '자녀·말년', day: '나·배우자', month: '부모·사회', year: '조상·어린 시절' }[p.key]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="text-sm font-semibold text-muted">십신</th>
              {c.pillars.map((p) => (
                <td key={p.key} className={clsx('text-sm font-semibold', p.key === 'day' ? 'text-brand' : 'text-ink-2')}>
                  {p.stemTenGod}
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-sm font-semibold text-muted">천간</th>
              {c.pillars.map((p) => (
                <td key={p.key}>
                  <GanjiChar ch={p.stem} el={stemElement(p.stem)} hanja={stemHanja(p.stem)} />
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-sm font-semibold text-muted">지지</th>
              {c.pillars.map((p) => (
                <td key={p.key}>
                  <GanjiChar ch={p.branch} el={branchElement(p.branch)} hanja={branchHanja(p.branch)} sub={ZODIAC[p.branch].emoji} />
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-sm font-semibold text-muted">십신</th>
              {c.pillars.map((p) => (
                <td key={p.key} className="text-sm font-semibold text-ink-2">
                  {p.branchTenGod}
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-sm font-semibold text-muted">지장간</th>
              {c.pillars.map((p) => (
                <td key={p.key} className="text-sm text-ink-2">
                  {p.hidden.map((h) => (
                    <span key={h.stem} className={clsx('mx-0.5 font-semibold', EL_TEXT[stemElement(h.stem)])} title={h.tenGod}>
                      {h.stem}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-sm font-semibold text-muted">12운성</th>
              {c.pillars.map((p) => (
                <td key={p.key} className="text-sm text-ink-2">
                  {p.stage}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <div className="mt-2 flex flex-col gap-1 rounded-md bg-paper px-3 py-2 text-sm leading-relaxed text-ink-2">
          <p>
            <b>읽는 법</b> · 표는 오른쪽 연주(태어난 해)부터 왼쪽 시주(태어난 시)로 읽습니다. 가운데 <b className="text-brand">일주의 위 글자(일간)</b>가 ‘나’이고, 나머지 글자는 나와의 관계(십신)로 풉니다. 색은 오행입니다.
          </p>
          <p>
            <b>12운성</b> · {[...new Set(c.pillars.map((p) => p.stage))].map((st) => `${st}(${STAGE_NOTE[st]})`).join(' · ')}
          </p>
          <p>
            <b>공망</b> · {c.voidBranches.join('·')} — 이 글자가 원국이나 운에 오면 그 일은 힘이 약하거나 늦게 이뤄진다고 봅니다. 띠는 입춘 기준(연주의 아래 글자)입니다.
          </p>
        </div>
      </div>

      <Card title="사주 용어 풀이" hint="처음 보신다면 먼저 읽어 보세요" icon={BookOpen}>
        <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {GLOSSARY.map(([term, text]) => (
            <div key={term} className="rounded-md border border-line bg-paper px-3 py-2">
              <dt className="text-base font-bold text-ink">{term}</dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-ink-2">{text}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="오행 지도" hint="다섯 기운이 얼마나, 어떻게 이어지나" icon={Compass}>
          <ElementCycle counts={c.elements} dayEl={dayEl} />
          <ElementTable counts={c.elements} dayEl={dayEl} total={c.pillars.length * 2} />
          <CycleGuide dayEl={dayEl} />
          <Reading>
            <p>
              <b>한 줄 정리</b> · {most.map((e) => EL_NAME[e]).join('·')} 기운이 {max}개로 가장 많고
              {min === 0 ? `, ${ELEMENTS.filter((e) => c.elements[e] === 0).map((e) => EL_NAME[e]).join('·')} 기운은 없습니다.` : ', 다섯 기운이 모두 있어 고르게 갖춘 편입니다.'}
              {min === 0 ? ' 없는 기운은 아래 ‘없는 기운 채우기’에서 생활 속으로 채우는 법을 볼 수 있어요.' : ''}
            </p>
          </Reading>
        </Card>
        <Card title="십신 다섯 갈래" hint="나를 둘러싼 관계와 힘" icon={Sparkles}>
          <TenGroupDonut counts={groups} dayEl={dayEl} hourKnown={inp.hour != null} />
          <Reading>
            {topGroups.length > 1 && (
              <p>
                <b>
                  {topGroups.join('·')}이 {gMax}개씩으로 가장 많아요.
                </b>
              </p>
            )}
            {topGroups.map((g) => (
              <p key={g}>
                <b>{topGroups.length > 1 ? `${g}(${TEN_GROUP_NOTE[g].short}) ·` : `${g}(${TEN_GROUP_NOTE[g].short})이 가장 많아요.`}</b> {GROUP_MANY[g]}
              </p>
            ))}
            {noGroups.map((g) => (
              <p key={g}>
                <b>{g}({TEN_GROUP_NOTE[g].short})이 없어요.</b> {GROUP_NONE[g]}
              </p>
            ))}
            <p className="text-muted">
              색은 그 갈래의 오행입니다. 일간 {c.dayMaster}
              {dayEl}에게 {EL_HANJA[groupElement('재성', dayEl)]}은 재물(재성), {EL_HANJA[groupElement('관성', dayEl)]}은 직장·명예(관성), {EL_HANJA[groupElement('인성', dayEl)]}은 배움·도움(인성)이 됩니다.
            </p>
          </Reading>
        </Card>
      </div>

      <LuckTimeline chart={c} />

      <YearsCard chart={c} />

      <LuckyTips least={least} min={min} />
    </Panel>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-sm font-semibold text-ink-2">{children}</span>
}

/** 대운 흐름: 10년 마디 막대, 지금 위치 표시 */
function LuckTimeline({ chart: c }: { chart: Chart }) {
  const dayEl = stemElement(c.dayMaster)
  const cur = c.luck.current
  // 지금 대운 안에서 얼마나 지났나
  const curItem = cur >= 0 ? c.luck.list[cur] : null
  const progress = curItem ? Math.min(1, Math.max(0, (c.age - curItem.age) / 10)) : 0
  return (
    <Card title="대운 흐름" hint={`${c.luck.forward ? '순행' : '역행'} · 대운수 ${c.luck.startAge} · 10년마다 바뀌는 큰 운`} icon={TrendingUp}>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-[40rem] gap-1">
          {c.luck.list.map((l, i) => {
            const g = TEN_GROUP_OF[l.stemTenGod]
            const el = groupElement(g, dayEl)
            const now = i === cur
            const past = cur >= 0 && i < cur
            return (
              <div key={l.age} className={clsx('relative flex flex-1 flex-col items-center gap-1 rounded-md border p-1.5 pt-2 text-center', now ? 'border-brand bg-brand-soft shadow-1' : 'border-line bg-paper', past && 'opacity-55')}>
                <span className="absolute inset-x-0 top-0 h-1.5 rounded-t-md" style={{ background: EL_VAR[el] }} />
                <span className="num text-sm font-bold text-ink-2">{l.age}세</span>
                <span className={clsx('text-2xl leading-none font-bold', EL_TEXT[stemElement(l.stem)])}>{stemHanja(l.stem)}</span>
                <span className={clsx('text-2xl leading-none font-bold', EL_TEXT[branchElement(l.branch)])}>{branchHanja(l.branch)}</span>
                <span className="text-xs font-semibold" style={{ color: EL_VAR[el] }}>
                  {g}
                </span>
                <span className="text-xs leading-tight text-muted">{TEN_GROUP_NOTE[g].short}</span>
                {now && (
                  <>
                    <Badge tone="brand">지금</Badge>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-surface">
                      <div className="h-full bg-brand" style={{ width: `${progress * 100}%` }} />
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 rounded-md bg-paper px-3 py-2.5 text-sm leading-relaxed text-ink-2">
        <p>
          <b>칸 읽는 법</b> · 맨 위 숫자(<b>{c.luck.list[0]?.age}세</b>, {c.luck.list[1]?.age}세…)는 그 대운이 <b>시작되는 나이(만)</b>이고, 한 대운은 10년 동안 이어집니다. 가운데 두 글자는 그 10년의 간지(위 글자 천간·아래 글자 지지)이며, 흔히 앞 5년은 위 글자, 뒤 5년은 아래 글자의 힘이 더 크다고 봅니다. 아래 ‘재성’ 같은 말은 위 글자가 나(일간)에게 어떤 갈래인지, 위쪽 색 띠는 그 갈래의 오행입니다. 흐린 칸은 지나간 대운입니다.
        </p>
        <p>
          <b>대운수 {c.luck.startAge}</b> · 첫 대운이 시작되는 나이입니다. 태어난 날부터 가까운 절기까지의 날수를 3으로 나눠 구하므로 사람마다 1~10 사이로 다릅니다. 그 전까지는 월주(부모·환경)의 영향을 크게 받는다고 봅니다.
        </p>
        <p>
          <b>{c.luck.forward ? '순행' : '역행'}</b> · 대운이 월주에서 {c.luck.forward ? '다음 간지로 나아가는(순행)' : '앞 간지로 거슬러 가는(역행)'} 방향입니다. 양(陽)의 해에 태어난 남자와 음(陰)의 해에 태어난 여자는 순행, 그 반대는 역행입니다. 좋고 나쁨이 아니라 흐름의 방향일 뿐입니다.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
        {c.luck.list.map((l, i) => {
          const g = TEN_GROUP_OF[l.stemTenGod]
          const gb = TEN_GROUP_OF[l.branchTenGod]
          // 시작 달부터 10년 뒤 전달까지(예: 1997.07 ~ 2007.06)
          const fy = Number(l.from.slice(0, 4))
          const fm = Number(l.from.slice(5, 7))
          const endM = fm === 1 ? 12 : fm - 1
          const endY = fy + 10 - (fm === 1 ? 1 : 0)
          return (
            <li key={l.age} className={clsx('grid grid-cols-[7.5rem_3.5rem_minmax(0,1fr)] items-center gap-x-3 px-3 py-2 text-sm', i === cur ? 'bg-brand-soft/70' : cur >= 0 && i < cur && 'text-muted')}>
              <span>
                <b className="num text-ink">
                  {l.age}~{l.age + 9}세
                </b>
                {i === cur && <Badge tone="brand" className="ml-1">지금</Badge>}
                <span className="num block text-xs text-muted">
                  {fy}.{pad(fm)} ~ {endY}.{pad(endM)}
                </span>
              </span>
              <span className="text-xl font-bold">
                <span className={EL_TEXT[stemElement(l.stem)]}>{stemHanja(l.stem)}</span>
                <span className={EL_TEXT[branchElement(l.branch)]}>{branchHanja(l.branch)}</span>
              </span>
              <span className="min-w-0">
                <b style={{ color: EL_VAR[groupElement(g, dayEl)] }}>{g}</b>
                {gb !== g && <span className="text-muted"> · 아래 글자 {gb}</span>} — {GROUP_LUCK_SHORT[g]}
              </span>
            </li>
          )
        })}
      </ul>
      <Reading>
        {curItem ? (
          <LuckLine label={`지금 대운 (${curItem.age}~${curItem.age + 9}세)`} item={curItem} />
        ) : (
          <p>아직 첫 대운({c.luck.startAge}세) 전입니다. 그 전까지는 부모·환경(월주)의 영향을 크게 받는다고 봅니다.</p>
        )}
        {c.luck.list[cur + 1] && <LuckLine label={`다음 대운 (${c.luck.list[cur + 1].age}세~)`} item={c.luck.list[cur + 1]} same={curItem != null && TEN_GROUP_OF[curItem.stemTenGod] === TEN_GROUP_OF[c.luck.list[cur + 1].stemTenGod]} />}
        <p className="text-muted">대운은 10년 동안 배경처럼 깔리는 큰 흐름이고, 해마다 바뀌는 세운이 그 위에 더해집니다.</p>
      </Reading>
    </Card>
  )
}

/** 부족한 기운 채우기 */
function LuckyTips({ least, min }: { least: Element[]; min: number }) {
  return (
    <Card title={min === 0 ? '없는 기운 채우기' : '약한 기운 채우기'} hint="전통 오행 배속에 따른 생활 팁" icon={Palette}>
      <div className="grid gap-3 md:grid-cols-2">
        {least.slice(0, 2).map((e) => {
          const t = ELEMENT_TIPS[e]
          return (
            <div key={e} className={clsx('flex flex-col gap-2 rounded-md border p-3', EL_BOX[e])}>
              <p className={clsx('text-base font-bold', EL_TEXT[e])}>
                {EL_NAME[e]} 기운
              </p>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                {t.colors.map((col) => (
                  <span key={col.name} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pr-2 pl-0.5">
                    <span className="size-4 rounded-full border border-line-strong" style={{ background: col.hex }} />
                    {col.name}
                  </span>
                ))}
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
                <dt className="text-muted">방향</dt>
                <dd className="text-ink-2">{t.direction}</dd>
                <dt className="text-muted">숫자</dt>
                <dd className="text-ink-2">{t.numbers}</dd>
                <dt className="text-muted">음식</dt>
                <dd className="text-ink-2">{t.food}</dd>
                <dt className="text-muted">활동</dt>
                <dd className="text-ink-2">{t.activity}</dd>
              </dl>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ── AI 풀이 ──────────────────────────────────────────────
const SECTION_ICON: Record<string, LucideIcon> = {
  personality: UserRound,
  strengths: Shield,
  elements: Palette,
  wealth: Coins,
  career: Briefcase,
  love: Heart,
  health: HeartPulse,
  luck: TrendingUp,
  thisYear: CalendarDays,
  nextYear: CalendarClock,
  advice: Lightbulb,
}
const SCORE_LABEL: Array<[string, string]> = [
  ['wealth', '재물'],
  ['career', '직업'],
  ['love', '연애'],
  ['health', '건강'],
  ['thisYear', '올해'],
  ['nextYear', '내년'],
]

export function AiReading({ chart, name, onDone, readOnly }: { chart: Chart; name: string; onDone?: () => void; readOnly?: boolean }) {
  const showLogin = useLoginDialog((s) => s.show)
  const [status, setStatus] = useState<{ allowed: boolean; ai: boolean } | null>(null)
  const [reading, setReading] = useState<Reading | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const payload = useMemo(() => chartForAi(chart), [chart])
  useEffect(() => {
    if (!readOnly)
      api<{ allowed: boolean; ai: boolean }>('/saju/status')
        .then(setStatus)
        .catch(() => setStatus({ allowed: false, ai: false }))
    // 같은 원국으로 이미 받은 풀이가 있으면(공유 링크 포함) 로그인 없이도 보여 준다
    api<{ reading: Reading | null }>('/saju/cached', { method: 'POST', body: { chart: payload } })
      .then((r) => r.reading && setReading((cur) => cur ?? r.reading))
      .catch(() => {})
  }, [payload])
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
      onDone?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI 풀이를 받지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!reading) return
    const text = [
      `${name ? `${name} 님의 ` : ''}사주풀이`,
      '',
      reading.summary,
      '',
      ...reading.sections.flatMap((s) => [`■ ${s.title} — ${s.headline}`, ...s.points.map((p) => `· ${p}`), s.body, '']),
    ].join('\n')
    await navigator.clipboard.writeText(text).then(
      () => toast.success('풀이를 복사했습니다.'),
      () => toast.error('복사하지 못했습니다.'),
    )
  }
  // 공유 화면: 받아 둔 풀이가 있을 때만 보여 준다(새로 받거나 로그인 안내는 없음)
  if (readOnly && !reading) return null
  return (
    <Panel data-pdf-block={reading ? '' : undefined} className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-2xl font-bold text-ink">
          <Sparkles className="size-5 text-accent" aria-hidden /> AI 사주풀이
        </h2>
        {reading && (
          <span className="text-sm text-muted">
            {reading.cached ? '같은 원국의 지난 풀이' : '방금 풀이'} · {new Date(reading.at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
        )}
        <div className="ml-auto flex gap-1.5" data-pdf-skip>
          {reading && (
            <Button size="sm" icon={Copy} onClick={() => void copy()}>
              풀이 복사
            </Button>
          )}
        </div>
      </div>
      {reading ? null : !status ? (
        <div className="flex items-center gap-2 text-muted">
          <Spinner /> 확인 중
        </div>
      ) : !status.allowed ? (
        <Callout tone="info" title="AI 풀이는 직원 계정으로 쓸 수 있습니다">
          원국과 도표는 누구나 볼 수 있고, AI 풀이는 로그인한 직원(또는 팀 코드로 들어온 사람)만 쓸 수 있습니다.
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
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-base text-ink-2">위 원국을 바탕으로 분야별 점수와 성격·재물·직업·연애·건강·대운·올해와 내년 운세를 풀이합니다. 30초~1분쯤 걸립니다.</p>
          <Button variant="primary" icon={Wand2} loading={busy} onClick={() => void run()}>
            {busy ? `풀이하는 중… ${elapsed}초` : 'AI 사주풀이 받기'}
          </Button>
        </div>
      )}
      {reading && (
        <div className="flex flex-col gap-4">
          <div className="grid items-center gap-4 rounded-lg border border-accent/30 bg-accent-soft/50 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-3">
              <p className="text-xl leading-relaxed font-bold text-ink">“{reading.summary}”</p>
              {reading.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {reading.keywords.map((k) => (
                    <span key={k} className="rounded-full bg-surface px-3 py-1 text-base font-semibold text-accent shadow-1">
                      #{k}
                    </span>
                  ))}
                </div>
              )}
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                {SCORE_LABEL.map(([k, label]) => (
                  <li key={k} className="flex items-center gap-2 text-sm font-semibold text-ink-2">
                    <span className="w-7">{label}</span>
                    <Stars value={reading.scores[k] ?? 3} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-center">
              <Radar items={SCORE_LABEL.map(([k, label]) => ({ label, value: reading.scores[k] ?? 3 }))} />
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {reading.sections.map((s) => (
              <SectionCard key={s.key} s={s} score={reading.scores[s.key]} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && (
              <Button data-pdf-skip size="sm" variant="ghost" icon={RefreshCw} loading={busy} onClick={() => void run()} title="같은 원국은 저장해 둔 풀이를 보여 줍니다">
                다시 불러오기
              </Button>
            )}
            <span className="text-sm text-faint">전통 명리학에 따른 참고용 풀이입니다. 점수는 AI가 원국을 보고 매긴 참고 값입니다.</span>
          </div>
        </div>
      )}
    </Panel>
  )
}

function SectionCard({ s, score }: { s: Reading['sections'][number]; score?: number }) {
  const Icon = SECTION_ICON[s.key] ?? Sparkles
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line bg-paper p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <h3 className="text-base font-bold text-ink">{s.title}</h3>
        {score != null && <Stars value={score} className="ml-auto" />}
      </div>
      <p className="text-lg leading-snug font-bold text-ink">{s.headline}</p>
      {s.points.length > 0 && (
        <ul className="flex flex-col gap-1">
          {s.points.map((p) => (
            <li key={p} className="flex gap-1.5 text-base text-ink-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
      {s.body && <p className="border-t border-line pt-2 text-base leading-relaxed whitespace-pre-line text-ink-2">{s.body}</p>}
    </section>
  )
}

/** 기본 풀이 글 상자 */
function Reading({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5 rounded-md border border-brand/20 bg-brand-soft/40 px-3 py-2.5 text-base leading-relaxed text-ink-2">{children}</div>
}

function LuckLine({ label, item, same }: { label: string; item: Chart['luck']['list'][number]; same?: boolean }) {
  const g = TEN_GROUP_OF[item.stemTenGod]
  return (
    <p>
      <b>
        {label} · {item.stem}
        {item.branch}({stemHanja(item.stem)}
        {branchHanja(item.branch)}) — {g}({TEN_GROUP_NOTE[g].short}) 운.
      </b>{' '}
      {same ? '지금과 같은 갈래의 흐름이 10년 더 이어지니, 지금 쌓은 것을 키워 가기 좋아요.' : GROUP_LUCK[g]}
    </p>
  )
}

/** 세운: 올해·내년이 내 사주와 만나는 방식 */
function YearsCard({ chart: c }: { chart: Chart }) {
  const dayEl = stemElement(c.dayMaster)
  const cur = c.luck.current >= 0 ? c.luck.list[c.luck.current] : null
  return (
    <Card title="세운" hint="해마다 들어오는 운" icon={CalendarDays}>
      <div className="flex flex-col gap-1.5 rounded-md bg-paper px-3 py-2.5 text-sm leading-relaxed text-ink-2">
        <p>
          <b>세운 읽는 법</b> · 해마다 그해를 나타내는 두 글자(간지)가 있습니다. 예를 들어 {c.years[0].year}년은 <b>{c.years[0].stem}{c.years[0].branch}년</b>으로, 위 글자 {stemHanja(c.years[0].stem)}(천간)와 아래 글자 {branchHanja(c.years[0].branch)}(지지·{ZODIAC[c.years[0].branch].animal}띠)로 이루어집니다. 간지는 60년마다 한 바퀴 돕니다.
        </p>
        <p>
          <b>읽는 순서</b> · ① 그해 글자가 나(일간)에게 어떤 십신인지(위 글자는 겉으로 드러나는 일, 아래 글자는 실제 생활에서 겪는 일) ② 내 사주 아래 글자들과 부딪히는지(충)·어울리는지(합) ③ 지금 대운과 같은 방향인지를 봅니다.
        </p>
        <p>
          <b>바뀌는 때</b> · 사주에서 새해는 1월 1일이나 설날이 아니라 <b>입춘(2월 4일 무렵)</b>부터입니다. 대운이 10년의 큰 배경이라면 세운은 그 위에 한 해씩 더해지는 날씨와 같습니다.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {c.years.map((y, i) => {
          const g = TEN_GROUP_OF[y.stemTenGod]
          const gb = TEN_GROUP_OF[y.branchTenGod]
          const clashes = c.pillars.filter((p) => isClash(p.branch, y.branch))
          const harmonies = c.pillars.filter((p) => isHarmony(p.branch, y.branch))
          const sameAsLuck = cur && TEN_GROUP_OF[cur.stemTenGod] === g
          return (
            <div key={y.year} className="flex flex-col gap-3 rounded-lg border border-line bg-paper p-4">
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-center rounded-md border border-line bg-surface px-2 py-1">
                  <span className={clsx('text-3xl leading-none font-bold', EL_TEXT[stemElement(y.stem)])}>{stemHanja(y.stem)}</span>
                  <span className={clsx('text-3xl leading-none font-bold', EL_TEXT[branchElement(y.branch)])}>{branchHanja(y.branch)}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-ink">
                    {y.year}년 {i === 0 ? '올해' : '내년'} · {y.stem}
                    {y.branch}년 <span aria-hidden>{ZODIAC[y.branch].emoji}</span>
                  </p>
                  <p className="text-sm text-muted">
                    {ZODIAC[y.branch].animal}의 해 · {stemElement(y.stem)}·{branchElement(y.branch)} 기운
                  </p>
                  <p className="mt-0.5 text-base font-semibold text-ink">
                    {TEN_GROUP_NOTE[g].short}
                    {gb !== g ? ` · ${TEN_GROUP_NOTE[gb].short}` : ''}의 해
                  </p>
                </div>
              </div>
              <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line bg-surface text-sm">
                {[
                  ['위 글자', y.stem, stemHanja(y.stem), stemElement(y.stem), y.stemTenGod, '겉으로 드러나는 일'] as const,
                  ['아래 글자', y.branch, branchHanja(y.branch), branchElement(y.branch), y.branchTenGod, '생활에서 겪는 일'] as const,
                ].map(([pos, ko, hj, el, tg, where]) => (
                  <li key={pos} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 px-3 py-2">
                    <span>
                      <span className="block text-xs text-muted">{pos}</span>
                      <b className={clsx('text-lg', EL_TEXT[el])}>{hj}</b> <span className="text-muted">{ko}·{el}</span>
                    </span>
                    <span className="text-ink-2">
                      나에게 <b style={{ color: EL_VAR[groupElement(TEN_GROUP_OF[tg], dayEl)] }}>{tg}</b>({TEN_GROUP_OF[tg]}) — {TEN_GOD_NOTE[tg]}
                      <span className="block text-xs text-muted">{where}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <Reading>
                <p>
                  <b>한 해 흐름</b> · {GROUP_LUCK[g]}
                </p>
                {clashes.map((p) => (
                  <p key={`c${p.key}`}>
                    <b className="text-accent">
                      충(沖) · {branchHanja(y.branch)}↔내 {PILLAR_LABEL[p.key]} {branchHanja(p.branch)}
                    </b>{' '}
                    — 서로 부딪히는 관계예요. {PILLAR_PLACE[p.key]} 쪽에 이동·변화·다툼이 생기기 쉬우니 서두르지 말고 한 번 더 살피세요.
                  </p>
                ))}
                {harmonies.map((p) => (
                  <p key={`h${p.key}`}>
                    <b className="text-brand">
                      합(合) · {branchHanja(y.branch)}↔내 {PILLAR_LABEL[p.key]} {branchHanja(p.branch)}
                    </b>{' '}
                    — 서로 어울리는 관계예요. {PILLAR_PLACE[p.key]} 쪽에 새 인연·협력·좋은 계약이 생기기 쉬워요.
                  </p>
                ))}
                {!clashes.length && !harmonies.length && <p className="text-muted">내 사주 아래 글자들과 크게 부딪히거나(충) 묶이는(합) 글자는 없어 비교적 무난하게 흘러갑니다.</p>}
                {cur && (
                  <p className="text-muted">
                    {sameAsLuck ? `지금 대운(${stemHanja(cur.stem)}${branchHanja(cur.branch)})과 같은 ${g} 갈래라, 대운의 흐름이 그해에 더 뚜렷하게 드러납니다.` : `지금 대운(${stemHanja(cur.stem)}${branchHanja(cur.branch)}, ${TEN_GROUP_OF[cur.stemTenGod]})의 큰 흐름 위에 그해에는 ${g} 기운이 더해집니다.`}
                  </p>
                )}
              </Reading>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
