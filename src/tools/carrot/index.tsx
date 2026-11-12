import clsx from 'clsx'
import { ArrowUp, AudioLines, Check, ChevronDown, Clapperboard, Clock, CalendarClock, Coins, Copy, Download, Film, Gauge, ImagePlus, Image as ImageIcon, Images, Loader2, Lock, MessagesSquare, Mic, MicOff, Plus, RefreshCw, RotateCcw, Search, Trash2, Volume2, VolumeX, Wand2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '@/lib/api'
import { canvasToBlob, fileToCanvas, fitWithin, resizeCanvas } from '@/lib/image'
import { Button, Callout, Dialog, EmptyState, MenuItem, Popover, Select, Spinner, toast } from '@/ui'
import { choices, dayTitle, daysLeft, DEFAULT_MODEL, DEFAULT_OPTIONS, fitOptions, formatBytes, formatCredits, hasAudio, hasEndFrame, hasStartFrame, maxRefs, modelChipLabel, optionLabel, PLACEHOLDER, ratioCss, ratioLabel, type Job, type Kind, type Model, type Options } from './logic'

interface Info {
  connected: boolean
  keepDays: number
  isAdmin: boolean
  /** 다른 사람 라이브러리를 볼 수 있는가(전체마스터 또는 관리자가 권한을 준 계정) */
  canBrowse?: boolean
  me: { owner: string; ownerName: string }
  models: Model[]
  chat: boolean
}
interface Owner {
  owner: string
  name: string
  username: string
  jobs: number
}
/** 올린 이미지(레퍼런스·프레임) */
interface Upload {
  key: string
  preview: string
  /** 힉스필드 media_id(올리는 중이면 null) */
  id: string | null
  /** 라이브러리 결과면 그 주소(작업 기록의 미리보기로 남긴다) */
  keep?: string
}
interface Account {
  credits: number
  plan: string
  monthly?: number
  lastReset?: string
  nextReset?: string | null
  at: string
}
interface Proposal {
  title?: string
  model: string
  kind: 'image' | 'video'
  prompt: string
  aspect_ratio?: string
  duration?: number
  count: number
}
interface ChatMsg {
  role: 'user' | 'assistant'
  text: string
  proposals?: Proposal[]
}

const PREF = 'onbijjang.carrot'
const loadPref = (): { kind?: Kind; model?: Record<string, string>; options?: Record<string, Options>; count?: number } => {
  try {
    return JSON.parse(localStorage.getItem(PREF) ?? '{}')
  } catch {
    return {}
  }
}
const savePref = (v: object) => {
  try {
    localStorage.setItem(PREF, JSON.stringify(v))
  } catch {
    // 저장 못 해도 화면은 그대로
  }
}

/** 이미지 파일 → 서버로 보낼 data URL(크면 줄여서 JPG) */
async function toDataUrl(file: File): Promise<string> {
  const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  let blob: Blob = file
  if (!ok || file.size > 4 * 1024 * 1024) {
    const c = await fileToCanvas(file)
    const { width, height } = fitWithin(c.width, c.height, 2048)
    blob = await canvasToBlob(width === c.width ? c : resizeCanvas(c, width, height), 'image/jpeg', 0.9)
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'))
    r.readAsDataURL(blob)
  })
}

const message = (err: unknown) => (err instanceof Error ? err.message : '처리하지 못했습니다.')

/** 입력창 아래의 둥근 선택 버튼 */
function Chip({ icon: Icon, children, active, ...rest }: { icon?: typeof Check; children: ReactNode; active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors disabled:opacity-40',
        active ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
        rest.className,
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
      {children}
    </button>
  )
}

