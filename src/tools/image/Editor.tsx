import '@fontsource/gaegu/korean-400.css'
import '@fontsource/gaegu/korean-700.css'
import '@fontsource/gaegu/latin-400.css'
import '@fontsource/gaegu/latin-700.css'
import '@fontsource/nanum-pen-script/korean-400.css'
import '@fontsource/nanum-pen-script/latin-400.css'

import clsx from 'clsx'
import {
  ArrowUpRight, BringToFront, Check, Circle, Copy, Crop, Eraser, FlipHorizontal2, FlipVertical2, Grid3x3, Minus, MousePointer2,
  Redo2, RotateCcw, RotateCw, Shapes, Square, Trash2, Type, Undo2, type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { bitmapToCanvas, ctx2d, fitWithin, loadBitmap, makeCanvas, resizeCanvas } from '@/lib/image'
import { usePersistentState } from '@/lib/hooks'
import { Button, Callout, ColorField, Dialog, Field, IconButton, NumberInput, Section, Select, Slider, Spinner, Switch, Tabs, Textarea } from '@/ui'
import {
  CROP_RATIOS, EMPTY_EDITS, clamp, clampRect, dragCrop, effectiveCrop, fitRatio, flipView, fromLocal, hitTest, inscribedRect, isEdited,
  moveObject, orientedSize, resizeBox, rotateQuarter, setAngle, boxCorners,
  type BoxHandle, type CropHandle, type CropRatioKey,
} from './geometry'
import { FONTS, boxOf, ensureFonts, fontsReady, releaseCanvas, renderEdited, type PhotoSource } from './render'
import { isLine, type Annotation, type AnnotationType, type Box, type FontKey, type Photo, type PhotoEdits, type Point, type Rect, type TextObject } from './types'

type Tool = 'select' | AnnotationType
type HandleKey = BoxHandle | 'rotate' | 'p1' | 'p2'

/** 새로 그릴 때 쓰는 모양. 크기는 사진 짧은 변 대비 %라서 큰 사진·작은 사진에서 비슷하게 보인다. */
interface StylePrefs {
  color: string
  widthPct: number
  fill: boolean
  textColor: string
  font: FontKey
  bold: boolean
  textPct: number
  /** 글자 높이 대비 외곽선 두께(%) */
  outlinePct: number
  outlineColor: string
  background: boolean
  backgroundColor: string
  blockPct: number
}

const DEFAULT_STYLE: StylePrefs = {
  color: '#e8551f',
  widthPct: 0.8,
  fill: false,
  textColor: '#ffffff',
  font: 'gothic',
  bold: true,
  textPct: 6,
  outlinePct: 8,
  outlineColor: '#14201a',
  background: false,
  backgroundColor: '#14201a',
  blockPct: 2.5,
}

const TOOLS: Array<{ value: Tool; label: string; icon: LucideIcon; hint: string }> = [
  { value: 'select', label: '선택', icon: MousePointer2, hint: '그린 것을 눌러 고르고, 끌어서 옮기거나 손잡이로 크기를 바꿉니다.' },
  { value: 'text', label: '글자', icon: Type, hint: '사진에서 글자를 놓을 자리를 누르세요.' },
  { value: 'arrow', label: '화살표', icon: ArrowUpRight, hint: '시작점에서 가리킬 곳까지 끌어서 그립니다.' },
  { value: 'line', label: '선', icon: Minus, hint: '끌어서 그립니다. Shift 를 누르면 수평·수직·45°에 맞춰집니다.' },
  { value: 'rect', label: '사각형', icon: Square, hint: '끌어서 그립니다. Shift 를 누르면 정사각형이 됩니다.' },
  { value: 'ellipse', label: '원', icon: Circle, hint: '끌어서 그립니다. Shift 를 누르면 동그란 원이 됩니다.' },
  { value: 'mosaic', label: '모자이크', icon: Grid3x3, hint: '가릴 곳을 끌어서 지정합니다. 여러 곳을 이어서 그릴 수 있습니다.' },
]

interface History {
  past: PhotoEdits[]
  present: PhotoEdits
  future: PhotoEdits[]
}

type Drag =
  | { kind: 'crop'; handle: CropHandle; start: Rect; p0: Point; base: PhotoEdits }
  | { kind: 'move'; id: string; p0: Point; base: PhotoEdits }
  | { kind: 'resize'; id: string; handle: BoxHandle; base: PhotoEdits }
  | { kind: 'rotate'; id: string; base: PhotoEdits }
  | { kind: 'endpoint'; id: string; which: 'p1' | 'p2'; base: PhotoEdits }
  | { kind: 'textscale'; id: string; d0: number; base: PhotoEdits }
  | { kind: 'create'; id: string; type: AnnotationType; p0: Point; s0: Point; base: PhotoEdits }

interface View {
  scale: number
  ox: number
  oy: number
  region: Rect
}

const newId = () => Math.random().toString(36).slice(2, 10)
const HANDLE_R = 6
const ROTATE_GAP = 26

let checker: HTMLCanvasElement | null = null
function checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern | string {
  if (!checker) {
    checker = makeCanvas(16, 16)
    const c = ctx2d(checker)
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, 16, 16)
    c.fillStyle = '#e4e0d6'
    c.fillRect(0, 0, 8, 8)
    c.fillRect(8, 8, 8, 8)
  }
  return ctx.createPattern(checker, 'repeat') ?? '#ffffff'
}

