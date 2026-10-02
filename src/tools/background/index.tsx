import { Blend, Brush, Download, Eraser, Eye, FolderArchive, Hand, ImagePlus, Pipette, Redo2, Trash2, Undo2, Upload, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTeamPresets } from '@/app/config'
import { useHandoffFiles } from '@/app/handoff'
import { blobToFile, downloadBlob, downloadZip, formatBytes, todayStamp } from '@/lib/files'
import { useAbortable, useDebounced, usePersistentState } from '@/lib/hooks'
import { ctx2d, fitWithin, hexToRgb, makeCanvas, resizeCanvas } from '@/lib/image'
import { Button, Callout, ColorField, Dropzone, EmptyState, Field, IconButton, Kbd, NumberInput, Progress, Section, Segmented, Select, SendToMenu, Slider, Switch, ToolLayout, toast } from '@/ui'
import { ACCEPT_IMAGES, DEFAULT_EXPORT, ExportFields, FileStrip, MAX_FILE_BYTES, encodeCanvas, exportName, newId, openImage, takeImageFiles, type ExportSettings } from './common'
import { DEFAULT_BACKGROUND, DEFAULT_THUMB, canvasToMask, composeFull, composeThumb, cutout, maskToCanvas, type BackgroundSettings, type ThumbSettings } from './compose'
import { colorKeyMask, coverage, detectBackgroundColor } from './mask'
import { MODELS, MODEL_HOST, MODEL_ORDER, modelInputSize, type ModelKey } from './models'
import type { SegmentRequest, SegmentResponse } from './segment.worker'
import { Viewport, ZoomControls, type ImagePoint } from './viewport'

const MAX_FILES = 30
/** 마스크(누끼)를 만들고 다듬는 해상도의 긴 변. 저장할 때는 원본 크기에 맞춰 부드럽게 늘린다. */
const MASK_EDGE = 2048
const HISTORY_LIMIT = 40

type Method = 'auto' | 'color'
type Tool = 'erase' | 'restore' | 'pick' | 'pan'
type Status = 'pending' | 'working' | 'done' | 'error'

interface Item {
  id: string
  file: File
  name: string
  width: number
  height: number
  thumb: string | null
  status: Status
  error?: string
  /** 마스크가 바뀔 때마다 올라간다(다시 그리기 신호) */
  rev: number
}
interface StoredMask {
  alpha: Uint8Array
  w: number
  h: number
}
interface ColorKeySettings {
  auto: boolean
  color: string
  tolerance: number
  softness: number
  contiguous: boolean
}
interface StrokePatch {
  x: number
  y: number
  before: ImageData
  after: ImageData
}

const DEFAULT_COLOR_KEY: ColorKeySettings = { auto: true, color: '#ffffff', tolerance: 18, softness: 12, contiguous: true }
const STATUS_LABEL: Record<Status, string | null> = { pending: '대기', working: '처리 중', done: null, error: '실패' }
const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'
const toHex = (c: { r: number; g: number; b: number }) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** 누끼 결과를 체커 없이 작은 미리보기로 만든다(목록용). */
function cutoutThumb(image: HTMLCanvasElement, mask: HTMLCanvasElement): string {
  const fit = fitWithin(image.width, image.height, 160)
  const small = makeCanvas(fit.width, fit.height)
  const ctx = ctx2d(small)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cutout(image, mask, 0), 0, 0, small.width, small.height)
  return small.toDataURL('image/webp', 0.7)
}

class SegmentError extends Error {
  constructor(
    public stage: 'load' | 'run',
    message: string,
  ) {
    super(message)
  }
}

