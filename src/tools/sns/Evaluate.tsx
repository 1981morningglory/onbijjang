/**
 * 수집 작업 하나의 평가 화면: 자동으로 읽은 숫자(팔로워·방문자)와 담당자가 확인해 적는 점수(적합성·리뷰·지원동기)를
 * 가이드 규칙대로 합쳐 정식 순위·추천 명단을 만든다. 담당자 입력은 서버에 저장되어 팀이 함께 본다.
 */
import clsx from 'clsx'
import { del, get } from 'idb-keyval'
import { Camera, ChevronRight, CirclePause, CirclePlay, Download, ExternalLink, FileUp, ListChecks, NotebookPen, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { downloadBlob } from '@/lib/files'
import { Badge, Button, Callout, Checkbox, Dialog, EmptyState, NumberInput, Progress, Segmented, Spinner, Tabs, Textarea, TextInput, toast } from '@/ui'
import { buildSelectionWorkbook, type ProblemRow } from './excel'
import type { Applicant } from './parse'
import {
  aiPatch,
  breakdownText,
  buildCandidate,
  MAX,
  MOTIVE_SOURCE_LABEL,
  rankCandidates,
  recommend,
  STATUS_LABEL,
  suggestMotive,
  TARGET,
  type BlogData,
  type Candidate,
  type Eval,
  type EvalStatus,
  type IgData,
  type JobItem,
} from './score'
import { AI_SEC_PER, AI_WON_PER, ConfirmLong, fmtDuration, IG_SEC, LONG_SEC, metaFileKey, metaKey, WON_PER_USD, type Count, type JobBrief, type Lanes, type LocalMeta } from './shared'

type Kind = 'ig' | 'blog'
interface AiInfo {
  /** 수집하면서 AI 채점까지 하는 작업인지 */
  auto?: boolean
  /** 그중 아직 수집 중이라 AI 줄에 서지 않은 계정 */
  autoWaiting?: number
  queued: number
  done: number
  fail: number
  cost: number
  note: string
}
type Job = JobBrief & { items: JobItem[]; evals: Record<string, Eval>; ai?: AiInfo }


const STATUS_TONE: Record<EvalStatus, string> = {
  complete: 'bg-brand-soft text-brand-ink',
  partial: 'bg-mark-soft text-ink',
  hold: 'bg-sunken text-muted',
  failed: 'bg-danger-soft text-danger',
}
const fmt = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('ko-KR'))
const accountUrl = (kind: Kind, key: string) => (kind === 'ig' ? `https://www.instagram.com/${key}/` : `https://blog.naver.com/${key}`)

