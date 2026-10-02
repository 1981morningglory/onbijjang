import clsx from 'clsx'
import { ChevronFirst, ChevronLast, CircleAlert, Download, FileArchive, Images, Play, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_WATERMARK, type WatermarkSettings } from '@/app/config'
import { useHandoffFiles } from '@/app/handoff'
import { blobToFile, downloadBlob, downloadZip, extOf, fileKind, formatBytes, todayStamp } from '@/lib/files'
import { useAbortable, useObjectUrl, usePersistentState } from '@/lib/hooks'
import { Badge, Button, Callout, Dropzone, EmptyState, Field, IconButton, NumberInput, Panel, Progress, Section, SendToMenu, Spinner, Stage, ToolLayout, WatermarkControls, toast } from '@/ui'
import { audioLimitReason, decodeAudio } from '../clips/shared/audio'
import { useEncodeSupport } from '../clips/shared/capabilities'
import { convertRange } from '../clips/shared/convert'
import { openVideo } from '../clips/shared/frameSource'
import { OutputSections, videoFormatLabel } from '../clips/shared/OutputSettings'
import { FramePreview } from '../clips/shared/player'
import { AbortError, isAbort, type FrameSink } from '../clips/shared/sinks'
import { TimeInput } from '../clips/shared/TimeInput'
import { formatDuration, outputName } from '../clips/shared/time'
import { DEFAULT_OUTPUT, GIF_MAX_SECONDS, type OutputSettings } from '../clips/shared/types'
import { MAX_DURATION, MAX_FILES, MAX_FILE_BYTES, applyFirstSeconds, itemProblem, moveItemEdge, newItemId, type VideoItem } from './items'

interface ResultItem {
  blob: Blob
  name: string
  kind: FrameSink['kind']
  width: number
  height: number
  audio: boolean
}

interface JobState {
  index: number
  total: number
  fraction: number
  name: string
  id: string
  preparing?: string
}

