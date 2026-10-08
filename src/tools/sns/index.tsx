import clsx from 'clsx'
import { del, get, set } from 'idb-keyval'
import { Camera, CirclePause, CirclePlay, Download, FileSpreadsheet, LogIn, NotebookPen, RefreshCw, Rocket, Trash2, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useLoginDialog } from '@/app/LoginDialog'
import { api, ApiError } from '@/lib/api'
import { downloadBlob } from '@/lib/files'
import { Badge, Button, Callout, Dialog, Dropzone, EmptyState, Field, Panel, Progress, Spinner, Tabs, Textarea, TextInput, toast } from '@/ui'
import { buildSelectionWorkbook, type ProblemRow } from './excel'
import { linesToApplicants, parseList, readApplicantsXlsx, type Applicant, type SnsKind } from './parse'
import { igMissingReason, MISSING_LABEL, rankBlog, rankIg, type BlogData, type IgData, type JobItem } from './score'

interface Status {
  allowed: boolean
  instagram: { connected: boolean; username: string; expiresAt: string | null } | null
}
interface Count {
  total: number
  done: number
  fail: number
}
interface JobBrief {
  id: string
  title: string
  createdAt: string
  finishedAt: string | null
  status: 'running' | 'done' | 'stopped'
  ig: Count
  blog: Count
}
interface Lanes {
  ig: { paused: boolean; note: string; gapMs: number }
  blog: { paused: boolean; note: string; gapMs: number }
}
/** 이 브라우저에만 두는 지원자 정보(이름·연락처). 서버로 보내지 않는다. */
interface LocalMeta {
  ig: Array<[string, Applicant[]]>
  blog: Array<[string, Applicant[]]>
  problems: ProblemRow[]
}
const metaKey = (id: string) => `onbijjang:sns:job:${id}`

/** 한 계정에 걸리는 시간(초): 인스타그램은 API 연결 시 Meta 한도(시간당 약 200번) 때문에 19초, 연결 전 6초. 블로그 약 1.2초 */
const IG_SEC = (connected: boolean) => (connected ? 19 : 6)
const BLOG_SEC = 1.2
/** 블로그와 인스타그램은 서버에서 동시에 돌므로 둘 중 긴 쪽이 전체 시간 */
const estimateSec = (ig: number, blog: number, connected: boolean) => Math.max(ig * IG_SEC(connected), blog * BLOG_SEC)
function fmtDuration(sec: number) {
  const m = Math.max(1, Math.ceil(sec / 60))
  if (m < 60) return `약 ${m}분`
  const h = Math.floor(m / 60)
  return m % 60 ? `약 ${h}시간 ${m % 60}분` : `약 ${h}시간`
}
const LONG_SEC = 5 * 60

/** 5분 이상 걸리는 수집을 시작하기 전에 묻는다 */
function ConfirmLong({ open, seconds, detail, onYes, onNo }: { open: boolean; seconds: number; detail: string; onYes: () => void; onNo: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onNo}
      size="sm"
      title="시간이 오래 걸리는 작업입니다"
      footer={
        <>
          <Button onClick={onNo}>아니오</Button>
          <Button variant="primary" onClick={onYes}>
            예, 진행합니다
          </Button>
        </>
      }
    >
      <Callout tone="warn" title={`예상 소요시간 ${fmtDuration(seconds)}`}>
        {detail}
      </Callout>
      <p className="mt-3 text-sm text-ink-2">수집은 서버에서 진행되므로 이 창을 닫거나 컴퓨터를 꺼도 계속됩니다. 중간에 ‘엑셀 내려받기’로 그때까지 모은 결과를 받을 수 있고, ‘멈추기’로 언제든 멈출 수 있습니다.</p>
      <p className="mt-3 font-semibold text-ink">진행하시겠습니까?</p>
    </Dialog>
  )
}

