import { Check, Circle, Download, Eye, FolderArchive, Grid3x3, Hand, ImagePlus, Maximize2, MousePointer2, Redo2, ScanFace, ScanText, Square, Trash2, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_WATERMARK, type WatermarkSettings } from '@/app/config'
import { useHandoffFiles } from '@/app/handoff'
import { blobToFile, downloadBlob, downloadZip, formatBytes, todayStamp } from '@/lib/files'
import { useAbortable, usePersistentState } from '@/lib/hooks'
import { ctx2d, fitWithin, makeCanvas } from '@/lib/image'
import { prepareWatermark } from '@/lib/watermark'
import { Button, Callout, Checkbox, ColorField, Dropzone, EmptyState, Field, IconButton, Kbd, Progress, Section, Segmented, SendToMenu, Slider, Switch, ToolLayout, WatermarkControls, toast } from '@/ui'
import { ACCEPT_IMAGES, DEFAULT_EXPORT, ExportFields, FileStrip, encodeCanvas, exportName, makeThumb, newId, openImage, takeImageFiles, type ExportSettings } from './common'
import { PATTERN_LABEL, PATTERN_ORDER, findSensitive, maskPreview, snapToInk, type Finding, type PatternId } from './detect-text'
import { FACE_MODEL, detectFaces, loadFaceDetector } from './faces'
import { OCR_DATA, cancelOcr, recognizeLines } from './ocr'
import { HANDLES, MAX_STRENGTH, MIN_REGION, MIN_STRENGTH, boxFromPoints, expandBox, handlePoint, hitHandle, hitRegion, iou, moveBox, resizeBox, type Box, type Effect, type Handle, type Region, type RegionStyle, type Shape } from './regions'
import { applyRegions, renderResult } from './render'
import { Viewport, ZoomControls, type ImagePoint } from './viewport'

const MAX_FILES = 50
/** 미리보기 캔버스의 긴 변. 저장은 항상 원본 크기로 한다. */
const PREVIEW_EDGE = 2048
const HISTORY_LIMIT = 60

interface Proposal extends Finding {
  id: string
}
interface Item {
  id: string
  file: File
  name: string
  width: number
  height: number
  thumb: string | null
  regions: Region[]
  past: Region[][]
  future: Region[][]
  /** 글자에서 찾은 제안. 사용자가 확인해야 영역이 된다. */
  proposals: Proposal[]
}

type Drag =
  | { kind: 'draw'; a: ImagePoint; b: ImagePoint }
  | { kind: 'move'; id: string; start: ImagePoint; orig: Box; box: Box }
  | { kind: 'resize'; id: string; handle: Handle; start: ImagePoint; orig: Box; box: Box }

const DEFAULT_STYLE: RegionStyle = { shape: 'rect', effect: 'pixel', strength: 5, color: '#000000' }
const DEFAULT_PATTERNS: Record<PatternId, boolean> = { phone: true, rrn: true, email: true, plate: true, digits: true }
const HANDLE_CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }

/** 글자 인식이 알려 준 상자를 실제 글자 위치에 맞춘다(낱말 상자가 몇 px 어긋나 첫 글자가 드러나는 일을 막는다). */
function snapFinding(source: CanvasImageSource & { width: number; height: number }, f: Finding): { x: number; w: number } {
  const reach = Math.ceil(f.h * 0.9)
  const bx = Math.max(0, Math.floor(f.x - reach))
  const by = Math.max(0, Math.floor(f.y))
  const bw = Math.min(source.width, Math.ceil(f.x + f.w + reach)) - bx
  const bh = Math.min(source.height, Math.ceil(f.y + f.h)) - by
  if (bw < 2 || bh < 2) return { x: f.x, w: f.w }
  const band = makeCanvas(bw, bh)
  const ctx = ctx2d(band, true)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, bw, bh)
  ctx.drawImage(source, bx, by, bw, bh, 0, 0, bw, bh)
  const data = ctx.getImageData(0, 0, bw, bh).data
  const lum = new Uint8Array(bw * bh)
  for (let i = 0; i < lum.length; i++) lum[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8
  const { x0, x1 } = snapToInk(lum, bw, bh, f.x - bx, f.x + f.w - bx, Math.max(2, Math.round(f.h * 0.12)), reach)
  return { x: bx + x0, w: x1 - x0 }
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

export default function MosaicTool() {
  const [items, setItems] = useState<Item[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = items.find((i) => i.id === activeId) ?? null
  const itemsRef = useRef(items)
  itemsRef.current = items

  const [style, setStyle] = usePersistentState<RegionStyle>('onbijjang:mosaic:style', DEFAULT_STYLE)
  const [faceMargin, setFaceMargin] = usePersistentState('onbijjang:mosaic:faceMargin', 15)
  const [autoFace, setAutoFace] = usePersistentState('onbijjang:mosaic:autoFace', false)
  const [patterns, setPatterns] = usePersistentState<Record<PatternId, boolean>>('onbijjang:mosaic:patterns', DEFAULT_PATTERNS)
  const [wm, setWm] = usePersistentState<WatermarkSettings>('onbijjang:mosaic:watermark', DEFAULT_WATERMARK)
  const [exp, setExp] = usePersistentState<ExportSettings>('onbijjang:mosaic:export', DEFAULT_EXPORT)

  const [panMode, setPanMode] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [cursor, setCursor] = useState('crosshair')
  const [comparing, setComparing] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [task, setTask] = useState<{ kind: 'face' | 'text' | 'save'; label: string; value: number | null } | null>(null)
  const [faceError, setFaceError] = useState<string | null>(null)
  const [textError, setTextError] = useState<string | null>(null)
  const [wmDraw, setWmDraw] = useState<{ fn: Awaited<ReturnType<typeof prepareWatermark>> } | null>(null)

  const viewRef = useRef<HTMLCanvasElement>(null)
  const sourceRef = useRef<HTMLCanvasElement | null>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const scaleRef = useRef(1)
  const lastCommit = useRef<{ key: string; at: number } | null>(null)
  const { start: startRun, abort: abortRun } = useAbortable()
  const busy = task !== null

  const k = active && active.width ? fitWithin(active.width, active.height, PREVIEW_EDGE).scale : 1

  // ── 영역 바꾸기(되돌리기 기록 포함) ─────────────────────
  const commit = useCallback((itemId: string, next: Region[] | ((cur: Region[]) => Region[]), coalesceKey?: string) => {
    const now = Date.now()
    const merge = !!coalesceKey && lastCommit.current?.key === coalesceKey && now - lastCommit.current.at < 1200
    lastCommit.current = coalesceKey ? { key: coalesceKey, at: now } : null
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it
        const regions = typeof next === 'function' ? next(it.regions) : next
        return { ...it, regions, past: merge ? it.past : [...it.past.slice(-(HISTORY_LIMIT - 1)), it.regions], future: [] }
      }),
    )
  }, [])
  const stepHistory = (dir: -1 | 1) => {
    if (!active || busy) return
    lastCommit.current = null
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== active.id) return it
        if (dir === -1 && it.past.length) return { ...it, regions: it.past[it.past.length - 1], past: it.past.slice(0, -1), future: [it.regions, ...it.future] }
        if (dir === 1 && it.future.length) return { ...it, regions: it.future[0], past: [...it.past, it.regions], future: it.future.slice(1) }
        return it
      }),
    )
    setSelected(null)
  }

  // ── 얼굴 찾기 ───────────────────────────────────────────
  const findFaces = useCallback(
    async (targets: Item[], quiet = false) => {
      if (!targets.length) return
      const signal = startRun()
      setFaceError(null)
      setTask({ kind: 'face', label: '얼굴 찾기 준비 중', value: null })
      let total = 0
      try {
        await loadFaceDetector((p) => setTask({ kind: 'face', label: `얼굴 찾기 자료 받는 중 (${formatBytes(FACE_MODEL.bytes)})`, value: p }))
        for (let n = 0; n < targets.length; n++) {
          const it = targets[n]
          if (signal.aborted) throw new DOMException('취소', 'AbortError')
          const own = it.id === activeIdRef.current && bitmapRef.current ? null : await openImage(it.file)
          const source = own ?? bitmapRef.current!
          try {
            const label = targets.length > 1 ? `얼굴 찾는 중 (${n + 1}/${targets.length})` : '얼굴 찾는 중'
            const faces = await detectFaces(source, (p) => setTask({ kind: 'face', label, value: ((n + p / 100) / targets.length) * 100 }), signal)
            const st = styleRef.current
            const margin = marginRef.current
            const w = source.width
            const h = source.height
            let added = 0
            commit(it.id, (cur) => {
              const fresh: Region[] = []
              for (const f of faces) {
                const box = expandBox(f, margin, w, h)
                // 이미 가려 둔 얼굴은 다시 넣지 않는다.
                if ([...cur, ...fresh].some((r) => iou(r, box) > 0.45)) continue
                fresh.push({ id: newId(), ...box, ...st, source: 'face' })
              }
              added = fresh.length
              return fresh.length ? [...cur, ...fresh] : cur
            })
            total += added || faces.length
          } finally {
            own?.close()
          }
        }
        if (!quiet || total > 0) {
          if (total > 0) toast.success(`얼굴 ${total}곳을 찾아 가렸습니다. 빠진 얼굴이 없는지 확인해 주세요.`)
          else toast.info('얼굴을 찾지 못했습니다. 작거나 옆을 본 얼굴은 놓칠 수 있으니 직접 그려서 가려 주세요.')
        }
      } catch (err) {
        if (!isAbort(err)) setFaceError(err instanceof Error ? err.message : '얼굴을 찾지 못했습니다.')
      } finally {
        setTask(null)
      }
    },
    [commit, startRun],
  )
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const styleRef = useRef(style)
  styleRef.current = style
  const marginRef = useRef(faceMargin)
  marginRef.current = faceMargin
  const autoFaceRef = useRef(autoFace)
  autoFaceRef.current = autoFace

  // ── 파일 받기 ───────────────────────────────────────────
  const addFiles = useCallback(
    async (incoming: File[]) => {
      const files = takeImageFiles(incoming, itemsRef.current.length, MAX_FILES)
      if (!files.length) return
      const fresh: Item[] = files.map((file) => ({ id: newId(), file, name: file.name, width: 0, height: 0, thumb: null, regions: [], past: [], future: [], proposals: [] }))
      setItems((prev) => [...prev, ...fresh])
      setActiveId((cur) => cur ?? fresh[0].id)
      const opened: Item[] = []
      for (const it of fresh) {
        try {
          const bmp = await openImage(it.file)
          const patch = { width: bmp.width, height: bmp.height, thumb: makeThumb(bmp) }
          bmp.close()
          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, ...patch } : p)))
          opened.push({ ...it, ...patch })
        } catch (err) {
          toast.error(`${it.name}: ${err instanceof Error ? err.message : '사진을 열 수 없습니다.'}`)
          setItems((prev) => prev.filter((p) => p.id !== it.id))
          setActiveId((cur) => (cur === it.id ? (itemsRef.current.find((p) => p.id !== it.id)?.id ?? null) : cur))
        }
      }
      if (autoFaceRef.current && opened.length) void findFaces(opened, true)
    },
    [findFaces],
  )
  useHandoffFiles('mosaic', addFiles)

  // ── 고른 사진 열기 ──────────────────────────────────────
  const activeFile = active?.file
  const mounted = !!active && active.width > 0
  useEffect(() => {
    setReady(false)
    setLoadError(null)
    setSelected(null)
    setDrag(null)
    bitmapRef.current?.close()
    bitmapRef.current = null
    sourceRef.current = null
    if (!activeFile || !mounted) return
    let alive = true
    openImage(activeFile)
      .then((bmp) => {
        const view = viewRef.current
        if (!alive || !view) return bmp.close()
        const fit = fitWithin(bmp.width, bmp.height, PREVIEW_EDGE)
        const src = makeCanvas(fit.width, fit.height)
        const sctx = ctx2d(src)
        sctx.imageSmoothingQuality = 'high'
        sctx.drawImage(bmp, 0, 0, src.width, src.height)
        view.width = src.width
        view.height = src.height
        sourceRef.current = src
        bitmapRef.current = bmp
        setZoom(1)
        setReady(true)
      })
      .catch((err) => alive && setLoadError(err instanceof Error ? err.message : '사진을 열 수 없습니다.'))
    return () => {
      alive = false
    }
  }, [activeId, activeFile, mounted])
  useEffect(
    () => () => {
      bitmapRef.current?.close()
      void cancelOcr()
    },
    [],
  )

  // ── 워터마크 준비(미리보기 배율에 맞춘 여백) ────────────
  useEffect(() => {
    let alive = true
    prepareWatermark({ ...wm, margin: wm.margin * k })
      .then((fn) => alive && setWmDraw({ fn }))
      .catch(() => alive && setWmDraw(null))
    return () => {
      alive = false
    }
  }, [wm, k])

  // ── 미리보기 그리기 ─────────────────────────────────────
  const liveRegions = useMemo(() => {
    const regions = active?.regions ?? []
    if (!drag || drag.kind === 'draw') return regions
    return regions.map((r) => (r.id === drag.id ? { ...r, ...drag.box } : r))
  }, [active?.regions, drag])
  const draftBox = drag?.kind === 'draw' && active ? boxFromPoints(drag.a.x, drag.a.y, drag.b.x, drag.b.y, active.width, active.height) : null

  useEffect(() => {
    const view = viewRef.current
    const src = sourceRef.current
    if (!ready || !view || !src) return
    const ctx = ctx2d(view)
    ctx.clearRect(0, 0, view.width, view.height)
    ctx.drawImage(src, 0, 0)
    if (comparing) return
    const drawn = draftBox && draftBox.w >= MIN_REGION && draftBox.h >= MIN_REGION ? [...liveRegions, { id: 'draft', ...draftBox, ...style, source: 'manual' as const }] : liveRegions
    applyRegions(ctx, src, drawn, k)
    wmDraw?.fn(ctx, view.width, view.height)
  }, [ready, liveRegions, draftBox?.x, draftBox?.y, draftBox?.w, draftBox?.h, comparing, wmDraw, k, style])

  // ── 마우스로 그리기·옮기기·크기 조절 ───────────────────
  const topRegionAt = (pt: ImagePoint) => {
    const regions = active?.regions ?? []
    for (let i = regions.length - 1; i >= 0; i--) if (hitRegion(regions[i], pt.x, pt.y)) return regions[i]
    return null
  }
  const selectedRegion = active?.regions.find((r) => r.id === selected) ?? null

  const onDown = (pt: ImagePoint) => {
    if (!active || !ready || busy) return
    if (selectedRegion) {
      const handle = hitHandle(selectedRegion, pt.x, pt.y, 10 / scaleRef.current)
      if (handle) return setDrag({ kind: 'resize', id: selectedRegion.id, handle, start: pt, orig: selectedRegion, box: selectedRegion })
    }
    const hit = topRegionAt(pt)
    if (hit) {
      setSelected(hit.id)
      setDrag({ kind: 'move', id: hit.id, start: pt, orig: hit, box: hit })
    } else {
      setSelected(null)
      setDrag({ kind: 'draw', a: pt, b: pt })
    }
  }
  const onMove = (pt: ImagePoint) => {
    if (!active || !drag) return
    if (drag.kind === 'draw') setDrag({ ...drag, b: pt })
    else if (drag.kind === 'move') setDrag({ ...drag, box: moveBox(drag.orig, pt.x - drag.start.x, pt.y - drag.start.y, active.width, active.height) })
    else setDrag({ ...drag, box: resizeBox(drag.orig, drag.handle, pt.x - drag.start.x, pt.y - drag.start.y, active.width, active.height) })
  }
  const onUp = () => {
    if (!active || !drag) return
    setDrag(null)
    if (drag.kind === 'draw') {
      const box = boxFromPoints(drag.a.x, drag.a.y, drag.b.x, drag.b.y, active.width, active.height)
      if (box.w < MIN_REGION || box.h < MIN_REGION) return
      const region: Region = { id: newId(), ...box, ...style, source: 'manual' }
      commit(active.id, (cur) => [...cur, region])
      setSelected(region.id)
    } else {
      const { box, orig, id } = drag
      if (box.x === orig.x && box.y === orig.y && box.w === orig.w && box.h === orig.h) return
      commit(active.id, (cur) => cur.map((r) => (r.id === id ? { ...r, ...box } : r)))
    }
  }
  const onHover = (pt: ImagePoint | null) => {
    if (!pt || drag) return
    let next = 'crosshair'
    const handle = selectedRegion ? hitHandle(selectedRegion, pt.x, pt.y, 10 / scaleRef.current) : null
    if (handle) next = HANDLE_CURSOR[handle]
    else if (topRegionAt(pt)) next = 'move'
    if (next !== cursor) setCursor(next)
  }

  const removeSelected = () => {
    if (!active || !selected) return
    commit(active.id, (cur) => cur.filter((r) => r.id !== selected))
    setSelected(null)
  }
  const coverAll = () => {
    if (!active) return
    const region: Region = { id: newId(), x: 0, y: 0, w: active.width, h: active.height, ...style, shape: 'rect', source: 'manual' }
    commit(active.id, (cur) => [...cur, region])
    setSelected(region.id)
  }
  const clearRegions = () => {
    if (!active || !active.regions.length) return
    commit(active.id, [])
    setSelected(null)
  }

  /** 설정 패널에서 방식을 바꾸면: 고른 영역이 있으면 그 영역을, 없으면 앞으로 그릴 영역의 기본값을 바꾼다. */
  const patchStyle = (patch: Partial<RegionStyle>) => {
    setStyle((s) => ({ ...s, ...patch }))
    if (active && selectedRegion) commit(active.id, (cur) => cur.map((r) => (r.id === selectedRegion.id ? { ...r, ...patch } : r)), `style:${selectedRegion.id}`)
  }
  const shown: RegionStyle = selectedRegion ?? style
  const applyStyleToAll = () => {
    if (!active) return
    const { shape, effect, strength, color } = shown
    commit(active.id, (cur) => cur.map((r) => ({ ...r, shape, effect, strength, color })))
    toast.success('이 사진의 모든 영역에 같은 방식을 적용했습니다.')
  }

  // ── 키보드 ──────────────────────────────────────────────
  const keys = useRef({ stepHistory, removeSelected, active, selectedRegion, commit })
  keys.current = { stepHistory, removeSelected, active, selectedRegion, commit }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const s = keys.current
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        s.stepHistory(e.shiftKey ? 1 : -1)
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        s.stepHistory(1)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedRegion) {
        e.preventDefault()
        s.removeSelected()
      } else if (e.key === 'Escape') setSelected(null)
      else if (e.key.startsWith('Arrow') && s.selectedRegion && s.active) {
        e.preventDefault()
        const step = (e.shiftKey ? 10 : 1) * Math.max(1, Math.round(1 / scaleRef.current))
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const id = s.selectedRegion.id
        const { width, height } = s.active
        s.commit(s.active.id, (cur) => cur.map((r) => (r.id === id ? { ...r, ...moveBox(r, dx, dy, width, height) } : r)), `nudge:${id}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── 글자에서 개인정보 찾기 ──────────────────────────────
  const anyPattern = PATTERN_ORDER.some((p) => patterns[p])
  const findText = async (targets: Item[]) => {
    if (!targets.length || !anyPattern) return
    setTextError(null)
    const signal = startRun()
    let total = 0
    try {
      for (let n = 0; n < targets.length; n++) {
        const it = targets[n]
        if (signal.aborted) return
        const own = it.id === activeId && bitmapRef.current ? null : await openImage(it.file)
        const source = own ?? bitmapRef.current!
        try {
          const suffix = targets.length > 1 ? ` (${n + 1}/${targets.length})` : ''
          const lines = await recognizeLines(source, (p) => setTask({ kind: 'text', label: p.label + suffix, value: p.value }))
          if (signal.aborted) return
          const w = source.width
          const h = source.height
          const found = findSensitive(lines, patterns).map((f): Proposal => {
            const snapped = snapFinding(source, f)
            const padY = f.h * 0.15
            const padX = f.h * 0.2
            const box = boxFromPoints(snapped.x - padX, f.y - padY, snapped.x + snapped.w + padX, f.y + f.h + padY, w, h)
            return { ...f, ...box, id: newId() }
          })
          total += found.length
          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, proposals: found.filter((f) => !p.regions.some((r) => iou(r, f) > 0.6)) } : p)))
        } finally {
          own?.close()
        }
      }
      if (total > 0) toast.success(`가릴 만한 곳 ${total}곳을 찾았습니다. 표시된 곳을 확인하고 가려 주세요.`)
      else toast.info('고른 종류에 해당하는 글자를 찾지 못했습니다. 작거나 흐린 글자는 놓칠 수 있으니 직접 확인해 주세요.')
    } catch (err) {
      if (!signal.aborted) setTextError(err instanceof Error ? err.message : '글자를 읽지 못했습니다.')
    } finally {
      setTask(null)
    }
  }
  const acceptProposals = (ids: string[]) => {
    if (!active) return
    const picked = active.proposals.filter((p) => ids.includes(p.id))
    if (!picked.length) return
    // 글자는 픽셀·블러로 가리면 원래 글자를 짐작할 수 있어 색으로 덮는다.
    const fresh: Region[] = picked.map((p) => ({ id: newId(), x: p.x, y: p.y, w: p.w, h: p.h, shape: 'rect', effect: 'fill', strength: style.strength, color: style.color, source: 'text' }))
    commit(active.id, (cur) => [...cur, ...fresh])
    setItems((prev) => prev.map((it) => (it.id === active.id ? { ...it, proposals: it.proposals.filter((p) => !ids.includes(p.id)) } : it)))
  }
  const dismissProposals = (ids: string[]) => {
    if (!active) return
    setItems((prev) => prev.map((it) => (it.id === active.id ? { ...it, proposals: it.proposals.filter((p) => !ids.includes(p.id)) } : it)))
  }

  const cancel = () => {
    abortRun()
    if (task?.kind === 'text') void cancelOcr()
    setTask(null)
  }

  // ── 저장 ────────────────────────────────────────────────
  const renderItem = async (item: Item) => {
    const draw = await prepareWatermark(wm)
    const own = item.id === activeId && bitmapRef.current ? null : await openImage(item.file)
    try {
      return renderResult(own ?? bitmapRef.current!, item.regions, draw)
    } finally {
      own?.close()
    }
  }
  const resultFile = async (item: Item) => blobToFile(await encodeCanvas(await renderItem(item), exp), exportName(item.name, '_모자이크', exp.format))
  const pendingProposals = items.reduce((s, it) => s + it.proposals.length, 0)
  const warnPending = () => {
    if (pendingProposals) toast.warn(`확인하지 않은 제안이 ${pendingProposals}곳 남아 있습니다. 가리지 않은 채 저장됩니다.`)
  }
  const saveCurrent = async () => {
    if (!active) return
    try {
      if (active.proposals.length) toast.warn(`확인하지 않은 제안이 ${active.proposals.length}곳 남아 있습니다. 가리지 않은 채 저장됩니다.`)
      const file = await resultFile(active)
      downloadBlob(file, file.name)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장하지 못했습니다.')
    }
  }
  const saveZip = async () => {
    const signal = startRun()
    warnPending()
    try {
      const entries = []
      for (let i = 0; i < items.length; i++) {
        setTask({ kind: 'save', label: `저장할 사진 만드는 중 (${i + 1}/${items.length})`, value: (i / items.length) * 100 })
        const file = await resultFile(items[i])
        if (signal.aborted) return
        entries.push({ name: file.name, data: file })
      }
      await downloadZip(entries, `모자이크_${todayStamp()}`)
      toast.success(`${entries.length}장을 ZIP 으로 저장했습니다.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ZIP 을 만들지 못했습니다.')
    } finally {
      setTask(null)
    }
  }

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id))
    if (id === activeId) setActiveId(items.find((p) => p.id !== id)?.id ?? null)
  }

  // ── 화면 ────────────────────────────────────────────────
  if (!items.length) {
    return (
      <div className="flex flex-col gap-4">
        <Dropzone onFiles={addFiles} accept={ACCEPT_IMAGES} icon={ImagePlus} title="가릴 곳이 있는 사진을 끌어다 놓으세요" hint={`한 장 40MB · 4천만 화소 이하 · 최대 ${MAX_FILES}장 · Ctrl+V 로 붙여넣기`} />
        <EmptyState icon={Grid3x3} title="사진을 올리면 가릴 곳을 끌어서 그립니다">
          얼굴과 전화번호·차량번호 같은 글자는 자동으로 찾아 제안합니다. 사진은 서버로 올라가지 않고 이 기기 안에서만 처리됩니다.
        </EmptyState>
      </div>
    )
  }

  const taskView = (kind: 'face' | 'text' | 'save') =>
    task?.kind === kind && (
      <div className="flex flex-col gap-2">
        <Progress value={task.value} label={task.label} />
        <Button size="sm" onClick={cancel}>
          취소
        </Button>
      </div>
    )

  const panel = (
    <>
      <Section title="가릴 영역" hint="사진 위를 끌어서 그립니다. 그린 영역은 눌러서 옮기고, 모서리 손잡이로 크기를 바꿉니다.">
        <Segmented
          label="영역 모양"
          block
          value={shown.shape}
          onValue={(shape: Shape) => patchStyle({ shape })}
          options={[
            { value: 'rect', label: '네모', icon: Square },
            { value: 'ellipse', label: '타원', icon: Circle },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={Maximize2} disabled={!ready || busy} onClick={coverAll}>
            사진 전체 가리기
          </Button>
          <Button size="sm" icon={X} disabled={!selectedRegion || busy} onClick={removeSelected}>
            고른 영역 삭제
          </Button>
          <Button size="sm" variant="danger" icon={Trash2} disabled={!active?.regions.length || busy} onClick={clearRegions}>
            모두 지우기
          </Button>
        </div>
        <p className="num text-sm text-muted">이 사진의 영역 {active?.regions.length ?? 0}곳</p>
      </Section>

      <Section title={selectedRegion ? '고른 영역 가리는 방식' : '가리는 방식'} hint={selectedRegion ? undefined : '앞으로 그리는 영역에 적용됩니다. 영역을 누르면 그 영역만 바꿀 수 있습니다.'}>
        <Segmented
          label="가리는 방식"
          block
          value={shown.effect}
          onValue={(effect: Effect) => patchStyle({ effect })}
          options={[
            { value: 'pixel', label: '픽셀' },
            { value: 'blur', label: '블러' },
            { value: 'fill', label: '색 채우기' },
          ]}
        />
        {shown.effect === 'fill' ? (
          <ColorField label="채울 색" value={shown.color} onValue={(color) => patchStyle({ color })} />
        ) : (
          <Field label="세기" aside={`${shown.strength}`} hint="가장 약하게 해도 원래 모습을 알아볼 수 없을 만큼은 가립니다.">
            {(id) => <Slider id={id} min={MIN_STRENGTH} max={MAX_STRENGTH} value={shown.strength} onValue={(strength) => patchStyle({ strength })} />}
          </Field>
        )}
        {shown.effect !== 'fill' && <p className="text-sm text-muted">글자·번호는 픽셀이나 블러로 가려도 짐작될 수 있습니다. 확실히 숨기려면 색 채우기를 쓰세요.</p>}
        <Button size="sm" icon={Check} disabled={!active || active.regions.length < 2 || busy} onClick={applyStyleToAll}>
          이 사진의 모든 영역에 적용
        </Button>
      </Section>

      <Section title="얼굴 자동 찾기" hint={`얼굴 찾기 자료(${formatBytes(FACE_MODEL.bytes)})를 처음 한 번 ${FACE_MODEL.host} 에서 내려받습니다. 사진은 밖으로 나가지 않습니다.`}>
        <Field label="얼굴 주변 여백" aside={`${faceMargin}%`}>
          {(id) => <Slider id={id} min={0} max={60} step={5} value={faceMargin} onValue={setFaceMargin} />}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button icon={ScanFace} disabled={!ready || busy} onClick={() => active && findFaces([active])}>
            이 사진에서 찾기
          </Button>
          {items.length > 1 && (
            <Button disabled={busy} onClick={() => findFaces(items.filter((i) => i.width > 0))}>
              모든 사진에서 찾기
            </Button>
          )}
        </div>
        <Switch checked={autoFace} onChange={setAutoFace} label="사진을 올리면 바로 얼굴 찾기" hint="새로 올리는 사진부터 적용됩니다." />
        {taskView('face')}
        {faceError && (
          <Callout tone="danger" title="얼굴을 찾지 못했습니다">
            {faceError}
          </Callout>
        )}
      </Section>

      <Section title="글자 속 개인정보 찾기" hint={`사진 속 글자를 읽어 아래 종류처럼 보이는 곳을 제안합니다. 글자 인식 자료(한국어·영어, ${formatBytes(OCR_DATA.bytes)})를 처음 한 번 ${OCR_DATA.host} 에서 내려받습니다.`}>
        <div className="flex flex-col gap-1.5">
          {PATTERN_ORDER.map((p) => (
            <Checkbox key={p} checked={patterns[p]} onChange={(v) => setPatterns((cur) => ({ ...cur, [p]: v }))} label={PATTERN_LABEL[p]} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={ScanText} disabled={!ready || busy || !anyPattern} onClick={() => active && findText([active])}>
            이 사진에서 찾기
          </Button>
          {items.length > 1 && (
            <Button disabled={busy || !anyPattern} onClick={() => findText(items.filter((i) => i.width > 0))}>
              모든 사진에서 찾기
            </Button>
          )}
        </div>
        {!anyPattern && <p className="text-sm text-warn">찾을 종류를 하나 이상 고르세요.</p>}
        {taskView('text')}
        {textError && (
          <Callout tone="danger" title="글자를 읽지 못했습니다">
            {textError}
          </Callout>
        )}
        {active && active.proposals.length > 0 && (
          <div className="flex flex-col gap-2">
            <Callout tone="warn" title={`제안 ${active.proposals.length}곳 — 직접 확인하세요`}>
              형식만 보고 고른 제안입니다. 빠진 곳이나 잘못 고른 곳이 있을 수 있습니다.
            </Callout>
            <ul className="flex flex-col gap-1">
              {active.proposals.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-md border border-line bg-paper px-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink-2">{PATTERN_LABEL[p.kind]}</span>
                    <span className="num block truncate text-xs text-muted">{maskPreview(p.text)}</span>
                  </span>
                  <Button size="sm" onClick={() => acceptProposals([p.id])}>
                    가리기
                  </Button>
                  <IconButton icon={X} label="이 제안 무시" size="sm" onClick={() => dismissProposals([p.id])} />
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={Check} onClick={() => acceptProposals(active.proposals.map((p) => p.id))}>
                모두 가리기
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dismissProposals(active.proposals.map((p) => p.id))}>
                모두 무시
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section title="워터마크">
        <WatermarkControls value={wm} onChange={setWm} />
      </Section>

      <Section title="저장">
        <ExportFields value={exp} onChange={setExp} />
        <div className="flex flex-col gap-2">
          <Button variant={items.length > 1 ? 'secondary' : 'primary'} icon={Download} block disabled={!ready || busy} onClick={saveCurrent}>
            이 사진 저장
          </Button>
          {items.length > 1 && (
            <Button variant="primary" icon={FolderArchive} block disabled={busy} onClick={saveZip}>
              ZIP 으로 모두 저장 ({items.length}장)
            </Button>
          )}
          <SendToMenu exclude="mosaic" disabled={busy || !ready} files={() => Promise.all(items.filter((i) => i.width > 0).map(resultFile))} />
        </div>
        {taskView('save')}
        <p className="text-sm text-muted">가린 부분은 저장된 파일에서 되돌릴 수 없습니다. 촬영 위치 같은 부가 정보도 남지 않습니다.</p>
      </Section>
    </>
  )

  const handleSize = 9 / scaleRef.current
  return (
    <ToolLayout panel={panel}>
      <Dropzone compact onFiles={addFiles} accept={ACCEPT_IMAGES} disabled={busy || items.length >= MAX_FILES} title="사진 더 올리기" hint={`${items.length}/${MAX_FILES}장`} />
      <FileStrip
        items={items}
        activeId={activeId}
        onSelect={setActiveId}
        onRemove={removeItem}
        disabled={busy}
        badge={(it) => (it.proposals.length ? `확인 ${it.proposals.length}` : it.regions.length ? `${it.regions.length}곳 가림` : null)}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented
          label="마우스 동작"
          size="sm"
          value={panMode ? 'pan' : 'draw'}
          onValue={(v) => setPanMode(v === 'pan')}
          options={[
            { value: 'draw', label: '그리기·고르기', icon: MousePointer2 },
            { value: 'pan', label: '화면 이동', icon: Hand },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          <IconButton icon={Undo2} label="되돌리기 (Ctrl+Z)" size="sm" disabled={!active?.past.length || busy} onClick={() => stepHistory(-1)} />
          <IconButton icon={Redo2} label="다시 실행 (Ctrl+Y)" size="sm" disabled={!active?.future.length || busy} onClick={() => stepHistory(1)} />
          <Button
            size="sm"
            icon={Eye}
            disabled={!ready}
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
          <ZoomControls zoom={zoom} onZoom={setZoom} />
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
            label="사진 작업 영역. 끌어서 가릴 영역을 그립니다."
            width={active.width}
            height={active.height}
            zoom={zoom}
            onZoom={setZoom}
            panMode={panMode}
            cursor={cursor}
            onDown={onDown}
            onMove={onMove}
            onUp={onUp}
            onHover={onHover}
          >
            {({ scale }) => {
              scaleRef.current = scale
              const hs = 9 / scale
              return (
                <>
                  <canvas ref={viewRef} className="checker absolute inset-0 size-full shadow-3" />
                  {comparing && <span className="absolute left-2 top-2 rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-paper">원본</span>}
                  {!comparing && (
                    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${active.width} ${active.height}`} preserveAspectRatio="none" aria-hidden>
                      {liveRegions.map((r) => {
                        const on = r.id === selected
                        const common = { fill: 'none', strokeWidth: (on ? 2 : 1) / scale }
                        return r.shape === 'ellipse' ? (
                          <g key={r.id}>
                            <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} {...common} className="stroke-ink" strokeWidth={(on ? 4 : 2.5) / scale} opacity={0.55} />
                            <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} {...common} className={on ? 'stroke-mark' : 'stroke-surface'} strokeDasharray={on ? undefined : `${5 / scale} ${4 / scale}`} />
                          </g>
                        ) : (
                          <g key={r.id}>
                            <rect x={r.x} y={r.y} width={r.w} height={r.h} {...common} className="stroke-ink" strokeWidth={(on ? 4 : 2.5) / scale} opacity={0.55} />
                            <rect x={r.x} y={r.y} width={r.w} height={r.h} {...common} className={on ? 'stroke-mark' : 'stroke-surface'} strokeDasharray={on ? undefined : `${5 / scale} ${4 / scale}`} />
                          </g>
                        )
                      })}
                      {draftBox && <rect x={draftBox.x} y={draftBox.y} width={draftBox.w} height={draftBox.h} fill="none" className="stroke-mark" strokeWidth={2 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} />}
                      {active.proposals.map((p) => (
                        <g key={p.id}>
                          <rect x={p.x} y={p.y} width={p.w} height={p.h} className="fill-mark/30 stroke-accent" strokeWidth={2 / scale} strokeDasharray={`${6 / scale} ${3 / scale}`} />
                        </g>
                      ))}
                      {selectedRegion &&
                        (() => {
                          const live = liveRegions.find((r) => r.id === selectedRegion.id) ?? selectedRegion
                          return (
                            <>
                              {live.shape === 'ellipse' && <rect x={live.x} y={live.y} width={live.w} height={live.h} fill="none" className="stroke-mark" strokeWidth={1 / scale} strokeDasharray={`${3 / scale} ${3 / scale}`} />}
                              {HANDLES.map((h) => {
                                const p = handlePoint(live, h)
                                return <rect key={h} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs} className="fill-surface stroke-ink" strokeWidth={1.5 / scale} />
                              })}
                            </>
                          )
                        })()}
                    </svg>
                  )}
                  {!ready && <div className="skeleton absolute inset-0 rounded-none!" aria-label="사진을 여는 중" />}
                </>
              )
            }}
          </Viewport>
        )
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1">
          <Kbd>방향키</Kbd> 고른 영역 이동
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Delete</Kbd> 삭제
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Ctrl</Kbd>+<Kbd>휠</Kbd> 확대
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Space</Kbd>+끌기 화면 이동
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