/** 목록에 보일 작은 장면 그림 */
function makeThumb(video: HTMLVideoElement): string | null {
  try {
    const scale = Math.min(1, 96 / Math.max(video.videoWidth, video.videoHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(video.videoWidth * scale))
    c.height = Math.max(1, Math.round(video.videoHeight * scale))
    c.getContext('2d')?.drawImage(video, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.7)
  } catch {
    return null
  }
}

export default function GifTool() {
  const [items, setItems] = useState<VideoItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [player, setPlayer] = useState<HTMLVideoElement | null>(null)
  const [firstSeconds, setFirstSeconds] = usePersistentState<number>('onbijjang:gif:first-seconds', 5)
  const [output, setOutput] = usePersistentState<OutputSettings>('onbijjang:gif:output', { ...DEFAULT_OUTPUT, videoLongSide: 720 })
  const [watermark, setWatermark] = usePersistentState<WatermarkSettings>('onbijjang:gif:watermark', DEFAULT_WATERMARK)
  const support = useEncodeSupport()
  const [job, setJob] = useState<JobState | null>(null)
  const [results, setResults] = useState<Record<string, ResultItem>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const abortable = useAbortable()
  const alive = useRef(true)
  const previewEnd = useRef<number | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const busy = job !== null

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const active = items.find((i) => i.id === activeId && i.status === 'ready') ?? null
  const activeUrl = useObjectUrl(active?.file)

  const patchItem = (id: string, fn: (item: VideoItem) => VideoItem) => setItems((list) => list.map((i) => (i.id === id ? fn(i) : i)))
  const dropResult = (id: string) => {
    setResults((prev) => {
      if (!(id in prev)) return prev
      const { [id]: _removed, ...rest } = prev
      return rest
    })
    setErrors((prev) => {
      if (!(id in prev)) return prev
      const { [id]: _removed, ...rest } = prev
      return rest
    })
  }

  // 영상 정보(길이·크기·장면 그림)는 한 개씩 차례로 읽는다.
  const probing = useRef(false)
  const probeNext = async () => {
    if (probing.current) return
    probing.current = true
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === 'loading')
        if (!next || !alive.current) break
        let patch: Partial<VideoItem>
        try {
          const src = await openVideo(next.file)
          try {
            if (src.duration > MAX_DURATION + 1) throw new Error(`${formatDuration(src.duration)} 길이입니다. 60분 이하 영상만 변환할 수 있습니다.`)
            patch = { status: 'ready', duration: src.duration, width: src.width, height: src.height, start: 0, end: Math.round(src.duration * 1000) / 1000, thumb: makeThumb(src.video) }
          } finally {
            src.dispose()
          }
        } catch (err) {
          patch = { status: 'error', error: err instanceof Error ? err.message : '영상을 열지 못했습니다.' }
        }
        if (!alive.current) break
        const updated = itemsRef.current.map((i) => (i.id === next.id ? { ...i, ...patch } : i))
        itemsRef.current = updated
        setItems((list) => list.map((i) => (i.id === next.id ? { ...i, ...patch } : i)))
        if (patch.status === 'ready') setActiveId((cur) => cur ?? next.id)
      }
    } finally {
      probing.current = false
    }
  }

  const addFiles = (files: File[]) => {
    if (busy) return toast.info('변환이 끝난 뒤에 영상을 더 넣을 수 있습니다.')
    const videos = files.filter((f) => fileKind(f) === 'video')
    if (!videos.length) return toast.warn('영상 파일만 넣을 수 있습니다.')
    const room = MAX_FILES - itemsRef.current.length
    if (room <= 0) return toast.warn(`영상은 한 번에 ${MAX_FILES}개까지 넣을 수 있습니다.`)
    const tooBig = videos.filter((f) => f.size > MAX_FILE_BYTES)
    const ok = videos.filter((f) => f.size <= MAX_FILE_BYTES)
    const taken = ok.slice(0, room)
    if (tooBig.length) toast.warn(`${formatBytes(MAX_FILE_BYTES)} 를 넘는 영상 ${tooBig.length}개는 제외했습니다.`)
    if (ok.length > room) toast.warn(`영상은 ${MAX_FILES}개까지입니다. ${ok.length - room}개는 넣지 않았습니다.`)
    if (!taken.length) return
    const added: VideoItem[] = taken.map((file) => ({ id: newItemId(), file, status: 'loading', duration: 0, width: 0, height: 0, start: 0, end: 0, thumb: null }))
    itemsRef.current = [...itemsRef.current, ...added]
    setItems(itemsRef.current)
    void probeNext()
  }

  useHandoffFiles('gif', addFiles)

  const removeItem = (id: string) => {
    setItems((list) => list.filter((i) => i.id !== id))
    dropResult(id)
    if (activeId === id) setActiveId(itemsRef.current.find((i) => i.id !== id && i.status === 'ready')?.id ?? null)
  }
  const clearAll = () => {
    setItems([])
    setResults({})
    setErrors({})
    setActiveId(null)
  }
  const setEdge = (id: string, edge: 'start' | 'end', time: number) => {
    if (busy) return
    patchItem(id, (i) => moveItemEdge(i, edge, time))
    dropResult(id)
  }
  const applyFirst = () => {
    const n = Number.isFinite(firstSeconds) && firstSeconds > 0 ? firstSeconds : 5
    setItems((list) => list.map((i) => applyFirstSeconds(i, n)))
    setResults({})
    setErrors({})
    toast.success(`모든 영상을 처음 ${formatDuration(n)}로 맞췄습니다.`)
  }
  const resetRanges = () => {
    setItems((list) => list.map((i) => (i.status === 'ready' ? { ...i, start: 0, end: Math.round(i.duration * 1000) / 1000 } : i)))
    setResults({})
    setErrors({})
  }

  // 고른 구간만 미리 재생하고 끝에서 멈춘다.
  const playRange = () => {
    if (!player || !active) return
    player.currentTime = active.start
    previewEnd.current = active.end
    void player.play().catch(() => undefined)
  }
  useEffect(() => {
    if (!player) return
    const check = () => {
      const end = previewEnd.current
      if (end != null && player.currentTime >= end) {
        player.pause()
        previewEnd.current = null
      }
    }
    const stopWatching = () => {
      if (player.paused) previewEnd.current = null
    }
    player.addEventListener('timeupdate', check)
    player.addEventListener('pause', stopWatching)
    return () => {
      player.removeEventListener('timeupdate', check)
      player.removeEventListener('pause', stopWatching)
    }
  }, [player])

  // ── 변환 ────────────────────────────────────────────────
  const ready = items.filter((i) => i.status === 'ready')
  const convertible = ready.filter((i) => !itemProblem(i, output.format))
  const blocked = ready.length - convertible.length
  const loadingCount = items.filter((i) => i.status === 'loading').length
  const formatUnavailable = (output.format === 'mp4' && support?.video === null) || (output.format === 'webp' && support?.webp === false)
  const resultList = items.flatMap((i) => (results[i.id] ? [results[i.id]] : []))
  const savedBytes = items.reduce((n, i) => (results[i.id] ? n + (i.file.size - results[i.id].blob.size) : n), 0)

  const convert = async () => {
    if (!convertible.length || busy) return
    const targets = convertible
    const signal = abortable.start()
    player?.pause()
    setErrors({})
    let done = 0
    let failed = 0
    try {
      for (const [index, item] of targets.entries()) {
        setJob({ index, total: targets.length, fraction: 0, name: item.file.name, id: item.id })
        let lastPaint = 0
        try {
          // 소리를 담을 수 있는 크기면 원본 소리를 먼저 푼다. 이 영상의 변환이 끝나면 버린다.
          let audio: AudioBuffer | null = null
          if (output.format === 'mp4' && output.videoAudio && !audioLimitReason(item.file.size, item.duration)) {
            setJob((j) => (j ? { ...j, preparing: '원본 소리를 읽는 중' } : j))
            audio = await decodeAudio(item.file)
            if (signal.aborted) throw new AbortError()
            setJob((j) => (j ? { ...j, preparing: undefined } : j))
          }
          const src = await openVideo(item.file, signal)
          try {
            const res = await convertRange({
              video: src.video,
              start: item.start,
              end: item.end,
              output,
              watermark,
              audio,
              signal,
              onProgress: (fraction) => {
                const now = performance.now()
                if (fraction < 1 && now - lastPaint < 120) return
                lastPaint = now
                setJob((j) => (j ? { ...j, fraction } : j))
              },
            })
            // 원본과 같은 형식으로 줄였을 때는 이름이 겹치지 않게 꼬리표를 붙인다.
            const sameFormat = extOf(item.file.name) === res.ext
            const result: ResultItem = { blob: res.blob, name: outputName(item.file.name, sameFormat ? '줄임' : '', res.ext), kind: res.kind, width: res.width, height: res.height, audio: res.audio }
            setResults((prev) => ({ ...prev, [item.id]: result }))
            done++
          } finally {
            src.dispose()
          }
        } catch (err) {
          if (isAbort(err)) throw err
          failed++
          setErrors((prev) => ({ ...prev, [item.id]: err instanceof Error ? err.message : '변환하지 못했습니다.' }))
        }
      }
      if (failed) toast.warn(`${done}개를 만들고 ${failed}개는 실패했습니다. 목록에서 이유를 확인해 주세요.`)
      else toast.success(`영상 ${done}개를 변환했습니다.`)
    } catch (err) {
      if (isAbort(err)) toast.info(done ? `변환을 취소했습니다. 먼저 끝난 ${done}개는 남아 있습니다.` : '변환을 취소했습니다.')
      else toast.error(err instanceof Error ? err.message : '변환하지 못했습니다.')
    } finally {
      if (alive.current) setJob(null)
    }
  }

  const saveZip = async () => {
    if (!resultList.length) return
    try {
      await downloadZip(resultList.map((r) => ({ name: r.name, data: r.blob })), `영상 변환_${todayStamp()}_${resultList.length}개.zip`)
    } catch {
      toast.error('ZIP 을 만들지 못했습니다. 결과가 너무 크면 하나씩 저장해 주세요.')
    }
  }

  const formatName = output.format === 'mp4' ? videoFormatLabel(support) : output.format === 'gif' ? 'GIF' : 'WebP'

  return (
    <ToolLayout
      panel={
        <>
          {active && (
            <Section title="결과 미리보기" hint="지금 보고 있는 장면에 출력 틀과 워터마크를 입힌 모습입니다.">
              <FramePreview video={player} output={output} watermark={watermark} />
            </Section>
          )}
          <Section title="모든 영상 구간 맞추기" hint="영상마다 따로 정하려면 목록에서 시작·끝을 고치세요.">
            <div className="flex items-end gap-2">
              <Field label="처음 몇 초만" className="flex-1">
                {(id) => <NumberInput id={id} unit="초" min={0.5} max={3600} step={0.5} value={firstSeconds} disabled={busy} onValue={(v) => setFirstSeconds(v ?? 5)} />}
              </Field>
              <Button disabled={busy || !ready.length} onClick={applyFirst}>
                모두 적용
              </Button>
            </div>
            <Button size="sm" variant="ghost" icon={RotateCcw} disabled={busy || !ready.length} onClick={resetRanges} className="self-start">
              모두 전체 길이로 되돌리기
            </Button>
          </Section>
          <OutputSections
            value={output}
            onChange={setOutput}
            support={support}
            source={active ? { width: active.width, height: active.height } : null}
            audioBlocked={ready.some((i) => audioLimitReason(i.file.size, i.duration)) ? '200MB 또는 15분을 넘는 영상은 소리 없이 화면만 저장합니다.' : null}
            disabled={busy}
          />
          <Section title="워터마크" hint="모든 프레임에 들어갑니다.">
            <WatermarkControls value={watermark} onChange={setWatermark} />
          </Section>
          <Section title="변환">
            {busy && job ? (
              <>
                <Progress value={job.preparing ? null : ((job.index + job.fraction) / job.total) * 100} label={<span className="break-all">{job.preparing ? `${job.preparing} — ${job.name}` : `${job.name} (${job.index + 1}/${job.total})`}</span>} />
                <Button icon={X} block onClick={abortable.abort}>
                  취소
                </Button>
              </>
            ) : (
              <>
                {output.format === 'gif' && convertible.some((i) => i.end - i.start > 20) && (
                  <Callout tone="warn" title="GIF 용량이 커질 수 있습니다">
                    20초가 넘는 영상이 있습니다. 용량을 줄이는 것이 목적이면 {videoFormatLabel(support)} 로 바꾸는 편이 훨씬 작습니다.
                  </Callout>
                )}
                {blocked > 0 && (
                  <Callout tone="warn">
                    {blocked}개는 구간이 {GIF_MAX_SECONDS}초를 넘거나 너무 짧아 건너뜁니다. 목록에서 구간을 줄이거나 {videoFormatLabel(support)} 로 바꿔 주세요.
                  </Callout>
                )}
                <Button variant="primary" icon={Images} block disabled={!convertible.length || formatUnavailable || loadingCount > 0} onClick={convert}>
                  {convertible.length ? `영상 ${convertible.length}개 ${formatName} 로 변환` : `${formatName} 로 변환`}
                </Button>
                <p className="text-sm text-muted">{!items.length ? '영상을 넣으면 변환할 수 있습니다.' : loadingCount ? '영상 정보를 읽는 중입니다.' : '위에서부터 한 개씩 차례로 변환합니다.'}</p>
                {resultList.length > 0 && (
                  <>
                    <Button icon={FileArchive} block onClick={saveZip}>
                      결과 {resultList.length}개 ZIP 으로 저장
                    </Button>
                    {savedBytes > 0 && <p className="num text-sm text-ink-2">원본보다 모두 {formatBytes(savedBytes)} 줄었습니다.</p>}
                  </>
                )}
              </>
            )}
          </Section>
        </>
      }
    >
      <Dropzone
        accept="video/*"
        compact={items.length > 0}
        icon={Images}
        disabled={busy}
        title={items.length ? '영상 더 넣기' : '변환할 영상을 끌어다 놓으세요'}
        hint={items.length ? <span className="num">{items.length} / {MAX_FILES}개</span> : `최대 ${MAX_FILES}개 · 한 개 ${formatBytes(MAX_FILE_BYTES)} 이하 · MP4·WebM·MOV 처럼 브라우저가 재생할 수 있는 형식`}
        onFiles={addFiles}
      />

      {items.length > 0 && (
        <>
          <Stage minHeight={260}>
            {active && activeUrl ? (
              <div className="flex max-w-full flex-col items-center gap-3">
                <video key={active.id} ref={setPlayer} src={activeUrl} controls playsInline preload="auto" className="max-h-[48vh] max-w-full rounded-sm shadow-2" aria-label={`${active.file.name} 미리보기`} />
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button size="sm" icon={ChevronFirst} disabled={busy} onClick={() => player && setEdge(active.id, 'start', player.currentTime)}>
                    지금 위치를 시작으로
                  </Button>
                  <Button size="sm" icon={ChevronLast} disabled={busy} onClick={() => player && setEdge(active.id, 'end', player.currentTime)}>
                    지금 위치를 끝으로
                  </Button>
                  <Button size="sm" icon={Play} onClick={playRange}>
                    구간 미리 재생
                  </Button>
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm font-semibold">
                {loadingCount > 0 ? (
                  <>
                    <Spinner /> 영상 정보를 읽는 중
                  </>
                ) : (
                  '목록에서 영상을 고르면 여기에서 미리 볼 수 있습니다.'
                )}
              </p>
            )}
          </Stage>

          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h3 className="text-sm font-bold text-ink">영상 {items.length}개</h3>
              <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onClick={clearAll}>
                모두 지우기
              </Button>
            </div>
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  active={item.id === activeId}
                  busy={busy}
                  working={job?.id === item.id}
                  problem={item.status === 'ready' ? itemProblem(item, output.format) : null}
                  error={errors[item.id]}
                  result={results[item.id]}
                  onActivate={() => item.status === 'ready' && setActiveId(item.id)}
                  onEdge={(edge, time) => setEdge(item.id, edge, time)}
                  onRemove={() => removeItem(item.id)}
                />
              ))}
            </ul>
          </Panel>
        </>
      )}

      {!items.length && (
        <EmptyState icon={Images} title="영상 여러 개를 한 번에 바꿉니다">
          짧은 영상을 GIF 로 만들거나, 용량이 큰 영상을 해상도·비트레이트를 낮춘 {videoFormatLabel(support)} 로 줄일 수 있습니다. 영상마다 쓸 구간을 따로 정할 수 있습니다.
        </EmptyState>
      )}
    </ToolLayout>
  )
}