export default function SnsTool() {
  const [status, setStatus] = useState<Status | null>(null)
  const [offline, setOffline] = useState(false)
  const load = useCallback(async () => {
    try {
      setStatus(await api<Status>('/sns/status'))
      setOffline(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) setOffline(true)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (offline)
    return (
      <Callout tone="warn" title="서버에 연결되지 않습니다">
        체험단 선발은 온비짱 서버가 SNS 를 대신 방문하므로 서버가 켜져 있어야 씁니다.
        <div className="mt-2">
          <Button size="sm" icon={WifiOff} onClick={() => void load()}>
            다시 연결
          </Button>
        </div>
      </Callout>
    )
  if (!status)
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted">
        <Spinner /> 불러오는 중
      </div>
    )
  if (!status.allowed) return <Gate onIn={load} />
  return <Workspace status={status} />
}

// ── 입장(견적서와 같은 팀 코드) ───────────────────────────
function Gate({ onIn }: { onIn: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const showLogin = useLoginDialog((s) => s.show)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    api('/quote/login', { method: 'POST', body: { code: code.trim() } })
      .then(onIn)
      .catch((err) => toast.error(err instanceof Error ? err.message : '들어가지 못했습니다.'))
      .finally(() => setBusy(false))
  }
  return (
    <Panel className="mx-auto mt-6 w-full max-w-xl p-6">
      <h2 className="text-xl font-bold text-ink">직원만 쓸 수 있습니다</h2>
      <p className="mt-1 text-sm text-ink-2">SNS 수집은 회사 인스타그램 API 를 쓰므로 직원 계정으로 로그인하거나, 견적서·거래명세서와 같은 팀 코드로 들어와 주세요.</p>
      <Button className="mt-4" variant="primary" icon={LogIn} onClick={showLogin}>
        직원 계정으로 로그인
      </Button>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        <Field label="팀 코드">{(id) => <TextInput id={id} type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} autoFocus />}</Field>
        <Button type="submit" icon={LogIn} loading={busy} disabled={!code.trim()}>
          팀 코드로 들어가기
        </Button>
        <p className="text-xs text-muted">
          관리자는 <Link to="/admin" className="underline">관리자 화면</Link>에서 로그인하면 바로 쓸 수 있습니다.
        </p>
      </form>
    </Panel>
  )
}

// ── 작업 공간 ─────────────────────────────────────────────
function Workspace({ status }: { status: Status }) {
  const [jobs, setJobs] = useState<JobBrief[] | null>(null)
  const [lanes, setLanes] = useState<Lanes | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const r = await api<{ jobs: JobBrief[]; lanes: Lanes }>('/sns/jobs')
    setJobs(r.jobs)
    setLanes(r.lanes)
  }, [])
  useEffect(() => {
    void refresh().catch(() => {})
    const t = setInterval(() => void refresh().catch(() => {}), 8000)
    return () => clearInterval(t)
  }, [refresh])

  const ig = status.instagram
  return (
    <div className="flex flex-col gap-5">
      {ig?.connected ? (
        <Callout tone="success" title={`인스타그램 공식 API 연결됨${ig.username ? ` · @${ig.username}` : ''}`}>
          비즈니스·크리에이터 계정인 지원자는 팔로워와 최근 게시물 10개의 좋아요·댓글까지, 개인 계정은 팔로워만 읽습니다. 한도(시간당 약 200번)에 맞춰 한 계정에 약 19초씩 걸립니다.
          {ig.expiresAt && ig.expiresAt !== 'never' && <> 토큰은 {new Date(ig.expiresAt).toLocaleDateString('ko-KR')}에 만료됩니다.</>}
        </Callout>
      ) : (
        <Callout tone="warn" title="인스타그램 API 가 아직 연결되지 않았습니다">
          지금은 인스타그램 팔로워 수만 공개 프로필에서 읽습니다(좋아요·댓글 없음). 관리자 화면 → ‘SNS 연결’에서 회사 인스타그램 토큰을 넣으면 반응까지 읽습니다. 블로그는 연결 없이도 모두 읽습니다.
        </Callout>
      )}

      <NewJob
        connected={Boolean(ig?.connected)}
        onCreated={(id) => {
          setOpenId(id)
          void refresh()
        }}
      />

      <Panel className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-ink">수집 작업</h3>
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void refresh()}>
            새로고침
          </Button>
        </div>
        {jobs === null ? (
          <Spinner />
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted">아직 작업이 없습니다. 위에서 주소를 넣고 수집을 시작하세요.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(openId === j.id ? null : j.id)}
                  className={clsx('flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-left text-sm', openId === j.id ? 'border-brand bg-brand-soft/40' : 'border-line hover:bg-paper')}
                >
                  <span className="font-semibold text-ink">{j.title || '이름 없는 작업'}</span>
                  <span className="text-xs text-muted">{new Date(j.createdAt).toLocaleString('ko-KR')}</span>
                  <span className="num text-xs text-ink-2">
                    인스타 {j.ig.done + j.ig.fail}/{j.ig.total} · 블로그 {j.blog.done + j.blog.fail}/{j.blog.total}
                  </span>
                  <Badge tone={j.status === 'done' ? 'brand' : j.status === 'running' ? 'mark' : 'neutral'}>{j.status === 'done' ? '완료' : j.status === 'running' ? '수집 중' : '멈춤'}</Badge>
                </button>
                {openId === j.id && <JobView id={j.id} lanes={lanes} connected={Boolean(ig?.connected)} onChanged={refresh} onDeleted={() => setOpenId(null)} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

// ── 새 작업 ───────────────────────────────────────────────
function NewJob({ connected, onCreated }: { connected: boolean; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [igText, setIgText] = useState('')
  const [blogText, setBlogText] = useState('')
  const [fromFile, setFromFile] = useState<{ ig: Applicant[]; blog: Applicant[]; other: Applicant[]; total: number; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)

  /** 칸의 줄에 엑셀에서 읽은 이름·연락처를 붙인다(같은 줄 글자로 맞춤) */
  const enrich = (kind: SnsKind, text: string) => {
    const pool = new Map<string, Applicant[]>()
    for (const p of (kind === 'ig' ? fromFile?.ig : fromFile?.blog) ?? []) pool.set(p.raw.trim(), [...(pool.get(p.raw.trim()) ?? []), p])
    return linesToApplicants(text).map((l) => pool.get(l.raw)?.shift() ?? l)
  }
  const igParsed = useMemo(() => parseList('ig', enrich('ig', igText)), [igText, fromFile]) // eslint-disable-line react-hooks/exhaustive-deps
  const blogParsed = useMemo(() => parseList('blog', enrich('blog', blogText)), [blogText, fromFile]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadFile = async (file: File) => {
    try {
      const r = await readApplicantsXlsx(file)
      setFromFile({ ...r, name: file.name })
      setIgText(r.ig.map((p) => p.raw).join('\n'))
      setBlogText(r.blog.map((p) => p.raw).join('\n'))
      if (!title) setTitle(file.name.replace(/\.xlsx?$/i, '').slice(0, 60))
      toast.success(`지원자 ${r.total}명을 읽었습니다. 인스타그램 ${r.ig.length} · 블로그 ${r.blog.length} · 기타 ${r.other.length}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '엑셀을 읽지 못했습니다.')
    }
  }

  const start = async () => {
    setBusy(true)
    try {
      const { job } = await api<{ job: JobBrief }>('/sns/jobs', { method: 'POST', body: { title: title.trim(), instagram: [...igParsed.keys.keys()], blogs: [...blogParsed.keys.keys()] } })
      const problems: ProblemRow[] = [
        ...igParsed.invalid.map((p) => ({ kind: '인스타그램', people: [p], raw: p.raw, reason: '주소에서 아이디를 읽지 못함' })),
        ...blogParsed.invalid.map((p) => ({ kind: '블로그', people: [p], raw: p.raw, reason: '주소에서 블로그 아이디를 읽지 못함' })),
        ...(fromFile?.other ?? []).map((p) => ({ kind: '기타 SNS', people: [p], raw: p.raw, reason: '인스타그램·네이버 블로그 주소가 아님(대상 아님)' })),
      ]
      const meta: LocalMeta = { ig: [...igParsed.keys.entries()], blog: [...blogParsed.keys.entries()], problems }
      await set(metaKey(job.id), meta).catch(() => {})
      toast.success('수집을 시작했습니다. 창을 닫아도 서버에서 계속 모읍니다.')
      onCreated(job.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '시작하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const box = (kind: SnsKind, text: string, setText: (v: string) => void, parsed: ReturnType<typeof parseList>) => (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold text-ink">
          {kind === 'ig' ? <Camera className="size-4 text-brand" aria-hidden /> : <NotebookPen className="size-4 text-brand" aria-hidden />}
          {kind === 'ig' ? '인스타그램 주소' : '네이버 블로그 주소'}
        </span>
        <span className="num text-xs text-muted">
          읽을 수 있는 계정 <b className="text-ink">{parsed.keys.size}</b>
          {parsed.duplicates > 0 && ` · 중복 ${parsed.duplicates}`}
          {parsed.invalid.length > 0 && <span className="text-warn"> · 확인 필요 {parsed.invalid.length}</span>}
        </span>
      </div>
      <Textarea
        aria-label={kind === 'ig' ? '인스타그램 주소' : '블로그 주소'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={kind === 'ig' ? 'https://www.instagram.com/아이디\n한 줄에 하나씩 붙여 넣으세요 (@아이디도 됩니다)' : 'https://blog.naver.com/아이디\n한 줄에 하나씩 붙여 넣으세요 (m.blog 주소도 됩니다)'}
        className="num min-h-56! font-mono text-xs!"
      />
      {parsed.invalid.length > 0 && (
        <details className="text-xs text-ink-2">
          <summary className="cursor-pointer text-warn">읽지 못한 줄 {parsed.invalid.length}개 보기 (엑셀 ‘확인 필요’ 시트에 들어갑니다)</summary>
          <ul className="mt-1 max-h-32 overflow-auto rounded-sm bg-sunken p-2">
            {parsed.invalid.map((p, i) => (
              <li key={i} className="truncate">
                {p.name ? `${p.name} · ` : ''}
                {p.raw}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )

  const total = igParsed.keys.size + blogParsed.keys.size
  const igN = igParsed.keys.size
  const blogN = blogParsed.keys.size
  const est = estimateSec(igN, blogN, connected)
  const detail = [
    igN ? `인스타그램 ${igN}명 × 약 ${IG_SEC(connected)}초${connected ? '(Meta 공식 API 한도: 시간당 약 200번)' : ''} = ${fmtDuration(igN * IG_SEC(connected))}` : '',
    blogN ? `블로그 ${blogN}명 = ${fmtDuration(blogN * BLOG_SEC)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const onStart = () => (est >= LONG_SEC ? setAsking(true) : void start())
  return (
    <Panel className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <h3 className="mr-auto text-base font-bold text-ink">새 수집 작업</h3>
        <Field label="작업 이름" className="w-full max-w-sm">
          {(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="예: 5겹 화장지 체험단 10월" />}
        </Field>
      </div>
      <Dropzone
        compact
        accept=".xlsx"
        multiple={false}
        icon={FileSpreadsheet}
        title={fromFile ? `${fromFile.name} · 지원자 ${fromFile.total}명 (인스타 ${fromFile.ig.length} · 블로그 ${fromFile.blog.length} · 기타 ${fromFile.other.length})` : '지원자 엑셀(설문 결과)을 끌어다 놓으면 두 칸이 자동으로 채워집니다'}
        hint="선택 사항입니다. 이름·연락처는 이 브라우저에만 두고, 서버로는 SNS 아이디만 보냅니다."
        onFiles={(f) => f[0] && void loadFile(f[0])}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {box('ig', igText, setIgText, igParsed)}
        {box('blog', blogText, setBlogText, blogParsed)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon={Rocket} loading={busy} disabled={!total} onClick={onStart}>
          {total ? `${total}개 계정 수집 시작` : '수집 시작'}
        </Button>
        {total > 0 && (
          <span className={clsx('text-sm', est >= LONG_SEC ? 'font-semibold text-warn' : 'text-muted')}>
            예상 소요시간 {fmtDuration(est)} <span className="font-normal text-muted">({detail}, 블로그와 인스타그램은 함께 진행)</span>
          </span>
        )}
      </div>
      <ConfirmLong
        open={asking}
        seconds={est}
        detail={detail}
        onNo={() => setAsking(false)}
        onYes={() => {
          setAsking(false)
          void start()
        }}
      />
    </Panel>
  )
}

// ── 작업 보기 ─────────────────────────────────────────────
function JobView({ id, lanes, connected, onChanged, onDeleted }: { id: string; lanes: Lanes | null; connected: boolean; onChanged: () => void; onDeleted: () => void }) {
  const [job, setJob] = useState<(JobBrief & { items: JobItem[] }) | null>(null)
  const [meta, setMeta] = useState<LocalMeta | null>(null)
  const [tab, setTab] = useState<'ig' | 'blog'>('ig')
  const [busy, setBusy] = useState<string | null>(null)
  const [askRecheck, setAskRecheck] = useState(false)
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    const r = await api<{ job: JobBrief & { items: JobItem[] } }>(`/sns/jobs/${id}`)
    setJob(r.job)
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
        if (alive && j.status === 'running') timer.current = window.setTimeout(tick, 5000)
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

  const people = useMemo(() => ({ ig: new Map(meta?.ig ?? []), blog: new Map(meta?.blog ?? []) }), [meta])
  const ranked = useMemo(() => {
    if (!job) return null
    const done = job.items.filter((x) => x.state === 'done' && x.data)
    const ig = rankIg(done.filter((x) => x.kind === 'ig').map((x) => ({ key: x.key, data: x.data as IgData })))
    // naver.me 짧은 주소는 서버가 찾은 아이디로
    const blog = rankBlog(done.filter((x) => x.kind === 'blog').map((x) => ({ key: x.id ?? x.key, data: x.data as BlogData })))
    return { ig, blog }
  }, [job])

  if (!job || !ranked)
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Spinner /> 작업을 여는 중
      </div>
    )

  const igLeft = job.ig.total - job.ig.done - job.ig.fail
  const blogLeft = job.blog.total - job.blog.done - job.blog.fail
  const igEtaMin = Math.ceil((igLeft * (lanes?.ig.gapMs ?? 19000)) / 60000)
  const pct = (c: Count) => (c.total ? ((c.done + c.fail) / c.total) * 100 : 100)

  const exportXlsx = async () => {
    setBusy('xlsx')
    try {
      const failed: ProblemRow[] = job.items
        .filter((x) => x.state === 'fail')
        .map((x) => {
          const ps = (x.kind === 'ig' ? people.ig : people.blog).get(x.key) ?? []
          return { kind: x.kind === 'ig' ? '인스타그램' : '블로그', people: ps, raw: ps[0]?.raw ?? x.key, reason: x.error ?? '읽지 못함' }
        })
      // 블로그 짧은 주소(naverme:)로 적은 사람은 찾은 아이디로도 이름을 찾을 수 있게
      const blogPeople = new Map(people.blog)
      for (const x of job.items) if (x.kind === 'blog' && x.id && x.id !== x.key && people.blog.has(x.key)) blogPeople.set(x.id, people.blog.get(x.key)!)
      const blob = await buildSelectionWorkbook({
        title: job.title,
        ig: ranked.ig,
        blog: ranked.blog,
        igPeople: people.ig,
        blogPeople,
        problems: [...(meta?.problems ?? []), ...failed],
        pending: { ig: igLeft, blog: blogLeft },
      })
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      downloadBlob(blob, `체험단선발_${(job.title || 'SNS').replace(/[\\/:*?"<>|]/g, '').slice(0, 40)}_${day}.xlsx`)
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
  const noApi = ranked.ig.filter((r) => igMissingReason(r.data) === 'no-api').length
  const personal = ranked.ig.filter((r) => igMissingReason(r.data) === 'personal').length
  const withApi = ranked.ig.length - noApi - personal

  return (
    <div className="mt-2 flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
      {!meta && <Callout tone="info">이 작업을 만든 브라우저가 아니어서 지원자 이름·연락처는 비어 있습니다(서버에는 SNS 아이디만 있습니다).</Callout>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Progress value={pct(job.blog)} label={`블로그 ${job.blog.done + job.blog.fail} / ${job.blog.total}${job.blog.fail ? ` (실패 ${job.blog.fail})` : ''}`} />
          {lanes?.blog.note && job.status === 'running' && blogLeft > 0 && <p className="text-xs text-warn">{lanes.blog.note}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <Progress value={pct(job.ig)} label={`인스타그램 ${job.ig.done + job.ig.fail} / ${job.ig.total}${job.ig.fail ? ` (실패 ${job.ig.fail})` : ''}`} />
          {job.status === 'running' && igLeft > 0 && (
            <p className="text-xs text-muted">
              남은 시간 약 {igEtaMin >= 60 ? `${Math.floor(igEtaMin / 60)}시간 ${igEtaMin % 60}분` : `${igEtaMin}분`}
              {lanes?.ig.note && <span className="text-warn"> · {lanes.ig.note}</span>}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={Download} loading={busy === 'xlsx'} onClick={exportXlsx} disabled={!ranked.ig.length && !ranked.blog.length}>
          엑셀 내려받기{job.status === 'running' ? ' (지금까지)' : ''}
        </Button>
        {job.status === 'running' ? (
          <Button icon={CirclePause} loading={busy === 'stop'} onClick={() => act('stop', () => api(`/sns/jobs/${id}/stop`, { method: 'POST' }))}>
            멈추기
          </Button>
        ) : (
          (job.status === 'stopped' || failCount > 0) && (
            <Button icon={CirclePlay} loading={busy === 'resume'} onClick={() => act('resume', () => api(`/sns/jobs/${id}/resume`, { method: 'POST' }))}>
              {job.status === 'stopped' ? '이어서 수집' : `실패한 ${failCount}개 다시 시도`}
            </Button>
          )
        )}
        <Button
          variant="ghost"
          icon={Trash2}
          className="ml-auto"
          loading={busy === 'del'}
          onClick={() => {
            if (!confirm('이 작업과 모은 숫자를 지울까요?')) return
            void act('del', async () => {
              await api(`/sns/jobs/${id}`, { method: 'DELETE' })
              await del(metaKey(id)).catch(() => {})
              onDeleted()
            })
          }}
        >
          지우기
        </Button>
      </div>

      {noApi > 0 && (
        <Callout tone="warn" title={`인스타그램 ${noApi}명은 반응(좋아요·댓글)을 아직 못 읽었습니다`}>
          인스타그램 API 가 연결되기 전에 모아서 팔로워만 읽었습니다. 그래서 이 사람들의 반응 점수(40)는 실제 반응이 아니라 팔로워 순위로 대신 채운 값입니다(표에서 회색).
          {connected ? (
            <div className="mt-2">
              <Button
                size="sm"
                variant="primary"
                icon={RefreshCw}
                loading={busy === 'recheck'}
                onClick={() => (noApi * IG_SEC(true) >= LONG_SEC ? setAskRecheck(true) : void act('recheck', () => api(`/sns/jobs/${id}/recheck`, { method: 'POST' })))}
              >
                API 로 최근 10개 게시물 반응 다시 읽기 ({noApi}명 · {fmtDuration(noApi * IG_SEC(true))})
              </Button>
              <ConfirmLong
                open={askRecheck}
                seconds={noApi * IG_SEC(true)}
                detail={`인스타그램 ${noApi}명 × 약 ${IG_SEC(true)}초(Meta 공식 API 한도: 시간당 약 200번)`}
                onNo={() => setAskRecheck(false)}
                onYes={() => {
                  setAskRecheck(false)
                  void act('recheck', () => api(`/sns/jobs/${id}/recheck`, { method: 'POST' }))
                }}
              />
            </div>
          ) : (
            <div className="mt-1">
              지금도 API 가 연결되어 있지 않습니다. 관리자 화면 → ‘SNS 연결’에서 연결하면 여기서 다시 읽을 수 있습니다.
            </div>
          )}
        </Callout>
      )}
      {ranked.ig.length > 0 && noApi === 0 && (
        <p className="text-sm text-ink-2">
          인스타그램: 최근 게시물 10개의 좋아요·댓글을 읽은 계정 <b>{withApi}</b>명
          {personal > 0 && <> · 개인 계정이라 팔로워만 읽은 계정 <b>{personal}</b>명(반응 점수는 팔로워 순위로 대신)</>}
        </p>
      )}

      <Tabs
        label="결과"
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'ig', label: `인스타그램 순위 (${ranked.ig.length})`, icon: Camera },
          { value: 'blog', label: `블로그 순위 (${ranked.blog.length})`, icon: NotebookPen },
        ]}
      />
      {tab === 'ig' ? (
        ranked.ig.length ? (
          <div className="max-h-[560px] overflow-auto rounded-md border border-line">
            <table className="num w-full min-w-[980px] text-sm">
              <thead className="sticky top-0 bg-paper text-left text-xs text-muted">
                <tr>
                  {['순위', '이름', '아이디', '팔로워', '평균 좋아요', '평균 댓글', '평균 반응', '참여율', '팔로워(60)', '반응(40)', '총점'].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranked.ig.map((r) => (
                  <tr key={r.key} className="border-t border-line">
                    <td className="px-3 py-1.5 font-bold">{r.rank}</td>
                    <td className="px-3 py-1.5">{[...new Set((people.ig.get(r.key) ?? []).map((p) => p.name).filter(Boolean))].join(', ')}</td>
                    <td className="px-3 py-1.5">
                      <a href={`https://www.instagram.com/${r.key}/`} target="_blank" rel="noreferrer" className="text-brand-ink hover:underline">
                        {r.key}
                      </a>
                    </td>
                    <td className="px-3 py-1.5 text-right">{r.data.followers?.toLocaleString('ko-KR')}</td>
                    {r.data.avgEngagement != null ? (
                      <>
                        <td className="px-3 py-1.5 text-right">{r.data.avgLikes?.toLocaleString('ko-KR')}</td>
                        <td className="px-3 py-1.5 text-right">{r.data.avgComments?.toLocaleString('ko-KR')}</td>
                        <td className="px-3 py-1.5 text-right font-semibold" title={`최근 게시물 ${r.data.postsRead}개 평균`}>
                          {r.data.avgEngagement.toLocaleString('ko-KR')}
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} className="px-3 py-1.5 text-center text-xs text-faint" title={r.data.apiError ?? ''}>
                        {MISSING_LABEL[igMissingReason(r.data) ?? 'no-api']} · 반응 없음
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-right">{r.engagementRate != null ? `${r.engagementRate}%` : ''}</td>
                    <td className="px-3 py-1.5 text-right">{r.followerScore}</td>
                    <td className={clsx('px-3 py-1.5 text-right', r.substituted && 'text-faint')}>{r.engagementScore}</td>
                    <td className="px-3 py-1.5 text-right font-bold">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="아직 읽은 인스타그램 계정이 없습니다">수집이 진행되면 여기에 순위가 쌓입니다.</EmptyState>
        )
      ) : ranked.blog.length ? (
        <div className="max-h-[560px] overflow-auto rounded-md border border-line">
          <table className="num w-full min-w-[820px] text-sm">
            <thead className="sticky top-0 bg-paper text-left text-xs text-muted">
              <tr>
                {['순위', '이름', '아이디', '블로그', '평균 방문자(5일)', '이웃', '방문자(70)', '이웃(30)', '총점'].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.blog.map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="px-3 py-1.5 font-bold">{r.rank}</td>
                  <td className="px-3 py-1.5">{[...new Set((people.blog.get(r.key) ?? []).map((p) => p.name).filter(Boolean))].join(', ')}</td>
                  <td className="px-3 py-1.5">
                    <a href={`https://blog.naver.com/${r.key}`} target="_blank" rel="noreferrer" className="text-brand-ink hover:underline">
                      {r.key}
                    </a>
                  </td>
                  <td className="max-w-48 truncate px-3 py-1.5">{r.data.name}</td>
                  <td className="px-3 py-1.5 text-right" title={r.data.visitors.map((v) => `${v.date.slice(5)} ${v.cnt}`).join(' · ')}>
                    {r.data.avgVisitors?.toLocaleString('ko-KR')}
                  </td>
                  <td className="px-3 py-1.5 text-right">{r.data.neighbors?.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-1.5 text-right">{r.visitorScore}</td>
                  <td className="px-3 py-1.5 text-right">{r.neighborScore}</td>
                  <td className="px-3 py-1.5 text-right font-bold">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="아직 읽은 블로그가 없습니다">수집이 진행되면 여기에 순위가 쌓입니다.</EmptyState>
      )}
      <p className="text-xs text-muted">
        점수는 지원자들 사이에서의 위치(백분위)로 매기므로, 수집이 끝나기 전에는 순위가 조금씩 바뀝니다. 엑셀에는 인스타그램·블로그 지원자 전체의 점수와 순위(평가표 빈칸 포함), 확인이 필요한 지원자, 점수 기준이 들어갑니다.
      </p>
    </div>
  )
}