function handlesOf(o: Annotation, scale: number): Array<{ key: HandleKey; p: Point }> {
  if (isLine(o)) {
    return [
      { key: 'p1', p: { x: o.x1, y: o.y1 } },
      { key: 'p2', p: { x: o.x2, y: o.y2 } },
    ]
  }
  const box = boxOf(o)
  const hw = box.w / 2
  const hh = box.h / 2
  const local: Array<[HandleKey, number, number]> = [
    ['nw', -hw, -hh],
    ['ne', hw, -hh],
    ['se', hw, hh],
    ['sw', -hw, hh],
  ]
  if (o.type !== 'text') local.push(['n', 0, -hh], ['e', hw, 0], ['s', 0, hh], ['w', -hw, 0])
  local.push(['rotate', 0, -hh - ROTATE_GAP / scale])
  return local.map(([key, x, y]) => ({ key, p: fromLocal({ x, y }, box) }))
}

const CROP_CURSOR: Record<CropHandle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', move: 'move' }

export interface EditorProps {
  photo: Photo
  onApply: (edits: PhotoEdits) => void
  onClose: () => void
}

/** 한 장 정밀 편집: 자르기·회전·반전과 글자·도형·모자이크. 결과는 PhotoEdits 데이터로 돌려준다. */
export default function Editor({ photo, onApply, onClose }: EditorProps) {
  const W = photo.width
  const H = photo.height
  const [source, setSource] = useState<PhotoSource | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hist, setHist] = useState<History>(() => ({ past: [], present: photo.edits, future: [] }))
  const [live, setLiveState] = useState<PhotoEdits | null>(null)
  const liveRef = useRef<PhotoEdits | null>(null)
  const setLive = (v: PhotoEdits | null) => {
    liveRef.current = v
    setLiveState(v)
  }
  const [mode, setMode] = useState<'crop' | 'draw'>('crop')
  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [ratioKey, setRatioKey] = useState<CropRatioKey>('free')
  const [style, setStyle] = usePersistentState<StylePrefs>('onbijjang:image:editor-style', DEFAULT_STYLE)
  const [confirmClose, setConfirmClose] = useState(false)
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 })
  const [fontTick, setFontTick] = useState(0)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textFieldId = useRef('')
  const dragRef = useRef<Drag | null>(null)
  const lastCommit = useRef<{ key: string | null; time: number }>({ key: null, time: 0 })
  const focusText = useRef(false)

  const edits = live ?? hist.present
  const dirty = hist.present !== photo.edits
  const ratio = CROP_RATIOS.find((r) => r.value === ratioKey)?.ratio ?? null
  const bbox = useMemo(() => orientedSize(W, H, edits), [W, H, edits])
  const crop = useMemo(() => effectiveCrop(W, H, edits), [W, H, edits])
  const short = Math.max(1, Math.min(crop.w, crop.h))
  const selected = mode === 'draw' ? (edits.objects.find((o) => o.id === selectedId) ?? null) : null

  // ── 원본 불러오기(편집 화면용으로 긴 변 2400px 까지) ──
  useEffect(() => {
    let alive = true
    let made: HTMLCanvasElement | null = null
    loadBitmap(photo.file)
      .then(async (bmp) => {
        const fit = fitWithin(bmp.width, bmp.height, 2400)
        const canvas = fit.scale < 1 ? resizeCanvas(bmp, fit.width, fit.height) : await bitmapToCanvas(bmp)
        bmp.close()
        if (!alive) return releaseCanvas(canvas)
        made = canvas
        setSource({ image: canvas, width: W, height: H })
      })
      .catch((err) => alive && setLoadError(err instanceof Error ? err.message : '사진을 열지 못했습니다.'))
    return () => {
      alive = false
      releaseCanvas(made)
    }
  }, [photo.file, W, H])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setViewSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 글자에 쓰인 글꼴이 아직 없으면 받은 뒤 다시 그린다.
  useEffect(() => {
    if (fontsReady(edits)) return
    let alive = true
    ensureFonts(edits).then(() => alive && setFontTick((t) => t + 1))
    return () => {
      alive = false
    }
  }, [edits])

  // ── 화면 배치 ──
  const view: View = useMemo(() => {
    const region = mode === 'crop' ? { x: 0, y: 0, w: bbox.w, h: bbox.h } : crop
    const pad = mode === 'crop' ? 28 : 40
    const scale = clamp(Math.min((viewSize.w - pad * 2) / region.w, (viewSize.h - pad * 2) / region.h), 0.001, 8)
    return { scale, region, ox: (viewSize.w - region.w * scale) / 2, oy: (viewSize.h - region.h * scale) / 2 }
  }, [mode, bbox, crop, viewSize])
  const toScreen = (p: Point): Point => ({ x: (p.x - view.region.x) * view.scale + view.ox, y: (p.y - view.region.y) * view.scale + view.oy })
  const toImage = (s: Point): Point => ({ x: (s.x - view.ox) / view.scale + view.region.x, y: (s.y - view.oy) / view.scale + view.region.y })

  // ── 그리기 ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !source || viewSize.w < 20 || viewSize.h < 20) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const cw = Math.round(viewSize.w * dpr)
    const ch = Math.round(viewSize.h * dpr)
    if (canvas.width !== cw) canvas.width = cw
    if (canvas.height !== ch) canvas.height = ch
    const ctx = ctx2d(canvas)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const { scale, ox, oy, region } = view
    const iw = region.w * scale
    const ih = region.h * scale

    ctx.fillStyle = checkerPattern(ctx)
    ctx.fillRect(ox, oy, iw, ih)
    const img = renderEdited(source, edits, { region, scale: scale * dpr })
    ctx.drawImage(img, ox, oy, iw, ih)
    releaseCanvas(img)

    if (mode === 'crop') {
      const c = { x: ox + crop.x * scale, y: oy + crop.y * scale, w: crop.w * scale, h: crop.h * scale }
      ctx.fillStyle = 'rgba(10, 20, 15, 0.62)'
      ctx.beginPath()
      ctx.rect(ox, oy, iw, ih)
      ctx.rect(c.x, c.y, c.w, c.h)
      ctx.fill('evenodd')
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(c.x + (c.w * i) / 3, c.y)
        ctx.lineTo(c.x + (c.w * i) / 3, c.y + c.h)
        ctx.moveTo(c.x, c.y + (c.h * i) / 3)
        ctx.lineTo(c.x + c.w, c.y + (c.h * i) / 3)
      }
      ctx.stroke()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.strokeRect(c.x, c.y, c.w, c.h)
      const pts: Array<[number, number]> = [
        [c.x, c.y], [c.x + c.w / 2, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h / 2],
        [c.x + c.w, c.y + c.h], [c.x + c.w / 2, c.y + c.h], [c.x, c.y + c.h], [c.x, c.y + c.h / 2],
      ]
      for (const [x, y] of pts) {
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#14201a'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.rect(x - 5.5, y - 5.5, 11, 11)
        ctx.fill()
        ctx.stroke()
      }
    } else if (selected) {
      const map = (p: Point) => ({ x: (p.x - region.x) * scale + ox, y: (p.y - region.y) * scale + oy })
      const handles = handlesOf(selected, scale)
      if (!isLine(selected)) {
        const corners = boxCorners(boxOf(selected)).map(map)
        const path = () => {
          ctx.beginPath()
          corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
          ctx.closePath()
        }
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
        path()
        ctx.stroke()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = '#0b7a53'
        ctx.setLineDash([6, 4])
        path()
        ctx.stroke()
        ctx.setLineDash([])
        const rot = handles.find((h) => h.key === 'rotate')
        if (rot) {
          const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }
          const r = map(rot.p)
          ctx.beginPath()
          ctx.moveTo(top.x, top.y)
          ctx.lineTo(r.x, r.y)
          ctx.stroke()
        }
      }
      for (const h of handles) {
        const p = map(h.p)
        ctx.beginPath()
        if (h.key === 'rotate' || h.key === 'p1' || h.key === 'p2') ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2)
        else ctx.rect(p.x - HANDLE_R + 1, p.y - HANDLE_R + 1, HANDLE_R * 2 - 2, HANDLE_R * 2 - 2)
        ctx.fillStyle = h.key === 'rotate' ? '#ffe55c' : '#ffffff'
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = '#0b7a53'
        ctx.stroke()
      }
    }
  }, [source, edits, mode, view, viewSize, crop, selected, fontTick])

  // ── 기록 ──
  const commit = (next: PhotoEdits, key?: string) => {
    const now = Date.now()
    const merge = key != null && lastCommit.current.key === key && now - lastCommit.current.time < 1200
    lastCommit.current = { key: key ?? null, time: now }
    setHist((h) => (merge && h.past.length ? { ...h, present: next, future: [] } : { past: [...h.past, h.present].slice(-100), present: next, future: [] }))
  }
  const undo = () => {
    lastCommit.current = { key: null, time: 0 }
    setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h))
  }
  const redo = () => {
    lastCommit.current = { key: null, time: 0 }
    setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h))
  }

  const updateObject = (id: string, patch: Partial<Annotation>, key?: string) => {
    const base = hist.present
    commit({ ...base, objects: base.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as Annotation) : o)) }, key ? `${key}:${id}` : undefined)
  }
  const removeSelected = () => {
    if (!selectedId) return
    const base = hist.present
    commit({ ...base, objects: base.objects.filter((o) => o.id !== selectedId) })
    setSelectedId(null)
  }
  const duplicateSelected = () => {
    const base = hist.present
    const o = base.objects.find((x) => x.id === selectedId)
    if (!o) return
    const copy = { ...moveObject(o, short * 0.04, short * 0.04), id: newId() }
    commit({ ...base, objects: [...base.objects, copy] })
    setSelectedId(copy.id)
  }
  const bringToFront = () => {
    const base = hist.present
    const o = base.objects.find((x) => x.id === selectedId)
    if (!o) return
    commit({ ...base, objects: [...base.objects.filter((x) => x !== o), o] })
  }

  // ── 물체 만들기 ──
  const makeObject = (type: AnnotationType, id: string, p0: Point, p1: Point | null, shift: boolean): Annotation => {
    const width = Math.max(1, Math.round((short * style.widthPct) / 100))
    if (type === 'text') {
      const size = Math.max(8, Math.round((short * style.textPct) / 100))
      return {
        id, type, cx: p0.x, cy: p0.y, rotation: 0, text: '글자', font: style.font, size, color: style.textColor, bold: style.bold,
        outline: Math.round((size * style.outlinePct) / 100), outlineColor: style.outlineColor, background: style.background, backgroundColor: style.backgroundColor,
      }
    }
    if (type === 'line' || type === 'arrow') {
      if (!p1) {
        const d = short * 0.18
        return type === 'arrow'
          ? { id, type, x1: p0.x - d, y1: p0.y + d, x2: p0.x, y2: p0.y, color: style.color, width }
          : { id, type, x1: p0.x - d, y1: p0.y, x2: p0.x + d, y2: p0.y, color: style.color, width }
      }
      const end = shift ? snapAngle(p0, p1) : p1
      return { id, type, x1: p0.x, y1: p0.y, x2: end.x, y2: end.y, color: style.color, width }
    }
    let box: Box
    if (!p1) box = { cx: p0.x, cy: p0.y, w: short * 0.3, h: short * 0.2, rotation: 0 }
    else {
      let w = Math.abs(p1.x - p0.x)
      let h = Math.abs(p1.y - p0.y)
      if (shift) w = h = Math.max(w, h)
      const sx = p1.x >= p0.x ? 1 : -1
      const sy = p1.y >= p0.y ? 1 : -1
      box = { cx: p0.x + (sx * w) / 2, cy: p0.y + (sy * h) / 2, w: Math.max(2, w), h: Math.max(2, h), rotation: 0 }
    }
    if (type === 'mosaic') return { id, type, ...box, block: Math.max(4, Math.round((short * style.blockPct) / 100)) }
    return { id, type, ...box, color: style.color, width, fill: style.fill }
  }

  // ── 포인터 ──
  const pointerPos = (e: { clientX: number; clientY: number }): Point => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const cropHandleAt = (s: Point): CropHandle | null => {
    const a = toScreen({ x: crop.x, y: crop.y })
    const b = toScreen({ x: crop.x + crop.w, y: crop.y + crop.h })
    const tol = 12
    if (s.x < a.x - tol || s.x > b.x + tol || s.y < a.y - tol || s.y > b.y + tol) return null
    const nearL = Math.abs(s.x - a.x) <= tol
    const nearR = Math.abs(s.x - b.x) <= tol
    const nearT = Math.abs(s.y - a.y) <= tol
    const nearB = Math.abs(s.y - b.y) <= tol
    const v = nearT ? 'n' : nearB ? 's' : ''
    const h = nearL ? 'w' : nearR ? 'e' : ''
    return ((v + h) as CropHandle) || 'move'
  }
  const handleAt = (o: Annotation, s: Point): HandleKey | null => {
    for (const h of handlesOf(o, view.scale).reverse()) {
      const p = toScreen(h.p)
      if (Math.hypot(p.x - s.x, p.y - s.y) <= HANDLE_R + 5) return h.key
    }
    return null
  }
  const hitTol = () => 8 / view.scale

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!source || e.button !== 0) return
    const s = pointerPos(e)
    const p = toImage(s)
    const base = hist.present
    let drag: Drag | null = null
    if (mode === 'crop') {
      const handle = cropHandleAt(s)
      if (handle) drag = { kind: 'crop', handle, start: effectiveCrop(W, H, base), p0: p, base }
    } else {
      const sel = base.objects.find((o) => o.id === selectedId) ?? null
      const hk = sel ? handleAt(sel, s) : null
      if (sel && hk) {
        if (hk === 'rotate') drag = { kind: 'rotate', id: sel.id, base }
        else if (hk === 'p1' || hk === 'p2') drag = { kind: 'endpoint', id: sel.id, which: hk, base }
        else if (sel.type === 'text') drag = { kind: 'textscale', id: sel.id, d0: Math.max(1, Math.hypot(p.x - sel.cx, p.y - sel.cy)), base }
        else drag = { kind: 'resize', id: sel.id, handle: hk, base }
      } else if (sel && hitTest(sel, p, hitTol(), boxOf)) {
        drag = { kind: 'move', id: sel.id, p0: p, base }
      } else if (tool === 'select') {
        const hit = [...base.objects].reverse().find((o) => hitTest(o, p, hitTol(), boxOf))
        setSelectedId(hit?.id ?? null)
        if (hit) drag = { kind: 'move', id: hit.id, p0: p, base }
      } else {
        drag = { kind: 'create', id: newId(), type: tool, p0: p, s0: s, base }
      }
    }
    if (!drag) return
    e.preventDefault()
    dragRef.current = drag
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = pointerPos(e)
    const p = toImage(s)
    const d = dragRef.current
    if (!d) {
      let cursor = 'default'
      if (mode === 'crop') {
        const h = cropHandleAt(s)
        if (h) cursor = CROP_CURSOR[h]
      } else {
        const sel = hist.present.objects.find((o) => o.id === selectedId)
        const hk = sel ? handleAt(sel, s) : null
        if (hk) cursor = hk === 'rotate' ? 'grab' : 'pointer'
        else if (sel && hitTest(sel, p, hitTol(), boxOf)) cursor = 'move'
        else if (tool !== 'select') cursor = 'crosshair'
        else if (hist.present.objects.some((o) => hitTest(o, p, hitTol(), boxOf))) cursor = 'move'
      }
      e.currentTarget.style.cursor = cursor
      return
    }
    const mapObj = (id: string, fn: (o: Annotation) => Annotation): PhotoEdits => ({ ...d.base, objects: d.base.objects.map((o) => (o.id === id ? fn(o) : o)) })
    switch (d.kind) {
      case 'crop':
        setLive({ ...d.base, crop: dragCrop(d.start, d.handle, p.x - d.p0.x, p.y - d.p0.y, bbox, ratio, Math.min(16, bbox.w, bbox.h)) })
        break
      case 'move':
        setLive(mapObj(d.id, (o) => moveObject(o, p.x - d.p0.x, p.y - d.p0.y)))
        break
      case 'resize':
        setLive(mapObj(d.id, (o) => ('w' in o ? { ...o, ...resizeBox(o, d.handle, p, 2) } : o)))
        break
      case 'rotate':
        setLive(
          mapObj(d.id, (o) => {
            if (!('rotation' in o)) return o
            let deg = (Math.atan2(p.y - o.cy, p.x - o.cx) * 180) / Math.PI + 90
            if (e.shiftKey) deg = Math.round(deg / 15) * 15
            if (deg > 180) deg -= 360
            return { ...o, rotation: Math.round(deg * 10) / 10 }
          }),
        )
        break
      case 'endpoint':
        setLive(
          mapObj(d.id, (o) => {
            if (!isLine(o)) return o
            if (d.which === 'p1') {
              const q = e.shiftKey ? snapAngle({ x: o.x2, y: o.y2 }, p) : p
              return { ...o, x1: q.x, y1: q.y }
            }
            const q = e.shiftKey ? snapAngle({ x: o.x1, y: o.y1 }, p) : p
            return { ...o, x2: q.x, y2: q.y }
          }),
        )
        break
      case 'textscale':
        setLive(
          mapObj(d.id, (o) => {
            if (o.type !== 'text') return o
            const f = Math.hypot(p.x - o.cx, p.y - o.cy) / d.d0
            const size = clamp(Math.round(o.size * f), 6, 4000)
            return { ...o, size, outline: Math.round(((o.outline * size) / o.size) * 10) / 10 }
          }),
        )
        break
      case 'create':
        if (Math.hypot(s.x - d.s0.x, s.y - d.s0.y) < 5 || d.type === 'text') setLive(null)
        else setLive({ ...d.base, objects: [...d.base.objects, makeObject(d.type, d.id, d.p0, p, e.shiftKey)] })
        break
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d) return
    if (d.kind === 'create') {
      commit(liveRef.current ?? { ...d.base, objects: [...d.base.objects, makeObject(d.type, d.id, d.p0, null, false)] })
      setSelectedId(d.id)
      if (d.type === 'text') {
        setTool('select')
        focusText.current = true
      }
    } else if (liveRef.current) {
      commit(liveRef.current)
    }
    setLive(null)
  }

  useEffect(() => {
    const el = focusText.current && selected?.type === 'text' ? document.getElementById(textFieldId.current) : null
    if (el instanceof HTMLTextAreaElement) {
      focusText.current = false
      el.focus()
      el.select()
    }
  }, [selected])

  // ── 닫기 ──
  const requestClose = () => {
    if (dirty) setConfirmClose(true)
    else onClose()
  }
  const apply = () => {
    if (dirty) onApply(hist.present)
    onClose()
  }

  // ── 키보드 ──
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined)
  keyHandler.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    const typing = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable))
    if (e.key === 'Escape') {
      // 기본 동작(대화상자 바로 닫힘)을 막고, 단계적으로 물러난다.
      e.preventDefault()
      if (typing) target?.blur()
      else if (dragRef.current) {
        dragRef.current = null
        setLive(null)
      } else if (confirmClose) setConfirmClose(false)
      else if (selectedId) setSelectedId(null)
      else if (tool !== 'select') setTool('select')
      else requestClose()
      return
    }
    if (typing) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (mod && k === 'y') {
      e.preventDefault()
      redo()
    } else if (mod && k === 'd' && selectedId) {
      e.preventDefault()
      duplicateSelected()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && mode === 'draw') {
      e.preventDefault()
      removeSelected()
    } else if (e.key.startsWith('Arrow') && selectedId && mode === 'draw') {
      e.preventDefault()
      const step = (e.shiftKey ? 10 : 1) / view.scale
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      const base = hist.present
      commit({ ...base, objects: base.objects.map((o) => (o.id === selectedId ? moveObject(o, dx, dy) : o)) }, `nudge:${selectedId}`)
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e)
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  // ── 자르기·회전 동작 ──
  const present = hist.present
  const pickRatio = (key: CropRatioKey) => {
    setRatioKey(key)
    const r = CROP_RATIOS.find((x) => x.value === key)?.ratio
    if (r) commit({ ...present, crop: fitRatio(inscribedRect(W, H, present), r) })
  }
  const setCropSize = (axis: 'w' | 'h', value: number | null) => {
    if (value == null || !Number.isFinite(value)) return
    const cur = effectiveCrop(W, H, present)
    let w = axis === 'w' ? value : cur.w
    let h = axis === 'h' ? value : cur.h
    if (ratio) {
      if (axis === 'w') h = w / ratio
      else w = h * ratio
      const k = Math.min(1, bbox.w / w, bbox.h / h)
      w *= k
      h *= k
    }
    const next = clampRect({ x: cur.x + (cur.w - w) / 2, y: cur.y + (cur.h - h) / 2, w, h }, bbox.w, bbox.h, 1)
    commit({ ...present, crop: next }, `cropsize:${axis}`)
  }
  const switchMode = (m: 'crop' | 'draw') => {
    setMode(m)
    setSelectedId(null)
    setTool('select')
  }

  const toolInfo = TOOLS.find((t) => t.value === tool)!

  // ── 선택한 물체의 설정 ──
  const objectPanel = (o: Annotation) => {
    const widthMax = Math.max(8, Math.round(short * 0.08))
    const common = (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={Copy} onClick={duplicateSelected}>
          복제
        </Button>
        <Button size="sm" icon={BringToFront} onClick={bringToFront}>
          맨 앞으로
        </Button>
        <Button size="sm" variant="danger" icon={Trash2} onClick={removeSelected}>
          삭제
        </Button>
      </div>
    )
    if (o.type === 'text') {
      const sizeMax = Math.max(40, Math.round(short * 0.5))
      const patch = (p: Partial<TextObject>, key?: string) => updateObject(o.id, p, key)
      return (
        <Section title="글자">
          <Field label="내용">
            {(id) => {
              textFieldId.current = id
              return <Textarea id={id} value={o.text} onChange={(e) => patch({ text: e.target.value }, 'text')} rows={2} className="min-h-16!" maxLength={300} />
            }}
          </Field>
          <Field label="글꼴">
            {(id) => (
              <Select
                id={id}
                value={o.font}
                onValue={(font) => {
                  patch({ font })
                  setStyle((s) => ({ ...s, font }))
                }}
                options={(Object.keys(FONTS) as FontKey[]).map((k) => ({ value: k, label: FONTS[k].label }))}
              />
            )}
          </Field>
          <Field label="크기" aside={`${Math.round(o.size)}px`}>
            {(id) => (
              <Slider
                id={id}
                min={8}
                max={sizeMax}
                value={Math.min(sizeMax, Math.round(o.size))}
                onValue={(size) => {
                  patch({ size, outline: Math.round(((o.outline * size) / o.size) * 10) / 10 }, 'size')
                  setStyle((s) => ({ ...s, textPct: (size / short) * 100 }))
                }}
              />
            )}
          </Field>
          <ColorField
            label="글자 색"
            value={o.color}
            onValue={(color) => {
              patch({ color }, 'color')
              setStyle((s) => ({ ...s, textColor: color }))
            }}
          />
          {FONTS[o.font].boldable && (
            <Switch
              label="굵게"
              checked={o.bold}
              onChange={(bold) => {
                patch({ bold })
                setStyle((s) => ({ ...s, bold }))
              }}
            />
          )}
          <Field label="외곽선" aside={o.outline > 0 ? `${Math.round(o.outline * 10) / 10}px` : '없음'}>
            {(id) => (
              <Slider
                id={id}
                min={0}
                max={Math.max(2, Math.round(o.size * 0.25))}
                step={0.5}
                value={o.outline}
                onValue={(outline) => {
                  patch({ outline }, 'outline')
                  setStyle((s) => ({ ...s, outlinePct: (outline / o.size) * 100 }))
                }}
              />
            )}
          </Field>
          {o.outline > 0 && (
            <ColorField
              label="외곽선 색"
              value={o.outlineColor}
              onValue={(outlineColor) => {
                patch({ outlineColor }, 'outlineColor')
                setStyle((s) => ({ ...s, outlineColor }))
              }}
            />
          )}
          <Switch
            label="글자 뒤 배경"
            checked={o.background}
            onChange={(background) => {
              patch({ background })
              setStyle((s) => ({ ...s, background }))
            }}
          />
          {o.background && (
            <ColorField
              label="배경 색"
              value={o.backgroundColor}
              onValue={(backgroundColor) => {
                patch({ backgroundColor }, 'backgroundColor')
                setStyle((s) => ({ ...s, backgroundColor }))
              }}
            />
          )}
          <Field label="기울기" aside={`${Math.round(o.rotation)}°`}>{(id) => <Slider id={id} min={-180} max={180} value={Math.round(o.rotation)} onValue={(rotation) => patch({ rotation }, 'rotation')} />}</Field>
          {common}
        </Section>
      )
    }
    if (o.type === 'mosaic') {
      const blockMax = Math.max(12, Math.round(short * 0.1))
      return (
        <Section title="모자이크">
          <Field label="칸 크기" aside={`${Math.round(o.block)}px`} hint="클수록 더 많이 가려집니다.">
            {(id) => (
              <Slider
                id={id}
                min={4}
                max={blockMax}
                value={Math.min(blockMax, Math.round(o.block))}
                onValue={(block) => {
                  updateObject(o.id, { block }, 'block')
                  setStyle((s) => ({ ...s, blockPct: (block / short) * 100 }))
                }}
              />
            )}
          </Field>
          {common}
        </Section>
      )
    }
    const isShape = o.type === 'rect' || o.type === 'ellipse'
    return (
      <Section title={o.type === 'rect' ? '사각형' : o.type === 'ellipse' ? '원' : o.type === 'arrow' ? '화살표' : '선'}>
        <ColorField
          label="색"
          value={o.color}
          onValue={(color) => {
            updateObject(o.id, { color }, 'color')
            setStyle((s) => ({ ...s, color }))
          }}
        />
        {isShape && (
          <Switch
            label="색으로 채우기"
            checked={o.fill}
            onChange={(fill) => {
              updateObject(o.id, { fill })
              setStyle((s) => ({ ...s, fill }))
            }}
          />
        )}
        {!(isShape && o.fill) && (
          <Field label="두께" aside={`${Math.round(o.width)}px`}>
            {(id) => (
              <Slider
                id={id}
                min={1}
                max={widthMax}
                value={Math.min(widthMax, Math.round(o.width))}
                onValue={(width) => {
                  updateObject(o.id, { width }, 'width')
                  setStyle((s) => ({ ...s, widthPct: (width / short) * 100 }))
                }}
              />
            )}
          </Field>
        )}
        {common}
      </Section>
    )
  }

  const footer = confirmClose ? (
    <>
      <span className="mr-auto text-sm font-semibold text-ink-2">적용하지 않은 변경이 있습니다.</span>
      <Button onClick={() => setConfirmClose(false)}>계속 편집</Button>
      <Button variant="danger" onClick={onClose}>
        버리고 닫기
      </Button>
      <Button variant="primary" icon={Check} onClick={apply}>
        적용하고 닫기
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="ghost"
        icon={Eraser}
        className="mr-auto"
        disabled={!isEdited(present)}
        onClick={() => {
          commit(EMPTY_EDITS)
          setSelectedId(null)
          setRatioKey('free')
        }}
      >
        편집 모두 지우기
      </Button>
      <Button onClick={requestClose}>취소</Button>
      <Button variant="primary" icon={Check} onClick={apply}>
        적용
      </Button>
    </>
  )

  return (
    <Dialog open onClose={requestClose} size="full" title={<span className="block max-w-[62vw] truncate">정밀 편집 · {photo.name}</span>} footer={footer}>
      <div className="flex flex-col gap-3 lg:h-full lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs
              label="편집 종류"
              value={mode}
              onValue={switchMode}
              tabs={[
                { value: 'crop', label: '자르기·회전', icon: Crop },
                { value: 'draw', label: '글자·도형', icon: Shapes },
              ]}
              className="overflow-y-hidden border-b-0! pb-px"
            />
            <div className="flex items-center gap-1">
              <IconButton icon={Undo2} label="되돌리기 (Ctrl+Z)" size="sm" disabled={!hist.past.length} onClick={undo} />
              <IconButton icon={Redo2} label="다시 실행 (Ctrl+Shift+Z)" size="sm" disabled={!hist.future.length} onClick={redo} />
            </div>
          </div>
          <div ref={wrapRef} className="mat relative h-[52dvh] min-h-[260px] overflow-hidden rounded-lg border border-mat-deep lg:h-auto lg:flex-1">
            <canvas
              ref={canvasRef}
              className="absolute inset-0 size-full touch-none select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label="편집 중인 사진"
            />
            {!source && !loadError && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm">
                <Spinner /> 사진을 여는 중
              </div>
            )}
            {loadError && (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <Callout tone="danger" title="사진을 열지 못했습니다">
                  {loadError}
                </Callout>
              </div>
            )}
          </div>
        </div>

        <aside className="shrink-0 rounded-lg border border-line bg-surface lg:w-[312px] lg:overflow-y-auto">
          {mode === 'crop' ? (
            <>
              <Section title="자르기" hint="밝은 영역이 남습니다. 모서리와 변을 끌어 조절하세요.">
                <div role="radiogroup" aria-label="자르기 비율" className="grid grid-cols-3 gap-1.5">
                  {CROP_RATIOS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      role="radio"
                      aria-checked={ratioKey === r.value}
                      onClick={() => pickRatio(r.value)}
                      className={clsx(
                        'num h-9 rounded-md border text-sm font-semibold transition-colors duration-150',
                        ratioKey === r.value ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-sunken',
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="가로">{(id) => <NumberInput id={id} unit="px" min={1} max={Math.round(bbox.w)} value={Math.round(crop.w)} onValue={(v) => setCropSize('w', v)} />}</Field>
                  <Field label="세로">{(id) => <NumberInput id={id} unit="px" min={1} max={Math.round(bbox.h)} value={Math.round(crop.h)} onValue={(v) => setCropSize('h', v)} />}</Field>
                </div>
                <Button
                  size="sm"
                  disabled={present.crop === null}
                  onClick={() => {
                    commit({ ...present, crop: null })
                    setRatioKey('free')
                  }}
                >
                  자르기 초기화
                </Button>
              </Section>
              <Section title="회전">
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" icon={RotateCcw} onClick={() => commit(rotateQuarter(W, H, present, -1))}>
                    왼쪽 90°
                  </Button>
                  <Button size="sm" icon={RotateCw} onClick={() => commit(rotateQuarter(W, H, present, 1))}>
                    오른쪽 90°
                  </Button>
                </div>
                <Field label="기울기 바로잡기" aside={`${present.angle > 0 ? '+' : ''}${present.angle}°`} hint="기울이면 빈 모서리가 생기지 않게 자동으로 조금 잘립니다.">
                  {(id) => <Slider id={id} min={-45} max={45} step={0.5} value={edits.angle} onValue={(a) => commit(setAngle(W, H, present, a), 'angle')} />}
                </Field>
                <Button size="sm" variant="ghost" disabled={present.angle === 0} onClick={() => commit(setAngle(W, H, present, 0))}>
                  기울기 0°로
                </Button>
              </Section>
              <Section title="반전">
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" icon={FlipHorizontal2} onClick={() => commit(flipView(W, H, present, 'h'))}>
                    좌우 반전
                  </Button>
                  <Button size="sm" icon={FlipVertical2} onClick={() => commit(flipView(W, H, present, 'v'))}>
                    상하 반전
                  </Button>
                </div>
              </Section>
            </>
          ) : (
            <>
              <Section title="도구" hint={toolInfo.hint}>
                <div role="radiogroup" aria-label="그리기 도구" className="grid grid-cols-4 gap-1.5">
                  {TOOLS.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={tool === t.value}
                      onClick={() => {
                        setTool(t.value)
                        if (t.value !== 'select') setSelectedId(null)
                      }}
                      className={clsx(
                        'flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-xs font-semibold transition-colors duration-150',
                        tool === t.value ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-sunken',
                      )}
                    >
                      <t.icon className="size-4" aria-hidden />
                      {t.label}
                    </button>
                  ))}
                </div>
              </Section>
              {selected ? (
                objectPanel(selected)
              ) : tool === 'text' ? (
                <Section title="새 글자 모양" hint="놓은 뒤에 내용·글꼴·외곽선을 바꿀 수 있습니다.">
                  <ColorField label="글자 색" value={style.textColor} onValue={(textColor) => setStyle((s) => ({ ...s, textColor }))} />
                </Section>
              ) : tool === 'mosaic' ? null : tool !== 'select' ? (
                <Section title="새로 그릴 모양">
                  <ColorField label="색" value={style.color} onValue={(color) => setStyle((s) => ({ ...s, color }))} />
                  <Field label="두께" aside={`${Math.max(1, Math.round((short * style.widthPct) / 100))}px`}>
                    {(id) => <Slider id={id} min={0.2} max={5} step={0.1} value={clamp(style.widthPct, 0.2, 5)} onValue={(widthPct) => setStyle((s) => ({ ...s, widthPct }))} />}
                  </Field>
                </Section>
              ) : (
                <p className="px-4 py-4 text-sm text-muted">
                  {edits.objects.length ? '사진 위의 글자·도형을 누르면 여기에서 색과 크기를 바꿀 수 있습니다.' : '위에서 도구를 고른 다음 사진 위에 그리세요. 그린 것은 언제든 다시 열어 고칠 수 있습니다.'}
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </Dialog>
  )
}

/** from 을 기준으로 to 를 45° 단위 방향에 맞춘다. */
function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  const step = Math.PI / 4
  const a = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len }
}