/** 고르기 목록(팝오버 안) */
function PickList<T extends string | number>({ title, value, items, onPick }: { title: string; value: T | undefined; items: Array<{ value: T; label: ReactNode; hint?: ReactNode }>; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-col">
      <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-muted">{title}</p>
      {items.map((it) => (
        <button
          key={String(it.value)}
          type="button"
          onClick={() => onPick(it.value)}
          className="flex w-full items-start gap-2 rounded-sm px-2.5 py-2 text-left text-sm text-ink-2 hover:bg-sunken hover:text-ink"
        >
          <Check className={clsx('mt-0.5 size-4 shrink-0 text-brand', String(value) !== String(it.value) && 'invisible')} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{it.label}</span>
            {it.hint && <span className="block text-xs text-muted">{it.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

/** 레퍼런스·시작/끝 프레임 칸 */
function Slot({ label, icon: Icon, upload, onFiles, onRemove, multiple, disabled }: { label: string; icon: typeof Plus; upload?: Upload | null; onFiles: (files: File[]) => void; onRemove?: () => void; multiple?: boolean; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  if (upload)
    return (
      <div className="group relative size-[72px] shrink-0 overflow-hidden rounded-lg border border-line bg-sunken">
        <img src={upload.preview} alt={label} className="size-full object-cover" />
        {!upload.id && (
          <div className="absolute inset-0 grid place-items-center bg-ink/40">
            <Loader2 className="size-5 animate-spin text-white" aria-label="올리는 중" />
          </div>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-ink/55 px-1 py-0.5 text-center text-[10px] font-semibold text-white">{label}</span>
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label={`${label} 빼기`} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-ink/70 text-white opacity-90 hover:bg-ink">
            <X className="size-3" aria-hidden />
          </button>
        )}
      </div>
    )
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="flex size-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong bg-sunken/60 text-xs text-muted transition-colors hover:border-brand hover:text-brand-ink disabled:opacity-40"
      >
        <Icon className="size-4" aria-hidden />
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </>
  )
}

export default function CarrotTool() {
  const [info, setInfo] = useState<Info | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pref = useMemo(loadPref, [])
  const [kind, setKind] = useState<Kind>(pref.kind ?? 'image')
  const [modelBy, setModelBy] = useState<Record<string, string>>(pref.model ?? {})
  const [optionsBy, setOptionsBy] = useState<Record<string, Options>>(pref.options ?? {})
  const [count, setCount] = useState(pref.count ?? 1)
  const [prompt, setPrompt] = useState('')
  const [refs, setRefs] = useState<Upload[]>([])
  const [start, setStart] = useState<Upload | null>(null)
  const [end, setEnd] = useState<Upload | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [owners, setOwners] = useState<Owner[] | undefined>()
  const [ownerView, setOwnerView] = useState('')
  const [busy, setBusy] = useState(false)
  const [credits, setCredits] = useState<number | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [voices, setVoices] = useState<Array<{ id: string; name: string; gender: string; preview: string }> | null>(null)
  const [chatMode, setChatMode] = useState(false)
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [view, setView] = useState<{ job: Job; index: number } | null>(null)
  const feedEnd = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api<Info>('/carrot/models')
      .then(setInfo)
      .catch((err) => setLoadError(err instanceof ApiError && err.status === 401 ? '스탭 이상 계정으로 로그인해야 쓸 수 있습니다.' : message(err)))
  }, [])

  const models = useMemo(() => (info?.models ?? []).filter((m) => m.kind === kind), [info, kind])
  const model = useMemo(() => models.find((m) => m.key === modelBy[kind]) ?? models.find((m) => m.key === DEFAULT_MODEL[kind]) ?? models[0] ?? null, [models, modelBy, kind])
  const options = useMemo(() => (model ? fitOptions(model, optionsBy[model.key] ?? {}, DEFAULT_OPTIONS[model.key]) : {}), [model, optionsBy])
  const setOption = (patch: Options) => model && setOptionsBy((o) => ({ ...o, [model.key]: { ...options, ...patch } }))

  useEffect(() => savePref({ kind, model: modelBy, options: optionsBy, count }), [kind, modelBy, optionsBy, count])

  // ── 라이브러리 불러오기(만드는 중이면 4초마다) ──
  const loadJobs = useCallback(async () => {
    const r = await api<{ jobs: Job[]; owners?: Owner[]; running: boolean }>(`/carrot/jobs${ownerView ? `?owner=${encodeURIComponent(ownerView)}` : ''}`)
    setJobs(r.jobs)
    setOwners(r.owners)
    return r.running
  }, [ownerView])
  const running = jobs.some((j) => j.status === 'running')
  // ── 남은 크레딧·갱신일: 1분마다, 창으로 돌아올 때, 생성·완료 때 새로 ──
  const loadAccount = useCallback((fresh = false) => {
    api<{ account: Account | null }>(`/carrot/account${fresh ? '?fresh=1' : ''}`)
      .then((r) => r.account && setAccount(r.account))
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!info?.connected) return
    loadAccount()
    const t = setInterval(() => loadAccount(), 60_000)
    const onFocus = () => loadAccount()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [info?.connected, loadAccount])
  const doneCount = jobs.filter((j) => j.status !== 'running').length
  useEffect(() => {
    if (info?.connected && doneCount) loadAccount(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount])
  useEffect(() => {
    if (!info) return
    loadJobs().catch(() => {})
  }, [info, loadJobs])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => loadJobs().catch(() => {}), 4000)
    return () => clearInterval(t)
  }, [running, loadJobs])
  // 새 결과·대화가 생기면 맨 아래로
  const lastKey = `${jobs.length}:${jobs.at(-1)?.status}:${chat.length}`
  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [lastKey])

  // ── 비용 어림 ──
  const reqBody = useCallback(
    (over?: Partial<{ model: string; prompt: string; options: Options; count: number }>) => ({
      model: over?.model ?? model?.key,
      prompt: over?.prompt ?? prompt,
      options: over?.options ?? options,
      count: over?.count ?? (kind === 'image' ? count : 1),
      refs: refs.map((r) => r.id).filter(Boolean),
      start: start?.id ?? null,
      end: end?.id ?? null,
      previews: [start, ...refs, end].map((u) => u?.keep).filter(Boolean),
    }),
    [model, prompt, options, count, kind, refs, start, end],
  )
  const estimateKey = JSON.stringify({ ...reqBody(), prompt: prompt ? 'x' : '' })
  useEffect(() => {
    setCredits(null)
    if (!info?.connected || !model || (model.tts && !options.voice)) return
    const t = setTimeout(() => {
      api<{ credits: number | null }>('/carrot/estimate', { method: 'POST', body: { ...reqBody(), prompt: prompt || 'preview' } })
        .then((r) => setCredits(r.credits))
        .catch(() => {})
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateKey, info?.connected])

  // ── 이미지 올리기 ──
  // ── 목소리(음성 TTS) ──
  const loadVoices = () => {
    if (voices) return
    api<{ voices: NonNullable<typeof voices> }>('/carrot/voices')
      .then((r) => setVoices(r.voices))
      .catch((err) => toast.error(message(err)))
  }
  useEffect(() => {
    if (info?.connected && kind === 'audio' && model?.tts) loadVoices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.connected, kind, model?.key])

  const upload = async (file: File, put: (u: Upload | null) => void) => {
    const key = Math.random().toString(36).slice(2)
    const preview = URL.createObjectURL(file)
    put({ key, preview, id: null })
    try {
      const data = await toDataUrl(file)
      const r = await api<{ id: string }>('/carrot/upload', { method: 'POST', body: { data } })
      put({ key, preview, id: r.id })
    } catch (err) {
      put(null)
      toast.error(message(err))
    }
  }
  const limit = model ? maxRefs(model) : 0
  const addRefs = (files: File[]) => {
    const room = Math.max(0, limit - refs.length)
    if (!room) return toast.error(limit ? `이 모델은 레퍼런스를 ${limit}장까지 받습니다.` : '이 모델은 레퍼런스를 받지 않습니다.')
    for (const f of files.slice(0, room)) {
      let mine: string | null = null
      upload(f, (u) =>
        setRefs((list) => {
          if (!u) return list.filter((x) => x.key !== mine)
          mine = u.key
          return list.some((x) => x.key === u.key) ? list.map((x) => (x.key === u.key ? u : x)) : [...list, u]
        }),
      )
    }
  }
  /** 라이브러리 결과를 레퍼런스·시작 프레임으로 */
  const reuse = async (job: Job, index: number, as: 'ref' | 'start') => {
    const it = job.items[index]
    const key = Math.random().toString(36).slice(2)
    const temp: Upload = { key, preview: it.url, id: null, keep: it.url }
    if (as === 'start') {
      setKind('video')
      setStart(temp)
    } else setRefs((l) => [...l, temp])
    try {
      const r = await api<{ id: string }>('/carrot/upload', { method: 'POST', body: { job: job.id, index } })
      const done = { ...temp, id: r.id }
      if (as === 'start') setStart(done)
      else setRefs((l) => l.map((x) => (x.key === key ? done : x)))
      toast.success(as === 'start' ? '영상 시작 프레임으로 넣었습니다.' : '레퍼런스로 넣었습니다.')
    } catch (err) {
      if (as === 'start') setStart(null)
      else setRefs((l) => l.filter((x) => x.key !== key))
      toast.error(message(err))
    }
    textRef.current?.focus()
  }

  const uploading = refs.some((r) => !r.id) || (start && !start.id) || (end && !end.id)

  // ── 끌어다 놓기·Ctrl+V 붙여 넣기: 레퍼런스로(레퍼런스를 안 받는 영상 모델이면 시작 프레임으로) ──
  const [dragOver, setDragOver] = useState(false)
  const takeFiles = (files: File[]) => {
    const images = files.filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type))
    if (!images.length) return false
    if (!info?.connected) {
      toast.error('힉스필드 계정이 연결되어야 이미지를 넣을 수 있습니다.')
      return true
    }
    if (kind === 'audio') {
      toast.error('오디오 탭에서는 이미지를 넣지 않습니다.')
      return true
    }
    if (limit > 0) addRefs(images)
    else if (model && hasStartFrame(model)) upload(images[0], setStart)
    else toast.error('이 모델은 이미지를 받지 않습니다.')
    return true
  }
  const takeRef = useRef(takeFiles)
  takeRef.current = takeFiles
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length && takeRef.current(files)) e.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // ── 생성 ──
  const generate = async (over?: Partial<{ model: string; prompt: string; options: Options; count: number }>) => {
    if (!model) return
    const body = reqBody(over)
    if (!String(body.prompt).trim() && !body.start && !body.refs.length) return toast.error('만들고 싶은 내용을 적어 주세요.')
    setBusy(true)
    try {
      const r = await api<{ job: Job }>('/carrot/generate', { method: 'POST', body })
      setJobs((list) => (ownerView && ownerView !== 'all' && ownerView !== info?.me.owner ? list : [...list, r.job]))
      setTimeout(() => loadAccount(true), 2500)
      if (!over) setPrompt('')
    } catch (err) {
      toast.error(message(err))
    } finally {
      setBusy(false)
    }
  }

  // ── 대화로 생성 ──
  const sendChat = async () => {
    const text = prompt.trim()
    if (!text || chatBusy) return
    const next = [...chat, { role: 'user' as const, text }]
    setChat(next)
    setPrompt('')
    setChatBusy(true)
    try {
      const r = await api<{ reply: string; proposals: Proposal[] }>('/carrot/chat', {
        method: 'POST',
        body: { messages: next.map((m) => ({ role: m.role, text: m.proposals?.length ? `${m.text}\n${m.proposals.map((x, n) => `(생성안 ${n + 1}: ${x.prompt})`).join('\n')}` : m.text })), context: { kind, model: model?.key, refs: refs.length, start: Boolean(start), end: Boolean(end) } },
      })
      setChat((c) => [...c, { role: 'assistant', text: r.reply, proposals: r.proposals ?? [] }])
    } catch (err) {
      setChat((c) => [...c, { role: 'assistant', text: message(err) }])
    } finally {
      setChatBusy(false)
    }
  }
  const runProposal = (p: Proposal) => {
    const m = info?.models.find((x) => x.key === p.model)
    if (!m) return Promise.resolve()
    setKind(m.kind)
    setModelBy((s) => ({ ...s, [m.kind]: m.key }))
    const opts = fitOptions(m, { ...(optionsBy[m.key] ?? {}), ...(p.aspect_ratio ? { aspect_ratio: p.aspect_ratio } : {}), ...(p.duration ? { duration: p.duration } : {}) })
    setOptionsBy((o) => ({ ...o, [m.key]: opts }))
    return generate({ model: m.key, prompt: p.prompt, options: opts, count: m.kind === 'image' ? p.count : 1 })
  }
  const [runningAll, setRunningAll] = useState(false)
  const runAll = async (list: Proposal[]) => {
    setRunningAll(true)
    try {
      for (const p of list) await runProposal(p)
    } finally {
      setRunningAll(false)
    }
  }

  const remove = async (job: Job) => {
    if (!confirm('이 결과를 지울까요? 되돌릴 수 없습니다.')) return
    try {
      await api(`/carrot/jobs/${job.id}`, { method: 'DELETE' })
      setJobs((l) => l.filter((j) => j.id !== job.id))
    } catch (err) {
      toast.error(message(err))
    }
  }
  const reprompt = (job: Job) => {
    setKind(job.kind)
    setModelBy((s) => ({ ...s, [job.kind]: job.model }))
    setOptionsBy((o) => ({ ...o, [job.model]: { ...(o[job.model] ?? {}), ...job.options } }))
    if (job.prompt) setPrompt(job.prompt)
    setChatMode(false)
    textRef.current?.focus()
  }

  // 글자 수만큼 입력창 높이
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(220, el.scrollHeight)}px`
  }, [prompt])

  if (loadError) return <Callout tone="warn" title="당근을 열 수 없습니다">{loadError}</Callout>
  if (!info)
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> 불러오는 중
      </div>
    )

  const ratios = model ? choices(model, 'aspect_ratio').map(String) : []
  const resolutions = model ? choices(model, 'resolution').map(String) : []
  const qualities = model ? choices(model, 'quality').map(String) : []
  const durations = model ? choices(model, 'duration').map(Number) : []
  const modes = model ? choices(model, 'mode').map(String) : []
  const variants = model ? choices(model, 'variant').map(String) : []
  const canGenerate = Boolean(model) && info.connected && !busy && !uploading && !(model?.tts && !options.voice)
  const groups = jobs.reduce<Array<{ title: string; jobs: Job[] }>>((acc, j) => {
    const t = dayTitle(j.createdAt)
    if (acc.at(-1)?.title === t) acc.at(-1)!.jobs.push(j)
    else acc.push({ title: t, jobs: [j] })
    return acc
  }, [])

  return (
    <div className="relative mx-auto flex w-full max-w-[1100px] flex-col">
      {info.connected && <CreditBar account={account} onRefresh={() => loadAccount(true)} />}
      {/* 위: 안내·라이브러리 보기 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Images className="size-4" aria-hidden />
        <span>
          {ownerView === 'all' ? '전체 라이브러리' : ownerView ? `${owners?.find((o) => o.owner === ownerView)?.name ?? ''}님의 라이브러리` : '내 라이브러리'} · 만든 결과는 {info.keepDays}일 동안 보관한 뒤 자동으로 지웁니다
        </span>
        {(info.isAdmin || info.canBrowse) && owners && (
          <Select
            aria-label="라이브러리 보기"
            className="ml-auto w-auto! min-w-44"
            value={ownerView}
            onValue={setOwnerView}
            options={[{ value: '', label: '내 라이브러리' }, { value: 'all', label: info.isAdmin ? '전체 사용자' : '볼 수 있는 전체' }, ...owners.filter((o) => o.owner !== info.me.owner).map((o) => ({ value: o.owner, label: `${o.name}${o.username ? ` (${o.username})` : ''} · ${o.jobs}건` }))]}
          />
        )}
      </div>
      {!info.connected && (
        <Callout tone="warn" title="힉스필드 계정이 아직 연결되지 않았습니다" className="mb-4">
          관리자 화면 → ‘당근 연결’에서 회사 힉스필드 계정으로 한 번 로그인하면 바로 만들 수 있습니다(구독 크레딧 사용, 추가 결제 없음).
        </Callout>
      )}

      {/* 가운데: 결과 피드 */}
      <div className="mx-auto flex min-h-[46vh] w-full max-w-[820px] flex-col gap-6 pb-6">
        {!jobs.length && !chat.length && (
          <div className="grid flex-1 place-items-center py-16">
            <h2 className="text-center text-2xl font-bold sm:text-3xl">무엇을 만들어 볼까요?</h2>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.title} className="flex flex-col gap-5">
            <h3 className="sticky top-0 z-[1] self-center rounded-full bg-paper/90 px-3 py-0.5 text-xs font-semibold text-muted backdrop-blur-sm">{g.title}</h3>
            {g.jobs.map((j) => (
              <JobCard key={j.id} job={j} showOwner={Boolean(ownerView) && ownerView !== info.me.owner} onOpen={(index) => setView({ job: j, index })} onRemove={() => remove(j)} onReprompt={() => reprompt(j)} onReuse={(i, as) => reuse(j, i, as)} canDelete={j.owner === info.me.owner || info.isAdmin} />
            ))}
          </section>
        ))}
        {chatMode &&
          chat.map((m, i) => (
            <div key={i} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={clsx('max-w-[78%] rounded-2xl px-4 py-3 text-base leading-relaxed', m.role === 'user' ? 'bg-brand text-white' : 'border border-line bg-surface text-ink-2')}>
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.proposals && m.proposals.length > 1 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="primary" icon={Wand2} loading={runningAll} disabled={!info.connected || busy || runningAll} onClick={() => runAll(m.proposals!)}>
                      {m.proposals.length}개 모두 생성
                    </Button>
                    <span className="text-xs text-muted">하나씩 보고 고르려면 아래 각 생성안의 ‘이대로 생성’을 누르세요.</span>
                  </div>
                )}
                {m.proposals?.map((pr, n) => (
                  <div key={n} className="mt-2.5 rounded-lg border border-line bg-paper p-3 text-ink">
                    <p className="text-[14px] font-semibold text-muted">
                      생성안{m.proposals!.length > 1 ? ` ${n + 1}` : ''}
                      {pr.title ? ` · ${pr.title}` : ''} · {info.models.find((x) => x.key === pr.model)?.label}
                      {pr.aspect_ratio ? ` · ${ratioLabel(pr.aspect_ratio)}` : ''}
                      {pr.duration && pr.kind === 'video' ? ` · ${pr.duration}초` : ''}
                      {pr.kind === 'image' ? ` · ${pr.count}개` : ''}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap font-mono text-[14px] leading-relaxed">{pr.prompt}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" icon={Wand2} disabled={!info.connected || busy || runningAll} onClick={() => runProposal(pr)}>
                        이대로 생성
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Copy}
                        onClick={() => {
                          setChatMode(false)
                          setPrompt(pr.prompt)
                        }}
                      >
                        입력창에 넣기
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        {chatMode && chatBusy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> 생각하는 중
          </div>
        )}
        <div ref={feedEnd} className="scroll-mb-72" />
      </div>

      {/* 아래: 입력창 */}
      <div className="sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-paper from-70% to-transparent px-4 pb-3 pt-6 sm:-mx-6 sm:px-6">
        <div className="mx-auto w-full max-w-[820px]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div role="tablist" aria-label="만들 종류" className="inline-flex rounded-full bg-sunken p-1 shadow-1">
            {(
              [
                ['image', '이미지', ImageIcon],
                ['video', '영상', Film],
                ['audio', '오디오', AudioLines],
              ] as const
            ).map(([k, label, Icon]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={clsx('inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-colors sm:px-4', kind === k ? 'bg-surface text-ink shadow-1' : 'text-muted hover:text-ink')}
              >
                <Icon className="hidden size-4 sm:block" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <Chip icon={MessagesSquare} active={chatMode} onClick={() => setChatMode((v) => !v)} title={info.chat ? undefined : 'Claude 키가 있어야 합니다'} disabled={!info.chat}>
            대화로 생성
          </Chip>
        </div>
        <div
          className={clsx('relative rounded-2xl border bg-surface p-3 shadow-3 transition-colors sm:p-4', dragOver ? 'border-brand ring-2 ring-brand/30' : 'border-line')}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return
            e.preventDefault()
            setDragOver(false)
            if (!takeFiles([...e.dataTransfer.files])) toast.error('JPG·PNG·WEBP·GIF 이미지만 넣을 수 있습니다.')
          }}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-brand-soft/85 text-sm font-semibold text-brand-ink">
              {kind === 'audio' ? '오디오 탭에서는 이미지를 넣지 않습니다' : limit > 0 ? '여기에 놓으면 레퍼런스로 넣습니다' : '여기에 놓으면 시작 프레임으로 넣습니다'}
            </div>
          )}
            <>
              {kind !== 'audio' && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {refs.map((r, i) => (
                  <Slot key={r.key} label={`레퍼런스 ${i + 1}`} icon={Plus} upload={r} onFiles={() => {}} onRemove={() => setRefs((l) => l.filter((x) => x.key !== r.key))} />
                ))}
                {(refs.length < limit || !limit) && <Slot label="레퍼런스" icon={Plus} onFiles={addRefs} multiple disabled={!limit || !info.connected} />}
                {model && hasStartFrame(model) && (
                  <>
                    <div className="mx-1 w-px shrink-0 self-stretch bg-line" />
                    <Slot label="시작 프레임" icon={ImagePlus} upload={start} disabled={!info.connected} onFiles={(f) => upload(f[0], setStart)} onRemove={() => setStart(null)} />
                    {hasEndFrame(model) && <Slot label="끝 프레임" icon={ImagePlus} upload={end} disabled={!info.connected} onFiles={(f) => upload(f[0], setEnd)} onRemove={() => setEnd(null)} />}
                  </>
                )}
              </div>
              )}
              <textarea
                ref={textRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    if (chatMode) sendChat()
                    else if (canGenerate) generate()
                  }
                }}
                rows={2}
                placeholder={chatMode ? '어떤 걸 만들고 싶은지 편하게 말해 주세요. 함께 프롬프트를 다듬어 드립니다' : kind === 'audio' ? PLACEHOLDER[kind] : `${PLACEHOLDER[kind]} (이미지는 끌어다 놓거나 Ctrl+V 로 붙여 넣기)`}
                aria-label="프롬프트"
                className="mt-2 block w-full resize-none border-0 bg-transparent px-1 py-1 text-[17px] leading-relaxed text-ink outline-none placeholder:text-muted focus:outline-none"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {model && (
                  <Popover
                    trigger={(p) => <ChipTrigger p={p} icon={Clapperboard} label={modelChipLabel(model, options)} />}
                    className="w-[340px]"
                  >
                    {(close) => (
                      <div className="flex flex-col">
                        <ModelPicker
                          title={kind === 'image' ? '이미지 모델' : kind === 'video' ? '영상 모델' : '오디오 모델'}
                          value={model.key}
                          models={models}
                          onPick={(k) => {
                            setModelBy((s) => ({ ...s, [kind]: k }))
                            close()
                          }}
                        />
                        {qualities.length > 0 && (
                          <div className="mt-1 border-t border-line pt-1">
                            <PickList title="품질" value={options.quality} items={qualities.map((q) => ({ value: q, label: optionLabel(q) }))} onPick={(q) => setOption({ quality: q })} />
                          </div>
                        )}
                      </div>
                    )}
                  </Popover>
                )}
                {kind === 'image' && (
                  <Popover trigger={(p) => <ChipTrigger p={p} icon={Copy} label={`${count}개`} />} className="w-44">
                    {(close) => (
                      <PickList
                        title="생성 개수"
                        value={count}
                        items={[1, 2, 3, 4].map((n) => ({ value: n, label: `${n}개` }))}
                        onPick={(n) => {
                          setCount(n)
                          close()
                        }}
                      />
                    )}
                  </Popover>
                )}
                {ratios.length > 1 && (
                  <Popover trigger={(p) => <ChipTrigger p={p} label={ratioLabel(options.aspect_ratio ?? ratios[0])} ratio={options.aspect_ratio} />} className="w-48">
                    {(close) => (
                      <PickList
                        title="비율"
                        value={options.aspect_ratio}
                        items={ratios.map((r) => ({ value: r, label: ratioLabel(r) }))}
                        onPick={(r) => {
                          setOption({ aspect_ratio: r })
                          close()
                        }}
                      />
                    )}
                  </Popover>
                )}
                {resolutions.length > 1 && (
                  <Popover trigger={(p) => <ChipTrigger p={p} label={String(options.resolution ?? resolutions[0]).toUpperCase()} />} className="w-40">
                    {(close) => (
                      <PickList
                        title="해상도"
                        value={options.resolution}
                        items={resolutions.map((r) => ({ value: r, label: r.toUpperCase() }))}
                        onPick={(r) => {
                          setOption({ resolution: r })
                          close()
                        }}
                      />
                    )}
                  </Popover>
                )}
                {kind === 'video' && durations.length > 0 && (
                  <Popover trigger={(p) => <ChipTrigger p={p} label={`${options.duration ?? durations[0]}초`} />} className="w-36">
                    {(close) => (
                      <PickList
                        title="길이"
                        value={options.duration}
                        items={durations.map((d) => ({ value: d, label: `${d}초` }))}
                        onPick={(d) => {
                          setOption({ duration: d })
                          close()
                        }}
                      />
                    )}
                  </Popover>
                )}
                {kind === 'video' && modes.length > 1 && (
                  <Popover trigger={(p) => <ChipTrigger p={p} icon={Gauge} label={optionLabel(options.mode ?? modes[0])} />} className="w-40">
                    {(close) => (
                      <PickList
                        title="모드"
                        value={options.mode}
                        items={modes.map((m) => ({ value: m, label: optionLabel(m) }))}
                        onPick={(m) => {
                          setOption({ mode: m })
                          close()
                        }}
                      />
                    )}
                  </Popover>
                )}
                {kind !== 'image' && variants.length > 1 && (
                  <Popover trigger={(p) => <ChipTrigger p={p} label={variantLabel(options.variant ?? variants[0])} />} className="w-48">
                    {(close) => (
                      <PickList
                        title="버전"
                        value={options.variant}
                        items={variants.map((v) => ({ value: v, label: variantLabel(v) }))}
                        onPick={(v) => {
                          setOption({ variant: v })
                          close()
                        }}
                      />
                    )}
                  </Popover>
                )}
                {kind === 'audio' && model?.tts && (
                  <Popover
                    trigger={(p) => (
                      <ChipTrigger
                        p={{
                          ...p,
                          onClick: () => {
                            loadVoices()
                            p.onClick()
                          },
                        }}
                        icon={Mic}
                        label={voices?.find((v) => v.id === options.voice)?.name ?? '목소리 고르기'}
                      />
                    )}
                    className="w-64"
                  >
                    {(close) =>
                      !voices ? (
                        <div className="flex items-center gap-2 p-3 text-sm text-muted">
                          <Spinner /> 목소리 불러오는 중
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-muted">목소리 (미리 듣기: ▶)</p>
                          {voices.map((v) => (
                            <div key={v.id} className="flex items-center gap-1 rounded-sm hover:bg-sunken">
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm text-ink-2"
                                onClick={() => {
                                  setOption({ voice: v.id })
                                  close()
                                }}
                              >
                                <Check className={clsx('size-4 shrink-0 text-brand', options.voice !== v.id && 'invisible')} aria-hidden />
                                <span className="font-medium">{v.name}</span>
                                <span className="text-xs text-muted">{v.gender === 'male' ? '남성' : v.gender === 'female' ? '여성' : ''}</span>
                              </button>
                              {v.preview && (
                                <button type="button" className="px-2 text-xs text-brand-ink hover:underline" aria-label={`${v.name} 미리 듣기`} onClick={() => new Audio(v.preview).play().catch(() => {})}>
                                  ▶
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    }
                  </Popover>
                )}
                {kind === 'audio' && model && !model.tts && durations.length > 0 && (
                  <Popover trigger={(p) => <ChipTrigger p={p} icon={Clock} label={`${options.duration ?? 30}초`} />} className="w-36">
                    {(close) => (
                      <PickList
                        title="길이"
                        value={options.duration}
                        items={durations.map((d) => ({ value: d, label: `${d}초` }))}
                        onPick={(d) => {
                          setOption({ duration: d })
                          close()
                        }}
                      />
                    )}
                  </Popover>
                )}
                {kind === 'audio' && model?.params.force_instrumental && (
                  <Chip icon={options.instrumental ? MicOff : Mic} active={options.instrumental} onClick={() => setOption({ instrumental: !options.instrumental })} aria-pressed={Boolean(options.instrumental)}>
                    {options.instrumental ? '보컬 없음' : '보컬 있음'}
                  </Chip>
                )}
                {kind === 'video' && model && hasAudio(model) && (
                  <Chip icon={options.audio ? Volume2 : VolumeX} active={options.audio} onClick={() => setOption({ audio: !options.audio })} aria-pressed={Boolean(options.audio)}>
                    {options.audio ? '소리 켬' : '소리 끔'}
                  </Chip>
                )}
                <div className="ml-auto flex items-center gap-3">
                  {credits != null && !chatMode && <span className="text-xs text-muted" title="힉스필드가 알려 준 예상 크레딧(회사 구독 크레딧에서 빠짐)">예상 {formatCredits(credits)}</span>}
                  {chatMode ? (
                    <Button variant="primary" icon={ArrowUp} loading={chatBusy} disabled={!prompt.trim()} onClick={sendChat}>
                      보내기
                    </Button>
                  ) : (
                    <Button variant="primary" icon={Wand2} loading={busy} disabled={!canGenerate} onClick={() => generate()}>
                      생성하기
                    </Button>
                  )}
                </div>
              </div>
            </>
        </div>
      </div>

      </div>
      <Lightbox view={view} onClose={() => setView(null)} onMove={(index) => view && setView({ ...view, index })} />
    </div>
  )
}

const VARIANT: Record<string, string> = { elevenlabs: 'ElevenLabs', minimax: 'MiniMax', seed_speech: 'Seed Speech', vibe_voice: 'Vibe Voice', cozy_voice: 'Cozy Voice' }
const variantLabel = (v: string) => VARIANT[v] ?? v.replace(/^veo-3-1-/, 'Veo 3.1 ').replace('preview', '최고 품질').replace('fast', '빠름')

/** 라이브러리 미리보기 크기(픽셀). 한 장일 때 / 여러 장일 때. 어떤 경우에도 1000을 넘지 않는다 */
const MEDIA_MAX = { w: 460, h: 460 }
const MEDIA_MAX_MANY = { w: 340, h: 380 }
/** 비율에 맞춰 가로·세로 상한 안에 들어가는 미리보기 상자 */
function mediaBox(ratio: string | undefined, single: boolean): { px: number; aspectRatio?: string; width?: string; maxWidth?: number; maxHeight?: number } {
  const lim = single ? MEDIA_MAX : MEDIA_MAX_MANY
  const m = /^(\d+):(\d+)$/.exec(ratio ?? '')
  if (!m) return { px: Math.min(lim.w, 1000), maxWidth: Math.min(lim.w, 1000), maxHeight: Math.min(lim.h, 1000) }
  const r = Number(m[1]) / Number(m[2])
  const w = Math.round(Math.min(lim.w, lim.h * r, 1000, 1000 * r))
  return { px: w, aspectRatio: ratioCss(ratio), width: `min(100%, ${w}px)` }
}

/** 남은 크레딧·다음 갱신까지 남은 기간 */
function CreditBar({ account, onRefresh }: { account: Account | null; onRefresh: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  if (!account) return <div className="skeleton mb-3 h-[52px] rounded-xl" aria-label="크레딧 불러오는 중" />
  const left = account.nextReset ? Date.parse(account.nextReset) - now : null
  const days = left != null ? Math.floor(left / 864e5) : null
  const hours = left != null ? Math.floor((left % 864e5) / 36e5) : null
  const pct = account.monthly ? Math.max(0, Math.min(100, (account.credits / account.monthly) * 100)) : null
  const low = account.monthly ? account.credits < account.monthly * 0.1 : account.credits < 100
  const resetText = account.nextReset ? new Date(account.nextReset).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }) : null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-surface px-4 py-2.5">
      <div className="flex min-w-[220px] flex-1 items-center gap-3">
        <Coins className={clsx('size-5 shrink-0', low ? 'text-warn' : 'text-brand')} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] text-ink-2">
            남은 크레딧 <b className={clsx('text-lg tabular-nums', low ? 'text-warn' : 'text-ink')}>{account.credits.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}</b>
            {account.monthly ? <span className="text-muted"> / {account.monthly.toLocaleString('ko-KR')}</span> : null}
            {account.plan && <span className="ml-1.5 rounded-full bg-sunken px-2 py-0.5 text-xs font-semibold uppercase text-muted">{account.plan}</span>}
          </p>
          {pct != null && (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="이번 달 남은 크레딧 비율">
              <div className={clsx('h-full rounded-full', low ? 'bg-warn' : 'bg-brand')} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>
      {resetText && days != null && hours != null && (
        <div className="flex items-center gap-2 text-[15px] text-ink-2">
          <CalendarClock className="size-5 shrink-0 text-muted" aria-hidden />
          <span>
            갱신까지 <b className="text-ink">{days > 0 ? `${days}일 ${hours}시간` : `${Math.max(0, hours)}시간`}</b>
            <span className="text-muted"> · {resetText}</span>
          </span>
        </div>
      )}
      <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted hover:bg-sunken hover:text-ink" title={`마지막 확인 ${new Date(account.at).toLocaleTimeString('ko-KR')}`}>
        <RefreshCw className="size-4" aria-hidden /> 새로 보기
      </button>
      {resetText && <p className="w-full text-xs text-muted">갱신 때 쓰지 않은 구독 크레딧은 사라지고 {account.monthly ? `${account.monthly.toLocaleString('ko-KR')}크레딧으로` : ''} 다시 채워집니다(힉스필드 거래 내역 기준으로 계산한 날짜).</p>}
    </div>
  )
}

/** 모델 고르기(검색 칸 + 목록) */
function ModelPicker({ title, value, models, onPick }: { title: string; value: string; models: Model[]; onPick: (key: string) => void }) {
  const [q, setQ] = useState('')
  const list = q.trim() ? models.filter((m) => `${m.label} ${m.key} ${m.provider} ${m.note}`.toLowerCase().includes(q.trim().toLowerCase())) : models
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-2.5 pb-2 pt-1">
        <Search className="size-4 text-muted" aria-hidden />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${title} 찾기 (${models.length}개)`} aria-label={`${title} 찾기`} className="w-full bg-transparent text-sm outline-none placeholder:text-muted" />
      </div>
      <div className="max-h-[46dvh] overflow-auto">
        <PickList title={title} value={value} items={list.map((m) => ({ value: m.key, label: m.label, hint: [m.provider, m.note].filter(Boolean).join(' · ') }))} onPick={onPick} />
        {!list.length && <p className="px-3 py-4 text-sm text-muted">맞는 모델이 없습니다.</p>}
      </div>
    </div>
  )
}

