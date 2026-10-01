import clsx from 'clsx'
import { ChevronFirst, ChevronLast, Download, FastForward, FileArchive, Film, Flag, Pause, Play, Plus, Rewind, Scissors, Trash2, Volume2, VolumeX, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { DEFAULT_WATERMARK, type WatermarkSettings } from '@/app/config'
import { useHandoffFiles } from '@/app/handoff'
import { blobToFile, downloadBlob, downloadZip, fileKind, formatBytes, stripExt } from '@/lib/files'
import { useAbortable, useObjectUrl, usePersistentState } from '@/lib/hooks'
import { Badge, Button, Callout, Checkbox, Dropzone, EmptyState, IconButton, Kbd, Panel, Progress, Section, SendToMenu, Spinner, Stage, TextInput, ToolLayout, WatermarkControls, toast } from '@/ui'
import { MAX_DURATION, MAX_FILE_BYTES, addRange, moveEdge, rangeProblem, type ClipRange } from './ranges'
import { useEncodeSupport } from './shared/capabilities'
import { convertRange, layoutFor } from './shared/convert'
import { openVideo, type OpenedVideo } from './shared/frameSource'
import { OutputSections, videoFormatLabel } from './shared/OutputSettings'
import { FramePreview, useCurrentTime, usePlaying } from './shared/player'
import { isAbort, type FrameSink } from './shared/sinks'
import { TimeInput } from './shared/TimeInput'
import { estimateGifBytes, estimateVideoBytes, formatDuration, formatTime, outputName } from './shared/time'
import { DEFAULT_OUTPUT, GIF_MAX_SECONDS, effectiveSize, resolveBitrate, type OutputSettings } from './shared/types'
import { Timeline } from './Timeline'

interface Loaded {
  file: File
  /** 변환할 때 프레임을 읽는 화면 밖 영상(보이는 플레이어와 따로 움직인다) */
  source: OpenedVideo
}

interface ResultItem {
  blob: Blob
  name: string
  kind: FrameSink['kind']
  width: number
  height: number
}

interface JobState {
  index: number
  total: number
  fraction: number
  name: string
}

const ZOOMS = [1, 2, 4, 8, 16, 32]
const GIF_WARN_BYTES = 30 * 1024 * 1024

/** 마우스로 누른 버튼에 포커스가 남아 스페이스바가 그 버튼을 다시 누르는 일을 막는다(키보드 조작은 그대로). */
function blurAfterPointer(e: ReactMouseEvent<HTMLElement>) {
  if (e.detail > 0) e.currentTarget.blur()
}

export default function ClipsTool() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [opening, setOpening] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const url = useObjectUrl(loaded?.file)
  const [player, setPlayer] = useState<HTMLVideoElement | null>(null)
  const [ranges, setRanges] = useState<ClipRange[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pendingStart, setPendingStart] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [muted, setMuted] = useState(false)
  const [output, setOutput] = usePersistentState<OutputSettings>('onbijjang:clips:output', DEFAULT_OUTPUT)
  const [watermark, setWatermark] = usePersistentState<WatermarkSettings>('onbijjang:clips:watermark', DEFAULT_WATERMARK)
  const support = useEncodeSupport()
  const [job, setJob] = useState<JobState | null>(null)
  const [results, setResults] = useState<Record<string, ResultItem>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const abortable = useAbortable()
  const alive = useRef(true)
  const previewEnd = useRef<number | null>(null)
  const busy = job !== null
  const duration = loaded?.source.duration ?? 0

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => () => loaded?.source.dispose(), [loaded])

  const loadFile = async (file: File) => {
    if (busy) return toast.info('변환이 끝난 뒤에 다른 영상을 열 수 있습니다.')
    if (opening) return
    if (file.size > MAX_FILE_BYTES) {
      setLoadError(`영상이 너무 큽니다(${formatBytes(file.size)}). 2GB 이하 영상만 열 수 있습니다.`)
      return
    }
    setOpening(true)
    setLoadError(null)
    try {
      const source = await openVideo(file)
      if (!alive.current) return source.dispose()
      if (source.duration > MAX_DURATION + 1) {
        source.dispose()
        throw new Error(`영상이 ${formatDuration(source.duration)} 길이입니다. 60분 이하 영상만 열 수 있으니 나눠서 올려 주세요.`)
      }
      setLoaded({ file, source })
      setRanges([])
      setResults({})
      setErrors({})
      setActiveId(null)
      setPendingStart(null)
      setZoom(1)
    } catch (err) {
      if (alive.current) setLoadError(err instanceof Error ? err.message : '영상을 열지 못했습니다.')
    } finally {
      if (alive.current) setOpening(false)
    }
  }

  useHandoffFiles('clips', (files) => {
    const video = files.find((f) => fileKind(f) === 'video')
    if (video) void loadFile(video)
    else toast.warn('영상 파일만 받을 수 있습니다.')
  })

  // ── 재생 ────────────────────────────────────────────────
  const seek = (time: number) => {
    if (!player) return
    previewEnd.current = null
    player.currentTime = Math.min(Math.max(0, time), duration)
  }
  const togglePlay = () => {
    if (!player) return
    previewEnd.current = null
    if (player.paused || player.ended) {
      if (player.ended || player.currentTime >= duration - 0.05) player.currentTime = 0
      void player.play().catch(() => undefined)
    } else player.pause()
  }
  const playRange = (r: ClipRange) => {
    if (!player) return
    setActiveId(r.id)
    player.currentTime = r.start
    previewEnd.current = r.end
    void player.play().catch(() => undefined)
  }

  // 구간 미리 재생은 끝 지점에서 멈춘다.
  useEffect(() => {
    if (!player) return
    let raf = 0
    const check = () => {
      const end = previewEnd.current
      if (end != null && player.currentTime >= end) {
        player.pause()
        previewEnd.current = null
      }
      if (!player.paused) raf = requestAnimationFrame(check)
    }
    const onPlay = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(check)
    }
    player.addEventListener('play', onPlay)
    player.addEventListener('timeupdate', check)
    return () => {
      cancelAnimationFrame(raf)
      player.removeEventListener('play', onPlay)
      player.removeEventListener('timeupdate', check)
    }
  }, [player])

  // ── 구간 ────────────────────────────────────────────────
  const markStart = () => {
    if (!player) return
    setPendingStart(player.currentTime)
  }
  const markEnd = () => {
    if (!player) return
    if (pendingStart == null) return toast.info('먼저 시작 지점을 찍어 주세요.')
    const end = player.currentTime
    if (end <= pendingStart + 0.05) return toast.info('끝 지점은 시작 지점보다 뒤여야 합니다.')
    const next = addRange(ranges, pendingStart, end, duration)
    setRanges(next)
    setActiveId(next[next.length - 1].id)
    setPendingStart(null)
  }
  const addAtCurrent = () => {
    if (!player) return
    const start = Math.min(player.currentTime, Math.max(0, duration - 0.1))
    const next = addRange(ranges, start, Math.min(duration, start + 5), duration)
    setRanges(next)
    setActiveId(next[next.length - 1].id)
  }
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
  const patchRange = (id: string, fn: (r: ClipRange) => ClipRange) => setRanges((list) => list.map((r) => (r.id === id ? fn(r) : r)))
  const setEdge = (id: string, edge: 'start' | 'end', time: number) => {
    if (busy) return
    patchRange(id, (r) => moveEdge(r, edge, time, duration))
    dropResult(id) // 구간이 바뀌면 앞서 만든 결과는 맞지 않는다
  }
  const removeRange = (id: string) => {
    setRanges((list) => list.filter((r) => r.id !== id))
    dropResult(id)
    if (activeId === id) setActiveId(null)
  }

  // ── 단축키 ──────────────────────────────────────────────
  const keys = useRef({ togglePlay, markStart, markEnd, seek })
  keys.current = { togglePlay, markStart, markEnd, seek }
  useEffect(() => {
    if (!player) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (document.querySelector('dialog[open]')) return
      const k = keys.current
      // 한글 입력 상태에서도 먹도록 글자가 아니라 자판 위치(code)로 본다.
      if (e.code === 'Space') {
        // 버튼에 포커스가 있으면 그 버튼을 누르는 동작이 우선이다.
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return
        e.preventDefault()
        k.togglePlay()
      } else if (e.code === 'KeyI') {
        e.preventDefault()
        k.markStart()
      } else if (e.code === 'KeyO') {
        e.preventDefault()
        k.markEnd()
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault()
        const step = (e.shiftKey ? 5 : 1) * (e.code === 'ArrowLeft' ? -1 : 1)
        k.seek(player.currentTime + step)
      } else if (e.code === 'Comma' || e.code === 'Period') {
        e.preventDefault()
        player.pause()
        k.seek(player.currentTime + (e.code === 'Comma' ? -1 : 1) / 30)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player])

  // ── 변환 ────────────────────────────────────────────────
  const selected = ranges.filter((r) => r.selected)
  const convertible = selected.filter((r) => !rangeProblem(r, output.format))
  const blocked = selected.length - convertible.length
  const layout = loaded ? layoutFor(loaded.source.width, loaded.source.height, output) : null
  const { fps } = effectiveSize(output)
  const totalSeconds = convertible.reduce((n, r) => n + (r.end - r.start), 0)
  const longest = convertible.reduce((n, r) => Math.max(n, r.end - r.start), 0)
  const estimate =
    layout && convertible.length
      ? output.format === 'mp4'
        ? estimateVideoBytes(resolveBitrate(output, layout.width, layout.height, fps), totalSeconds)
        : output.format === 'gif'
          ? estimateGifBytes(layout.width, layout.height, totalSeconds * fps, output.gifQuality)
          : null
      : null
  const gifHeavy = output.format === 'gif' && layout != null && estimateGifBytes(layout.width, layout.height, longest * fps, output.gifQuality) > GIF_WARN_BYTES
  const formatUnavailable = (output.format === 'mp4' && support?.video === null) || (output.format === 'webp' && support?.webp === false)
  const resultList = ranges.flatMap((r) => (results[r.id] ? [results[r.id]] : []))

  const convert = async () => {
    if (!loaded || !convertible.length || busy) return
    const targets = convertible
    const signal = abortable.start()
    player?.pause()
    setErrors({})
    let done = 0
    let failed = 0
    try {
      for (const [index, r] of targets.entries()) {
        setJob({ index, total: targets.length, fraction: 0, name: r.name })
        let lastPaint = 0
        try {
          const res = await convertRange({
            video: loaded.source.video,
            start: r.start,
            end: r.end,
            output,
            watermark,
            signal,
            onProgress: (fraction) => {
              const now = performance.now()
              if (fraction < 1 && now - lastPaint < 120) return
              lastPaint = now
              setJob((j) => (j ? { ...j, fraction } : j))
            },
          })
          const item: ResultItem = { blob: res.blob, name: outputName(loaded.file.name, r.name, res.ext), kind: res.kind, width: res.width, height: res.height }
          setResults((prev) => ({ ...prev, [r.id]: item }))
          done++
        } catch (err) {
          if (isAbort(err)) throw err
          failed++
          setErrors((prev) => ({ ...prev, [r.id]: err instanceof Error ? err.message : '변환하지 못했습니다.' }))
        }
      }
      if (failed) toast.warn(`${done}개를 만들고 ${failed}개는 실패했습니다. 구간 목록에서 이유를 확인해 주세요.`)
      else toast.success(`구간 ${done}개를 변환했습니다.`)
    } catch (err) {
      if (isAbort(err)) toast.info(done ? `변환을 취소했습니다. 먼저 끝난 ${done}개는 남아 있습니다.` : '변환을 취소했습니다.')
      else toast.error(err instanceof Error ? err.message : '변환하지 못했습니다.')
    } finally {
      if (alive.current) setJob(null)
    }
  }

  const saveZip = async () => {
    if (!loaded || !resultList.length) return
    try {
      await downloadZip(resultList.map((r) => ({ name: r.name, data: r.blob })), `${stripExt(loaded.file.name)}_구간 ${resultList.length}개.zip`)
    } catch {
      toast.error('ZIP 을 만들지 못했습니다. 결과가 너무 크면 하나씩 저장해 주세요.')
    }
  }

  const allSelected = ranges.length > 0 && ranges.every((r) => r.selected)

  return (
    <ToolLayout
      panel={
        <>
          {loaded && (
            <Section title="결과 미리보기" hint="지금 보고 있는 장면에 출력 틀과 워터마크를 입힌 모습입니다.">
              <FramePreview video={player} output={output} watermark={watermark} />
            </Section>
          )}
          <OutputSections value={output} onChange={setOutput} support={support} source={loaded ? { width: loaded.source.width, height: loaded.source.height } : null} disabled={busy} />
          <Section title="워터마크" hint="모든 프레임에 들어갑니다.">
            <WatermarkControls value={watermark} onChange={setWatermark} />
          </Section>
          <Section title="변환">
            {busy && job ? (
              <>
                <Progress value={((job.index + job.fraction) / job.total) * 100} label={`${job.name} 변환 중 (${job.index + 1}/${job.total})`} />
                <Button icon={X} block onClick={abortable.abort}>
                  취소
                </Button>
              </>
            ) : (
              <>
                {gifHeavy && (
                  <Callout tone="warn" title="GIF 용량이 커질 수 있습니다">
                    긴 구간은 수십 MB 가 넘기 쉽습니다. 긴 변이나 초당 프레임을 줄이거나, {videoFormatLabel(support)} 로 바꾸면 훨씬 작아집니다.
                  </Callout>
                )}
                {blocked > 0 && (
                  <Callout tone="warn">
                    고른 구간 중 {blocked}개는 {GIF_MAX_SECONDS}초를 넘거나 너무 짧아 건너뜁니다. 구간 목록에서 확인해 주세요.
                  </Callout>
                )}
                <Button variant="primary" icon={Scissors} block disabled={!loaded || !convertible.length || formatUnavailable} onClick={convert}>
                  {convertible.length ? `고른 구간 ${convertible.length}개 변환` : '구간 변환'}
                </Button>
                <p className="text-sm text-muted">
                  {!loaded
                    ? '영상을 올리고 구간을 만들면 변환할 수 있습니다.'
                    : !ranges.length
                      ? '타임라인에서 구간을 먼저 만들어 주세요.'
                      : !convertible.length
                        ? '변환할 구간을 골라 주세요.'
                        : estimate != null
                          ? `모두 ${formatDuration(totalSeconds)} · 예상 용량 약 ${formatBytes(estimate)}(어림값)`
                          : `모두 ${formatDuration(totalSeconds)}`}
                </p>
                {resultList.length > 0 && (
                  <Button icon={FileArchive} block onClick={saveZip}>
                    결과 {resultList.length}개 ZIP 으로 저장
                  </Button>
                )}
              </>
            )}
          </Section>
        </>
      }
    >
      {loadError && (
        <Callout tone="danger" title="영상을 열지 못했습니다">
          {loadError}
        </Callout>
      )}

      {!loaded ? (
        opening ? (
          <Stage>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Spinner /> 영상을 여는 중
            </div>
          </Stage>
        ) : (
          <Dropzone
            accept="video/*"
            multiple={false}
            icon={Film}
            title="자를 영상을 끌어다 놓으세요"
            hint="영상 1개 · 최대 2GB · 60분 이하 · MP4·WebM·MOV 처럼 브라우저가 재생할 수 있는 형식"
            onFiles={(files) => void loadFile(files[0])}
          />
        )
      ) : (
        <>
          <Dropzone
            compact
            accept="video/*"
            multiple={false}
            disabled={busy || opening}
            title={loaded.file.name}
            hint={
              <span className="num">
                {loaded.source.width} × {loaded.source.height}px · {formatDuration(duration)} · {formatBytes(loaded.file.size)}
              </span>
            }
            onFiles={(files) => void loadFile(files[0])}
          />

          <Stage minHeight={300}>
            {url && (
              <video
                ref={setPlayer}
                src={url}
                playsInline
                preload="auto"
                muted={muted}
                onClick={togglePlay}
                className="max-h-[56vh] max-w-full cursor-pointer rounded-sm shadow-2"
                aria-label="영상 미리보기. 누르면 재생하거나 멈춥니다."
              />
            )}
          </Stage>

          <Panel className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Transport video={player} duration={duration} onToggle={togglePlay} onSeek={seek} />
              <IconButton icon={muted ? VolumeX : Volume2} label={muted ? '소리 켜기' : '소리 끄기'} size="sm" onClick={() => setMuted((m) => !m)} />
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button size="sm" icon={Flag} disabled={busy} onClick={(e) => (blurAfterPointer(e), markStart())}>
                  시작 찍기
                </Button>
                <Button size="sm" variant={pendingStart != null ? 'primary' : 'secondary'} icon={Scissors} disabled={busy} onClick={(e) => (blurAfterPointer(e), markEnd())}>
                  끝 찍기
                </Button>
                {pendingStart != null && (
                  <Button size="sm" variant="ghost" icon={X} onClick={() => setPendingStart(null)}>
                    시작 지점 지우기
                  </Button>
                )}
              </div>
            </div>
            <Timeline video={player} duration={duration} ranges={ranges} activeId={activeId} pendingStart={pendingStart} zoom={zoom} onSeek={seek} onSelect={setActiveId} onEdge={setEdge} />
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1">
                  <Kbd>Space</Kbd> 재생·정지
                </span>
                <span className="inline-flex items-center gap-1">
                  <Kbd>I</Kbd> 시작 <Kbd>O</Kbd> 끝
                </span>
                <span className="inline-flex items-center gap-1">
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd> 1초(Shift 5초)
                </span>
                <span className="inline-flex items-center gap-1">
                  <Kbd>,</Kbd>
                  <Kbd>.</Kbd> 한 프레임
                </span>
              </p>
              <div className="flex items-center gap-1">
                <IconButton icon={ZoomOut} label="타임라인 축소" size="sm" disabled={zoom <= ZOOMS[0]} onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)])} />
                <span className="num w-9 text-center text-xs text-muted">{zoom}배</span>
                <IconButton icon={ZoomIn} label="타임라인 확대" size="sm" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)])} />
              </div>
            </div>
          </Panel>

          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-ink">구간 {ranges.length}개</h3>
                {ranges.length > 1 && <Checkbox checked={allSelected} disabled={busy} onChange={(v) => setRanges((list) => list.map((r) => ({ ...r, selected: v })))} label="모두 고르기" />}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" icon={Plus} disabled={busy} onClick={addAtCurrent}>
                  현재 위치에 5초 구간 추가
                </Button>
                {ranges.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    disabled={busy}
                    onClick={() => {
                      setRanges([])
                      setResults({})
                      setErrors({})
                      setActiveId(null)
                    }}
                  >
                    모두 지우기
                  </Button>
                )}
              </div>
            </div>
            {ranges.length === 0 ? (
              <EmptyState icon={Scissors} title="아직 구간이 없습니다">
                영상을 재생하다가 원하는 곳에서 "시작 찍기", 끝나는 곳에서 "끝 찍기"를 누르면 구간이 만들어집니다. 여러 구간을 만들어 한 번에 변환할 수 있습니다.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {ranges.map((r) => (
                  <RangeRow
                    key={r.id}
                    range={r}
                    active={r.id === activeId}
                    busy={busy}
                    working={busy && job != null && convertible[job.index]?.id === r.id}
                    problem={r.selected ? rangeProblem(r, output.format) : null}
                    error={errors[r.id]}
                    result={results[r.id]}
                    onActivate={() => setActiveId(r.id)}
                    onRename={(name) => patchRange(r.id, (x) => ({ ...x, name }))}
                    onSelect={(sel) => patchRange(r.id, (x) => ({ ...x, selected: sel }))}
                    onEdge={(edge, time) => setEdge(r.id, edge, time)}
                    onEdgeToCurrent={(edge) => player && setEdge(r.id, edge, player.currentTime)}
                    onPlay={() => playRange(r)}
                    onRemove={() => removeRange(r.id)}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </ToolLayout>
  )
}

function Transport({ video, duration, onToggle, onSeek }: { video: HTMLVideoElement | null; duration: number; onToggle: () => void; onSeek: (t: number) => void }) {
  const time = useCurrentTime(video)
  const playing = usePlaying(video)
  return (
    <div className="flex items-center gap-1.5">
      <IconButton icon={Rewind} label="1초 뒤로" size="sm" onClick={(e) => (blurAfterPointer(e), onSeek(time - 1))} />
      <IconButton icon={playing ? Pause : Play} label={playing ? '정지' : '재생'} variant="primary" onClick={(e) => (blurAfterPointer(e), onToggle())} />
      <IconButton icon={FastForward} label="1초 앞으로" size="sm" onClick={(e) => (blurAfterPointer(e), onSeek(time + 1))} />
      <span className="num ml-1 text-sm text-ink">
        {formatTime(time)} <span className="text-muted">/ {formatTime(duration)}</span>
      </span>
    </div>
  )
}

interface RangeRowProps {
  range: ClipRange
  active: boolean
  busy: boolean
  working: boolean
  problem: string | null
  error?: string
  result?: ResultItem
  onActivate: () => void
  onRename: (name: string) => void
  onSelect: (selected: boolean) => void
  onEdge: (edge: 'start' | 'end', time: number) => void
  onEdgeToCurrent: (edge: 'start' | 'end') => void
  onPlay: () => void
  onRemove: () => void
}

function RangeRow({ range, active, busy, working, problem, error, result, onActivate, onRename, onSelect, onEdge, onEdgeToCurrent, onPlay, onRemove }: RangeRowProps) {
  return (
    <li className={clsx('flex flex-col gap-2 px-4 py-3 transition-colors duration-150', active && 'bg-mark-soft')} onPointerDown={onActivate}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Checkbox checked={range.selected} disabled={busy} onChange={onSelect} label={<span className="sr-only">{range.name} 변환 대상으로 고르기</span>} />
        <TextInput
          value={range.name}
          onChange={(e) => onRename(e.target.value)}
          aria-label="구간 이름"
          maxLength={40}
          disabled={busy}
          className="h-8! min-w-28 flex-1 basis-28 px-2! text-sm!"
        />
        <div className="flex items-center gap-1">
          <IconButton icon={ChevronFirst} label="시작을 현재 재생 위치로" size="sm" disabled={busy} onClick={() => onEdgeToCurrent('start')} />
          <TimeInput value={range.start} onCommit={(t) => onEdge('start', t)} label={`${range.name} 시작`} disabled={busy} className="w-[5.5rem]!" />
          <span className="text-muted">–</span>
          <TimeInput value={range.end} onCommit={(t) => onEdge('end', t)} label={`${range.name} 끝`} disabled={busy} className="w-[5.5rem]!" />
          <IconButton icon={ChevronLast} label="끝을 현재 재생 위치로" size="sm" disabled={busy} onClick={() => onEdgeToCurrent('end')} />
        </div>
        <span className="num w-16 text-sm text-muted">{formatDuration(range.end - range.start)}</span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton icon={Play} label={`${range.name} 미리 재생`} size="sm" onClick={(e) => (blurAfterPointer(e), onPlay())} />
          <IconButton icon={Trash2} label={`${range.name} 삭제`} size="sm" disabled={busy} onClick={onRemove} />
        </div>
      </div>
      {working ? (
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
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Download} onClick={() => downloadBlob(result.blob, result.name)}>
              저장
            </Button>
            <SendToMenu size="sm" label="보내기" exclude="clips" files={[blobToFile(result.blob, result.name)]} />
          </div>
        </div>
      ) : null}
    </li>
  )
}