export function JobView({ id, lanes, connected, aiConnected, onChanged, onDeleted }: { id: string; lanes: Lanes | null; connected: boolean; aiConnected: boolean; onChanged: () => void; onDeleted: () => void }) {
  const [job, setJob] = useState<Job | null>(null)
  const [meta, setMeta] = useState<LocalMeta | null>(null)
  const [tab, setTab] = useState<Kind | 'rec'>('ig')
  const [busy, setBusy] = useState<string | null>(null)
  const [askRecheck, setAskRecheck] = useState(false)
  const [target, setTarget] = useState<{ ig: number; blog: number }>({ ig: TARGET.ig, blog: TARGET.blog })
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    const r = await api<{ job: Job }>(`/sns/jobs/${id}`)
    setJob((prev) => ({ ...r.job, evals: { ...r.job.evals, ...pendingEvals(prev) } }))
    return r.job
  }, [id])
  useEffect(() => {
    let alive = true
    void get<LocalMeta>(metaKey(id))
      .then((m) => alive && setMeta(m ?? null))
      .catch(() => {})
    const tick = async () => {
      try {
        const j = await load()
        if (alive) timer.current = window.setTimeout(tick, j.status === 'running' || (j.ai?.queued ?? 0) > 0 ? 5000 : 20000)
      } catch {
        if (alive) timer.current = window.setTimeout(tick, 10000)
      }
    }
    void tick()
    return () => {
      alive = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [id, load])

  // 담당자 입력: 화면에 바로 반영하고 잠시 뒤 서버에 저장
  const saveTimers = useRef(new Map<string, number>())
  const queued = useRef(new Map<string, { kind: Kind; key: string; patch: Eval }>())
  const setEval = useCallback(
    (kind: Kind, key: string, patch: Eval) => {
      const evKey = `${kind}:${key}`
      setJob((j) => (j ? { ...j, evals: { ...j.evals, [evKey]: { ...(j.evals[evKey] ?? {}), ...patch } } } : j))
      const q = queued.current.get(evKey)
      queued.current.set(evKey, { kind, key, patch: { ...(q?.patch ?? {}), ...patch } })
      const t = saveTimers.current.get(evKey)
      if (t) clearTimeout(t)
      saveTimers.current.set(
        evKey,
        window.setTimeout(() => {
          const item = queued.current.get(evKey)
          queued.current.delete(evKey)
          saveTimers.current.delete(evKey)
          if (!item) return
          api(`/sns/jobs/${id}/eval`, { method: 'PATCH', body: item }).catch((err) => toast.error(err instanceof Error ? `저장하지 못했습니다: ${err.message}` : '저장하지 못했습니다.'))
        }, 600),
      )
    },
    [id],
  )
  function pendingEvals(prev: Job | null): Record<string, Eval> {
    // 서버에서 새로 받아도 아직 저장 중인 입력은 덮어쓰지 않는다
    const out: Record<string, Eval> = {}
    if (!prev) return out
    for (const k of queued.current.keys()) out[k] = prev.evals[k] ?? {}
    return out
  }

  const people = useMemo(() => ({ ig: new Map(meta?.ig ?? []), blog: new Map(meta?.blog ?? []) }), [meta])
  const lists = useMemo(() => {
    if (!job) return null
    const make = (kind: Kind) =>
      rankCandidates(
        job.items
          .filter((x) => x.kind === kind)
          .map((x) => {
            // 블로그 짧은 주소·인스타그램 게시물 주소는 서버가 찾은 진짜 아이디로 보여 준다
            const shown = x.id ?? x.key
            const c = buildCandidate(kind, shown, x, (kind === 'ig' ? people.ig : people.blog).get(x.key) ?? [], job.evals[`${kind}:${x.key}`] ?? {})
            return Object.assign(c, { evalKey: x.key, waiting: x.state === 'wait' })
          }),
      ) as Array<Candidate & { evalKey: string; waiting: boolean }>
    const ig = make('ig')
    const blog = make('blog')
    return { ig, blog, recIg: recommend('ig', ig, target.ig), recBlog: recommend('blog', blog, target.blog) }
  }, [job, people, target])

  if (!job || !lists)
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Spinner /> 작업을 여는 중
      </div>
    )

  const igLeft = job.ig.total - job.ig.done - job.ig.fail
  const blogLeft = job.blog.total - job.blog.done - job.blog.fail
  const pct = (c: Count) => (c.total ? ((c.done + c.fail) / c.total) * 100 : 100)
  const pageOnly = lists.ig.filter((c) => (c.data as IgData | undefined)?.source === 'page' && !(c.data as IgData).personal).length

  const exportXlsx = async () => {
    setBusy('xlsx')
    try {
      const original = await get<ArrayBuffer>(metaFileKey(id)).catch(() => undefined)
      const blob = await buildSelectionWorkbook({
        title: job.title,
        ig: lists.ig,
        blog: lists.blog,
        recIg: lists.recIg,
        recBlog: lists.recBlog,
        problems: meta?.problems ?? [],
        pending: { ig: igLeft, blog: blogLeft },
        original: original ?? null,
      })
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      downloadBlob(blob, `체험단평가_${(job.title || 'SNS').replace(/[\\/:*?"<>|]/g, '').slice(0, 40)}_${day}.xlsx`)
      if (!original) toast.info('원본 지원자 엑셀이 이 브라우저에 없어 평가 시트만 담았습니다.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '엑셀을 만들지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    try {
      await fn()
      await load()
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '처리하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const failCount = job.ig.fail + job.blog.fail
  const count = (l: Candidate[], s: EvalStatus) => l.filter((c) => c.status === s).length

  return (
    <div className="mt-2 flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
      {!meta && <Callout tone="info">이 작업을 만든 브라우저가 아니어서 지원자 이름·연락처·지원동기는 비어 있습니다(서버에는 SNS 아이디와 담당자 점수만 있습니다). 지원동기 점수는 담당자가 직접 적어야 합니다.</Callout>}
      <div className="grid gap-4 md:grid-cols-2">
        <Progress value={pct(job.blog)} label={`블로그 자동 확인 ${job.blog.done + job.blog.fail} / ${job.blog.total}${job.blog.fail ? ` (실패 ${job.blog.fail})` : ''}`} />
        <div className="flex flex-col gap-1">
          <Progress value={pct(job.ig)} label={`인스타그램 자동 확인 ${job.ig.done + job.ig.fail} / ${job.ig.total}${job.ig.fail ? ` (실패 ${job.ig.fail})` : ''}`} />
          {job.status === 'running' && igLeft > 0 && (
            <p className="text-xs text-muted">
              남은 시간 {fmtDuration((igLeft * (lanes?.ig.gapMs ?? 19000)) / 1000)}
              {lanes?.ig.note && <span className="text-warn"> · {lanes.ig.note}</span>}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={Download} loading={busy === 'xlsx'} onClick={exportXlsx}>
          평가 엑셀 내려받기{meta?.fileName ? ' (원본에 시트 추가)' : ''}
        </Button>
        {job.status === 'running' ? (
          <Button icon={CirclePause} loading={busy === 'stop'} onClick={() => act('stop', () => api(`/sns/jobs/${id}/stop`, { method: 'POST' }))}>
            자동 확인 멈추기
          </Button>
        ) : (
          (job.status === 'stopped' || failCount > 0) && (
            <Button icon={CirclePlay} loading={busy === 'resume'} onClick={() => act('resume', () => api(`/sns/jobs/${id}/resume`, { method: 'POST' }))}>
              {job.status === 'stopped' ? '이어서 확인' : `실패한 ${failCount}개 다시 확인`}
            </Button>
          )
        )}
        {connected && pageOnly > 0 && (
          <>
            <Button icon={RefreshCw} loading={busy === 'recheck'} onClick={() => (pageOnly * IG_SEC(true) >= LONG_SEC ? setAskRecheck(true) : void act('recheck', () => api(`/sns/jobs/${id}/recheck`, { method: 'POST' })))}>
              API 로 팔로워 정확히 다시 읽기 ({pageOnly}명)
            </Button>
            <ConfirmLong
              open={askRecheck}
              seconds={pageOnly * IG_SEC(true)}
              detail={`인스타그램 ${pageOnly}명 × 약 ${IG_SEC(true)}초(Meta 공식 API 한도: 시간당 약 200번)`}
              onNo={() => setAskRecheck(false)}
              onYes={() => {
                setAskRecheck(false)
                void act('recheck', () => api(`/sns/jobs/${id}/recheck`, { method: 'POST' }))
              }}
            />
          </>
        )}
        <Button
          variant="ghost"
          icon={Trash2}
          className="ml-auto"
          loading={busy === 'del'}
          onClick={() => {
            if (!confirm('이 작업과 모은 숫자·담당자 점수를 모두 지울까요?')) return
            void act('del', async () => {
              await api(`/sns/jobs/${id}`, { method: 'DELETE' })
              await del(metaKey(id)).catch(() => {})
              await del(metaFileKey(id)).catch(() => {})
              onDeleted()
            })
          }}
        >
          지우기
        </Button>
      </div>

      <AiPanel
        jobId={id}
        jobTitle={job.title}
        aiConnected={aiConnected}
        info={job.ai}
        lists={lists}
        applicant={(kind, key) => (kind === 'ig' ? people.ig : people.blog).get(key)?.slice().sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))[0]}
        onQueued={() => void load()}
      />

      <Tabs
        label="평가"
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'ig', label: `인스타그램 (완료 ${count(lists.ig, 'complete')} / ${lists.ig.length})`, icon: Camera },
          { value: 'blog', label: `블로그 (완료 ${count(lists.blog, 'complete')} / ${lists.blog.length})`, icon: NotebookPen },
          { value: 'rec', label: '추천 명단', icon: ListChecks },
        ]}
      />
      {tab === 'rec' ? (
        <RecommendView lists={lists} target={target} setTarget={setTarget} problems={meta?.problems ?? []} />
      ) : (
        <EvalTable kind={tab} list={tab === 'ig' ? lists.ig : lists.blog} setEval={setEval} />
      )}
    </div>
  )
}

// ── 평가 표 ───────────────────────────────────────────────
type Row = Candidate & { evalKey: string; waiting: boolean }
type Filter = 'all' | 'todo' | EvalStatus | 'dupe'

function EvalTable({ kind, list, setEval }: { kind: Kind; list: Row[]; setEval: (kind: Kind, key: string, patch: Eval) => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const query = q.trim().toLowerCase()
  const shown = useMemo(
    () =>
      list.filter((c) => {
        if (filter === 'todo' && !(c.status === 'partial')) return false
        if ((filter === 'complete' || filter === 'partial' || filter === 'hold' || filter === 'failed') && c.status !== filter) return false
        if (filter === 'dupe' && !c.dupes.length) return false
        if (query && !`${c.key} ${c.rep?.name ?? ''} ${c.keywords.join(' ')}`.toLowerCase().includes(query)) return false
        return true
      }),
    [list, filter, query],
  )
  const m = MAX[kind]
  const nextTodo = (from: string) => {
    const i = shown.findIndex((c) => c.key === from)
    const next = [...shown.slice(i + 1), ...shown.slice(0, i)].find((c) => c.status === 'partial')
    setOpen(next ? next.key : null)
  }
  const applicable = shown.map((c) => [c, aiPatch(c)] as const).filter(([, p]) => p)
  const applyAll = () => {
    if (!applicable.length) return
    if (!confirm(`지금 보이는 지원자 중 AI 초안이 있는 ${applicable.length}명의 빈 항목에 AI 초안 점수를 적용할까요?\n담당자가 이미 적은 점수는 바꾸지 않습니다. 적용한 점수는 ‘AI 초안 적용’으로 기록됩니다.`)) return
    for (const [c, patch] of applicable) setEval(kind, c.evalKey, patch!)
    toast.success(`${applicable.length}명에 AI 초안을 적용했습니다.`)
  }
  const aiCell = (confirmed: number | null, draft: number | null | undefined) =>
    confirmed != null ? confirmed : draft != null ? <span className="text-xs font-semibold text-accent" title="AI 초안(아직 적용 전)">AI {draft}</span> : ''
  if (!list.length) return <EmptyState title="아직 이 채널 지원자가 없습니다">수집 작업에 주소가 들어 있으면 여기에 쌓입니다.</EmptyState>
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Filter>
          label="보기"
          size="sm"
          value={filter}
          onValue={setFilter}
          options={[
            { value: 'all', label: `전체 ${list.length}` },
            { value: 'todo', label: `확인할 것 ${list.filter((c) => c.status === 'partial').length}` },
            { value: 'complete', label: `평가 완료 ${list.filter((c) => c.status === 'complete').length}` },
            { value: 'hold', label: `보류 ${list.filter((c) => c.status === 'hold').length}` },
            { value: 'failed', label: `확인 실패 ${list.filter((c) => c.status === 'failed').length}` },
            { value: 'dupe', label: `중복 지원 ${list.filter((c) => c.dupes.length).length}` },
          ]}
        />
        <label className="ml-auto flex h-9 min-w-56 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 focus-within:border-brand">
          <Search className="size-4 text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="계정·이름·키워드 찾기" aria-label="찾기" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
        </label>
        {applicable.length > 0 && (
          <Button size="sm" icon={Sparkles} onClick={applyAll}>
            AI 초안 적용(빈칸만 · {applicable.length}명)
          </Button>
        )}
      </div>
      <div className="max-h-[640px] overflow-auto rounded-md border border-line">
        <table className="num w-full min-w-[1040px] text-sm">
          <thead className="sticky top-0 z-10 bg-paper text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">순위</th>
              <th className="px-3 py-2 font-semibold">상태</th>
              <th className="px-3 py-2 font-semibold">이름</th>
              <th className="px-3 py-2 font-semibold">{kind === 'ig' ? '계정' : '블로그'}</th>
              <th className="px-3 py-2 text-right font-semibold">{kind === 'ig' ? '팔로워' : '일평균 방문자'}</th>
              <th className="px-3 py-2 text-right font-semibold">{kind === 'ig' ? `팔로워(${MAX.ig.followers})` : `방문자(${MAX.blog.visitors})`}</th>
              <th className="px-3 py-2 text-right font-semibold">적합성({m.fit})</th>
              <th className="px-3 py-2 text-right font-semibold">{kind === 'ig' ? '표현력' : '리뷰'}({m.review})</th>
              <th className="px-3 py-2 text-right font-semibold">동기({m.motive})</th>
              <th className="px-3 py-2 text-right font-semibold">총점·소계</th>
              <th className="px-3 py-2 font-semibold">미확인</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <Fragment key={c.key}>
                <tr className={clsx('cursor-pointer border-t border-line hover:bg-paper', open === c.key && 'bg-paper')} onClick={() => setOpen(open === c.key ? null : c.key)}>
                  <td className="px-3 py-1.5 font-bold">
                    <span className="flex items-center gap-1">
                      <ChevronRight className={clsx('size-3.5 text-muted transition-transform', open === c.key && 'rotate-90')} aria-hidden />
                      {c.rank ?? '–'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={clsx('inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-2xs font-bold', STATUS_TONE[c.status])}>{c.waiting ? '자동 확인 중' : STATUS_LABEL[c.status]}</span>
                    {c.ev.aiApplied && <span className="ml-1 text-2xs font-semibold text-accent">AI 적용</span>}
                    {c.dupes.length > 0 && <span className="ml-1 text-2xs text-warn">중복 {c.dupes.length}</span>}
                  </td>
                  <td className="max-w-24 truncate px-3 py-1.5">{c.rep?.name}</td>
                  <td className="max-w-44 truncate px-3 py-1.5">
                    <a href={accountUrl(kind, c.key)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-brand-ink hover:underline">
                      {c.key}
                    </a>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {kind === 'ig' ? (
                      <span title={c.followersApprox ? `원문 ${c.followersRaw} · 근사값` : undefined}>
                        {fmt(c.followers)}
                        {c.followersApprox && <span className="ml-0.5 text-2xs text-warn">≈</span>}
                      </span>
                    ) : c.visitorsHidden ? (
                      <span className="text-xs text-faint">통계 미공개</span>
                    ) : (
                      fmt(c.visitorsAvg)
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">{c.scores.base ?? ''}</td>
                  <td className="px-3 py-1.5 text-right">{aiCell(c.scores.fit, c.ev.ai?.fit?.score)}</td>
                  <td className="px-3 py-1.5 text-right">{aiCell(c.scores.review, c.ev.ai?.review?.score)}</td>
                  <td
                    className={clsx('px-3 py-1.5 text-right', c.motiveAuto && 'text-ink-2')}
                    title={c.motiveSource === 'ai' ? `AI 채점(수정 가능) · ${breakdownText(c.ev.ai?.motive?.breakdown)}` : c.motiveAuto ? '자동 판단(수정 가능)' : undefined}
                  >
                    {c.scores.motive ?? ''}
                    {c.motiveAuto && <span className={clsx('ml-0.5 text-2xs', c.motiveSource === 'ai' ? 'font-semibold text-accent' : 'text-faint')}>{MOTIVE_SOURCE_LABEL[c.motiveSource ?? 'auto']}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right font-bold">{c.total != null ? c.total : <span className="font-normal text-ink-2">{c.subtotal}/{c.confirmedMax}</span>}</td>
                  <td className="max-w-40 truncate px-3 py-1.5 text-xs text-muted">{c.missing.join(', ')}</td>
                </tr>
                {open === c.key && (
                  <tr className="border-t border-line bg-paper">
                    <td colSpan={11} className="px-4 pb-4 pt-2">
                      <Editor kind={kind} c={c} onPatch={(p) => setEval(kind, c.evalKey, p)} onNext={() => nextTodo(c.key)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        모든 항목이 확인된 지원자만 총점과 정식 순위가 나옵니다. 일부 미확인자는 ‘확인 항목 소계/확인된 배점’으로만 보이고, 미확인 항목을 0점으로 치지 않습니다. 줄을 누르면 담당자 평가 칸이 열리고, 적는 즉시 저장되어 팀원도 함께 봅니다.
      </p>
    </div>
  )
}

// ── 한 지원자 평가 ─────────────────────────────────────────
function ScoreInput({ label, value, max, onValue, hint }: { label: string; value: number | null | undefined; max: number; onValue: (v: number | null) => void; hint?: string }) {
  const half = Math.round(max / 2)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          {label} <span className="font-normal text-muted">/ {max}</span>
        </span>
        {hint && <span className="text-2xs text-muted">{hint}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {[
          [0, '근거 없음'],
          [half, '일부'],
          [max, '충분'],
        ].map(([v, t]) => (
          <button
            key={t}
            type="button"
            onClick={() => onValue(v as number)}
            className={clsx('h-8 rounded-md border px-2.5 text-xs font-semibold', value === v ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-sunken')}
          >
            {t} {v}
          </button>
        ))}
        <NumberInput aria-label={`${label} 점수`} value={value ?? null} min={0} max={max} onValue={(v) => onValue(v == null ? null : Math.max(0, Math.min(max, v)))} className="w-20!" />
        <button type="button" className="text-xs text-muted underline" onClick={() => onValue(null)}>
          미확인으로
        </button>
      </div>
    </div>
  )
}

function Editor({ kind, c, onPatch, onNext }: { kind: Kind; c: Row; onPatch: (p: Eval) => void; onNext: () => void }) {
  const m = MAX[kind]
  const ev = c.ev
  const auto = suggestMotive(c.rep?.motive)
  const aiMotive = ev.ai && !ev.ai.error ? ev.ai.motive?.score ?? null : null
  const d = c.data as (IgData & BlogData) | undefined
  const posts = kind === 'ig' ? (d as IgData | undefined)?.posts ?? [] : []
  const since90 = Date.now() - 90 * 86400_000
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* 왼쪽: 확인할 자료 */}
      <div className="flex min-w-0 flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <a href={accountUrl(kind, c.key)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-ink hover:underline">
            {kind === 'ig' ? `@${c.key}` : `blog.naver.com/${c.key}`} <ExternalLink className="size-3.5" aria-hidden />
          </a>
          {c.rep?.submittedAt && <span className="text-xs text-muted">접수 {c.rep.submittedAt}</span>}
          {c.rep?.row && <span className="text-xs text-muted">· 신청서 {c.rep.row}행</span>}
        </div>
        {kind === 'ig' ? (
          <p className="text-ink-2">
            팔로워 <b className="text-ink">{c.followers != null ? fmt(c.followers) : '미확인'}</b>
            {c.followersRaw && c.followersApprox && <> (원문 ‘{c.followersRaw}’ 환산 · 근사값)</>}
            {d && (d as IgData).source === 'page' && <span className="text-xs text-muted"> · 공개 프로필에서 읽음</span>}
          </p>
        ) : (
          <p className="text-ink-2">
            {c.visitorsHidden ? (
              <b className="text-warn">방문자 통계 미공개</b>
            ) : c.visitorDays.length ? (
              <>
                완료된 날 방문자 {c.visitorDays.map((v) => `${v.date.slice(5)} ${fmt(v.cnt)}`).join(' · ')} → 평균 <b className="text-ink">{fmt(c.visitorsAvg)}</b>
              </>
            ) : (
              '방문자 미확인'
            )}
          </p>
        )}
        {c.dupes.length > 0 && (
          <Callout tone="warn">
            같은 계정 중복 지원 {c.dupes.length}건 — 가장 먼저 접수된 신청서({c.rep?.name} {c.rep?.submittedAt})만 평가합니다: {c.dupes.map((x) => `${x.name ?? ''}(${x.row ?? ''}행)`).join(', ')}
          </Callout>
        )}
        {c.rep?.reviewLink && (
          <p className="text-xs text-muted">
            신청서에 적은 리뷰 게시물:{' '}
            <a href={c.rep.reviewLink} target="_blank" rel="noreferrer" className="break-all text-brand-ink underline">
              {c.rep.reviewLink}
            </a>
          </p>
        )}
        <div>
          <p className="text-xs font-semibold text-muted">지원동기</p>
          {c.rep?.motive !== undefined ? (
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-surface p-2 text-ink">{c.rep.motive || '(비어 있음)'}</p>
          ) : (
            <p className="mt-1 text-xs text-muted">이 브라우저에 신청서 내용이 없습니다(지원자 엑셀로 만든 작업에서만 보입니다).</p>
          )}
          {c.keywords.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {c.keywords.map((k) => (
                <Badge key={k}>{k}</Badge>
              ))}
            </div>
          )}
        </div>
        {posts.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted">최근 게시물 (고정 게시물이 섞여 있을 수 있으니 날짜를 보세요 · 최근 90일 리뷰를 우선)</p>
            <ul className="mt-1 flex max-h-64 flex-col gap-1 overflow-auto">
              {posts.map((p, i) => {
                const t = Date.parse(p.timestamp)
                return (
                  <li key={i} className="rounded-md bg-surface p-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={clsx('num', Number.isFinite(t) && t >= since90 ? 'text-ink' : 'text-faint')}>{p.timestamp.slice(0, 10)}</span>
                      <span className="text-muted">{p.mediaType === 'REELS' ? '릴스' : p.mediaType === 'VIDEO' ? '영상' : p.mediaType === 'CAROUSEL_ALBUM' ? '여러 장' : '사진'}</span>
                      {p.permalink && (
                        <a href={p.permalink} target="_blank" rel="noreferrer" className="text-brand-ink hover:underline">
                          보기
                        </a>
                      )}
                      {p.permalink && (
                        <button type="button" className="text-muted underline" onClick={() => onPatch({ reviewUrl: p.permalink, reviewDate: p.timestamp.slice(0, 10) })}>
                          이 게시물로 리뷰 평가
                        </button>
                      )}
                    </div>
                    {p.caption && <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{p.caption}</p>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      {/* 오른쪽: 담당자 평가 */}
      <div className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3">
        <AiCard kind={kind} c={c} onApply={(p) => onPatch(p)} />
        {kind === 'ig' && (c.followers == null || (d as IgData | undefined)?.followersApprox) && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-ink">팔로워 수 직접 확인</span>
              <NumberInput aria-label="확인한 팔로워 수" value={ev.followers ?? null} min={0} onValue={(v) => onPatch({ followers: v })} className="w-32!" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">화면 표기(예: 1.2만)</span>
              <TextInput aria-label="팔로워 원문 표기" value={ev.followersRaw ?? ''} maxLength={20} onChange={(e) => onPatch({ followersRaw: e.target.value })} className="w-28!" />
            </label>
          </div>
        )}
        {kind === 'blog' && c.visitorsAvg == null && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-ink">일평균 방문자 직접 확인 (공개된 완료 날짜 평균)</span>
            <NumberInput aria-label="확인한 일평균 방문자" value={ev.visitors ?? null} min={0} onValue={(v) => onPatch({ visitors: v })} className="w-32!" />
          </label>
        )}
        <ScoreInput label="살림·리빙·육아 콘텐츠 적합성" value={ev.fit} max={m.fit} onValue={(fit) => onPatch({ fit })} hint="프로필 소개·카테고리·사진·캡션" />
        <ScoreInput label={kind === 'ig' ? '제품 리뷰 표현력' : '제품 리뷰 품질'} value={ev.review} max={m.review} onValue={(review) => onPatch({ review })} hint="최근 90일 최신 리뷰 1개" />
        <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <label className="flex flex-col gap-1 text-xs text-muted">
            리뷰 게시일
            <TextInput type="date" aria-label="리뷰 게시일" value={ev.reviewDate ?? ''} onChange={(e) => onPatch({ reviewDate: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            평가한 리뷰 링크
            <TextInput aria-label="리뷰 링크" value={ev.reviewUrl ?? ''} maxLength={500} onChange={(e) => onPatch({ reviewUrl: e.target.value })} placeholder="https://" />
          </label>
        </div>
        <Checkbox checked={Boolean(ev.reviewFallback)} onChange={(reviewFallback) => onPatch({ reviewFallback })} label="제품 리뷰가 없어 최근 30일 게시물로 평가함" />
        <div className="flex flex-col gap-1.5">
          <ScoreInput label="지원동기" value={ev.motive ?? c.scores.motive} max={m.motive} onValue={(motive) => onPatch({ motive })} />
          {(c.rep?.motive !== undefined || aiMotive != null) && (
            <p className="text-2xs text-muted">
              {aiMotive != null ? (
                <>
                  AI 채점 {aiMotive}점 ({breakdownText(ev.ai?.motive?.breakdown) || '기준별 점수 없음'})
                </>
              ) : (
                <>
                  자동 판단 {auto.score}점 ({auto.reasons.join(' · ') || '근거 적음'})
                </>
              )}
              {ev.motive != null && ' · 지금은 담당자 점수를 씁니다 '}
              {ev.motive != null && (
                <button type="button" className="underline" onClick={() => onPatch({ motive: null })}>
                  {aiMotive != null ? 'AI 점수로 되돌리기' : '자동 점수로 되돌리기'}
                </button>
              )}
            </p>
          )}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">특이사항 메모</span>
          <Textarea aria-label="특이사항 메모" value={ev.memo ?? ''} maxLength={500} onChange={(e) => onPatch({ memo: e.target.value })} className="min-h-16!" />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox checked={Boolean(ev.hold)} onChange={(hold) => onPatch({ hold })} label="평가 보류(계정 불분명·접근 불가 등)" />
          <Button size="sm" variant="primary" className="ml-auto" onClick={onNext}>
            다음 확인할 지원자
          </Button>
        </div>
        <p className="text-2xs text-muted">근거가 없으면 0, 일부 충족 중간, 충분하면 만점. 협찬이라는 이유만으로 감점하지 않고, 이름·성별·나이·추정 가족관계로 적합성을 판단하지 않습니다. 계정에 접근하지 못하면 0점 대신 미확인으로 두세요.</p>
      </div>
    </div>
  )
}

// ── 추천 명단 ─────────────────────────────────────────────
function RecommendView({
  lists,
  target,
  setTarget,
  problems,
}: {
  lists: { ig: Row[]; blog: Row[]; recIg: ReturnType<typeof recommend>; recBlog: ReturnType<typeof recommend> }
  target: { ig: number; blog: number }
  setTarget: (t: { ig: number; blog: number }) => void
  problems: ProblemRow[]
}) {
  const section = (kind: Kind, r: ReturnType<typeof recommend>) => (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-base font-bold text-ink">{kind === 'ig' ? '인스타그램' : '네이버 블로그'}</h4>
        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          목표
          <NumberInput aria-label="목표 인원" value={target[kind]} min={0} max={1000} onValue={(v) => setTarget({ ...target, [kind]: Math.max(0, v ?? 0) })} className="w-20!" />명
        </label>
        <Badge tone={r.shortfall ? 'warn' : 'brand'}>
          추천 {r.picked.length} / {r.target}
        </Badge>
      </div>
      {r.shortfall > 0 && <Callout tone="warn">부족 {r.shortfall}명 — {r.shortfallReason}</Callout>}
      <ol className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
        {r.picked.map((c, i) => (
          <li key={c.key} className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-sm">
            <span className="num w-7 text-right font-bold text-muted">{i + 1}</span>
            <span className="truncate font-semibold text-ink">{c.rep?.name || c.key}</span>
            <a href={accountUrl(kind, c.key)} target="_blank" rel="noreferrer" className="truncate text-xs text-brand-ink hover:underline">
              {c.key}
            </a>
            <span className="num ml-auto font-bold">{c.total}</span>
          </li>
        ))}
      </ol>
      {kind === 'blog' && r.visitorUnknown.length > 0 && (
        <details className="rounded-md border border-line p-2 text-sm" open={r.conditional.length > 0}>
          <summary className="cursor-pointer font-semibold text-ink">
            방문자 미확인 후보 {r.visitorUnknown.length}명 (리뷰+적합성+동기 70점 소계 순 · 총점과 비교하지 않음)
          </summary>
          <ol className="mt-2 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
            {r.visitorUnknown.map((c, i) => (
              <li key={c.key} className={clsx('flex items-center gap-2 rounded-md px-2 py-1', r.conditional.includes(c) ? 'bg-mark-soft' : 'border border-line')}>
                <span className="num w-7 text-right text-muted">{i + 1}</span>
                <span className="truncate">{c.rep?.name || c.key}</span>
                <span className="num ml-auto">{c.subtotal}/70</span>
                {r.conditional.includes(c) && <span className="text-2xs font-bold text-warn">조건부 추천</span>}
              </li>
            ))}
          </ol>
          {r.conditional.length > 0 && <p className="mt-2 text-xs text-muted">노란 줄은 ‘조건부 추천—방문자 미확인’입니다. 최종 포함 여부는 담당자가 정합니다. 추가 자료 없이 확정하려면 방문자 항목 예외 처리 방식을 먼저 정해 주세요.</p>}
        </details>
      )}
    </div>
  )
  return (
    <div className="flex flex-col gap-6">
      {section('ig', lists.recIg)}
      {section('blog', lists.recBlog)}
      {problems.length > 0 && <p className="text-sm text-muted">주소가 불분명해 보류한 신청서 {problems.length}건은 엑셀 ‘보류·확인 필요’ 시트에 들어갑니다.</p>}
    </div>
  )
}

// ── AI 점수 초안 ──────────────────────────────────────────
function AiCard({ kind, c, onApply }: { kind: Kind; c: Row; onApply: (p: Eval) => void }) {
  const ai = c.ev.ai
  if (!ai) return null
  if (ai.error) return <Callout tone="warn" title="AI 초안을 만들지 못했습니다">{ai.error}</Callout>
  const patch = aiPatch(c)
  const row = (label: string, max: number, d?: { score: number | null; reason: string }) => (
    <li className="flex gap-2">
      <span className="w-24 shrink-0 text-ink-2">{label}</span>
      <span className="num w-14 shrink-0 font-bold text-accent">{d?.score != null ? `${d.score}/${max}` : '판단 못 함'}</span>
      <span className="min-w-0 text-ink-2">{d?.reason}</span>
    </li>
  )
  return (
    <div className="rounded-md border border-accent/30 bg-accent-soft/40 p-2.5 text-xs">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 font-bold text-accent">
          <Sparkles className="size-3.5" aria-hidden /> AI 점수 초안
        </span>
        <span className="text-faint">적합성·리뷰는 확인한 뒤 적용해야 점수로 칩니다 · 지원동기는 AI 점수가 바로 쓰입니다(고치면 담당자 점수)</span>
        {patch && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => onApply(patch)}>
            빈칸에 초안 적용
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {row('콘텐츠 적합성', MAX[kind].fit, ai.fit)}
        {row(kind === 'ig' ? '리뷰 표현력' : '리뷰 품질', MAX[kind].review, ai.review)}
        {row('지원동기', MAX[kind].motive, ai.motive)}
      </ul>
      {ai.review?.url && (
        <p className="mt-1">
          AI 가 본 리뷰:{' '}
          <a href={ai.review.url} target="_blank" rel="noreferrer" className="text-brand-ink underline">
            {ai.review.date || '게시물'}
          </a>
          {ai.review.recent && ' (제품 리뷰가 없어 최근 게시물로 평가)'}
        </p>
      )}
      {ai.motive?.breakdown && <p className="mt-1 text-ink-2">지원동기 기준별: {breakdownText(ai.motive.breakdown)}</p>}
      {ai.motive?.keywords?.length ? <p className="mt-1 text-ink-2">지원동기 키워드: {ai.motive.keywords.join(', ')}</p> : null}
      {ai.note && <p className="mt-1 text-ink-2">메모: {ai.note}</p>}
    </div>
  )
}

function AiPanel({
  jobId,
  jobTitle,
  aiConnected,
  info,
  lists,
  applicant,
  onQueued,
}: {
  jobId: string
  jobTitle: string
  aiConnected: boolean
  info?: AiInfo
  lists: { ig: Row[]; blog: Row[] }
  /** 대표 신청서(가장 먼저 접수된 것) — 지원동기·리뷰 링크를 서버에 함께 보낸다 */
  applicant: (kind: Kind, key: string) => Applicant | undefined
  onQueued: () => void
}) {
  const [open, setOpen] = useState<null | 'export' | 'api'>(null)
  const [scope, setScope] = useState<'todo' | 'all'>('todo')
  const [channel, setChannel] = useState<'both' | Kind>('both')
  const [busy, setBusy] = useState<string | null>(null)
  const [autoApply, setAutoApply] = useState(true)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pick = (l: Row[]) => l.filter((c) => !c.waiting && c.status !== 'hold' && (scope === 'all' ? true : c.status === 'partial' || c.status === 'failed') && (scope === 'all' || !c.ev.ai || Boolean(c.ev.ai.error)))
  const targets = [...(channel !== 'blog' ? pick(lists.ig) : []), ...(channel !== 'ig' ? pick(lists.blog) : [])]
  const n = targets.length

  /** 평가 자료 묶음(JSON) 내려받기 — Claude Code 대화(Max 요금제)에 주고 초안을 받는다 */
  const exportPack = async () => {
    setBusy('export')
    setProgress({ done: 0, total: n })
    try {
      const items: Array<Record<string, unknown>> = []
      let guide = ''
      for (let i = 0; i < targets.length; i += 25) {
        const part = targets.slice(i, i + 25)
        const r = await api<{ items: Array<Record<string, unknown> & { kind: Kind; key: string }>; guide: string }>(`/sns/jobs/${jobId}/ai-pack`, {
          method: 'POST',
          body: { targets: part.map((c) => ({ kind: c.kind, key: c.evalKey, reviewLink: applicant(c.kind, c.evalKey)?.reviewLink })) },
        })
        guide = r.guide
        for (const it of r.items) items.push({ ...it, motive: applicant(it.kind, it.key)?.motive ?? null })
        setProgress({ done: Math.min(n, i + part.length), total: n })
      }
      const pack = {
        format: 'onbijjang-sns-ai-pack',
        version: 1,
        jobId,
        title: jobTitle,
        exportedAt: new Date().toISOString(),
        guide,
        output: {
          format: 'onbijjang-sns-ai-drafts',
          howto: '각 item 에 대해 { kind, key, fit: { score: 0~25 | null, reason }, review: { score: 인스타 0~20 · 블로그 0~30 | null, reason, url, date, recent }, motive: { score: 0~15 | null, reason, keywords: [], breakdown: { product: 0~4, life: 0~3, plan: 0~4, sincerity: 0~4 } }, note } 를 items 배열로. 판단할 근거가 없으면 score 는 null.',
        },
        items,
      }
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      downloadBlob(new Blob([JSON.stringify(pack, null, 1)], { type: 'application/json' }), `체험단_AI평가자료_${(jobTitle || 'SNS').replace(/[\\/:*?"<>|]/g, '').slice(0, 30)}_${day}.json`)
      toast.success(`${items.length}명의 평가 자료를 내려받았습니다. Claude Code 대화에 이 파일을 주고 ‘체험단 AI 초안 매겨줘’라고 하세요.`)
      setOpen(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '내보내지 못했습니다.')
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  /** Claude Code 대화에서 만든 초안 결과(JSON) 가져오기 */
  const importDrafts = async (file: File) => {
    setBusy('import')
    try {
      const raw = JSON.parse(await file.text())
      const items = Array.isArray(raw) ? raw : raw?.items
      if (!Array.isArray(items)) throw new Error('초안 결과 파일이 아닙니다(items 가 없음).')
      if (raw?.jobId && raw.jobId !== jobId && !confirm('다른 작업에서 만든 결과 파일 같습니다. 그래도 같은 계정이 있으면 넣을까요?')) return
      const r = await api<{ imported: number; skippedCount: number }>(`/sns/jobs/${jobId}/ai-import`, { method: 'POST', body: { items } })
      toast.success(`AI 초안 ${r.imported}명을 넣었습니다${r.skippedCount ? ` (이 작업에 없는 계정 ${r.skippedCount}개는 건너뜀)` : ''}. 확인 후 ‘적용’해 주세요.`)
      onQueued()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '가져오지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const start = async () => {
    setBusy('api')
    try {
      const r = await api<{ queued: number }>(`/sns/jobs/${jobId}/ai`, {
        method: 'POST',
        body: {
          targets: targets.map((c) => {
            const a = applicant(c.kind, c.evalKey)
            return { kind: c.kind, key: c.evalKey, motive: a?.motive, reviewLink: a?.reviewLink }
          }),
          autoApply,
        },
      })
      toast.success(`${r.queued}명 AI 채점을 시작했습니다. 창을 닫아도 서버에서 계속합니다.`)
      setOpen(null)
      onQueued()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '시작하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const queued = info?.queued ?? 0
  const scopeControls = (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<'todo' | 'all'>
        label="대상"
        size="sm"
        value={scope}
        onValue={setScope}
        options={[
          { value: 'todo', label: '확인할 것(초안 없는 미확인자)' },
          { value: 'all', label: '전체(다시 만들기 포함)' },
        ]}
      />
      <Segmented<'both' | Kind>
        label="채널"
        size="sm"
        value={channel}
        onValue={setChannel}
        options={[
          { value: 'both', label: '둘 다' },
          { value: 'ig', label: '인스타그램' },
          { value: 'blog', label: '블로그' },
        ]}
      />
    </div>
  )
  /** API 없이(Max 대화) 하는 방법: 평가 자료 내보내기 → 대화 → 초안 가져오기 */
  const manual = (
    <>
      <Button size="sm" variant={aiConnected ? 'ghost' : 'primary'} icon={Download} loading={busy === 'export'} onClick={() => setOpen('export')}>
        평가 자료 내보내기
      </Button>
      <Button size="sm" variant={aiConnected ? 'ghost' : 'secondary'} icon={FileUp} loading={busy === 'import'} onClick={() => fileRef.current?.click()}>
        AI 초안 가져오기
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void importDrafts(f)
        }}
      />
    </>
  )
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-accent" aria-hidden />
        <span className="font-semibold text-ink">AI 점수 초안</span>
        {aiConnected ? (
          queued > 0 || (info?.autoWaiting ?? 0) > 0 ? (
            <>
              <span className="text-ink-2">
                AI 가 매기는 중 · 남은 {queued}명{(info?.autoWaiting ?? 0) > 0 && ` · 수집 중 ${info?.autoWaiting}명(끝나는 대로 이어서 채점)`} ·{' '}
                {fmtDuration((queued + (info?.autoWaiting ?? 0)) * AI_SEC_PER)}
              </span>
              {info?.note && <span className="text-warn">{info.note}</span>}
              <Button size="sm" variant="ghost" onClick={() => void api(`/sns/jobs/${jobId}/ai/stop`, { method: 'POST' }).then(onQueued)}>
                멈추기
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" icon={Sparkles} loading={busy === 'api'} onClick={() => setOpen('api')}>
              AI 로 채점하기
            </Button>
          )
        ) : (
          manual
        )}
        {(info?.done ?? 0) > 0 && (
          <span className="ml-auto text-xs text-muted">
            초안 {info?.done ?? 0}명{info?.fail ? ` · 실패 ${info.fail}` : ''}
            {(info?.cost ?? 0) > 0 && ` · API 비용 약 ₩${Math.round((info?.cost ?? 0) * WON_PER_USD).toLocaleString('ko-KR')}`}
          </span>
        )}
      </div>
      {aiConnected ? (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">API 비용 없이 하기(Max 요금제 대화)</summary>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {manual}
            <span>① 평가 자료 내보내기 → ② Claude Code 대화에 주고 ‘체험단 AI 초안 매겨줘’ → ③ 받은 결과를 AI 초안 가져오기</span>
          </div>
        </details>
      ) : (
        <p className="text-xs text-muted">
          추가 비용 없이(Max 요금제): ① ‘평가 자료 내보내기’로 받은 파일을 Claude Code 대화에 주고 ‘체험단 AI 초안 매겨줘’라고 하면 ② 결과 파일을 만들어 드립니다 → ③ ‘AI 초안 가져오기’로 올리고 확인 후 적용하세요. 관리자 화면에서 AI 키를 연결하면 버튼 하나로 바로 매길 수 있습니다.
        </p>
      )}
      {progress && <Progress value={(progress.done / Math.max(1, progress.total)) * 100} label={`평가 자료 모으는 중 ${progress.done} / ${progress.total}`} />}

      <Dialog
        open={open === 'export'}
        onClose={() => setOpen(null)}
        size="md"
        title="평가 자료 내보내기 (추가 비용 없음)"
        footer={
          <>
            <Button onClick={() => setOpen(null)}>아니오</Button>
            <Button variant="primary" icon={Download} loading={busy === 'export'} disabled={!n} onClick={exportPack}>
              예, {n}명 내보냅니다
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-ink-2">
            서버가 공개 게시물(인스타그램 최근 게시물 캡션·사진 주소, 블로그 최근 글 목록과 제품 리뷰 글 본문·사진 주소)을 모으고, 이 브라우저의 신청서 지원동기를 덧붙여 <b>파일 하나</b>로 내려받습니다. 이름·연락처·주소는 넣지 않습니다.
          </p>
          {scopeControls}
          <Callout tone="info" title={`${n}명 · 자료 모으기 ${fmtDuration(n * 1.5)} 정도`}>
            이 파일을 Claude Code 대화(Max 요금제)에 주면 가이드대로 초안 점수와 근거를 매긴 결과 파일을 만들어 드립니다. 별도 API 크레딧은 쓰지 않습니다. 인원이 많으면 대화에서 나눠 진행하며, Max 사용 한도에 닿으면 잠시 쉬었다 이어 갑니다.
          </Callout>
          <p className="font-semibold text-ink">진행하시겠습니까?</p>
        </div>
      </Dialog>

      <Dialog
        open={open === 'api'}
        onClose={() => setOpen(null)}
        size="md"
        title="AI 로 채점하기"
        footer={
          <>
            <Button onClick={() => setOpen(null)}>아니오</Button>
            <Button variant="primary" icon={Sparkles} loading={busy === 'api'} disabled={!n} onClick={start}>
              예, {n}명 진행합니다
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          {scopeControls}
          <Callout tone="warn" title={`${n}명 · 예상 비용 약 ₩${(n * AI_WON_PER).toLocaleString('ko-KR')} · 예상 시간 ${fmtDuration(n * AI_SEC_PER)}`}>
            Max 요금제와 별도로 API 크레딧이 차감됩니다. 승인하면 서버가 바로 시작하고, 창을 닫아도 계속합니다.
          </Callout>
          <Checkbox checked={autoApply} onChange={setAutoApply} label="끝나면 콘텐츠 적합성·리뷰 점수를 빈칸에 바로 적용(담당자가 적은 점수는 그대로)" />
          <p className="text-xs text-muted">지원동기는 AI 점수가 바로 쓰입니다. 게시물을 볼 수 없는 계정(개인 인스타그램 등)은 빈칸으로 남으니 직접 확인해 주세요.</p>
          <p className="font-semibold text-ink">진행하시겠습니까?</p>
        </div>
      </Dialog>
    </div>
  )
}
