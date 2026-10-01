import clsx from 'clsx'
import { Circle, Download, Maximize, MonitorPlay, Pause, Play, RotateCcw, ScreenShare, ScreenShareOff, Square, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_WATERMARK, type WatermarkSettings } from '@/app/config'
import { blobToFile, downloadBlob, formatBytes, todayStamp } from '@/lib/files'
import { useObjectUrl, usePersistentState } from '@/lib/hooks'
import { Badge, Button, Callout, Field, NumberInput, Panel, Progress, Section, Segmented, Select, SendToMenu, Slider, Spinner, Stage, Switch, ToolLayout, WatermarkControls, toast } from '@/ui'
import { computeLayout } from '../clips/shared/layout'
import { formatMbps } from '../clips/shared/OutputSettings'
import { formatDuration, formatTime } from '../clips/shared/time'
import { GIF_FPS_OPTIONS, GIF_MAX_SECONDS, GIF_SIZE_MAX, GIF_SIZE_MIN, clampGifLongSide, resolveBitrate, type QualityLevel } from '../clips/shared/types'
import { clampRect, fitRatio, fullRect, isFullRect, ratioValue, setRectField, type RatioLock, type Rect } from './crop'
import { CropOverlay } from './CropOverlay'
import { createTicker, startRecording, type Recording, type RecordingResult } from './recorder'
import { PROBLEM_TEXT, captureProblem, currentEnv, detectRecorderFormat, micErrorMessage, shareErrorMessage } from './support'

type Phase = 'idle' | 'ready' | 'countdown' | 'recording' | 'finishing' | 'done'

interface RecordSettings {
  mode: 'video' | 'gif'
  /** 0 = 영역 크기 그대로 */
  videoLongSide: number
  videoFps: number
  videoQuality: QualityLevel
  gifLongSide: number
  gifFps: number
  gifQuality: QualityLevel
  countdown: number
  mic: boolean
  systemAudio: boolean
  ratio: RatioLock
}

const DEFAULTS: RecordSettings = {
  mode: 'video',
  videoLongSide: 0,
  videoFps: 30,
  videoQuality: 'medium',
  gifLongSide: 640,
  gifFps: 10,
  gifQuality: 'medium',
  countdown: 3,
  mic: false,
  systemAudio: false,
  ratio: 'free',
}

const VIDEO_MAX_MS = 30 * 60 * 1000
const GIF_MAX_MS = GIF_MAX_SECONDS * 1000
/** 화면 녹화는 움직임이 적어 일반 영상보다 낮은 비트레이트로 충분하다. */
const SCREEN_BITRATE_FACTOR = 0.8

interface Result extends RecordingResult {
  name: string
}

function timeStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${todayStamp(d)}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export default function RecordTool() {
  const [settings, setSettings] = usePersistentState<RecordSettings>('onbijjang:record:settings', DEFAULTS)
  const [watermark, setWatermark] = usePersistentState<WatermarkSettings>('onbijjang:record:watermark', DEFAULT_WATERMARK)
  const set = (patch: Partial<RecordSettings>) => setSettings((s) => ({ ...s, ...patch }))
  const problem = useMemo(() => captureProblem(currentEnv()), [])
  const recorderFormat = useMemo(() => detectRecorderFormat(false), [])

  const [phase, setPhase] = useState<Phase>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [src, setSrc] = useState<{ w: number; h: number } | null>(null)
  const [crop, setCrop] = useState<Rect | null>(null)
  const [count, setCount] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resultUrl = useObjectUrl(result?.blob)

  const streamRef = useRef<MediaStream | null>(null)
  const micRef = useRef<MediaStream | null>(null)
  const recordingRef = useRef<Recording | null>(null)
  const stopCountdown = useRef<(() => void) | null>(null)
  const lastSrc = useRef<{ w: number; h: number } | null>(null)
  const alive = useRef(true)
  const phaseRef = useRef<Phase>(phase)
  phaseRef.current = phase

  const isVideo = settings.mode === 'video'
  const ratio = ratioValue(settings.ratio)
  // 결과를 보는 중에도 다음 녹화를 위해 설정을 바꿀 수 있다(이미 만든 결과에는 영향이 없다).
  const editable = phase === 'idle' || phase === 'ready' || phase === 'done'
  const maxMs = isVideo ? VIDEO_MAX_MS : GIF_MAX_MS
  const fps = isVideo ? settings.videoFps : settings.gifFps
  const longSide = isVideo ? settings.videoLongSide : clampGifLongSide(settings.gifLongSide)
  const layout = src && crop ? computeLayout(src.w, src.h, { aspect: 'source', fit: 'pad', longSide: longSide > 0 ? longSide : Infinity, even: isVideo, crop }) : null
  const bitrate = layout ? Math.max(500_000, Math.round(resolveBitrate({ videoBitrate: settings.videoQuality, videoMbps: 2 }, layout.width, layout.height, fps) * SCREEN_BITRATE_FACTOR)) : 0
  const videoName = recorderFormat?.kind === 'webm' ? 'WebM' : 'MP4'
  const hasSystemAudio = (stream?.getAudioTracks().length ?? 0) > 0

  const stopMic = () => {
    micRef.current?.getTracks().forEach((t) => t.stop())
    micRef.current = null
  }
  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    lastSrc.current = null
    setStream(null)
    setSrc(null)
    setCrop(null)
  }
  const cancelCountdown = () => {
    stopCountdown.current?.()
    stopCountdown.current = null
  }

  // 화면을 떠나면 공유·녹화·마이크를 모두 끈다.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      stopCountdown.current?.()
      recordingRef.current?.cancel()
      recordingRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      micRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // 공유 화면을 미리보기 <video> 에 연결하고 실제 크기를 따라간다(창 크기가 바뀌면 달라진다).
  useEffect(() => {
    if (!videoEl) return
    videoEl.srcObject = stream
    if (stream) void videoEl.play().catch(() => undefined)
    const sync = () => {
      const w = videoEl.videoWidth
      const h = videoEl.videoHeight
      if (w && h) setSrc((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    }
    videoEl.addEventListener('loadedmetadata', sync)
    videoEl.addEventListener('resize', sync)
    sync()
    return () => {
      videoEl.removeEventListener('loadedmetadata', sync)
      videoEl.removeEventListener('resize', sync)
      videoEl.srcObject = null
    }
  }, [videoEl, stream])

  useEffect(() => {
    if (!src) return
    const before = lastSrc.current
    lastSrc.current = src
    setCrop((prev) => {
      // 전체를 쓰고 있었으면 바뀐 크기에서도 전체, 영역을 정해 두었으면 화면 안으로만 맞춘다.
      if (!prev || (before && isFullRect(prev, before.w, before.h))) return fitRatio(fullRect(src.w, src.h), ratioValue(settings.ratio), src.w, src.h)
      return clampRect(prev, src.w, src.h)
    })
    // 비율 설정이 바뀔 때는 아래 changeRatio 에서 따로 맞춘다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  const finish = async () => {
    const rec = recordingRef.current
    if (!rec) return
    recordingRef.current = null
    setPhase('finishing')
    try {
      const res = await rec.stop()
      if (!alive.current) return
      setResult({ ...res, name: `화면녹화_${timeStamp()}.${res.ext}` })
      setPhase('done')
    } catch (err) {
      if (!alive.current) return
      setError(err instanceof Error ? err.message : '녹화를 저장하지 못했습니다.')
      setPhase(streamRef.current ? 'ready' : 'idle')
    } finally {
      stopMic()
    }
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  const onShareEnded = async () => {
    if (!alive.current) return
    cancelCountdown()
    if (recordingRef.current) {
      toast.info('화면 공유가 끝나 녹화를 마무리했습니다.')
      await finishRef.current()
      if (alive.current) stopStream()
      return
    }
    stopMic()
    stopStream()
    if (phaseRef.current !== 'done' && phaseRef.current !== 'finishing') {
      setPhase('idle')
      toast.info('화면 공유가 끝났습니다.')
    }
  }
  const shareEndedRef = useRef(onShareEnded)
  shareEndedRef.current = onShareEnded

  const share = async () => {
    if (problem) return
    setError(null)
    let next: MediaStream
    try {
      next = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: isVideo && settings.systemAudio })
    } catch (err) {
      const message = shareErrorMessage(err)
      if (message && alive.current) setError(message)
      return
    }
    if (!alive.current) return next.getTracks().forEach((t) => t.stop())
    const track = next.getVideoTracks()[0]
    if (!track) {
      next.getTracks().forEach((t) => t.stop())
      setError('공유한 화면에서 영상을 받지 못했습니다. 다시 시도해 주세요.')
      return
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    track.addEventListener('ended', () => {
      if (streamRef.current === next) void shareEndedRef.current()
    })
    streamRef.current = next
    lastSrc.current = null
    setSrc(null)
    setCrop(null)
    setStream(next)
    setResult(null)
    setPhase('ready')
  }

  const endShare = () => {
    cancelCountdown()
    stopMic()
    stopStream()
    setPhase(result ? 'done' : 'idle')
  }

  const startNow = async () => {
    const live = streamRef.current
    if (!alive.current || !live || !videoEl || !crop) return
    const audioTracks = isVideo ? [...(settings.systemAudio ? live.getAudioTracks() : []), ...(micRef.current?.getAudioTracks() ?? [])] : []
    try {
      const rec = await startRecording({
        mode: settings.mode,
        source: videoEl,
        crop,
        longSide,
        fps,
        bitrate,
        gifQuality: settings.gifQuality,
        watermark,
        audioTracks,
        maxMs,
        onElapsed: (ms) => alive.current && setElapsed(ms),
        onLimit: () => {
          toast.info(isVideo ? '30분이 되어 녹화를 끝냈습니다.' : 'GIF 는 60초까지라 녹화를 끝냈습니다.')
          void finishRef.current()
        },
        onError: (err) => {
          if (alive.current) setError(err.message)
          void finishRef.current()
        },
      })
      if (!alive.current || streamRef.current !== live) return rec.cancel()
      recordingRef.current = rec
      setElapsed(0)
      setPaused(false)
      setPhase('recording')
    } catch (err) {
      stopMic()
      if (!alive.current) return
      setError(err instanceof Error ? err.message : '녹화를 시작하지 못했습니다.')
      setPhase('ready')
    }
  }

  const begin = async () => {
    if (phase !== 'ready' || !videoEl || !crop || !src) return
    setError(null)
    if (isVideo && settings.mic) {
      try {
        micRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      } catch (err) {
        setError(micErrorMessage(err))
        return
      }
      if (!alive.current || phaseRef.current !== 'ready' || !streamRef.current) return stopMic()
    }
    if (settings.countdown <= 0) return void startNow()
    const endAt = performance.now() + settings.countdown * 1000
    let fired = false
    setCount(settings.countdown)
    setPhase('countdown')
    // 카운트다운 중에 녹화할 창으로 넘어가면 이 탭이 가려지므로 워커 박자로 센다.
    stopCountdown.current = createTicker(100, () => {
      if (fired) return
      const left = endAt - performance.now()
      if (left <= 0) {
        fired = true
        cancelCountdown()
        void startNow()
      } else if (alive.current) setCount(Math.ceil(left / 1000))
    })
  }

  const cancelBegin = () => {
    cancelCountdown()
    stopMic()
    setPhase('ready')
  }
  const togglePause = () => {
    const rec = recordingRef.current
    if (!rec) return
    if (rec.paused) rec.resume()
    else rec.pause()
    setPaused(rec.paused)
  }
  const discard = () => {
    recordingRef.current?.cancel()
    recordingRef.current = null
    stopMic()
    setPhase(streamRef.current ? 'ready' : 'idle')
    toast.info('녹화한 내용을 버렸습니다.')
  }
  const again = () => {
    setResult(null)
    setError(null)
    setPhase(streamRef.current ? 'ready' : 'idle')
  }

  const changeRatio = (next: RatioLock) => {
    set({ ratio: next })
    if (src) setCrop((c) => (c ? fitRatio(c, ratioValue(next), src.w, src.h) : c))
  }
  const changeField = (field: keyof Rect, value: number | null) => {
    if (value == null || !src) return
    setCrop((c) => (c ? setRectField(c, field, value, ratio, src.w, src.h) : c))
  }

  const showLive = stream != null && phase !== 'done'
  const aspect = src ? src.w / src.h : 16 / 9

  return (
    <ToolLayout
      panel={
        <>
          <Section title="녹화 형식" hint={isVideo ? `${videoName} 영상으로 최대 30분까지 녹화합니다.` : `GIF 로 최대 ${GIF_MAX_SECONDS}초까지 녹화합니다. 소리는 담기지 않습니다.`}>
            <Segmented
              label="녹화 형식"
              block
              value={settings.mode}
              onValue={(mode) => set({ mode })}
              options={[
                { value: 'video', label: `영상(${videoName})`, disabled: !editable },
                { value: 'gif', label: 'GIF', disabled: !editable },
              ]}
            />
            {isVideo && recorderFormat?.kind === 'webm' && (
              <Callout tone="info" title="이 브라우저에서는 WebM 으로 저장됩니다">
                MP4 녹화를 지원하지 않는 브라우저입니다. MP4 가 꼭 필요하면 크롬이나 엣지에서 녹화해 주세요.
              </Callout>
            )}
            {isVideo && !recorderFormat && (
              <Callout tone="warn" title="이 브라우저는 영상 녹화를 지원하지 않습니다">
                GIF 로 바꾸거나 최신 크롬·엣지에서 열어 주세요.
              </Callout>
            )}
          </Section>

          <Section
            title="녹화 영역"
            hint={src && crop ? '미리보기에서 끌어서 정합니다. 영역을 누른 뒤 방향키로 1px(Shift 10px)씩 옮기고, Alt+방향키로 크기를 바꿉니다.' : '화면을 공유하면 미리보기에서 영역을 정할 수 있습니다.'}
            action={
              src && crop && !isFullRect(crop, src.w, src.h) ? (
                <Button size="sm" variant="ghost" icon={Maximize} disabled={!editable} onClick={() => setCrop(fitRatio(fullRect(src.w, src.h), ratio, src.w, src.h))}>
                  전체
                </Button>
              ) : undefined
            }
          >
            <Segmented<RatioLock>
              label="영역 비율"
              block
              size="sm"
              value={settings.ratio}
              onValue={changeRatio}
              options={[
                { value: 'free', label: '자유', disabled: !editable },
                { value: '1:1', label: '1:1', disabled: !editable },
                { value: '16:9', label: '16:9', disabled: !editable },
                { value: '4:3', label: '4:3', disabled: !editable },
              ]}
            />
            {src && crop && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                <Field label="왼쪽">{(id) => <NumberInput id={id} unit="px" min={0} max={src.w} step={1} disabled={!editable} value={crop.x} onValue={(v) => changeField('x', v)} />}</Field>
                <Field label="위">{(id) => <NumberInput id={id} unit="px" min={0} max={src.h} step={1} disabled={!editable} value={crop.y} onValue={(v) => changeField('y', v)} />}</Field>
                <Field label="너비">{(id) => <NumberInput id={id} unit="px" min={16} max={src.w} step={1} disabled={!editable} value={crop.w} onValue={(v) => changeField('w', v)} />}</Field>
                <Field label="높이">{(id) => <NumberInput id={id} unit="px" min={16} max={src.h} step={1} disabled={!editable} value={crop.h} onValue={(v) => changeField('h', v)} />}</Field>
              </div>
            )}
          </Section>

          <Section title="크기·화질" hint={layout ? <span className="num">결과 크기 {layout.width} × {layout.height}px{isVideo && ` · 약 ${formatMbps(bitrate)}`}</span> : undefined}>
            {isVideo ? (
              <>
                <Field label="해상도(긴 변)" hint="영역보다 크게 만들지는 않습니다.">
                  {(id) => (
                    <Select
                      id={id}
                      disabled={!editable}
                      value={String(settings.videoLongSide)}
                      onValue={(v) => set({ videoLongSide: Number(v) })}
                      options={[
                        { value: '0', label: '영역 크기 그대로' },
                        { value: '1920', label: '1920px' },
                        { value: '1280', label: '1280px' },
                        { value: '854', label: '854px' },
                      ]}
                    />
                  )}
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-ink-2">초당 프레임</span>
                  <Segmented
                    label="초당 프레임"
                    block
                    size="sm"
                    value={String(settings.videoFps)}
                    onValue={(v) => set({ videoFps: Number(v) })}
                    options={[15, 30].map((f) => ({ value: String(f), label: `${f}`, disabled: !editable }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-ink-2">화질</span>
                  <Segmented<QualityLevel>
                    label="화질"
                    block
                    size="sm"
                    value={settings.videoQuality}
                    onValue={(videoQuality) => set({ videoQuality })}
                    options={[
                      { value: 'high', label: '높음', disabled: !editable },
                      { value: 'medium', label: '보통', disabled: !editable },
                      { value: 'low', label: '작게', disabled: !editable },
                    ]}
                  />
                </div>
              </>
            ) : (
              <>
                <Field label="긴 변" aside={`${settings.gifLongSide}px`}>
                  {(id) => <Slider id={id} disabled={!editable} min={GIF_SIZE_MIN} max={GIF_SIZE_MAX} step={40} value={settings.gifLongSide} onValue={(gifLongSide) => set({ gifLongSide })} />}
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-ink-2">초당 프레임</span>
                  <Segmented
                    label="초당 프레임"
                    block
                    size="sm"
                    value={String(settings.gifFps)}
                    onValue={(v) => set({ gifFps: Number(v) })}
                    options={GIF_FPS_OPTIONS.map((f) => ({ value: String(f), label: `${f}`, disabled: !editable }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-ink-2">색 품질</span>
                  <Segmented<QualityLevel>
                    label="색 품질"
                    block
                    size="sm"
                    value={settings.gifQuality}
                    onValue={(gifQuality) => set({ gifQuality })}
                    options={[
                      { value: 'high', label: '높음 256색', disabled: !editable },
                      { value: 'medium', label: '보통 128색', disabled: !editable },
                      { value: 'low', label: '작게 64색', disabled: !editable },
                    ]}
                  />
                </div>
              </>
            )}
          </Section>

          {isVideo && (
            <Section title="소리">
              <Switch checked={settings.mic} onChange={(mic) => set({ mic })} disabled={!editable} label="마이크" hint="녹화를 시작할 때 마이크 권한을 묻습니다." />
              <Switch
                checked={settings.systemAudio}
                onChange={(systemAudio) => set({ systemAudio })}
                disabled={!editable}
                label="컴퓨터 소리"
                hint="화면을 고르는 창에서 '오디오도 공유'를 켜야 담깁니다. 크롬·엣지의 탭 또는 전체 화면 공유에서 됩니다."
              />
              {settings.systemAudio && stream && !hasSystemAudio && (
                <Callout tone="warn" title="지금 공유에는 소리가 없습니다">
                  "화면 다시 고르기"를 눌러 공유 창에서 오디오 공유를 켜 주세요. 창 하나만 공유할 때는 소리를 받을 수 없습니다.
                </Callout>
              )}
            </Section>
          )}

          <Section title="시작 전 카운트다운" hint="녹화할 창으로 넘어갈 시간을 줍니다.">
            <Segmented
              label="시작 전 카운트다운"
              block
              size="sm"
              value={String(settings.countdown)}
              onValue={(v) => set({ countdown: Number(v) })}
              options={[
                { value: '0', label: '없음', disabled: !editable },
                { value: '3', label: '3초', disabled: !editable },
                { value: '5', label: '5초', disabled: !editable },
              ]}
            />
          </Section>

          <Section title="워터마크" hint="녹화되는 모든 장면에 들어갑니다.">
            <WatermarkControls value={watermark} onChange={setWatermark} />
          </Section>
        </>
      }
    >
      {problem && (
        <Callout tone="warn" title={PROBLEM_TEXT[problem].title}>
          {PROBLEM_TEXT[problem].body}
        </Callout>
      )}
      {error && (
        <Callout tone="danger" title="문제가 생겼습니다">
          {error}
        </Callout>
      )}

      <Stage minHeight={360}>
        {phase === 'done' && result && resultUrl && (
          <>
            {result.kind === 'gif' ? (
              <img src={resultUrl} alt="녹화한 GIF 미리보기" className="max-h-[60vh] max-w-full rounded-sm shadow-2" />
            ) : (
              <video src={resultUrl} controls playsInline className="max-h-[60vh] max-w-full rounded-sm shadow-2" aria-label="녹화한 영상 미리보기" />
            )}
          </>
        )}
        {stream && (
          <div className={clsx('relative w-full', !showLive && 'hidden')} style={{ aspectRatio: `${aspect}`, maxWidth: `min(100%, calc(60vh * ${aspect}))` }}>
            <video ref={setVideoEl} muted playsInline className="absolute inset-0 size-full rounded-xs bg-ink shadow-2" aria-label="공유 중인 화면 미리보기" />
            {src && crop && <CropOverlay rect={crop} bounds={src} ratio={ratio} locked={phase !== 'ready'} recording={phase === 'recording'} onChange={setCrop} />}
            {phase === 'countdown' && (
              <div className="absolute inset-0 flex items-center justify-center bg-ink/50" role="status" aria-live="assertive">
                <span className="num flex size-28 items-center justify-center rounded-full bg-surface text-ink shadow-3">
                  <span className="scale-[2.4] text-2xl font-bold">{count}</span>
                </span>
              </div>
            )}
            {phase === 'finishing' && (
              <div className="absolute inset-0 flex items-center justify-center bg-ink/50" role="status">
                <span className="flex items-center gap-2 rounded-md bg-surface px-4 py-2.5 text-sm font-semibold text-ink shadow-3">
                  <Spinner /> {isVideo ? '녹화를 정리하는 중' : 'GIF 를 만드는 중'}
                </span>
              </div>
            )}
          </div>
        )}
        {!stream && phase !== 'done' && (
          <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-line bg-surface px-6 py-8 text-center text-ink shadow-2">
            <MonitorPlay className="size-8 text-brand" aria-hidden />
            <p className="text-lg font-semibold">녹화할 화면을 골라 주세요</p>
            <p className="text-sm text-muted">화면 전체, 창 하나, 브라우저 탭 가운데 고를 수 있습니다. 고른 뒤 미리보기에서 녹화할 영역을 끌어서 정합니다. 화면은 이 기기에서만 처리되고 어디로도 전송되지 않습니다.</p>
            <Button variant="primary" size="lg" icon={ScreenShare} disabled={problem != null} onClick={share}>
              화면 공유 시작
            </Button>
          </div>
        )}
      </Stage>

      {phase === 'ready' && (
        <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="num text-sm text-ink-2">
            {src && crop && layout ? (
              <>
                영역 {crop.w} × {crop.h}px
                {(layout.width !== crop.w || layout.height !== crop.h) && ` → 결과 ${layout.width} × ${layout.height}px`}
              </>
            ) : (
              '공유 화면을 불러오는 중'
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" icon={ScreenShareOff} onClick={endShare}>
              공유 끝내기
            </Button>
            <Button icon={ScreenShare} onClick={share}>
              화면 다시 고르기
            </Button>
            <Button variant="primary" icon={Circle} disabled={!src || !crop || (isVideo && !recorderFormat)} onClick={begin}>
              녹화 시작
            </Button>
          </div>
        </Panel>
      )}

      {phase === 'countdown' && (
        <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm font-semibold text-ink" role="status">
            <span className="num">{count}</span>초 뒤 녹화를 시작합니다. 녹화할 창으로 넘어가세요.
          </p>
          <Button icon={X} onClick={cancelBegin}>
            취소
          </Button>
        </Panel>
      )}

      {phase === 'recording' && (
        <Panel className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink" role="status">
              <span className={clsx('size-2.5 rounded-full', paused ? 'bg-faint' : 'animate-pulse bg-danger')} aria-hidden />
              {paused ? '일시정지' : '녹화 중'}
              <span className="num font-normal text-ink-2">
                {formatTime(elapsed / 1000, false)} / {formatTime(maxMs / 1000, false)}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="danger" icon={Trash2} onClick={discard}>
                버리기
              </Button>
              <Button icon={paused ? Play : Pause} onClick={togglePause}>
                {paused ? '계속 녹화' : '일시정지'}
              </Button>
              <Button variant="primary" icon={Square} onClick={() => void finish()}>
                녹화 끝내기
              </Button>
            </div>
          </div>
          <Progress value={(elapsed / maxMs) * 100} />
          <p className="text-sm text-muted">다른 창으로 넘어가도 녹화는 계속됩니다. 브라우저의 "공유 중지"를 눌러도 녹화가 끝나고 저장할 수 있습니다.</p>
        </Panel>
      )}

      {phase === 'finishing' && !stream && (
        <Panel className="flex items-center gap-2 p-4 text-sm font-semibold text-ink" role="status">
          <Spinner /> {isVideo ? '녹화를 정리하는 중' : 'GIF 를 만드는 중'}
        </Panel>
      )}

      {phase === 'done' && result && (
        <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge tone="brand">{result.kind.toUpperCase()}</Badge>
            <span className="num text-sm text-ink-2">
              {result.width} × {result.height}px · {formatDuration(result.ms / 1000)} · {formatBytes(result.blob.size)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={RotateCcw} onClick={again}>
              다시 녹화
            </Button>
            {stream && (
              <Button variant="ghost" icon={ScreenShareOff} onClick={endShare}>
                공유 끝내기
              </Button>
            )}
            <SendToMenu exclude="record" files={[blobToFile(result.blob, result.name)]} />
            <Button variant="primary" icon={Download} onClick={() => downloadBlob(result.blob, result.name)}>
              저장
            </Button>
          </div>
        </Panel>
      )}
    </ToolLayout>
  )
}
