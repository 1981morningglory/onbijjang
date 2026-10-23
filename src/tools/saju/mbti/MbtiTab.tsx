import clsx from 'clsx'
import { ArrowLeft, ArrowRight, BatteryLow, Briefcase, CheckCircle2, FileDown, Grid3x3, Link2, Heart, ListChecks, RotateCcw, Sprout, ThumbsUp, TriangleAlert, Users, Zap, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Panel } from '@/ui'
import { mbtiQuery } from '../share'
import { ShareDialog, useShare, type ShareTarget } from '../ShareUI'
import { AXES, AXIS_INFO, QUESTIONS, SCALE, scoreAnswers, TEMPERAMENT, temperamentOf, TYPE_ORDER, TYPES, type Axis } from './data'

const PER_PAGE = 8
const PAGES = Math.ceil(QUESTIONS.length / PER_PAGE)
const STORE = 'onbijjang.mbti.last'

export interface Result {
  type: string
  /** 검사로 나온 결과면 축별 비율, 둘러보기면 없음 */
  pct: Record<Axis, number> | null
  at?: string
  /** 공유 링크로 받은 결과 */
  shared?: boolean
}

function loadLast(): Result | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null')
    return v && typeof v.type === 'string' && TYPES[v.type] ? v : null
  } catch {
    return null
  }
}
function saveLast(r: Result) {
  try {
    localStorage.setItem(STORE, JSON.stringify(r))
  } catch {
    // 저장이 안 되는 브라우저는 그냥 넘어간다
  }
}

