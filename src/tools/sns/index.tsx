import clsx from 'clsx'
import { set } from 'idb-keyval'
import { Camera, FileSpreadsheet, LogIn, NotebookPen, RefreshCw, Rocket, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useLoginDialog } from '@/app/LoginDialog'
import { api, ApiError } from '@/lib/api'
import { Badge, Button, Callout, Checkbox, Dialog, Dropzone, Field, Panel, Spinner, Textarea, TextInput, toast } from '@/ui'
import { JobView } from './Evaluate'
import type { ProblemRow } from './excel'
import { linesToApplicants, parseList, readApplicantsXlsx, type Applicant, type SnsKind } from './parse'
import {
  AI_SEC_PER,
  AI_WON_PER,
  BLOG_SEC,
  ConfirmLong,
  estimateSec,
  estimateWithAiSec,
  fmtDuration,
  IG_SEC,
  LONG_SEC,
  metaFileKey,
  metaKey,
  type JobBrief,
  type Lanes,
  type LocalMeta,
} from './shared'

interface Status {
  allowed: boolean
  instagram: { connected: boolean; username: string; expiresAt: string | null } | null
  ai?: { connected: boolean; model: string } | null
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
          비즈니스·크리에이터 계정인 지원자는 정확한 팔로워 수와 평가에 참고할 최근 게시물(날짜·캡션·링크)까지, 개인 계정은 공개 프로필의 팔로워 표기(축약이면 근사값으로 표시)를 읽습니다. 한도(시간당 약 200번)에 맞춰 한 계정에 약 19초씩 걸립니다.
          {ig.expiresAt && ig.expiresAt !== 'never' && <> 토큰은 {new Date(ig.expiresAt).toLocaleDateString('ko-KR')}에 만료됩니다.</>}
        </Callout>
      ) : (
        <Callout tone="warn" title="인스타그램 API 가 아직 연결되지 않았습니다">
          지금은 인스타그램 팔로워를 공개 프로필 표기로만 읽습니다(1.2만처럼 축약되면 근사값). 관리자 화면 → ‘SNS 연결’에서 회사 인스타그램을 연결하면 정확한 팔로워 수와 최근 게시물까지 읽습니다. 블로그 방문자는 연결 없이도 읽습니다.
        </Callout>
      )}

      <NewJob
        connected={Boolean(ig?.connected)}
        aiConnected={Boolean(status.ai?.connected)}
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
                {openId === j.id && <JobView id={j.id} lanes={lanes} connected={Boolean(ig?.connected)} aiConnected={Boolean(status.ai?.connected)} onChanged={refresh} onDeleted={() => setOpenId(null)} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

// ── 새 작업 ───────────────────────────────────────────────
function NewJob({ connected, aiConnected, onCreated }: { connected: boolean; aiConnected: boolean; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [igText, setIgText] = useState('')
  const [blogText, setBlogText] = useState('')
  const [fromFile, setFromFile] = useState<{ ig: Applicant[]; blog: Applicant[]; other: Applicant[]; total: number; name: string; bytes: ArrayBuffer } | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  /** 수집하면서 AI 채점까지 한 번에(AI 키가 연결돼 있을 때) */
  const [withAi, setWithAi] = useState(true)
  const [autoApply, setAutoApply] = useState(true)
  const doAi = aiConnected && withAi

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
      setFromFile({ ...r, name: file.name, bytes: await file.arrayBuffer() })
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
      // AI 채점까지 하면 계정마다 대표 신청서(가장 먼저 접수된 것)의 지원동기·리뷰 링크를 함께 보낸다(이름·연락처는 보내지 않음)
      const people: Record<string, { motive?: string; reviewLink?: string }> = {}
      if (doAi)
        for (const [kind, parsed] of [['ig', igParsed], ['blog', blogParsed]] as const)
          for (const [key, list] of parsed.keys) {
            const rep = list.slice().sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))[0]
            if (rep?.motive !== undefined || rep?.reviewLink) people[`${kind}:${key}`] = { motive: rep.motive, reviewLink: rep.reviewLink }
          }
      const { job } = await api<{ job: JobBrief }>('/sns/jobs', {
        method: 'POST',
        body: { title: title.trim(), instagram: [...igParsed.keys.keys()], blogs: [...blogParsed.keys.keys()], ...(doAi ? { ai: { autoApply, people } } : {}) },
      })
      const problems: ProblemRow[] = [
        ...igParsed.invalid.map((p) => ({ kind: '인스타그램', people: [p], raw: p.raw, reason: '계정 주소가 불분명해 평가 보류' })),
        ...blogParsed.invalid.map((p) => ({ kind: '블로그', people: [p], raw: p.raw, reason: '블로그 주소가 불분명해 평가 보류' })),
        ...(fromFile?.other ?? []).map((p) => ({ kind: '기타 SNS', people: [p], raw: p.raw, reason: '인스타그램·네이버 블로그 주소가 아님(대상 아님)' })),
      ]
      const meta: LocalMeta = { ig: [...igParsed.keys.entries()], blog: [...blogParsed.keys.entries()], problems, fileName: fromFile?.name }
      await set(metaKey(job.id), meta).catch(() => {})
      if (fromFile) await set(metaFileKey(job.id), fromFile.bytes).catch(() => {})
      toast.success(doAi ? '수집과 AI 채점을 시작했습니다. 창을 닫아도 서버에서 계속합니다.' : '수집을 시작했습니다. 창을 닫아도 서버에서 계속 모읍니다.')
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
  const aiWon = total * AI_WON_PER
  const allSec = doAi ? estimateWithAiSec(est, total) : est
  // AI 채점은 비용이 드니 늘 한 번 묻는다
  const onStart = () => (doAi || est >= LONG_SEC ? setAsking(true) : void start())
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
        hint="지원동기 평가·접수 순서·중복 지원 판단에 필요하니 지원자 엑셀로 시작하세요. 이름·연락처·지원동기는 이 브라우저에만 두고 서버로는 SNS 아이디만 보냅니다. 평가 엑셀은 이 원본에 시트를 덧붙여 만듭니다."
        onFiles={(f) => f[0] && void loadFile(f[0])}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {box('ig', igText, setIgText, igParsed)}
        {box('blog', blogText, setBlogText, blogParsed)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon={Rocket} loading={busy} disabled={!total} onClick={onStart}>
          {total ? `${total}개 계정 ${doAi ? '수집 + AI 채점' : '수집'} 시작` : '수집 시작'}
        </Button>
        {aiConnected && <Checkbox checked={withAi} onChange={setWithAi} label="수집이 끝나는 대로 AI 채점까지" />}
        {total > 0 && (
          <span className={clsx('text-sm', allSec >= LONG_SEC ? 'font-semibold text-warn' : 'text-muted')}>
            예상 소요시간 {fmtDuration(allSec)}
            {doAi && ` · AI 비용 약 ₩${aiWon.toLocaleString('ko-KR')}`} <span className="font-normal text-muted">({detail}, 블로그와 인스타그램은 함께 진행)</span>
          </span>
        )}
      </div>
      <ConfirmLong
        open={asking && !doAi}
        seconds={est}
        detail={detail}
        onNo={() => setAsking(false)}
        onYes={() => {
          setAsking(false)
          void start()
        }}
      />
      <Dialog
        open={asking && doAi}
        onClose={() => setAsking(false)}
        size="md"
        title="수집 + AI 채점을 시작할까요?"
        footer={
          <>
            <Button onClick={() => setAsking(false)}>아니오</Button>
            <Button
              variant="primary"
              icon={Rocket}
              loading={busy}
              onClick={() => {
                setAsking(false)
                void start()
              }}
            >
              예, {total}명 진행합니다
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <Callout tone="warn" title={`${total}명 · 예상 비용 약 ₩${aiWon.toLocaleString('ko-KR')} · 예상 시간 ${fmtDuration(allSec)}`}>
            <ul className="list-disc pl-4">
              <li>계정 수집: {detail}</li>
              <li>AI 채점: 수집이 끝난 계정부터 바로 매김(한 명 약 {AI_SEC_PER}초 · ₩{AI_WON_PER} 안팎, Max 요금제와 별도로 API 크레딧 차감)</li>
            </ul>
          </Callout>
          <Checkbox checked={autoApply} onChange={setAutoApply} label="콘텐츠 적합성·리뷰 점수를 빈칸에 바로 적용(담당자가 적은 점수는 그대로)" />
          <p className="text-xs text-muted">
            지원동기는 AI 점수가 바로 쓰입니다. 지원동기와 신청서의 리뷰 링크는 AI 채점을 위해 서버로 보내고, 이름·연락처는 보내지 않습니다. 게시물을 볼 수 없는 계정은 빈칸으로 남습니다. 서버에서 진행하니 창을 닫아도 계속되고, 작업 화면의 ‘멈추기’로 언제든 멈출 수
            있습니다.
          </p>
          <p className="font-semibold text-ink">진행하시겠습니까?</p>
        </div>
      </Dialog>
    </Panel>
  )
}