interface ItemRowProps {
  item: VideoItem
  active: boolean
  busy: boolean
  working: boolean
  problem: string | null
  error?: string
  result?: ResultItem
  onActivate: () => void
  onEdge: (edge: 'start' | 'end', time: number) => void
  onRemove: () => void
}

function ItemRow({ item, active, busy, working, problem, error, result, onActivate, onEdge, onRemove }: ItemRowProps) {
  return (
    <li className={clsx('flex flex-col gap-2 px-4 py-3 transition-colors duration-150', active && 'bg-mark-soft')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={onActivate}
          disabled={item.status !== 'ready'}
          aria-pressed={active}
          title="이 영상 미리보기"
          className="flex min-w-0 flex-1 basis-56 items-center gap-3 rounded-sm text-left transition-opacity duration-150 hover:opacity-80 disabled:hover:opacity-100"
        >
          <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xs border border-line bg-sunken">
            {item.thumb ? <img src={item.thumb} alt="" className="size-full object-cover" /> : item.status === 'loading' ? <Spinner className="text-muted" /> : <CircleAlert className="size-4 text-danger" aria-hidden />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{item.file.name}</span>
            <span className="num block text-xs text-muted">
              {item.status === 'ready' ? `${item.width} × ${item.height}px · ${formatDuration(item.duration)} · ${formatBytes(item.file.size)}` : item.status === 'loading' ? '읽는 중' : formatBytes(item.file.size)}
            </span>
          </span>
        </button>
        {item.status === 'ready' && (
          <div className="flex items-center gap-1">
            <TimeInput value={item.start} onCommit={(t) => onEdge('start', t)} label={`${item.file.name} 시작`} disabled={busy} className="w-[5.5rem]!" />
            <span className="text-muted">–</span>
            <TimeInput value={item.end} onCommit={(t) => onEdge('end', t)} label={`${item.file.name} 끝`} disabled={busy} className="w-[5.5rem]!" />
            <span className="num ml-1 w-14 text-sm text-muted">{formatDuration(item.end - item.start)}</span>
          </div>
        )}
        <IconButton icon={Trash2} label={`${item.file.name} 빼기`} size="sm" disabled={busy} onClick={onRemove} className="ml-auto" />
      </div>
      {item.status === 'error' ? (
        <p className="text-sm text-danger" role="alert">
          {item.error}
        </p>
      ) : working ? (
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <Spinner /> 변환 중
        </p>
      ) : problem ? (
        <p className="text-sm text-warn" role="status">
          {problem}
        </p>
      ) : error ? (
        <p className="text-sm text-danger" role="alert">
          변환하지 못했습니다. {error}
        </p>
      ) : result ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{result.kind.toUpperCase()}</Badge>
          <span className="num text-sm text-ink-2">
            {result.width} × {result.height}px · {formatBytes(result.blob.size)}
            {(result.kind === 'mp4' || result.kind === 'webm') && (result.audio ? ' · 소리 포함' : ' · 소리 없음')}
            {result.blob.size < item.file.size && ` (원본의 ${Math.min(99, Math.max(1, Math.round((result.blob.size / item.file.size) * 100)))}%)`}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Download} onClick={() => downloadBlob(result.blob, result.name)}>
              저장
            </Button>
            <SendToMenu size="sm" label="보내기" exclude="gif" files={[blobToFile(result.blob, result.name)]} />
          </div>
        </div>
      ) : null}
    </li>
  )
}