export default function MbtiTab() {
  const [mode, setMode] = useState<'intro' | 'test' | 'result'>('intro')
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [last, setLast] = useState<Result | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  useEffect(() => setLast(loadLast()), [])
  const target: ShareTarget | null = result
    ? { containerId: 'mbti-result', filename: `MBTI_${result.type}_${TYPES[result.type].nick}.pdf`, title: `성격유형 ${result.type} ${TYPES[result.type].nick}`, kind: 'mbti', query: mbtiQuery(result.type, result.pct) }
    : null
  const share = useShare(target)

  const top = () => requestAnimationFrame(() => document.getElementById('mbti-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  const start = () => {
    setAnswers({})
    setPage(0)
    setMode('test')
    top()
  }
  const show = (r: Result) => {
    setResult(r)
    setMode('result')
    top()
  }
  const finish = () => {
    const { pct, type } = scoreAnswers(answers)
    const r = { type, pct, at: new Date().toISOString() }
    saveLast(r)
    setLast(r)
    show(r)
    setShareOpen(true)
  }

  return (
    <div id="mbti-top" className="flex scroll-mt-20 flex-col gap-5">
      {mode === 'intro' && <Intro onStart={start} last={last} onLast={() => last && show(last)} onPick={(t) => show({ type: t, pct: null })} />}
      {mode === 'test' && (
        <Test
          answers={answers}
          page={page}
          onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
          onPage={(p) => {
            setPage(p)
            top()
          }}
          onFinish={finish}
          onQuit={() => setMode('intro')}
        />
      )}
      {mode === 'result' && result && <ResultView result={result} share={share} onRetry={start} onPick={(t) => show({ type: t, pct: null })} onBack={() => setMode('intro')} />}
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        heading="검사가 끝났어요!"
        target={target}
        share={share}
        note="짧은 링크를 받은 사람은 메뉴 없이 이 결과(유형 풀이와 성향 비율)만 볼 수 있습니다. 답한 내용은 들어가지 않습니다."
      />
    </div>
  )
}

// ── 소개 ─────────────────────────────────────────────────
const FEATURES: Array<[string, string]> = [
  ['48문항 · 약 7분', '일상 속 행동을 묻는 쉬운 문장에 7단계로 답합니다. 정답은 없어요.'],
  ['네 가지 성향을 그래프로', '외향–내향, 감각–직관, 사고–감정, 판단–인식을 몇 %씩 가졌는지 막대로 보여 줍니다.'],
  ['16유형 자세한 풀이', '성격, 강점과 약점, 일하는 스타일과 추천 직업, 연애·친구, 스트레스 신호와 회복법, 성장 팁까지.'],
  ['궁합과 16유형 도감', '흔히 잘 맞는다는 유형과 어려운 유형, 16유형을 한눈에 비교할 수 있습니다.'],
]

function Intro({ onStart, last, onLast, onPick }: { onStart: () => void; last: Result | null; onLast: () => void; onPick: (t: string) => void }) {
  return (
    <>
      <Panel className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-bold text-ink">MBTI 성격유형이란?</h2>
          <p className="text-base leading-relaxed text-ink-2">
            사람마다 <b>에너지를 얻는 곳</b>, <b>정보를 받아들이는 법</b>, <b>결정하는 법</b>, <b>생활하는 방식</b>이 다릅니다. 이 네 가지 성향을 짝지어 16가지 유형으로 나눈 것이 MBTI 방식의 성격유형입니다. 짧은 검사로 내 유형을 찾고, 나와 주변 사람을 더 잘 이해하는 데 써 보세요.
          </p>
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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={ListChecks} onClick={onStart}>
            검사 시작하기
          </Button>
          {last && (
            <Button icon={RotateCcw} onClick={onLast}>
              지난 결과 보기 ({last.type})
            </Button>
          )}
        </div>
        <p className="text-sm text-faint">이 검사는 MBTI 이론을 바탕으로 새로 만든 참고용 성격유형 검사이며, 공식 MBTI® 검사가 아닙니다. 답과 결과는 이 브라우저에만 저장됩니다.</p>
      </Panel>
      <TypeGrid title="이미 내 유형을 알아요" hint="눌러서 바로 풀이 보기" onPick={onPick} />
    </>
  )
}

// ── 검사 ─────────────────────────────────────────────────
const SCALE_SIZE = ['size-11', 'size-9', 'size-7', 'size-6', 'size-7', 'size-9', 'size-11']

function Test({ answers, page, onAnswer, onPage, onFinish, onQuit }: { answers: Record<number, number>; page: number; onAnswer: (id: number, v: number) => void; onPage: (p: number) => void; onFinish: () => void; onQuit: () => void }) {
  const qs = QUESTIONS.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const done = Object.keys(answers).length
  const pageDone = qs.every((q) => answers[q.id] != null)
  const answer = (id: number, v: number) => {
    onAnswer(id, v)
    // 다음 문항으로 살짝 넘겨 준다
    const idx = qs.findIndex((q) => q.id === id)
    const next = qs.slice(idx + 1).find((q) => answers[q.id] == null)
    if (next) requestAnimationFrame(() => document.getElementById(`q-${next.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="sticky top-14 z-10 -mx-4 flex flex-col gap-1.5 border-b border-line bg-surface/95 px-4 pb-3 backdrop-blur sm:-mx-5 sm:px-5">
        <div className="flex items-center justify-between text-base">
          <span className="font-bold text-ink">
            {page + 1} / {PAGES} 쪽
          </span>
          <span className="num text-muted">
            {done} / {QUESTIONS.length} 문항
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${(done / QUESTIONS.length) * 100}%` }} />
        </div>
      </div>
      <ol className="flex flex-col gap-3">
        {qs.map((q) => {
          const v = answers[q.id]
          return (
            <li key={q.id} id={`q-${q.id}`} className={clsx('flex scroll-mt-40 flex-col items-center gap-3 rounded-lg border p-4 transition-colors', v != null ? 'border-line bg-paper' : 'border-line-strong bg-surface')}>
              <p className="text-center text-lg font-semibold text-ink">{q.text}</p>
              <div className="flex w-full max-w-md items-center justify-between gap-1" role="radiogroup" aria-label={q.text}>
                {SCALE.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={v === s}
                    aria-label={['전혀 아니다', '아니다', '약간 아니다', '보통', '약간 그렇다', '그렇다', '매우 그렇다'][i]}
                    onClick={() => answer(q.id, s)}
                    className={clsx(
                      'shrink-0 rounded-full border-2 transition-[background-color,transform] duration-150 hover:scale-110',
                      SCALE_SIZE[i],
                      s < 0 ? 'border-accent' : s > 0 ? 'border-brand' : 'border-line-strong',
                      v === s && (s < 0 ? 'bg-accent' : s > 0 ? 'bg-brand' : 'bg-line-strong'),
                    )}
                  />
                ))}
              </div>
              <div className="-mt-1 flex w-full max-w-md justify-between text-sm font-semibold" aria-hidden>
                <span className="text-accent">그렇지 않다</span>
                <span className="text-brand">그렇다</span>
              </div>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {page === 0 ? (
          <Button variant="ghost" icon={ArrowLeft} onClick={onQuit}>
            그만하기
          </Button>
        ) : (
          <Button icon={ArrowLeft} onClick={() => onPage(page - 1)}>
            이전
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!pageDone && <span className="text-sm text-muted">이 쪽의 모든 문항에 답해 주세요</span>}
          {page < PAGES - 1 ? (
            <Button variant="primary" icon={ArrowRight} disabled={!pageDone} onClick={() => onPage(page + 1)}>
              다음
            </Button>
          ) : (
            <Button variant="primary" icon={CheckCircle2} disabled={!pageDone} onClick={onFinish}>
              결과 보기
            </Button>
          )}
        </div>
      </div>
    </Panel>
  )
}

// ── 결과 ─────────────────────────────────────────────────
/** readOnly: 공유 링크로 본 화면 — 다시 검사·다른 유형 둘러보기·링크 버튼 없이 결과만 */
export function ResultView({ result, share, onRetry, onPick, onBack, readOnly }: { result: Result; share: ReturnType<typeof useShare>; onRetry?: () => void; onPick?: (t: string) => void; onBack?: () => void; readOnly?: boolean }) {
  const t = TYPES[result.type]
  const temp = TEMPERAMENT[temperamentOf(result.type)]
  return (
    <>
      <div id="mbti-result" className="flex flex-col gap-5">
      <Panel data-pdf-block className="overflow-hidden p-0">
        <div className="flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left" style={{ background: temp.soft }}>
          <span className="inline-flex size-28 shrink-0 items-center justify-center rounded-full border-4 bg-surface text-6xl shadow-2" style={{ borderColor: temp.color }} aria-hidden>
            {t.emoji}
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-sm font-bold" style={{ color: temp.color }}>
              {result.shared ? '공유받은 성격유형 결과' : result.pct ? '나의 성격유형' : '성격유형 둘러보기'} · {temp.name} — {temp.note}
            </p>
            <p className="flex flex-wrap items-baseline justify-center gap-x-3 sm:justify-start">
              <span className="text-6xl font-black tracking-wider" style={{ color: temp.color }}>
                {result.type}
              </span>
              <span className="text-3xl font-extrabold text-ink">{t.nick}</span>
            </p>
            <p className="text-lg font-semibold text-ink-2">{t.tagline}</p>
          </div>
        </div>
        {result.pct && (
          <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-2">
            {AXES.map((a) => (
              <AxisBar key={a} axis={a} pct={result.pct![a]} color={temp.color} />
            ))}
          </div>
        )}
        {!result.pct && (
          <div className="flex flex-wrap gap-2 border-t border-line p-4">
            {AXES.map((a, i) => {
              const letter = result.type[i]
              const n = AXIS_INFO[a].names[letter]
              return (
                <span key={a} className="rounded-full border border-line bg-paper px-3 py-1 text-sm text-ink-2">
                  <b style={{ color: temp.color }}>{letter}</b> {n.name} · {n.note}
                </span>
              )
            })}
          </div>
        )}
      </Panel>

      <div data-pdf-block className="grid gap-4 lg:grid-cols-2">
        <Box icon={Sprout} title="이런 사람이에요" className="lg:col-span-2">
          {t.overview.map((p) => (
            <p key={p} className="text-base leading-relaxed text-ink-2">
              {p}
            </p>
          ))}
        </Box>
        <Box icon={ThumbsUp} title="강점" tone="brand">
          <ul className="flex flex-col gap-1.5">
            {t.strengths.map((s) => (
              <li key={s} className="flex gap-2 text-base text-ink-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                {s}
              </li>
            ))}
          </ul>
        </Box>
        <Box icon={TriangleAlert} title="조심할 점" tone="accent">
          <ul className="flex flex-col gap-1.5">
            {t.weaknesses.map((s) => (
              <li key={s} className="flex gap-2 text-base text-ink-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                {s}
              </li>
            ))}
          </ul>
        </Box>
        <Box icon={Briefcase} title="일하는 스타일 · 추천 직업" className="lg:col-span-2">
          <p className="text-base leading-relaxed text-ink-2">{t.work}</p>
          <div className="flex flex-wrap gap-1.5">
            {t.careers.map((c) => (
              <span key={c} className="rounded-full px-3 py-1 text-base font-semibold" style={{ background: temp.soft, color: temp.color }}>
                {c}
              </span>
            ))}
          </div>
        </Box>
        <Box icon={Heart} title="연애할 때">
          <p className="text-base leading-relaxed text-ink-2">{t.love}</p>
        </Box>
        <Box icon={Users} title="친구로서">
          <p className="text-base leading-relaxed text-ink-2">{t.friends}</p>
        </Box>
        <Box icon={BatteryLow} title="스트레스를 받으면" className="lg:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-danger/25 bg-danger-soft/60 p-3">
              <p className="mb-1 text-sm font-bold text-danger">이런 신호가 와요</p>
              <p className="text-base leading-relaxed text-ink-2">{t.stress.signs}</p>
            </div>
            <div className="rounded-md border border-brand/25 bg-brand-soft/60 p-3">
              <p className="mb-1 text-sm font-bold text-brand">이렇게 회복해요</p>
              <p className="text-base leading-relaxed text-ink-2">{t.stress.recover}</p>
            </div>
          </div>
        </Box>
        <Box icon={Zap} title="성장 포인트">
          <ol className="flex flex-col gap-2">
            {t.growth.map((g, i) => (
              <li key={g} className="flex gap-2 text-base text-ink-2">
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-on-brand" style={{ background: temp.color }}>
                  {i + 1}
                </span>
                {g}
              </li>
            ))}
          </ol>
        </Box>
        <Box icon={Heart} title="궁합" hint="흔히 말하는 궁합 · 재미로 보세요">
          <p className="text-sm font-bold text-brand">잘 맞는 유형</p>
          <div className="flex flex-wrap gap-2">
            {t.best.map((x) => (
              <MiniType key={x} type={x} onClick={onPick && (() => onPick(x))} />
            ))}
          </div>
          <p className="text-sm font-bold text-accent">서로 노력이 필요한 유형</p>
          <div className="flex flex-wrap gap-2">
            {t.hard.map((x) => (
              <MiniType key={x} type={x} onClick={onPick && (() => onPick(x))} />
            ))}
          </div>
        </Box>
      </div>

      <div className="flex flex-wrap gap-2" data-pdf-skip>
        {!readOnly && (
          <Button variant="primary" icon={ListChecks} onClick={onRetry}>
            {result.pct ? '다시 검사하기' : '검사해 보기'}
          </Button>
        )}
        <Button icon={FileDown} loading={share.busy} onClick={() => void share.pdf()}>
          PDF 다운로드
        </Button>
        {!readOnly && (
          <>
            <Button icon={Link2} loading={share.linking} onClick={() => void share.link()}>
              링크 복사
            </Button>
            <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
              처음으로
            </Button>
          </>
        )}
      </div>
      </div>
      {!readOnly && onPick && <TypeGrid title="16유형 한눈에" hint="눌러서 다른 유형 풀이 보기" current={result.type} onPick={onPick} />}
    </>
  )
}

function AxisBar({ axis, pct, color }: { axis: Axis; pct: number; color: string }) {
  const info = AXIS_INFO[axis]
  const leftWin = pct > 50
  const winPct = leftWin ? pct : 100 - pct
  const winLetter = leftWin ? info.left : info.right
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line bg-paper p-3">
      <p className="text-sm font-semibold text-muted">{info.title}</p>
      <div className="flex items-center gap-2 text-base">
        <span className={clsx('w-16 font-bold', leftWin ? 'text-ink' : 'text-faint')}>
          {info.left} {info.names[info.left].name}
        </span>
        <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-sunken">
          <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
          <div
            className="absolute inset-y-0 rounded-full"
            style={{ background: color, ...(leftWin ? { right: '50%', width: `${pct - 50}%` } : { left: '50%', width: `${50 - pct}%` }) }}
          />
        </div>
        <span className={clsx('w-16 text-right font-bold', !leftWin ? 'text-ink' : 'text-faint')}>
          {info.names[info.right].name} {info.right}
        </span>
      </div>
      <p className="text-sm text-ink-2">
        <b style={{ color }}>
          {info.names[winLetter].name} {winPct}%
        </b>{' '}
        · {info.names[winLetter].note}
        {winPct <= 55 && <span className="text-muted"> (양쪽이 비슷해요)</span>}
      </p>
    </div>
  )
}

function Box({ icon: Icon, title, hint, tone, className, children }: { icon: LucideIcon; title: string; hint?: string; tone?: 'brand' | 'accent'; className?: string; children: ReactNode }) {
  return (
    <Panel className={clsx('flex flex-col gap-3 p-4 sm:p-5', className)}>
      <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
        <span className={clsx('inline-flex size-8 items-center justify-center rounded-full', tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-brand-soft text-brand')}>
          <Icon className="size-4" aria-hidden />
        </span>
        {title}
        {hint && <span className="text-sm font-normal text-muted">{hint}</span>}
      </h3>
      {children}
    </Panel>
  )
}

function MiniType({ type, onClick }: { type: string; onClick?: () => void }) {
  const t = TYPES[type]
  const temp = TEMPERAMENT[temperamentOf(type)]
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="flex items-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-left transition-colors enabled:hover:border-line-strong">
      <span className="text-3xl" aria-hidden>
        {t.emoji}
      </span>
      <span>
        <span className="block text-base font-extrabold" style={{ color: temp.color }}>
          {type}
        </span>
        <span className="block text-sm text-muted">{t.nick}</span>
      </span>
    </button>
  )
}

function TypeGrid({ title, hint, current, onPick }: { title: string; hint: string; current?: string; onPick: (t: string) => void }) {
  return (
    <Panel className="flex flex-col gap-3 p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
        <Grid3x3 className="size-4 text-brand" aria-hidden />
        {title}
        <span className="text-sm font-normal text-muted">{hint}</span>
      </h3>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {Object.entries(TEMPERAMENT).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-full" style={{ background: v.color }} />
            {v.name}({k})
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TYPE_ORDER.map((type) => {
          const t = TYPES[type]
          const temp = TEMPERAMENT[temperamentOf(type)]
          return (
            <button
              key={type}
              type="button"
              onClick={() => onPick(type)}
              aria-current={current === type ? 'true' : undefined}
              className={clsx('flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-center transition-transform hover:-translate-y-0.5', current === type ? 'shadow-2' : 'border-transparent')}
              style={{ background: temp.soft, ...(current === type ? { borderColor: temp.color } : {}) }}
            >
              <span className="text-4xl" aria-hidden>
                {t.emoji}
              </span>
              <span className="text-lg font-black tracking-wide" style={{ color: temp.color }}>
                {type}
              </span>
              <span className="text-sm font-semibold text-ink-2">{t.nick}</span>
            </button>
          )
        })}
      </div>
    </Panel>
  )
}
