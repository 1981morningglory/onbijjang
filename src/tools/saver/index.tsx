import clsx from 'clsx'
import { AlertTriangle, Clapperboard, Download, FileText, Link2, Music, Plus, RotateCcw, Scissors, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { usePersistentState } from '@/lib/hooks'
import { Badge, Button, Callout, EmptyState, Field, IconButton, Panel, Progress, Section, Segmented, Select, SendToMenu, Spinner, Stage, Switch, TextInput, ToolLayout, toast } from '@/ui'
import { AUDIO_FORMATS, BITRATES, TEXT_FORMATS, VIDEO_FORMATS, extractUrl, formatTime, keptRanges, parseTime, siteOf, youtubeId, type EditMode, type Kind } from './logic'

const K = (n: string) => `onbijjang:saver:${n}`

interface Info {
  url: string
  id: string
  site: string
  title: string
  uploader: string
  duration: number
  thumbnail: string
  webpage: string
  isLive: boolean
  hasVideo: boolean
  heights: number[]
  subtitles: string[]
  autoCaptions: string[]
}
interface Job {
  id: string
  status: 'queued' | 'running' | 'done' | 'error'
  stage: string
  progress: number
  error: string | null
  filename?: string
  size?: number
  position: number
}
interface RangeText {
  start: string
  end: string
}

const LANG_NAME: Record<string, string> = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', 'zh-Hans': '중국어(간체)', 'zh-Hant': '중국어(번체)' }
const langLabel = (k: string, auto: boolean) => `${LANG_NAME[k] ?? LANG_NAME[k.split('-')[0]] ?? k}${auto ? ' (자동 생성)' : ''}`
const fmtBytes = (n?: number) => (!n ? '' : n > 1e9 ? `${(n / 1e9).toFixed(2)}GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1e3))}KB`)

/** 남는 구간을 막대로 보여준다 */
function Timeline({ duration, kept }: { duration: number; kept: Array<[number, number]> }) {
  if (!duration) return null
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-3 overflow-hidden rounded-full bg-danger-soft" aria-hidden>
        {kept.map(([s, e], i) => (
          <span key={i} className="absolute inset-y-0 rounded-full bg-brand" style={{ left: `${(s / duration) * 100}%`, width: `${Math.max(0.5, ((e - s) / duration) * 100)}%` }} />
        ))}
      </div>
      <div className="num flex justify-between text-2xs text-muted">
        <span>0:00</span>
        <span>
          남는 길이 <b className="text-ink">{formatTime(kept.reduce((a, [s, e]) => a + e - s, 0))}</b> / {formatTime(duration)}
        </span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}

export default function SaverTool() {
  const [input, setInput] = useState('')
  const [info, setInfo] = useState<Info | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [infoErr, setInfoErr] = useState('')
  const [status, setStatus] = useState<{ ready: boolean; installing: boolean; error: string | null } | null>(null)
  const [authErr, setAuthErr] = useState('')

  const [kind, setKind] = usePersistentState<Kind>(K('kind'), 'video')
  const [vfmt, setVfmt] = usePersistentState(K('vfmt'), 'mp4')
  const [afmt, setAfmt] = usePersistentState(K('afmt'), 'mp3')
  const [tfmt, setTfmt] = usePersistentState(K('tfmt'), 'txt')
  const [height, setHeight] = usePersistentState(K('height'), '0')
  const [abr, setAbr] = usePersistentState(K('abr'), '192')
  const [subLang, setSubLang] = useState('')
  const [editOn, setEditOn] = useState(false)
  const [mode, setMode] = useState<EditMode>('keep')
  const [ranges, setRanges] = useState<RangeText[]>([{ start: '', end: '' }])

  const [job, setJob] = useState<Job | null>(null)
  const poll = useRef<number | null>(null)

  useEffect(() => {
    api<{ ready: boolean; installing: boolean; error: string | null }>('/media/status')
      .then(setStatus)
      .catch((e) => setAuthErr(e instanceof ApiError && e.status === 401 ? e.message : e instanceof ApiError && e.status === 0 ? '서버에 연결할 수 없습니다.' : ''))
    return () => {
      if (poll.current) window.clearInterval(poll.current)
    }
  }, [])

  const duration = info?.duration ?? 0
  const parsed = ranges.map((r) => ({ start: parseTime(r.start), end: parseTime(r.end) }))
  const rangeErr = editOn
    ? parsed.some((r, i) => (ranges[i].start || ranges[i].end) && (r.start == null || r.end == null))
      ? '시간은 1:23 이나 01:02:03 처럼 적어 주세요.'
      : parsed.some((r) => r.start != null && r.end != null && r.end <= r.start)
        ? '끝 시간은 시작 시간보다 뒤여야 합니다.'
        : mode === 'cut' && !duration
          ? '이 영상은 길이를 알 수 없어 [잘라내기]를 쓸 수 없습니다. [남기기]를 쓰세요.'
          : ''
    : ''
  const validRanges = parsed.filter((r): r is { start: number; end: number } => r.start != null && r.end != null && r.end > r.start)
  const kept = useMemo(() => (editOn && validRanges.length ? keptRanges(mode, validRanges, duration) : duration ? [[0, duration] as [number, number]] : []), [editOn, mode, JSON.stringify(validRanges), duration])
  const editActive = editOn && validRanges.length > 0 && !rangeErr
  const ytId = info ? youtubeId(info.webpage || info.url) : null

  const subOptions = useMemo(() => {
    if (!info) return []
    const manual = info.subtitles.map((k) => ({ value: k, label: langLabel(k, false) }))
    const auto = info.autoCaptions.filter((k) => !info.subtitles.includes(k)).map((k) => ({ value: k, label: langLabel(k, true) }))
    return [...manual, ...auto]
  }, [info])
  useEffect(() => {
    if (!subOptions.length) return setSubLang('')
    const ko = subOptions.find((o) => o.value === 'ko' || o.value.startsWith('ko'))
    setSubLang((ko ?? subOptions[0]).value)
  }, [subOptions])

  const heightOptions = useMemo(() => {
    const hs = info?.heights ?? []
    return [{ value: '0', label: '최고 화질' }, ...[2160, 1440, 1080, 720, 480, 360].filter((h) => !hs.length || hs.some((x) => x >= h)).map((h) => ({ value: String(h), label: `${h}p${h >= 2160 ? ' (4K)' : h === 1080 ? ' (FHD)' : h === 720 ? ' (HD)' : ''}` }))]
  }, [info])

  async function load(raw = input) {
    const url = extractUrl(raw)
    if (!url) return
    setInput(url)
    setLoadingInfo(true)
    setInfoErr('')
    setInfo(null)
    setJob(null)
    try {
      const r = await api<Info>('/media/info', { method: 'POST', body: { url } })
      setInfo(r)
      if (!r.hasVideo && r.heights.length === 0 && kind === 'video' && r.duration === 0) {
        // 길이·화질 정보를 주지 않는 사이트 — 그래도 받아 볼 수는 있다
      }
    } catch (e) {
      setInfoErr(e instanceof Error ? e.message : '영상 정보를 읽지 못했습니다.')
    } finally {
      setLoadingInfo(false)
    }
  }

  async function start() {
    if (!info) return
    const format = kind === 'video' ? vfmt : kind === 'audio' ? afmt : tfmt
    try {
      const { id } = await api<{ id: string }>('/media/jobs', {
        method: 'POST',
        body: {
          url: info.url, kind, format, height: Number(height), abr: Number(abr), subLang, title: info.title, duration,
          edit: { enabled: editActive, mode, ranges: validRanges },
        },
      })
      setJob({ id, status: 'queued', stage: '차례를 기다리는 중', progress: 0, error: null, position: 0 })
      if (poll.current) window.clearInterval(poll.current)
      poll.current = window.setInterval(async () => {
        try {
          const j = await api<Job>(`/media/jobs/${id}`)
          setJob(j)
          if (j.status === 'done' || j.status === 'error') {
            window.clearInterval(poll.current!)
            poll.current = null
            if (j.status === 'done') {
              toast.success('준비됐습니다. 파일을 저장합니다.')
              saveFile(id)
            }
          }
        } catch {
          /* 잠깐 끊겨도 다음 확인에서 이어진다 */
        }
      }, 1000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '시작하지 못했습니다.')
    }
  }

  function saveFile(id: string) {
    const a = document.createElement('a')
    a.href = `/api/media/jobs/${id}/file`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function cancel() {
    if (!job) return
    if (poll.current) window.clearInterval(poll.current)
    poll.current = null
    await api(`/media/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {})
    setJob(null)
    toast.info('취소했습니다.')
  }

  const busy = job && (job.status === 'queued' || job.status === 'running')
  const transcriptMissing = kind === 'transcript' && info && !subOptions.length

  if (authErr) {
    return (
      <EmptyState icon={AlertTriangle} title="로그인이 필요합니다" className="py-20">
        {authErr} 오른쪽 위 [로그인]으로 들어오세요.
      </EmptyState>
    )
  }

  const panel = (
    <>
      <Section title="받을 내용">
        <Segmented
          label="받을 내용"
          block
          value={kind}
          onValue={setKind}
          options={[
            { value: 'video', label: '영상', icon: Clapperboard },
            { value: 'audio', label: '소리만', icon: Music },
            { value: 'transcript', label: '대본', icon: FileText },
          ]}
        />
        <p className="-mt-1 text-xs text-muted">
          {kind === 'video' ? '자막을 입히지 않은 원본 영상을 받습니다.' : kind === 'audio' ? '영상에서 소리만 뽑아 받습니다.' : '영상에 붙은 자막을 글로 받습니다. 자막이 없는 영상은 받을 수 없습니다.'}
        </p>
      </Section>

      <Section title="파일 형식·품질">
        {kind === 'video' && (
          <>
            <Field label="파일 형식">{(id) => <Select id={id} value={vfmt} onValue={setVfmt} options={VIDEO_FORMATS} />}</Field>
            <Field label="화질" hint="원본보다 높게는 받을 수 없습니다. 고른 화질이 없으면 가장 가까운 낮은 화질로 받습니다.">
              {(id) => <Select id={id} value={heightOptions.some((o) => o.value === height) ? height : '0'} onValue={setHeight} options={heightOptions} />}
            </Field>
            <Field label="소리 음질" hint={vfmt === 'mkv' || (!editActive && vfmt === 'mp4') ? '원본을 그대로 담을 수 있으면 음질을 바꾸지 않습니다.' : undefined}>
              {(id) => <Select id={id} value={abr} onValue={setAbr} options={BITRATES} />}
            </Field>
          </>
        )}
        {kind === 'audio' && (
          <>
            <Field label="파일 형식">{(id) => <Select id={id} value={afmt} onValue={setAfmt} options={AUDIO_FORMATS} />}</Field>
            {afmt !== 'wav' && <Field label="음질">{(id) => <Select id={id} value={abr} onValue={setAbr} options={BITRATES} />}</Field>}
          </>
        )}
        {kind === 'transcript' && (
          <>
            <Field label="파일 형식">{(id) => <Select id={id} value={tfmt} onValue={setTfmt} options={TEXT_FORMATS} />}</Field>
            <Field label="언어">
              {(id) => <Select id={id} value={subLang} onValue={setSubLang} disabled={!subOptions.length} options={subOptions.length ? subOptions : [{ value: '', label: info ? '이 영상에는 자막이 없습니다' : '링크를 먼저 불러오세요' }]} />}
            </Field>
          </>
        )}
      </Section>

      <Section
        title="구간 편집"
        action={<Switch className="w-auto!" checked={editOn} onChange={setEditOn} label={<span className="sr-only">구간 편집 켜기</span>} />}
      >
        {!editOn ? (
          <p className="text-sm text-muted">켜면 원하는 부분만 남기거나, 필요 없는 부분을 잘라낸 파일로 받습니다.</p>
        ) : (
          <>
            <Segmented label="편집 방식" block size="sm" value={mode} onValue={setMode} options={[{ value: 'keep', label: '이 구간만 남기기', icon: Scissors }, { value: 'cut', label: '이 구간 잘라내기', icon: Trash2 }]} />
            <ul className="flex flex-col gap-2">
              {ranges.map((r, i) => (
                <li key={i} className="flex items-end gap-2">
                  <Field label={i === 0 ? '시작' : <span className="sr-only">시작</span>} className="min-w-0 flex-1">
                    {(id) => <TextInput id={id} value={r.start} onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} placeholder="0:30" className="num" inputMode="decimal" />}
                  </Field>
                  <Field label={i === 0 ? '끝' : <span className="sr-only">끝</span>} className="min-w-0 flex-1">
                    {(id) => <TextInput id={id} value={r.end} onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} placeholder="1:15" className="num" inputMode="decimal" />}
                  </Field>
                  <IconButton icon={X} label={`${i + 1}번째 구간 지우기`} size="sm" disabled={ranges.length === 1} onClick={() => setRanges(ranges.filter((_, j) => j !== i))} />
                </li>
              ))}
            </ul>
            <Button size="sm" icon={Plus} className="self-start" disabled={ranges.length >= 10} onClick={() => setRanges([...ranges, { start: '', end: '' }])}>
              구간 추가
            </Button>
            {rangeErr ? <Callout tone="warn">{rangeErr}</Callout> : <Timeline duration={duration} kept={kept} />}
            <p className="text-xs text-muted">시간은 1:23 또는 01:02:03 처럼 적습니다. 왼쪽 미리보기에서 재생하며 시간을 확인하세요.</p>
          </>
        )}
      </Section>

      <Section title="받기">
        {busy ? (
          <>
            <Progress value={job!.status === 'queued' ? null : job!.progress} label={job!.status === 'queued' && job!.position ? `${job!.stage} (앞에 ${job!.position - 1}건)` : job!.stage} />
            <Button icon={X} onClick={cancel}>
              취소
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={Download} block disabled={!info || !!rangeErr || Boolean(transcriptMissing) || (status != null && !status.ready && !status.installing)} onClick={start}>
            {kind === 'video' ? `영상 받기 (${vfmt.toUpperCase()})` : kind === 'audio' ? `소리 받기 (${afmt.toUpperCase()})` : `대본 받기 (${tfmt.toUpperCase()})`}
          </Button>
        )}
        {job?.status === 'error' && <Callout tone="danger">{job.error}</Callout>}
        {job?.status === 'done' && (
          <div className="flex flex-col gap-2 rounded-md bg-brand-soft px-3 py-2.5">
            <p className="text-sm text-brand-ink">
              <b>{job.filename}</b> <span className="num">{fmtBytes(job.size)}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={Download} onClick={() => saveFile(job.id)}>
                다시 저장
              </Button>
              {kind === 'video' && (
                <SendToMenu
                  size="sm"
                  exclude="saver"
                  files={async () => {
                    const blob = await (await fetch(`/api/media/jobs/${job.id}/file`)).blob()
                    return [new File([blob], job.filename ?? 'video.mp4', { type: blob.type || 'video/mp4' })]
                  }}
                />
              )}
            </div>
          </div>
        )}
      </Section>
    </>
  )

  return (
    <ToolLayout panel={panel}>
      <Panel className="flex flex-col gap-3 p-4 sm:p-5">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            void load()
          }}
        >
          <Field label="영상 링크" hint="유튜브·틱톡·인스타그램·페이스북·X 등 영상 페이지 주소를 붙여넣으세요." className="min-w-0 flex-1">
            {(id) => (
              <TextInput
                id={id}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  const t = e.clipboardData.getData('text')
                  if (/https?:\/\//.test(t)) {
                    e.preventDefault()
                    void load(t)
                  }
                }}
                placeholder="https://www.youtube.com/watch?v=…"
                inputMode="url"
                spellCheck={false}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" icon={Search} loading={loadingInfo} disabled={!input.trim()}>
            불러오기
          </Button>
        </form>
        {status?.installing && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> 처음 한 번 내려받기 도구를 준비하는 중입니다(1분 안팎).
          </p>
        )}
        {status?.error && <Callout tone="warn">{status.error}</Callout>}
        {infoErr && (
          <Callout tone="danger" title="영상을 불러오지 못했습니다">
            {infoErr}
          </Callout>
        )}
      </Panel>

      {info ? (
        <Panel className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <Badge tone="brand">{siteOf(info.webpage || info.url) || info.site}</Badge>
                {info.uploader && <span>{info.uploader}</span>}
                {duration > 0 && <span className="num">· {formatTime(duration)}</span>}
              </p>
              <h2 className="mt-1 text-lg leading-snug">{info.title || '(제목 없음)'}</h2>
            </div>
            <a href={info.webpage || info.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand underline">
              <Link2 className="size-4" aria-hidden /> 원본 열기
            </a>
          </div>
          <Stage minHeight={240} className="p-3!">
            {ytId ? (
              <iframe
                title="미리보기"
                className="aspect-video w-full max-w-[760px] rounded-md bg-ink"
                src={`https://www.youtube-nocookie.com/embed/${ytId}?rel=0`}
                allow="encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : info.thumbnail ? (
              <img src={info.thumbnail} alt="" referrerPolicy="no-referrer" className="max-h-[420px] max-w-full rounded-md object-contain shadow-2" />
            ) : (
              <span className="rounded-md bg-surface px-3 py-2 text-sm text-ink-2 shadow-1">미리보기를 보여줄 수 없는 사이트입니다. [원본 열기]로 확인하세요.</span>
            )}
          </Stage>
          {editOn && duration > 0 && !rangeErr && <Timeline duration={duration} kept={kept} />}
          {info.isLive && <Callout tone="warn">진행 중인 라이브 방송은 받을 수 없습니다.</Callout>}
          {transcriptMissing && <Callout tone="warn">이 영상에는 자막이 없어 대본을 받을 수 없습니다. [영상]이나 [소리만]으로 받아 보세요.</Callout>}
        </Panel>
      ) : (
        !loadingInfo && (
          <Panel className="p-4 sm:p-5">
            <EmptyState icon={Link2} title="영상 링크를 붙여넣으세요" className="py-10">
              위 칸에 붙여넣으면 바로 영상 정보를 불러옵니다. 공유 문구째 붙여넣어도 링크만 골라냅니다.
            </EmptyState>
          </Panel>
        )
      )}

      <Callout tone="info" title="쓰기 전에">
        회사 자체 영상이나 사용 허락을 받은 영상에만 쓰세요. 다른 사람의 영상을 내려받아 쓰면 저작권·플랫폼 약관 문제가 생길 수 있습니다. 영상은 온비짱 서버에서 받아 바꾼 뒤 내려 주며, 30분 뒤 서버에서 지워집니다.
        <span className="mt-1 block text-xs text-muted">
          유튜브·인스타그램은 서버에서 오는 요청을 막는 경우가 있어 일부 영상은 받지 못할 수 있습니다.
        </span>
      </Callout>
      {job?.status === 'error' && (
        <Button size="sm" icon={RotateCcw} className={clsx('self-start')} onClick={start}>
          다시 시도
        </Button>
      )}
    </ToolLayout>
  )
}