/** 팝오버를 여는 칩 */
function ChipTrigger({ p, label, icon, ratio }: { p: { onClick: () => void; 'aria-expanded': boolean; ref: (el: HTMLElement | null) => void }; label: string; icon?: typeof Check; ratio?: string }) {
  const Icon = icon
  return (
    <button
      type="button"
      ref={p.ref}
      onClick={p.onClick}
      aria-expanded={p['aria-expanded']}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
    >
      {Icon ? <Icon className="size-4" aria-hidden /> : ratio !== undefined && <span className="inline-block w-3.5 rounded-[3px] border-[1.5px] border-current" style={{ aspectRatio: ratioCss(ratio) }} aria-hidden />}
      {label}
      <ChevronDown className="size-3.5" aria-hidden />
    </button>
  )
}

function JobCard({ job, showOwner, onOpen, onRemove, onReprompt, onReuse, canDelete }: { job: Job; showOwner: boolean; onOpen: (i: number) => void; onRemove: () => void; onReprompt: () => void; onReuse: (i: number, as: 'ref' | 'start') => void; canDelete: boolean }) {
  const o = job.options ?? {}
  const meta = [job.modelLabel, o.quality && optionLabel(o.quality), o.aspect_ratio && ratioLabel(o.aspect_ratio), job.kind !== 'image' && o.duration ? `${o.duration}초` : null, o.resolution?.toUpperCase(), o.mode && job.kind === 'video' ? optionLabel(o.mode) : null].filter(Boolean).join(' · ')
  const left = daysLeft(job.expiresAt)
  const placeholders = job.status === 'running' ? Math.max(0, job.count - job.items.length) : 0
  const box = mediaBox(o.aspect_ratio, job.count <= 1)
  // 결과 묶음 폭을 이미지 줄 폭에 맞춘다(말풍선이 이미지 바로 위 오른쪽에 오게). 최소 560px
  const n = Math.max(1, job.count, job.items.length)
  const rowW = job.kind === 'audio' ? 820 : Math.max(560, n * box.px + (n - 1) * 12)
  return (
    <article className="flex flex-col gap-2" style={{ width: `min(100%, ${rowW}px)` }}>
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-brand-soft px-4 py-3 text-base text-brand-ink">
          {job.refs.length > 0 && (
            <div className="mb-1.5 flex gap-1.5">
              {job.refs.slice(0, 6).map((u) => (
                <img key={u} src={u} alt="" className="size-14 rounded-md border border-line object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              ))}
            </div>
          )}
          {job.promptHidden ? (
            <p className="flex items-center gap-1.5 text-muted">
              <Lock className="size-4 shrink-0" aria-hidden /> 프롬프트는 작성자만 볼 수 있습니다
            </p>
          ) : (
            <p className="whitespace-pre-wrap leading-relaxed">{job.prompt || '(프롬프트 없음)'}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
        {showOwner && <span className="rounded-full bg-sunken px-2 py-0.5 font-semibold text-ink-2">{job.ownerName}</span>}
        <span>{meta}</span>
        <span>· {new Date(job.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
        {job.credits != null && <span>· {formatCredits(job.credits)}</span>}
        <span className={clsx(left <= 1 && 'text-warn')}>· {left ? `${left}일 뒤 자동 삭제` : '오늘 자동 삭제'}</span>
        <span className="ml-auto flex gap-1">
          {!job.promptHidden && (
            <button type="button" onClick={onReprompt} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-sunken hover:text-ink" title="이 설정으로 다시 쓰기">
              <RotateCcw className="size-4" aria-hidden /> 다시 쓰기
            </button>
          )}
          {canDelete && (
            <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-danger-soft hover:text-danger" title="지우기">
              <Trash2 className="size-4" aria-hidden /> 지우기
            </button>
          )}
        </span>
      </div>
      {job.error && <p className="text-[14px] text-warn">{job.error}</p>}
      {(job.items.length > 0 || placeholders > 0) && (
        <div className={clsx(job.kind === 'audio' ? 'grid grid-cols-1 gap-3' : 'flex flex-wrap items-start gap-3')}>
          {job.items.map((it, i) => (
            <div key={it.url} className="group relative max-w-full overflow-hidden rounded-xl border border-line bg-sunken" style={it.type === 'audio' ? undefined : { aspectRatio: box.aspectRatio, width: box.width }}>
              {it.type === 'audio' ? (
                <div className="flex items-center gap-3 p-3 pr-24">
                  <AudioLines className="size-5 shrink-0 text-brand" aria-hidden />
                  <audio src={it.url} controls preload="metadata" className="h-10 w-full" />
                </div>
              ) : it.type === 'video' ? (
                <video src={it.url} controls preload="metadata" playsInline className="block h-full w-full bg-ink object-contain" style={box.aspectRatio ? undefined : { maxHeight: MEDIA_MAX.h }} />
              ) : (
                <button type="button" onClick={() => onOpen(i)} className="block w-full" aria-label="크게 보기">
                  <img src={it.url} alt={job.prompt ? job.prompt.slice(0, 60) : `${job.ownerName}님의 결과`} loading="lazy" className={clsx('block', box.aspectRatio ? 'h-full w-full object-cover' : 'h-auto w-auto object-contain')} style={box.aspectRatio ? undefined : { maxWidth: box.maxWidth, maxHeight: box.maxHeight }} />
                </button>
              )}
              <div className={clsx('absolute right-1.5 flex gap-1 transition-opacity', it.type === 'audio' ? 'top-1/2 -translate-y-1/2' : 'top-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')}>
                <a href={`${it.url}?download=1`} className="grid size-8 place-items-center rounded-full bg-ink/70 text-white hover:bg-ink" title={`내려받기 (${formatBytes(it.size)})`} aria-label="내려받기">
                  <Download className="size-4" aria-hidden />
                </a>
                {it.type === 'image' && (
                  <Popover
                    align="end"
                    trigger={(p) => (
                      <button type="button" ref={p.ref} onClick={p.onClick} aria-expanded={p['aria-expanded']} className="grid size-8 place-items-center rounded-full bg-ink/70 text-white hover:bg-ink" aria-label="이 이미지로">
                        <Plus className="size-4" aria-hidden />
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuItem
                          icon={ImagePlus}
                          onClick={() => {
                            close()
                            onReuse(i, 'ref')
                          }}
                        >
                          레퍼런스로 쓰기
                        </MenuItem>
                        <MenuItem
                          icon={Film}
                          onClick={() => {
                            close()
                            onReuse(i, 'start')
                          }}
                        >
                          이 이미지로 영상 만들기
                        </MenuItem>
                      </>
                    )}
                  </Popover>
                )}
              </div>
            </div>
          ))}
          {Array.from({ length: placeholders }, (_, i) => (
            <div key={`p${i}`} className="skeleton grid max-w-full place-items-center rounded-xl text-xs font-semibold text-muted" style={job.kind === 'audio' ? { aspectRatio: '8 / 1' } : { aspectRatio: box.aspectRatio ?? '1 / 1', width: box.width ?? `min(100%, ${MEDIA_MAX.w}px)` }}>
              <span className="flex items-center gap-1.5 rounded-full bg-surface/80 px-2.5 py-1">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {job.kind === 'video' ? '영상 만드는 중(몇 분 걸려요)' : job.kind === 'audio' ? '오디오 만드는 중' : '만드는 중'}
              </span>
            </div>
          ))}
        </div>
      )}
      {job.status !== 'running' && !job.items.length && (
        <EmptyState title={job.status === 'nsfw' ? '내용 검수에 걸려 만들지 못했습니다' : '만들지 못했습니다'} className="py-6">
          실패하거나 검수에 걸린 요청은 크레딧이 빠지지 않습니다. 프롬프트를 바꿔 다시 해 보세요.
        </EmptyState>
      )}
    </article>
  )
}

function Lightbox({ view, onClose, onMove }: { view: { job: Job; index: number } | null; onClose: () => void; onMove: (i: number) => void }) {
  const it = view?.job.items[view.index]
  const n = view?.job.items.length ?? 0
  useEffect(() => {
    if (!view) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && view.index < n - 1) onMove(view.index + 1)
      if (e.key === 'ArrowLeft' && view.index > 0) onMove(view.index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, n, onMove])
  return (
    <Dialog
      open={Boolean(it)}
      onClose={onClose}
      size="xl"
      title={view ? `${view.job.modelLabel} · ${view.index + 1}/${n}` : ''}
      footer={
        it && (
          <>
            <p className="mr-auto line-clamp-2 max-w-[70%] text-xs text-muted">{view?.job.promptHidden ? `${view.job.ownerName}님의 결과 · 프롬프트는 작성자만 볼 수 있습니다` : view?.job.prompt}</p>
            {!view?.job.promptHidden && (
            <Button
              size="sm"
              icon={Copy}
              onClick={() => {
                navigator.clipboard.writeText(view?.job.prompt ?? '').then(() => toast.success('프롬프트를 복사했습니다.'))
              }}
            >
              프롬프트 복사
            </Button>
            )}
            <a href={`${it.url}?download=1`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-strong">
              <Download className="size-4" aria-hidden /> 내려받기 ({formatBytes(it.size)})
            </a>
          </>
        )
      }
    >
      {it && <img src={it.url} alt="" className="mx-auto max-h-[min(70dvh,1000px)] max-w-[min(100%,1000px)] w-auto object-contain" />}
    </Dialog>
  )
}