export default function BackgroundTool() {
  const presets = useTeamPresets()
  const [items, setItems] = useState<Item[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = items.find((i) => i.id === activeId) ?? null
  const itemsRef = useRef(items)
  itemsRef.current = items
  const masks = useRef(new Map<string, StoredMask>())

  const [method, setMethod] = usePersistentState<Method>('onbijjang:background:method', 'auto')
  const [modelKey, setModelKey] = usePersistentState<ModelKey>('onbijjang:background:model', 'fast')
  const [downloaded, setDownloaded] = usePersistentState<ModelKey[]>('onbijjang:background:downloaded', [])
  const [colorKey, setColorKey] = usePersistentState<ColorKeySettings>('onbijjang:background:colorKey', DEFAULT_COLOR_KEY)
  const [bg, setBg] = usePersistentState<BackgroundSettings>('onbijjang:background:bg', DEFAULT_BACKGROUND)
  const [thumb, setThumb] = usePersistentState<ThumbSettings>('onbijjang:background:thumb', DEFAULT_THUMB)
  const [feather, setFeather] = usePersistentState('onbijjang:background:feather', 1)
  const [brush, setBrush] = usePersistentState('onbijjang:background:brush', 12)
  const [exp, setExp] = usePersistentState<ExportSettings>('onbijjang:background:export', DEFAULT_EXPORT)

  const [tool, setTool] = useState<Tool>('erase')
  const [zoom, setZoom] = useState(1)
  const [comparing, setComparing] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [task, setTask] = useState<{ label: string; value: number | null } | null>(null)
  const [autoError, setAutoError] = useState<{ stage: 'load' | 'run'; message: string } | null>(null)
  const [hover, setHover] = useState<ImagePoint | null>(null)
  const [bgImage, setBgImage] = useState<{ name: string; bitmap: ImageBitmap } | null>(null)
  const [history, setHistory] = useState<{ past: StrokePatch[]; future: StrokePatch[] }>({ past: [], future: [] })
  /** 붓질·설정 변경 뒤 썸네일 미리보기를 다시 그리라는 신호 */
  const [paintRev, setPaintRev] = useState(0)

  const viewRef = useRef<HTMLCanvasElement>(null)
  const thumbRef = useRef<HTMLCanvasElement>(null)
  const workRef = useRef<HTMLCanvasElement | null>(null)
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  const beforeRef = useRef<HTMLCanvasElement | null>(null)
  const stroke = useRef<{ last: ImagePoint; x0: number; y0: number; x1: number; y1: number } | null>(null)
  const frame = useRef(0)
  const worker = useRef<Worker | null>(null)
  const pending = useRef(new Map<number, { resolve: (r: SegmentResponse) => void; onProgress?: (percent: number) => void }>())
  const seq = useRef(0)
  const { start: startRun, abort: abortRun } = useAbortable()
  const bgInput = useRef<HTMLInputElement>(null)
  const busy = task !== null

  // 긴 작업 안에서 최신 설정을 읽기 위한 참조
  const latest = useRef({ method, modelKey, colorKey, downloaded })
  latest.current = { method, modelKey, colorKey, downloaded }

  // ── 자동 지우기 작업자 ──────────────────────────────────
  const callWorker = useCallback((build: (id: number) => SegmentRequest, transfer: Transferable[], onProgress?: (percent: number) => void) => {
    if (!worker.current) {
      const w = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<SegmentResponse>) => {
        const entry = pending.current.get(e.data.id)
        if (!entry) return
        if (e.data.type === 'progress') return entry.onProgress?.(e.data.percent)
        pending.current.delete(e.data.id)
        entry.resolve(e.data)
      }
      w.onerror = (e) => {
        // 작업자 자체를 불러오지 못한 경우(실행기 파일 누락 등)
        for (const [id, entry] of pending.current) entry.resolve({ type: 'error', id, stage: 'load', message: e.message || '자동 지우기 실행기를 불러오지 못했습니다.' })
        pending.current.clear()
        w.terminate()
        worker.current = null
      }
      worker.current = w
    }
    const id = ++seq.current
    return new Promise<SegmentResponse>((resolve) => {
      pending.current.set(id, { resolve, onProgress })
      worker.current!.postMessage(build(id), transfer)
    })
  }, [])
  useEffect(
    () => () => {
      worker.current?.terminate()
      worker.current = null
    },
    [],
  )

  /** 사진 한 장의 마스크를 만든다. */
  const segment = useCallback(
    async (item: Item, how: Method): Promise<{ mask: StoredMask; thumb: string }> => {
      const bmp = await openImage(item.file)
      try {
        const fit = fitWithin(bmp.width, bmp.height, MASK_EDGE)
        const guide = resizeCanvas(bmp, fit.width, fit.height)
        const guideData = ctx2d(guide, true).getImageData(0, 0, guide.width, guide.height)
        let alpha: Uint8Array
        if (how === 'color') {
          const ck = latest.current.colorKey
          const color = ck.auto ? detectBackgroundColor(guideData.data, guide.width, guide.height) : hexToRgb(ck.color)
          alpha = colorKeyMask(guideData.data, guide.width, guide.height, { color, tolerance: ck.tolerance, softness: ck.softness, contiguous: ck.contiguous })
        } else {
          const model = latest.current.modelKey
          const size = modelInputSize(MODELS[model], guide.width, guide.height)
          const input = resizeCanvas(guide, size.width, size.height)
          const inputData = ctx2d(input, true).getImageData(0, 0, size.width, size.height).data
          const inputBuffer = inputData.buffer.slice(0) as ArrayBuffer
          const guideBuffer = guideData.data.buffer.slice(0) as ArrayBuffer
          const res = await callWorker(
            (id) => ({ type: 'run', id, model, input: inputBuffer, inputWidth: size.width, inputHeight: size.height, guide: guideBuffer, width: guide.width, height: guide.height }),
            [inputBuffer, guideBuffer],
          )
          if (res.type === 'error') throw new SegmentError(res.stage, res.message)
          if (res.type !== 'result') throw new SegmentError('run', '결과를 받지 못했습니다.')
          alpha = new Uint8Array(res.mask)
        }
        const mask = { alpha, w: guide.width, h: guide.height }
        return { mask, thumb: cutoutThumb(guide, maskToCanvas(alpha, guide.width, guide.height)) }
      } finally {
        bmp.close()
      }
    },
    [callWorker],
  )

  /** 여러 장을 차례로 처리한다(진행률·취소). */
  const process = useCallback(
    async (targets: Item[], how: Method) => {
      if (!targets.length) return
      const signal = startRun()
      setAutoError(null)
      const ids = new Set(targets.map((t) => t.id))
      setItems((prev) => prev.map((p) => (ids.has(p.id) ? { ...p, status: 'pending', error: undefined } : p)))
      let odd = 0
      try {
        if (how === 'auto') {
          const model = latest.current.modelKey
          const spec = MODELS[model]
          const first = !latest.current.downloaded.includes(model)
          setTask({ label: first ? `자동 지우기 자료 받는 중 (${formatBytes(spec.bytes)})` : '자동 지우기 준비 중', value: first ? 0 : null })
          const res = await callWorker(
            (id) => ({ type: 'load', id, model }),
            [],
            (percent) => setTask({ label: `자동 지우기 자료 받는 중 (${formatBytes(spec.bytes)})`, value: percent }),
          )
          if (res.type === 'error') throw new SegmentError('load', res.message)
          setDownloaded((cur) => (cur.includes(model) ? cur : [...cur, model]))
        }
        for (let n = 0; n < targets.length; n++) {
          if (signal.aborted) throw new DOMException('취소', 'AbortError')
          const it = targets[n]
          setTask({ label: targets.length > 1 ? `배경 지우는 중 (${n + 1}/${targets.length})` : '배경 지우는 중', value: targets.length > 1 ? (n / targets.length) * 100 : null })
          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: 'working' } : p)))
          try {
            const { mask, thumb: th } = await segment(it, how)
            if (signal.aborted) throw new DOMException('취소', 'AbortError')
            masks.current.set(it.id, mask)
            const cov = coverage(mask.alpha)
            if (cov < 0.005 || cov > 0.995) odd++
            setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: 'done', thumb: th, rev: p.rev + 1 } : p)))
          } catch (err) {
            if (isAbort(err) || (err instanceof SegmentError && err.stage === 'load')) throw err
            const message = err instanceof Error ? err.message : '배경을 지우지 못했습니다.'
            setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: 'error', error: message } : p)))
            if (err instanceof SegmentError) throw err
          }
        }
        if (odd) toast.warn(`${odd}장은 배경과 물건을 잘 구분하지 못했습니다. 다른 방식으로 바꾸거나 브러시로 다듬어 주세요.`)
      } catch (err) {
        setItems((prev) => prev.map((p) => (ids.has(p.id) && (p.status === 'working' || (p.status === 'pending' && !masks.current.has(p.id))) ? { ...p, status: masks.current.has(p.id) ? 'done' : 'pending' } : p)))
        // 다시 처리하려다 멈춘 사진은 이전 결과를 그대로 둔다.
        setItems((prev) => prev.map((p) => (ids.has(p.id) && p.status === 'pending' && masks.current.has(p.id) ? { ...p, status: 'done' } : p)))
        if (err instanceof SegmentError) setAutoError({ stage: err.stage, message: err.message })
        else if (!isAbort(err)) toast.error(err instanceof Error ? err.message : '배경을 지우지 못했습니다.')
      } finally {
        setTask(null)
      }
    },
    [callWorker, startRun, segment, setDownloaded],
  )

  // ── 파일 받기 ───────────────────────────────────────────
  const addFiles = useCallback(
    async (incoming: File[]) => {
      const files = takeImageFiles(incoming, itemsRef.current.length, MAX_FILES)
      if (!files.length) return
      const fresh: Item[] = files.map((file) => ({ id: newId(), file, name: file.name, width: 0, height: 0, thumb: null, status: 'pending', rev: 0 }))
      setItems((prev) => [...prev, ...fresh])
      setActiveId((cur) => cur ?? fresh[0].id)
      const opened: Item[] = []
      for (const it of fresh) {
        try {
          const bmp = await openImage(it.file)
          const fit = fitWithin(bmp.width, bmp.height, 160)
          const small = makeCanvas(fit.width, fit.height)
          ctx2d(small).drawImage(bmp, 0, 0, small.width, small.height)
          const patch = { width: bmp.width, height: bmp.height, thumb: small.toDataURL('image/webp', 0.7) }
          bmp.close()
          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, ...patch } : p)))
          opened.push({ ...it, ...patch })
        } catch (err) {
          toast.error(`${it.name}: ${err instanceof Error ? err.message : '사진을 열 수 없습니다.'}`)
          setItems((prev) => prev.filter((p) => p.id !== it.id))
          setActiveId((cur) => (cur === it.id ? (itemsRef.current.find((p) => p.id !== it.id)?.id ?? null) : cur))
        }
      }
      // 색으로 지우기는 내려받을 것이 없으니 바로, 자동은 자료를 이미 받은 경우에만 바로 시작한다.
      const { method: m, modelKey: key, downloaded: got } = latest.current
      if (opened.length && (m === 'color' || got.includes(key))) void process(opened, m)
    },
    [process],
  )
  useHandoffFiles('background', addFiles)

  // ── 고른 사진을 작업 캔버스에 올리기 ────────────────────
  const redraw = useCallback(() => {
    const view = viewRef.current
    const work = workRef.current
    if (!view || !work) return
    const mask = maskRef.current
    if (!mask || comparingRef.current) {
      if (view.width !== work.width || view.height !== work.height) {
        view.width = work.width
        view.height = work.height
      }
      const ctx = ctx2d(view)
      ctx.clearRect(0, 0, view.width, view.height)
      ctx.drawImage(work, 0, 0)
      return
    }
    const s = drawState.current
    composeFull({ image: work, mask, feather: s.feather, background: s.bg, bgImage: s.bgImage }, view)
  }, [])
  const comparingRef = useRef(comparing)
  comparingRef.current = comparing
  const drawState = useRef({ feather, bg, bgImage: bgImage?.bitmap ?? null })
  drawState.current = { feather, bg, bgImage: bgImage?.bitmap ?? null }

  const activeFile = active?.file
  const activeRev = active?.rev
  const mounted = !!active && active.width > 0
  useEffect(() => {
    setReady(false)
    setLoadError(null)
    setHistory({ past: [], future: [] })
    stroke.current = null
    workRef.current = null
    maskRef.current = null
    if (!activeFile || !activeId || !mounted) return
    let alive = true
    openImage(activeFile)
      .then((bmp) => {
        if (!alive) return bmp.close()
        const fit = fitWithin(bmp.width, bmp.height, MASK_EDGE)
        workRef.current = resizeCanvas(bmp, fit.width, fit.height)
        bmp.close()
        const stored = masks.current.get(activeId)
        maskRef.current = stored ? maskToCanvas(stored.alpha, stored.w, stored.h) : null
        redraw()
        setReady(true)
        setPaintRev((n) => n + 1)
      })
      .catch((err) => alive && setLoadError(err instanceof Error ? err.message : '사진을 열 수 없습니다.'))
    return () => {
      alive = false
    }
  }, [activeId, activeFile, activeRev, mounted, redraw])
  useEffect(() => setZoom(1), [activeId])

  // 설정이 바뀌면 다시 그린다.
  useEffect(() => {
    if (ready) redraw()
  }, [ready, redraw, feather, bg, bgImage, comparing])

  // 썸네일 미리보기
  const thumbKey = useDebounced(`${paintRev}|${feather}|${JSON.stringify(bg)}|${JSON.stringify(thumb)}|${bgImage?.name ?? ''}`, 120)
  useEffect(() => {
    const canvas = thumbRef.current
    const work = workRef.current
    const mask = maskRef.current
    if (!canvas || !thumb.enabled || !ready || !work || !mask) return
    const k = Math.min(1, 480 / Math.max(thumb.width, thumb.height))
    composeThumb({ image: work, mask, feather, background: bg, bgImage: bgImage?.bitmap ?? null }, { ...thumb, width: Math.max(1, Math.round(thumb.width * k)), height: Math.max(1, Math.round(thumb.height * k)) }, canvas)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbKey, ready, thumb.enabled])

  // ── 브러시로 다듬기 ─────────────────────────────────────
  const hasMask = active?.status === 'done' && ready
  const maskScale = active && workRef.current ? workRef.current.width / active.width : 1
  /** 브러시 지름(원본 px). 슬라이더 값은 사진 긴 변의 0.25% 단위 */
  const brushPx = active ? Math.max(4, (Math.max(active.width, active.height) * brush * 0.25) / 100) : 10

  const scheduleDraw = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      redraw()
    })
  }
  const paintTo = (pt: ImagePoint) => {
    const mask = maskRef.current
    const st = stroke.current
    if (!mask || !st) return
    const ctx = ctx2d(mask, true)
    const k = maskScale
    ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#ffffff'
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.lineWidth = brushPx * k
    ctx.beginPath()
    ctx.moveTo(st.last.x * k, st.last.y * k)
    ctx.lineTo(pt.x * k + 0.01, pt.y * k + 0.01)
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
    const r = (brushPx * k) / 2 + 2
    st.x0 = Math.min(st.x0, pt.x * k - r, st.last.x * k - r)
    st.y0 = Math.min(st.y0, pt.y * k - r, st.last.y * k - r)
    st.x1 = Math.max(st.x1, pt.x * k + r, st.last.x * k + r)
    st.y1 = Math.max(st.y1, pt.y * k + r, st.last.y * k + r)
    st.last = pt
    scheduleDraw()
  }

  const pickColor = (pt: ImagePoint) => {
    const work = workRef.current
    if (!work || !active) return
    const x = Math.max(0, Math.min(work.width - 1, Math.round(pt.x * maskScale)))
    const y = Math.max(0, Math.min(work.height - 1, Math.round(pt.y * maskScale)))
    const d = ctx2d(work, true).getImageData(x, y, 1, 1).data
    setColorKey((c) => ({ ...c, auto: false, color: toHex({ r: d[0], g: d[1], b: d[2] }) }))
    setTool('erase')
    toast.success('고른 색을 배경색으로 정했습니다.')
  }

  const onDown = (pt: ImagePoint) => {
    if (!active || !ready || busy) return
    if (tool === 'pick') return pickColor(pt)
    const mask = maskRef.current
    if (!mask || !hasMask) return
    // 되돌리기를 위해 붓질 전 마스크를 복사해 둔다.
    if (!beforeRef.current) beforeRef.current = makeCanvas(mask.width, mask.height)
    const before = beforeRef.current
    if (before.width !== mask.width || before.height !== mask.height) {
      before.width = mask.width
      before.height = mask.height
    }
    const bctx = ctx2d(before, true)
    bctx.clearRect(0, 0, before.width, before.height)
    bctx.drawImage(mask, 0, 0)
    stroke.current = { last: pt, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    paintTo(pt)
  }
  const onMove = (pt: ImagePoint) => {
    if (stroke.current) paintTo(pt)
  }
  /** 다듬은 마스크를 보관하고 목록 미리보기를 새로 만든다. */
  const storeMask = () => {
    const mask = maskRef.current
    const work = workRef.current
    if (!mask || !work || !activeId) return
    masks.current.set(activeId, { alpha: canvasToMask(mask), w: mask.width, h: mask.height })
    const th = cutoutThumb(work, mask)
    setItems((prev) => prev.map((p) => (p.id === activeId ? { ...p, thumb: th } : p)))
    setPaintRev((n) => n + 1)
  }
  const onUp = () => {
    const st = stroke.current
    const mask = maskRef.current
    const before = beforeRef.current
    stroke.current = null
    // 붓질이 끝나면 예약된 그리기를 기다리지 않고 바로 반영한다.
    if (frame.current) {
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
    redraw()
    if (!st || !mask || !before || st.x1 < 0) return
    const x = Math.max(0, Math.floor(st.x0))
    const y = Math.max(0, Math.floor(st.y0))
    const w = Math.min(mask.width, Math.ceil(st.x1)) - x
    const h = Math.min(mask.height, Math.ceil(st.y1)) - y
    if (w <= 0 || h <= 0) return
    const patch: StrokePatch = { x, y, before: ctx2d(before, true).getImageData(x, y, w, h), after: ctx2d(mask, true).getImageData(x, y, w, h) }
    setHistory((cur) => ({ past: [...cur.past.slice(-(HISTORY_LIMIT - 1)), patch], future: [] }))
    storeMask()
  }
  const stepHistory = (dir: -1 | 1) => {
    const mask = maskRef.current
    if (!mask || busy) return
    const patch = dir === -1 ? history.past[history.past.length - 1] : history.future[0]
    if (!patch) return
    ctx2d(mask, true).putImageData(dir === -1 ? patch.before : patch.after, patch.x, patch.y)
    setHistory(dir === -1 ? { past: history.past.slice(0, -1), future: [patch, ...history.future] } : { past: [...history.past, patch], future: history.future.slice(1) })
    redraw()
    storeMask()
  }
  const keys = useRef(stepHistory)
  keys.current = stepHistory
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        keys.current(e.shiftKey ? 1 : -1)
      } else if (key === 'y') {
        e.preventDefault()
        keys.current(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 색으로 지우기 설정을 바꾸면 지금 보는 사진에 바로 다시 적용한다.
  const colorKeySignature = useDebounced(JSON.stringify(colorKey), 250)
  const firstColorRun = useRef(true)
  useEffect(() => {
    if (firstColorRun.current) {
      firstColorRun.current = false
      return
    }
    const cur = itemsRef.current.find((i) => i.id === activeIdRef.current)
    if (latest.current.method === 'color' && cur && cur.width > 0 && !busyRef.current) void processRef.current([cur], 'color')
    // 설정 값이 바뀔 때만 다시 적용한다(process 가 바뀌는 것은 신호가 아니다).
  }, [colorKeySignature])
  const processRef = useRef(process)
  processRef.current = process
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const busyRef = useRef(busy)
  busyRef.current = busy

  // ── 배경 사진 ───────────────────────────────────────────
  const chooseBgImage = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) return toast.error(`배경 사진은 ${formatBytes(MAX_FILE_BYTES)} 이하로 올려 주세요.`)
    try {
      const bitmap = await openImage(file)
      setBgImage((prev) => {
        prev?.bitmap.close()
        return { name: file.name, bitmap }
      })
      setBg((b) => ({ ...b, kind: 'image' }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '배경 사진을 열 수 없습니다.')
    }
  }

  // ── 저장 ────────────────────────────────────────────────
  const doneItems = items.filter((i) => i.status === 'done' && masks.current.has(i.id))
  const renderItem = async (item: Item): Promise<HTMLCanvasElement> => {
    const stored = masks.current.get(item.id)
    if (!stored) throw new Error('아직 배경을 지우지 않은 사진입니다.')
    const bmp = await openImage(item.file)
    try {
      const input = { image: bmp, mask: maskToCanvas(stored.alpha, stored.w, stored.h), feather, background: bg, bgImage: bgImage?.bitmap ?? null }
      return thumb.enabled ? composeThumb(input, thumb) : composeFull(input)
    } finally {
      bmp.close()
    }
  }
  const resultFile = async (item: Item) => blobToFile(await encodeCanvas(await renderItem(item), exp), exportName(item.name, thumb.enabled ? '_썸네일' : '_누끼', exp.format))
  const saveCurrent = async () => {
    if (!active) return
    try {
      const file = await resultFile(active)
      downloadBlob(file, file.name)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장하지 못했습니다.')
    }
  }
  const saveZip = async () => {
    const signal = startRun()
    try {
      const entries = []
      for (let i = 0; i < doneItems.length; i++) {
        setTask({ label: `저장할 사진 만드는 중 (${i + 1}/${doneItems.length})`, value: (i / doneItems.length) * 100 })
        const file = await resultFile(doneItems[i])
        if (signal.aborted) return
        entries.push({ name: file.name, data: file })
      }
      await downloadZip(entries, `${thumb.enabled ? '썸네일' : '배경제거'}_${todayStamp()}`)
      toast.success(`${entries.length}장을 ZIP 으로 저장했습니다.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ZIP 을 만들지 못했습니다.')
    } finally {
      setTask(null)
    }
  }
  const cancel = () => {
    abortRun()
    setTask(null)
  }
  const removeItem = (id: string) => {
    masks.current.delete(id)
    setItems((prev) => prev.filter((p) => p.id !== id))
    if (id === activeId) setActiveId(items.find((p) => p.id !== id)?.id ?? null)
  }
  const switchToColor = () => {
    setMethod('color')
    setAutoError(null)
    const targets = itemsRef.current.filter((i) => i.width > 0 && i.status !== 'done')
    latest.current = { ...latest.current, method: 'color' }
    void process(targets, 'color')
  }

  // ── 화면 ────────────────────────────────────────────────
  const spec = MODELS[modelKey]
  const needsDownload = !downloaded.includes(modelKey)

  if (!items.length) {
    return (
      <div className="flex flex-col gap-4">
        <Dropzone onFiles={addFiles} accept={ACCEPT_IMAGES} icon={ImagePlus} title="배경을 지울 사진을 끌어다 놓으세요" hint={`한 장 40MB · 4천만 화소 이하 · 최대 ${MAX_FILES}장 · Ctrl+V 로 붙여넣기`} />
        <EmptyState icon={Blend} title="사진을 올리면 배경을 지우고 새 배경을 입힙니다">
          자동으로 지우거나, 단색 배경이면 색을 기준으로 지울 수 있습니다. 흰 배경 정사각 썸네일도 한 번에 만듭니다. 사진은 서버로 올라가지 않습니다.
        </EmptyState>
      </div>
    )
  }

  const targetsForRun = items.filter((i) => i.width > 0)
  const pendingCount = items.filter((i) => i.status !== 'done').length
  const sizeOptions = [
    { value: '1000x1000', label: '1000 × 1000' },
    { value: '500x500', label: '500 × 500' },
    { value: '800x800', label: '800 × 800' },
    { value: '1200x1200', label: '1200 × 1200' },
    ...presets.canvasSizes.filter((s) => s.w <= 4000 && s.h <= 4000 && !(s.w === s.h && [500, 800, 1000, 1200].includes(s.w))).map((s) => ({ value: `${s.w}x${s.h}`, label: `${s.name} ${s.w} × ${s.h}` })),
  ]
  const sizeValue = `${thumb.width}x${thumb.height}`

  const panel = (
    <>
      <Section title="배경 지우는 방법">
        <Segmented
          label="배경 지우는 방법"
          block
          value={method}
          onValue={(m: Method) => {
            setMethod(m)
            setAutoError(null)
            if (m !== 'color' && tool === 'pick') setTool('erase')
          }}
          options={[
            { value: 'auto', label: '자동으로', icon: Wand2 },
            { value: 'color', label: '색으로', icon: Pipette },
          ]}
        />
        {method === 'auto' ? (
          <>
            <Field label="자동 지우기 방식" hint={spec.note}>
              {(id) => <Select id={id} value={modelKey} onValue={setModelKey} disabled={busy} options={MODEL_ORDER.map((k) => ({ value: k, label: `${MODELS[k].label} · ${formatBytes(MODELS[k].bytes)}` }))} />}
            </Field>
            <p className="text-sm text-muted">
              {needsDownload
                ? `처음 한 번 ${formatBytes(spec.bytes)}를 ${MODEL_HOST} 에서 내려받아 이 브라우저에 저장합니다. 사진은 밖으로 나가지 않습니다.`
                : '필요한 자료는 이미 받아 두었습니다. 사진을 올리면 바로 지웁니다.'}
            </p>
            <Button variant="primary" icon={Wand2} block disabled={busy || !targetsForRun.length} onClick={() => process(targetsForRun, 'auto')}>
              {needsDownload ? `자료 받고 배경 지우기 (${formatBytes(spec.bytes)})` : pendingCount ? `배경 지우기 (${targetsForRun.length}장)` : '다시 지우기'}
            </Button>
          </>
        ) : (
          <>
            <Switch checked={colorKey.auto} onChange={(auto) => setColorKey((c) => ({ ...c, auto }))} label="배경색 자동으로 찾기" hint="사진 가장자리에서 가장 많은 색을 배경으로 봅니다." />
            {!colorKey.auto && (
              <div className="flex flex-col gap-2">
                <ColorField label="지울 배경색" value={colorKey.color} onValue={(color) => setColorKey((c) => ({ ...c, color }))} />
                <Button size="sm" icon={Pipette} disabled={!ready || busy} onClick={() => setTool('pick')}>
                  사진에서 색 고르기
                </Button>
              </div>
            )}
            <Field label="비슷한 색 허용 범위" aside={`${colorKey.tolerance}`} hint="배경이 덜 지워지면 올리고, 물건까지 지워지면 내립니다.">
              {(id) => <Slider id={id} min={1} max={80} value={colorKey.tolerance} onValue={(tolerance) => setColorKey((c) => ({ ...c, tolerance }))} />}
            </Field>
            <Field label="경계 번짐" aside={`${colorKey.softness}`}>
              {(id) => <Slider id={id} min={0} max={60} value={colorKey.softness} onValue={(softness) => setColorKey((c) => ({ ...c, softness }))} />}
            </Field>
            <Switch checked={colorKey.contiguous} onChange={(contiguous) => setColorKey((c) => ({ ...c, contiguous }))} label="바깥과 이어진 배경만 지우기" hint="물건 안쪽에 있는 같은 색은 남깁니다." />
            <Button variant="primary" icon={Pipette} block disabled={busy || !targetsForRun.length} onClick={() => process(targetsForRun, 'color')}>
              {targetsForRun.length > 1 ? `모든 사진에 적용 (${targetsForRun.length}장)` : '배경 지우기'}
            </Button>
            <p className="text-sm text-muted">설정을 바꾸면 지금 보는 사진에 바로 다시 적용됩니다. 브러시로 다듬은 내용은 새로 지울 때 사라집니다.</p>
          </>
        )}
        {task && (
          <div className="flex flex-col gap-2">
            <Progress value={task.value} label={task.label} />
            <Button size="sm" onClick={cancel}>
              취소
            </Button>
          </div>
        )}
        {autoError && (
          <Callout tone="danger" title={autoError.stage === 'load' ? '자동 지우기 자료를 받지 못했습니다' : '자동으로 지우지 못했습니다'}>
            <p>
              {autoError.stage === 'load'
                ? `사내망에서 외부 주소(${MODEL_HOST})가 막혀 있을 수 있습니다. 배경이 단색이면 ‘색으로’ 방식은 내려받기 없이 쓸 수 있습니다.`
                : '이 PC 에서 계산을 마치지 못했습니다. ‘빠르게’ 방식으로 바꾸거나 ‘색으로’ 방식을 써 보세요.'}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-muted">{autoError.message.slice(0, 160)}</p>
            <Button size="sm" icon={Pipette} className="mt-2" onClick={switchToColor}>
              색으로 지우기로 바꾸기
            </Button>
          </Callout>
        )}
      </Section>

      <Section title="다듬기" hint="자동 결과에서 잘못 지워진 곳은 복원 브러시로, 남은 배경은 지우기 브러시로 칠합니다.">
        <Segmented
          label="브러시 종류"
          block
          value={tool === 'restore' ? 'restore' : 'erase'}
          onValue={(t: 'erase' | 'restore') => setTool(t)}
          options={[
            { value: 'erase', label: '지우기', icon: Eraser },
            { value: 'restore', label: '복원', icon: Brush },
          ]}
        />
        <Field label="브러시 크기" aside={`${brush}`}>
          {(id) => <Slider id={id} min={1} max={60} value={brush} onValue={setBrush} />}
        </Field>
        <Field label="경계 부드러움" aside={`${feather}`}>
          {(id) => <Slider id={id} min={0} max={12} step={0.5} value={feather} onValue={setFeather} />}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={Undo2} disabled={!history.past.length || busy} onClick={() => stepHistory(-1)}>
            되돌리기
          </Button>
          <Button size="sm" icon={Redo2} disabled={!history.future.length || busy} onClick={() => stepHistory(1)}>
            다시 실행
          </Button>
        </div>
      </Section>

      <Section title="새 배경">
        <Segmented
          label="새 배경 종류"
          block
          size="sm"
          value={bg.kind}
          onValue={(kind) => setBg((b) => ({ ...b, kind }))}
          options={[
            { value: 'transparent', label: '투명' },
            { value: 'color', label: '단색' },
            { value: 'gradient', label: '그라데이션' },
            { value: 'image', label: '내 사진' },
          ]}
        />
        {bg.kind === 'color' && <ColorField label="배경색" value={bg.color} onValue={(color) => setBg((b) => ({ ...b, color }))} />}
        {bg.kind === 'gradient' && (
          <>
            <ColorField label="시작 색" value={bg.from} onValue={(from) => setBg((b) => ({ ...b, from }))} />
            <ColorField label="끝 색" value={bg.to} onValue={(to) => setBg((b) => ({ ...b, to }))} />
            <Segmented
              label="그라데이션 방향"
              block
              size="sm"
              value={bg.direction}
              onValue={(direction) => setBg((b) => ({ ...b, direction }))}
              options={[
                { value: 'down', label: '세로' },
                { value: 'right', label: '가로' },
                { value: 'diagonal', label: '대각선' },
              ]}
            />
          </>
        )}
        {bg.kind === 'image' && (
          <div className="flex flex-col gap-2">
            <input
              ref={bgInput}
              type="file"
              accept={ACCEPT_IMAGES}
              hidden
              onChange={(e) => {
                void chooseBgImage(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" icon={Upload} onClick={() => bgInput.current?.click()}>
                배경 사진 고르기
              </Button>
              {bgImage && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  onClick={() =>
                    setBgImage((prev) => {
                      prev?.bitmap.close()
                      return null
                    })
                  }
                >
                  빼기
                </Button>
              )}
            </div>
            <p className="truncate text-sm text-muted">{bgImage ? bgImage.name : '고른 사진이 없습니다. 사진을 고르면 화면을 가득 채워 깔립니다.'}</p>
          </div>
        )}
        {bg.kind === 'transparent' && <p className="text-sm text-muted">배경 없이 물건만 남깁니다. PNG 나 WebP 로 저장하세요.</p>}
      </Section>

      <Section title="흰 배경 정사각 썸네일">
        <Switch checked={thumb.enabled} onChange={(enabled) => setThumb((t) => ({ ...t, enabled }))} label="썸네일로 저장" hint="물건만 잘라 가운데에 놓고 여백을 맞춥니다. 배경이 ‘투명’이면 흰색으로 채웁니다." />
        {thumb.enabled && (
          <>
            <Field label="크기">
              {(id) => (
                <Select
                  id={id}
                  value={sizeOptions.some((o) => o.value === sizeValue) ? sizeValue : 'custom'}
                  onValue={(v) => {
                    if (v === 'custom') return
                    const [w, h] = v.split('x').map(Number)
                    setThumb((t) => ({ ...t, width: w, height: h }))
                  }}
                  options={[...sizeOptions, { value: 'custom', label: '직접 입력' }]}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="가로">{(id) => <NumberInput id={id} unit="px" min={100} max={4000} value={thumb.width} onValue={(v) => setThumb((t) => ({ ...t, width: Math.max(100, Math.min(4000, Math.round(v ?? 1000))) }))} />}</Field>
              <Field label="세로">{(id) => <NumberInput id={id} unit="px" min={100} max={4000} value={thumb.height} onValue={(v) => setThumb((t) => ({ ...t, height: Math.max(100, Math.min(4000, Math.round(v ?? 1000))) }))} />}</Field>
            </div>
            <Field label="여백" aside={`${thumb.marginPct}%`}>
              {(id) => <Slider id={id} min={0} max={30} value={thumb.marginPct} onValue={(marginPct) => setThumb((t) => ({ ...t, marginPct }))} />}
            </Field>
            <Switch checked={thumb.shadow} onChange={(shadow) => setThumb((t) => ({ ...t, shadow }))} label="바닥 그림자" />
            {thumb.shadow && (
              <Field label="그림자 진하기" aside={`${thumb.shadowStrength}%`}>
                {(id) => <Slider id={id} min={10} max={80} step={5} value={thumb.shadowStrength} onValue={(shadowStrength) => setThumb((t) => ({ ...t, shadowStrength }))} />}
              </Field>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink-2">썸네일 미리보기</span>
              {hasMask ? (
                <canvas ref={thumbRef} className="checker h-auto max-h-64 w-full max-w-64 self-center rounded-md border border-line-strong object-contain" />
              ) : (
                <p className="text-sm text-muted">배경을 지우면 여기에 썸네일이 보입니다.</p>
              )}
            </div>
          </>
        )}
      </Section>

      <Section title="저장">
        <ExportFields value={exp} onChange={setExp} transparentHint={bg.kind === 'transparent' && !thumb.enabled} />
        <div className="flex flex-col gap-2">
          <Button icon={Download} block disabled={!hasMask || busy} onClick={saveCurrent}>
            이 사진 저장
          </Button>
          <Button icon={FolderArchive} block disabled={busy || doneItems.length < 2} onClick={saveZip}>
            ZIP 으로 모두 저장 ({doneItems.length}장)
          </Button>
          <SendToMenu exclude="background" disabled={busy || !doneItems.length} files={() => Promise.all(doneItems.map(resultFile))} />
        </div>
        <p className="text-sm text-muted">원본 크기 그대로 저장합니다. 촬영 위치 같은 부가 정보는 남지 않습니다.</p>
      </Section>
    </>
  )

  const cursor = tool === 'pan' ? 'grab' : tool === 'pick' ? 'crosshair' : hasMask ? 'none' : 'default'
  return (
    <ToolLayout panel={panel}>
      <Dropzone compact onFiles={addFiles} accept={ACCEPT_IMAGES} disabled={busy || items.length >= MAX_FILES} title="사진 더 올리기" hint={`${items.length}/${MAX_FILES}장`} />
      <FileStrip items={items} activeId={activeId} onSelect={setActiveId} onRemove={removeItem} disabled={busy} badge={(it) => STATUS_LABEL[it.status]} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented
          label="마우스 동작"
          size="sm"
          value={tool}
          onValue={setTool}
          options={[
            { value: 'erase', label: '지우기', icon: Eraser },
            { value: 'restore', label: '복원', icon: Brush },
            ...(method === 'color' ? [{ value: 'pick' as const, label: '색 고르기', icon: Pipette }] : []),
            { value: 'pan', label: '화면 이동', icon: Hand },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          <IconButton icon={Undo2} label="되돌리기 (Ctrl+Z)" size="sm" disabled={!history.past.length || busy} onClick={() => stepHistory(-1)} />
          <IconButton icon={Redo2} label="다시 실행 (Ctrl+Y)" size="sm" disabled={!history.future.length || busy} onClick={() => stepHistory(1)} />
          <Button
            size="sm"
            icon={Eye}
            disabled={!hasMask}
            aria-pressed={comparing}
            onPointerDown={() => setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setComparing(true)}
            onKeyUp={() => setComparing(false)}
            onBlur={() => setComparing(false)}
          >
            누르는 동안 원본
          </Button>
          <ZoomControls zoom={zoom} onZoom={setZoom} max={4} />
        </div>
      </div>

      {loadError ? (
        <Callout tone="danger" title="이 사진을 열 수 없습니다">
          {loadError}
        </Callout>
      ) : (
        active &&
        mounted && (
          <Viewport
            label="사진 작업 영역. 끌어서 지우거나 복원합니다."
            width={active.width}
            height={active.height}
            zoom={zoom}
            onZoom={setZoom}
            maxZoom={4}
            panMode={tool === 'pan'}
            cursor={cursor}
            onDown={onDown}
            onMove={onMove}
            onUp={onUp}
            onHover={setHover}
          >
            {({ scale }) => (
              <>
                <canvas ref={viewRef} className="checker absolute inset-0 size-full shadow-3" />
                {comparing && <span className="absolute left-2 top-2 rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-paper">원본</span>}
                {active.status === 'error' && (
                  <div className="absolute inset-x-3 bottom-3">
                    <Callout tone="danger" title="이 사진은 배경을 지우지 못했습니다">
                      {active.error ?? '다른 방식으로 다시 시도해 주세요.'}
                    </Callout>
                  </div>
                )}
                {hasMask && hover && tool !== 'pan' && tool !== 'pick' && !comparing && (
                  <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${active.width} ${active.height}`} preserveAspectRatio="none" aria-hidden>
                    <circle cx={hover.x} cy={hover.y} r={brushPx / 2} fill="none" className="stroke-ink" strokeWidth={3 / scale} />
                    <circle cx={hover.x} cy={hover.y} r={brushPx / 2} fill="none" className={tool === 'erase' ? 'stroke-surface' : 'stroke-mark'} strokeWidth={1.5 / scale} />
                  </svg>
                )}
                {!ready && <div className="skeleton absolute inset-0 rounded-none!" aria-label="사진을 여는 중" />}
              </>
            )}
          </Viewport>
        )
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {active?.status === 'pending' && !busy && <span className="font-semibold text-ink-2">오른쪽의 ‘배경 지우기’를 누르면 시작합니다.</span>}
        <span className="inline-flex items-center gap-1">
          <Kbd>Ctrl</Kbd>+<Kbd>휠</Kbd> 확대
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Space</Kbd>+끌기 화면 이동
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> 되돌리기
        </span>
        {active && mounted && (
          <span className="num ml-auto">
            {active.width}×{active.height}px
          </span>
        )}
      </p>
    </ToolLayout>
  )
}
