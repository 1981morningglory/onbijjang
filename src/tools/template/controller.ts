import type { Canvas, FabricImage, Path, Textbox, TPointerEventInfo } from 'fabric'
import type { Asset, AssetStore } from './assets'
import { EXTRA_PROPS, extra, type Fabric, type FObject } from './fabricKit'
import { DEFAULT_FONT, HAND_FONT, ensureFonts } from './fonts'
import { alignDelta, computeSnap, distributeDeltas, type AlignHow, type Box, type Guide } from './geometry'
import { ASSET_PREFIX, collectFontUsage, mapImageSources, newId, reassignUids, type EntranceEffect, type ObjectJSON } from './model'

export type ToolMode = 'select' | 'pen' | 'highlighter'
export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'triangle' | 'line' | 'arrow'
export type TextPreset = 'title' | 'subtitle' | 'body' | 'hand'
export type SelKind = 'none' | 'text' | 'image' | 'shape' | 'line' | 'draw' | 'group' | 'multi' | 'other'
export type DashKind = 'solid' | 'dash' | 'dot'
export type ArrowKind = 'none' | 'end' | 'both'
export type OrderOp = 'front' | 'forward' | 'backward' | 'back'

export interface TextProps {
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  align: 'left' | 'center' | 'right'
  fill: string
  outline: boolean
  outlineColor: string
  outlineWidth: number
  bg: boolean
  bgColor: string
  shadow: boolean
  shadowColor: string
  shadowBlur: number
  shadowX: number
  shadowY: number
  charSpacing: number
  lineHeight: number
}

export interface ImageProps {
  /** -100 – 100 */
  brightness: number
  contrast: number
  saturation: number
}

export interface ShapeProps {
  shape: 'rect' | 'ellipse' | 'triangle'
  fillOn: boolean
  fill: string
  strokeOn: boolean
  stroke: string
  strokeWidth: number
  dash: DashKind
  radius: number
}

export interface LineProps {
  color: string
  width: number
  dash: DashKind
  arrow: ArrowKind
}

export interface DrawProps {
  color: string
  width: number
}

export interface Selection {
  kind: SelKind
  count: number
  uid: string | null
  name: string
  x: number
  y: number
  w: number
  h: number
  angle: number
  /** 0 – 100 */
  opacity: number
  flipX: boolean
  flipY: boolean
  locked: boolean
  anim: EntranceEffect
  text?: TextProps
  image?: ImageProps
  shape?: ShapeProps
  line?: LineProps
  draw?: DrawProps
}

export interface Layer {
  uid: string
  name: string
  kind: SelKind
  visible: boolean
  locked: boolean
  selected: boolean
}

export interface BrushSettings {
  pen: { color: string; width: number }
  highlighter: { color: string; width: number }
}

export interface ControllerEvents {
  onCommit: (pageId: string, objects: ObjectJSON[]) => void
  onSelection: (sel: Selection) => void
  onLayers: (layers: Layer[]) => void
  onZoom: (zoom: number) => void
  onMode: (mode: ToolMode) => void
}

export const NO_SELECTION: Selection = { kind: 'none', count: 0, uid: null, name: '', x: 0, y: 0, w: 0, h: 0, angle: 0, opacity: 100, flipX: false, flipY: false, locked: false, anim: 'none' }

const ACCENT = '#0b7a53'
const GUIDE = '#e8551f'
const HIGHLIGHT_ALPHA = 0.45
const MIN_ZOOM = 0.02
const MAX_ZOOM = 8
const VIEW_PAD = 28

const BRIGHTNESS_RANGE = 0.6
const CONTRAST_RANGE = 0.7

function dashArray(kind: DashKind, width: number, round: boolean): number[] | null {
  const w = Math.max(1, width)
  if (kind === 'solid') return null
  if (kind === 'dash') return [w * 3.5, w * 2.5]
  return round ? [0.1, w * 2.2] : [w, w * 1.6]
}

function dashKind(arr: number[] | null | undefined, width: number): DashKind {
  if (!arr || !arr.length) return 'solid'
  return arr[0] / Math.max(1, width) >= 2 ? 'dash' : 'dot'
}

function linePathData(len: number, strokeWidth: number, arrow: ArrowKind): string {
  const l = Math.max(4, len)
  const head = Math.min(l * 0.6, Math.max(12, strokeWidth * 3.4))
  const wing = head * 0.62
  let d = `M 0 0 L ${l} 0`
  if (arrow !== 'none') d += ` M ${l - head} ${-wing} L ${l} 0 L ${l - head} ${wing}`
  if (arrow === 'both') d += ` M ${head} ${-wing} L 0 0 L ${head} ${wing}`
  return d
}

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

/**
 * 편집 화면 — fabric 캔버스 하나로 현재 페이지를 보여 주고 고친다.
 * 문서 데이터는 갖지 않는다. 바뀔 때마다 객체 JSON 을 만들어 onCommit 으로 넘긴다.
 */
export class CanvasController {
  readonly canvas: Canvas
  private f: Fabric
  private host: HTMLElement
  private assets: AssetStore
  private ev: ControllerEvents
  private page = { width: 1080, height: 1080, background: '#ffffff' as string | null }
  private pageId = ''
  /** 지금 화면에 올라와 있는(또는 올리는 중인) 객체 JSON. 같은 배열이면 다시 읽지 않는다. */
  private shown: ObjectJSON[] | null = null
  private loadToken = 0
  private commitTimer: ReturnType<typeof setTimeout> | null = null
  private guides: Guide[] = []
  private autoFit: 'page' | 'width' | null = 'page'
  private mode: ToolMode = 'select'
  private brushes: BrushSettings = { pen: { color: '#14201a', width: 6 }, highlighter: { color: '#ffe55c', width: 28 } }
  private clip: ObjectJSON[] = []
  private pasteCount = 0
  private checker: CanvasPattern | null = null
  private cleanup: Array<() => void> = []
  private selRaf = 0
  private disposed = false
  private spaceDown = false
  /** true 인 동안에는 변경을 기록하지 않는다(페이지를 바꿔 싣는 중). */
  private muted = false
  private panning: { x: number; y: number } | null = null

  constructor(f: Fabric, host: HTMLElement, assets: AssetStore, ev: ControllerEvents) {
    this.f = f
    this.host = host
    this.assets = assets
    this.ev = ev
    const el = document.createElement('canvas')
    host.appendChild(el)
    const rect = host.getBoundingClientRect()
    this.canvas = new f.Canvas(el, {
      width: Math.max(50, Math.floor(rect.width)),
      height: Math.max(50, Math.floor(rect.height)),
      preserveObjectStacking: true,
      controlsAboveOverlay: true,
      selectionColor: 'rgba(11, 122, 83, 0.12)',
      selectionBorderColor: ACCENT,
      selectionLineWidth: 1,
      stopContextMenu: false,
      fireRightClick: false,
      fireMiddleClick: false,
    })
    // 호스트를 꽉 채워 겹쳐 놓는다(이전 캔버스가 정리되는 동안에도 자리가 밀리지 않게).
    Object.assign(this.canvas.wrapperEl.style, { position: 'absolute', left: '0', top: '0' })
    this.bind()
    this.setPage(this.page)
  }

  // ── 준비·정리 ───────────────────────────────────────────
  private on(target: EventTarget, type: string, handler: (e: never) => void, options?: AddEventListenerOptions | boolean) {
    target.addEventListener(type, handler as EventListener, options)
    this.cleanup.push(() => target.removeEventListener(type, handler as EventListener, options))
  }

  private bind() {
    const c = this.canvas
    c.on('before:render', ({ ctx }) => this.drawPage(ctx))
    c.on('after:render', ({ ctx }) => this.drawOverlay(ctx))
    c.on('selection:created', () => this.selectionChanged())
    c.on('selection:updated', () => this.selectionChanged())
    c.on('selection:cleared', () => this.selectionChanged())
    c.on('object:moving', (opt) => this.snap(opt.target, opt.e as MouseEvent))
    c.on('object:scaling', () => this.emitSelectionSoon())
    c.on('object:rotating', () => this.emitSelectionSoon())
    c.on('object:resizing', () => this.emitSelectionSoon())
    c.on('object:modified', (opt) => {
      this.clearGuides()
      this.normalize(opt.target)
      this.commit()
    })
    c.on('mouse:up', () => this.clearGuides())
    c.on('path:created', ({ path }) => {
      const highlighter = this.mode === 'highlighter'
      path.set({ strokeUniform: true, ...(highlighter ? { globalCompositeOperation: 'multiply', strokeLineCap: 'butt' } : {}) })
      extra(path).kind = highlighter ? 'highlighter' : 'pen'
      this.decorate(path)
      this.commit()
    })
    c.on('text:changed', ({ target }) => {
      void ensureFonts(collectFontUsage([{ objects: [{ type: 'textbox', fontFamily: target.fontFamily, fontWeight: target.fontWeight, fontStyle: target.fontStyle, text: target.text }] }]))
      this.commitSoon(700)
    })
    c.on('text:editing:exited', ({ target }) => {
      if (!target.text.trim()) c.remove(target)
      this.commit()
    })
    c.on('mouse:wheel', (opt) => this.onWheel(opt))

    const refit = new ResizeObserver(() => this.resize())
    refit.observe(this.host)
    this.cleanup.push(() => refit.disconnect())

    // 글꼴이 뒤늦게 도착하면 글자 폭을 다시 잰다.
    this.on(document.fonts, 'loadingdone', () => this.remeasureText())

    // 화면 옮기기: 스페이스를 누른 채 끌기, 또는 가운데 버튼으로 끌기
    this.on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target) && !this.spaceDown) {
        this.spaceDown = true
        this.host.style.cursor = 'grab'
      }
    })
    this.on(window, 'keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this.spaceDown = false
        this.host.style.cursor = ''
      }
    })
    this.on(
      this.host,
      'pointerdown',
      (e: PointerEvent) => {
        if (!(e.button === 1 || (e.button === 0 && this.spaceDown))) return
        e.preventDefault()
        e.stopPropagation()
        this.panning = { x: e.clientX, y: e.clientY }
        this.host.setPointerCapture(e.pointerId)
        this.host.style.cursor = 'grabbing'
      },
      true,
    )
    this.on(this.host, 'mousedown', (e: MouseEvent) => this.panning && e.stopPropagation(), true)
    this.on(this.host, 'pointermove', (e: PointerEvent) => {
      if (!this.panning) return
      this.panBy(e.clientX - this.panning.x, e.clientY - this.panning.y)
      this.panning = { x: e.clientX, y: e.clientY }
    })
    const endPan = (e: PointerEvent) => {
      if (!this.panning) return
      this.panning = null
      this.host.style.cursor = this.spaceDown ? 'grab' : ''
      if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId)
    }
    this.on(this.host, 'pointerup', endPan)
    this.on(this.host, 'pointercancel', endPan)
  }

  dispose() {
    this.disposed = true
    this.loadToken++
    if (this.commitTimer) clearTimeout(this.commitTimer)
    cancelAnimationFrame(this.selRaf)
    for (const fn of this.cleanup) fn()
    this.cleanup = []
    // fabric 의 정리는 다음 화면 갱신까지 걸린다. 화면에서는 바로 치운다.
    const wrapper = this.canvas.wrapperEl
    if (wrapper) wrapper.style.display = 'none'
    void this.canvas.dispose().finally(() => wrapper?.remove())
  }

  // ── 페이지·보기 ─────────────────────────────────────────
  setPage(page: { width: number; height: number; background: string | null }) {
    const sizeChanged = page.width !== this.page.width || page.height !== this.page.height || !this.canvas.overlayImage
    this.page = { ...page }
    if (sizeChanged) {
      const { width: w, height: h } = page
      const far = 60000
      // 페이지 바깥으로 나간 부분은 흐리게만 보이도록 지운다(내보낼 때는 잘린다).
      const mask = new this.f.Path(`M ${-far} ${-far} H ${far} V ${far} H ${-far} Z M 0 0 V ${h} H ${w} V 0 Z`, {
        fill: 'rgba(0,0,0,0.9)',
        fillRule: 'evenodd',
        stroke: null,
        strokeWidth: 0,
        objectCaching: false,
        globalCompositeOperation: 'destination-out',
        selectable: false,
        evented: false,
      })
      mask.setPositionByOrigin(new this.f.Point(0, 0), 'center', 'center')
      this.canvas.overlayImage = mask
      if (this.autoFit !== 'width') this.autoFit = 'page'
      this.fit(this.autoFit ?? 'page')
    }
    this.canvas.requestRenderAll()
  }

  private drawPage(ctx: CanvasRenderingContext2D) {
    const v = this.canvas.viewportTransform
    const { width, height, background } = this.page
    ctx.save()
    if (background) {
      ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5])
      ctx.fillStyle = background
      ctx.fillRect(0, 0, width, height)
    } else {
      this.checker ??= this.makeChecker(ctx)
      ctx.fillStyle = this.checker ?? '#ffffff'
      ctx.fillRect(v[4], v[5], width * v[0], height * v[3])
    }
    ctx.restore()
  }

  private makeChecker(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    const tile = document.createElement('canvas')
    tile.width = tile.height = 16
    const t = tile.getContext('2d')!
    t.fillStyle = '#ffffff'
    t.fillRect(0, 0, 16, 16)
    t.fillStyle = '#e4e0d6'
    t.fillRect(0, 0, 8, 8)
    t.fillRect(8, 8, 8, 8)
    return ctx.createPattern(tile, 'repeat')
  }

  private drawOverlay(ctx: CanvasRenderingContext2D) {
    const v = this.canvas.viewportTransform
    const z = v[0]
    ctx.save()
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5])
    ctx.lineWidth = 1 / z
    ctx.strokeStyle = 'rgba(8, 40, 28, 0.55)'
    ctx.strokeRect(0, 0, this.page.width, this.page.height)
    if (this.guides.length) {
      ctx.strokeStyle = GUIDE
      ctx.lineWidth = 1 / z
      ctx.beginPath()
      for (const g of this.guides) {
        if (g.axis === 'x') {
          ctx.moveTo(g.pos, g.from)
          ctx.lineTo(g.pos, g.to)
        } else {
          ctx.moveTo(g.from, g.pos)
          ctx.lineTo(g.to, g.pos)
        }
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  private resize() {
    if (this.disposed) return
    const rect = this.host.getBoundingClientRect()
    const w = Math.max(50, Math.floor(rect.width))
    const h = Math.max(50, Math.floor(rect.height))
    if (w === this.canvas.width && h === this.canvas.height) return
    this.canvas.setDimensions({ width: w, height: h })
    if (this.autoFit) this.fit(this.autoFit)
    else this.setView(this.zoom, this.canvas.viewportTransform[4], this.canvas.viewportTransform[5])
  }

  get zoom(): number {
    return this.canvas.viewportTransform[0]
  }

  private setView(z: number, tx: number, ty: number) {
    const cw = this.canvas.width
    const ch = this.canvas.height
    const pw = this.page.width * z
    const ph = this.page.height * z
    // 페이지가 화면 밖으로 완전히 사라지지 않게 한다.
    const keep = 80
    const x = Math.max(keep - pw, Math.min(cw - keep, tx))
    const y = Math.max(keep - ph, Math.min(ch - keep, ty))
    this.canvas.setViewportTransform([z, 0, 0, z, x, y])
    this.ev.onZoom(z)
  }

  /** page: 한눈에 보이게, width: 너비에 맞춰(긴 페이지용) */
  fit(mode: 'page' | 'width') {
    const cw = this.canvas.width
    const ch = this.canvas.height
    const { width: pw, height: ph } = this.page
    const zw = (cw - VIEW_PAD * 2) / pw
    const zh = (ch - VIEW_PAD * 2) / ph
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, mode === 'page' ? Math.min(zw, zh) : zw))
    const tx = (cw - pw * z) / 2
    const ty = ph * z <= ch - VIEW_PAD * 2 ? (ch - ph * z) / 2 : VIEW_PAD
    this.autoFit = mode
    this.setView(z, tx, ty)
  }

  zoomTo(z: number, anchor?: { x: number; y: number }) {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
    const v = this.canvas.viewportTransform
    const a = anchor ?? { x: this.canvas.width / 2, y: this.canvas.height / 2 }
    const sx = (a.x - v[4]) / v[0]
    const sy = (a.y - v[5]) / v[3]
    this.autoFit = null
    this.setView(next, a.x - sx * next, a.y - sy * next)
  }

  zoomBy(factor: number) {
    this.zoomTo(this.zoom * factor)
  }

  private panBy(dx: number, dy: number): boolean {
    const v = this.canvas.viewportTransform
    const before = [v[4], v[5]]
    this.autoFit = null
    this.setView(v[0], v[4] + dx, v[5] + dy)
    const after = this.canvas.viewportTransform
    return after[4] !== before[0] || after[5] !== before[1]
  }

  private onWheel(opt: TPointerEventInfo<WheelEvent>) {
    const e = opt.e
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      this.zoomTo(this.zoom * Math.exp(-e.deltaY * 0.0016), { x: e.offsetX, y: e.offsetY })
      return
    }
    // 페이지가 화면보다 클 때만 캔버스를 굴린다. 끝에 닿으면 바깥 화면이 스크롤된다.
    const z = this.zoom
    const overY = this.page.height * z > this.canvas.height - VIEW_PAD
    const overX = this.page.width * z > this.canvas.width - VIEW_PAD
    if (!overX && !overY) return
    const dx = overX ? (e.shiftKey ? -e.deltaY : -e.deltaX) : 0
    const dy = overY && !e.shiftKey ? -e.deltaY : 0
    const v = this.canvas.viewportTransform
    const minX = this.canvas.width - VIEW_PAD - this.page.width * z
    const minY = this.canvas.height - VIEW_PAD - this.page.height * z
    const tx = overX ? Math.max(minX, Math.min(VIEW_PAD, v[4] + dx)) : v[4]
    const ty = overY ? Math.max(minY, Math.min(VIEW_PAD, v[5] + dy)) : v[5]
    if (tx === v[4] && ty === v[5]) return
    e.preventDefault()
    this.autoFit = null
    this.setView(z, tx, ty)
  }

  /** 화면 좌표(clientX/Y)를 페이지 좌표로 */
  scenePoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.upperCanvasEl.getBoundingClientRect()
    const v = this.canvas.viewportTransform
    return { x: (clientX - rect.left - v[4]) / v[0], y: (clientY - rect.top - v[5]) / v[3] }
  }

  /** 새 객체를 놓을 자리: 지금 보이는 영역의 가운데(페이지 안으로 제한) */
  private dropPoint(): { x: number; y: number } {
    const c = this.canvas.getVpCenter()
    const { width, height } = this.page
    return { x: Math.max(width * 0.1, Math.min(width * 0.9, c.x)), y: Math.max(height * 0.05, Math.min(height * 0.95, c.y)) }
  }

  // ── 불러오기·내보내기(JSON) ─────────────────────────────
  isShowing(pageId: string, objects: ObjectJSON[]): boolean {
    return this.pageId === pageId && this.shown === objects
  }

  async load(pageId: string, objects: ObjectJSON[]): Promise<void> {
    const token = ++this.loadToken
    if (this.commitTimer) clearTimeout(this.commitTimer)
    this.commitTimer = null
    const active = this.canvas.getActiveObject()
    if (active && this.isText(active) && active.isEditing) {
      this.muted = true
      active.exitEditing()
      this.muted = false
    }
    this.pageId = pageId
    this.shown = objects
    await ensureFonts(collectFontUsage([{ objects }]))
    const live = (await this.f.util.enlivenObjects(mapImageSources(objects, (id) => this.assets.url(id)))) as FObject[]
    if (token !== this.loadToken || this.disposed) return
    const c = this.canvas
    c.discardActiveObject()
    c.remove(...c.getObjects())
    live.forEach((o) => this.decorate(o))
    if (live.length) c.add(...live)
    this.guides = []
    c.requestRenderAll()
    this.emitLayers()
    this.emitSelection()
  }

  serialize(): ObjectJSON[] {
    const raw = (this.canvas.toObject([...EXTRA_PROPS]) as { objects: ObjectJSON[] }).objects
    return mapImageSources(raw, (id) => ASSET_PREFIX + id)
  }

  commit() {
    if (this.disposed || this.muted) return
    if (this.commitTimer) clearTimeout(this.commitTimer)
    this.commitTimer = null
    const objects = this.serialize()
    this.shown = objects
    this.ev.onCommit(this.pageId, objects)
    this.emitLayers()
    this.emitSelection()
  }

  /** 슬라이더를 끄는 동안처럼 연달아 바뀔 때는 잠시 모았다가 한 번만 기록한다. */
  commitSoon(ms = 350) {
    if (this.commitTimer) clearTimeout(this.commitTimer)
    this.commitTimer = setTimeout(() => this.commit(), ms)
  }

  /** 아직 기록되지 않은 변경이 있으면 지금 기록한다. 되돌리기·페이지 바꾸기·내보내기 전에 부른다. */
  flush() {
    const active = this.canvas.getActiveObject()
    if (active && this.isText(active) && active.isEditing) {
      active.exitEditing()
      return
    }
    if (this.commitTimer) this.commit()
  }

  // ── 종류 판별·꾸미기 ────────────────────────────────────
  private isText(o: FObject): o is Textbox {
    return o instanceof this.f.IText
  }

  private isImage(o: FObject): o is FabricImage {
    return o instanceof this.f.FabricImage
  }

  private kindOf(o: FObject): SelKind {
    const f = this.f
    if (o instanceof f.ActiveSelection) return 'multi'
    if (this.isText(o)) return 'text'
    if (this.isImage(o)) return 'image'
    if (o instanceof f.Group) return 'group'
    const k = extra(o).kind
    if (k === 'line') return 'line'
    if (o instanceof f.Rect || o instanceof f.Ellipse || o instanceof f.Triangle) return 'shape'
    if (o instanceof f.Path) return 'draw'
    return 'other'
  }

  private autoName(o: FObject): string {
    const kind = this.kindOf(o)
    if (kind === 'text') return (o as Textbox).text.replace(/\s+/g, ' ').trim().slice(0, 24) || '글자'
    if (kind === 'image') return '사진'
    if (kind === 'group') return '묶음'
    if (kind === 'line') return extra(o).arrow && extra(o).arrow !== 'none' ? '화살표' : '선'
    if (kind === 'draw') return extra(o).kind === 'highlighter' ? '형광펜' : '손글씨'
    if (o instanceof this.f.Rect) return (o.rx ?? 0) > 0 ? '둥근 사각형' : '사각형'
    if (o instanceof this.f.Ellipse) return '원'
    if (o instanceof this.f.Triangle) return '삼각형'
    return '객체'
  }

  /** 조절점 모양·잠금 상태 등 화면에서만 쓰는 설정을 입힌다. */
  private decorate(o: FObject) {
    const x = extra(o)
    x.uid ||= newId()
    const locked = !!x.locked
    o.set({
      borderColor: ACCENT,
      cornerColor: '#ffffff',
      cornerStrokeColor: ACCENT,
      cornerStyle: 'circle',
      cornerSize: 11,
      transparentCorners: false,
      borderScaleFactor: 1.5,
      selectable: !locked,
      evented: !locked,
      hasControls: !locked,
      lockMovementX: locked,
      lockMovementY: locked,
    })
    const kind = this.kindOf(o)
    if (kind === 'line') o.setControlsVisibility({ tl: false, tr: false, bl: false, br: false, mt: false, mb: false })
    if (kind === 'text') o.setControlsVisibility({ mt: false, mb: false })
  }

  /** 글꼴이 새로 등록됐을 때 글자 폭을 다시 재고 그린다. */
  remeasureText() {
    if (this.disposed) return
    this.f.cache.clearFontCache()
    const visit = (o: FObject) => {
      if (this.isText(o)) {
        o.initDimensions()
        o.set('dirty', true)
        o.setCoords()
      } else if (o instanceof this.f.Group) {
        o.getObjects().forEach(visit)
        o.set('dirty', true)
      }
    }
    this.canvas.getObjects().forEach(visit)
    this.canvas.requestRenderAll()
  }

  // ── 선택 상태 알리기 ────────────────────────────────────
  private selectionChanged() {
    const a = this.canvas.getActiveObject()
    if (a instanceof this.f.ActiveSelection) {
      a.set({ borderColor: ACCENT, cornerColor: '#ffffff', cornerStrokeColor: ACCENT, cornerStyle: 'circle', cornerSize: 11, transparentCorners: false, borderScaleFactor: 1.5 })
    }
    this.emitSelection()
    this.emitLayers()
  }

  private emitSelectionSoon() {
    cancelAnimationFrame(this.selRaf)
    this.selRaf = requestAnimationFrame(() => this.emitSelection())
  }

  private hex(value: unknown, fallback: string): string {
    if (typeof value !== 'string' || !value) return fallback
    try {
      return `#${new this.f.Color(value).toHex().toLowerCase()}`
    } catch {
      return fallback
    }
  }

  private emitSelection() {
    if (this.disposed) return
    this.ev.onSelection(this.readSelection())
  }

  readSelection(): Selection {
    const a = this.canvas.getActiveObject()
    if (!a) return NO_SELECTION
    a.setCoords()
    const box = a.getBoundingRect()
    const kind = this.kindOf(a)
    const x = extra(a)
    const sel: Selection = {
      kind,
      count: kind === 'multi' ? this.canvas.getActiveObjects().length : 1,
      uid: kind === 'multi' ? null : (x.uid ?? null),
      name: kind === 'multi' ? '' : x.name || this.autoName(a),
      x: Math.round(box.left),
      y: Math.round(box.top),
      w: Math.round(a.getScaledWidth()),
      h: Math.round(a.getScaledHeight()),
      angle: Math.round(((a.angle % 360) + 360) % 360),
      opacity: Math.round(a.opacity * 100),
      flipX: a.flipX,
      flipY: a.flipY,
      locked: !!x.locked,
      anim: x.anim === 'fade' || x.anim === 'rise' || x.anim === 'pop' ? x.anim : 'none',
    }
    if (kind === 'text') {
      const t = a as Textbox
      const sh = t.shadow
      sel.text = {
        fontFamily: t.fontFamily,
        fontSize: Math.round(t.fontSize * 10) / 10,
        bold: t.fontWeight === 'bold' || Number(t.fontWeight) >= 600,
        italic: t.fontStyle === 'italic',
        underline: !!t.underline,
        align: t.textAlign === 'center' || t.textAlign === 'right' ? t.textAlign : 'left',
        fill: this.hex(t.fill, '#14201a'),
        outline: !!t.stroke && t.strokeWidth > 0,
        outlineColor: this.hex(t.stroke, '#ffffff'),
        outlineWidth: t.stroke ? Math.round(t.strokeWidth * 10) / 10 : 4,
        bg: !!t.textBackgroundColor,
        bgColor: this.hex(t.textBackgroundColor, '#ffe55c'),
        shadow: !!sh,
        shadowColor: this.hex(sh?.color, '#000000'),
        shadowBlur: sh?.blur ?? 8,
        shadowX: sh?.offsetX ?? 4,
        shadowY: sh?.offsetY ?? 4,
        charSpacing: Math.round(t.charSpacing),
        lineHeight: Math.round(t.lineHeight * 100) / 100,
      }
    } else if (kind === 'image') {
      const img = a as FabricImage
      const find = (type: string, key: string) => {
        const flt = img.filters.find((it) => it && it.type === type) as unknown as Record<string, number> | undefined
        return flt ? flt[key] : 0
      }
      sel.image = {
        brightness: Math.round((find('Brightness', 'brightness') / BRIGHTNESS_RANGE) * 100),
        contrast: Math.round((find('Contrast', 'contrast') / CONTRAST_RANGE) * 100),
        saturation: Math.round(find('Saturation', 'saturation') * 100),
      }
    } else if (kind === 'shape') {
      const rx = a instanceof this.f.Rect ? (a.rx ?? 0) : 0
      sel.shape = {
        shape: a instanceof this.f.Rect ? 'rect' : a instanceof this.f.Ellipse ? 'ellipse' : 'triangle',
        fillOn: !!a.fill,
        fill: this.hex(a.fill, '#0b7a53'),
        strokeOn: !!a.stroke && a.strokeWidth > 0,
        stroke: this.hex(a.stroke, '#14201a'),
        strokeWidth: a.stroke ? Math.round(a.strokeWidth * 10) / 10 : 4,
        dash: dashKind(a.strokeDashArray, a.strokeWidth),
        radius: Math.round(rx),
      }
    } else if (kind === 'line') {
      sel.line = {
        color: this.hex(a.stroke, '#14201a'),
        width: Math.round(a.strokeWidth * 10) / 10,
        dash: dashKind(a.strokeDashArray, a.strokeWidth),
        arrow: x.arrow === 'end' || x.arrow === 'both' ? x.arrow : 'none',
      }
    } else if (kind === 'draw') {
      sel.draw = { color: this.hex(a.stroke, '#14201a'), width: Math.round(a.strokeWidth * 10) / 10 }
    }
    return sel
  }

  private emitLayers() {
    if (this.disposed) return
    const active = new Set(this.canvas.getActiveObjects())
    const layers = this.canvas
      .getObjects()
      .map((o): Layer => {
        const x = extra(o)
        return { uid: x.uid ?? '', name: x.name || this.autoName(o), kind: this.kindOf(o), visible: o.visible, locked: !!x.locked, selected: active.has(o) }
      })
      .reverse()
    this.ev.onLayers(layers)
  }

  // ── 스냅 ────────────────────────────────────────────────
  private snap(target: FObject, e: MouseEvent | undefined) {
    this.emitSelectionSoon()
    if (e?.ctrlKey || e?.metaKey) {
      this.guides = []
      return
    }
    target.setCoords()
    const moving = new Set<FObject>(target instanceof this.f.ActiveSelection ? target.getObjects() : [target])
    const others: Box[] = this.canvas
      .getObjects()
      .filter((o) => !moving.has(o) && o.visible)
      .map((o) => o.getBoundingRect())
    const { dx, dy, guides } = computeSnap(target.getBoundingRect(), others, this.page, 6 / this.zoom)
    if (dx || dy) {
      target.set({ left: target.left + dx, top: target.top + dy })
      target.setCoords()
    }
    this.guides = guides
  }

  private clearGuides() {
    if (!this.guides.length) return
    this.guides = []
    this.canvas.requestRenderAll()
  }

  // ── 크기를 바꾼 뒤 정리 ─────────────────────────────────
  /** 늘린 배율을 실제 크기·글자 크기로 바꿔 넣는다. 그래야 모서리 둥글기·테두리·글자 크기 숫자가 보이는 그대로다. */
  private normalize(o: FObject | undefined) {
    if (!o || o instanceof this.f.ActiveSelection || o.group) return
    const sx = o.scaleX
    const sy = o.scaleY
    if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) return
    const f = this.f
    if (this.isText(o)) {
      o.set({ width: o.width * sx, fontSize: Math.max(4, Math.round(o.fontSize * sy * 10) / 10), strokeWidth: o.stroke ? o.strokeWidth * sy : o.strokeWidth, scaleX: 1, scaleY: 1 })
    } else if (o instanceof f.Rect) {
      const w = o.width * sx
      const h = o.height * sy
      const r = Math.min(o.rx ?? 0, w / 2, h / 2)
      o.set({ width: w, height: h, rx: r, ry: r, scaleX: 1, scaleY: 1 })
    } else if (o instanceof f.Ellipse) {
      o.set({ rx: o.rx * sx, ry: o.ry * sy, scaleX: 1, scaleY: 1 })
    } else if (o instanceof f.Triangle) {
      o.set({ width: o.width * sx, height: o.height * sy, scaleX: 1, scaleY: 1 })
    } else if (extra(o).kind === 'line') {
      this.rebuildLine(o as Path, { length: o.width * sx })
      return
    } else {
      return
    }
    o.setCoords()
  }

  private rebuildLine(old: Path, patch: { length?: number; width?: number; arrow?: ArrowKind }): Path {
    const c = this.canvas
    const x = extra(old)
    const arrow: ArrowKind = patch.arrow ?? (x.arrow === 'end' || x.arrow === 'both' ? x.arrow : 'none')
    const width = patch.width ?? old.strokeWidth
    const length = patch.length ?? old.width * old.scaleX
    const dash = dashKind(old.strokeDashArray, old.strokeWidth)
    const next = new this.f.Path(linePathData(length, width, arrow), {
      fill: null,
      stroke: old.stroke,
      strokeWidth: width,
      strokeDashArray: dashArray(dash, width, true),
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      strokeUniform: true,
      opacity: old.opacity,
      angle: old.angle,
      flipX: old.flipX,
      flipY: old.flipY,
      shadow: old.shadow,
      visible: old.visible,
    })
    Object.assign(extra(next), { uid: x.uid, name: x.name, locked: x.locked, anim: x.anim, kind: 'line', arrow })
    next.setPositionByOrigin(old.getCenterPoint(), 'center', 'center')
    this.decorate(next)
    const wasActive = c.getActiveObject() === old
    const index = c.getObjects().indexOf(old)
    c.remove(old)
    c.insertAt(Math.max(0, index), next)
    next.setCoords()
    if (wasActive) c.setActiveObject(next)
    return next
  }

  // ── 객체 추가 ───────────────────────────────────────────
  private place(o: FObject, at?: { x: number; y: number }) {
    const c = this.canvas
    const p = at ?? this.dropPoint()
    // 같은 자리에 겹쳐 쌓이지 않게 조금씩 비껴 놓는다.
    let shift = 0
    if (!at) {
      const taken = c.getObjects().map((it) => it.getCenterPoint())
      while (taken.some((t) => Math.abs(t.x - (p.x + shift)) < 2 && Math.abs(t.y - (p.y + shift)) < 2) && shift < 400) shift += 24
    }
    o.setPositionByOrigin(new this.f.Point(p.x + shift, p.y + shift), 'center', 'center')
    this.decorate(o)
    this.setMode('select')
    c.add(o)
    o.setCoords()
    c.setActiveObject(o)
    c.requestRenderAll()
  }

  async addText(preset: TextPreset) {
    const { width, height } = this.page
    const unit = Math.max(0.35, Math.min(width, height * 1.4) / 1080)
    const spec = ({
      title: { text: '제목을 입력하세요', size: 88, weight: 'bold', family: DEFAULT_FONT, align: 'center' },
      subtitle: { text: '부제목을 입력하세요', size: 52, weight: 'bold', family: DEFAULT_FONT, align: 'center' },
      body: { text: '본문 내용을 입력하세요', size: 34, weight: 'normal', family: DEFAULT_FONT, align: 'left' },
      hand: { text: '손글씨로 한마디', size: 84, weight: 'normal', family: HAND_FONT, align: 'center' },
    } as const)[preset]
    await ensureFonts([{ family: spec.family, weight: spec.weight, style: 'normal', text: spec.text }])
    if (this.disposed) return
    const box = new this.f.Textbox(spec.text, {
      width: Math.round(width * (preset === 'body' ? 0.6 : 0.8)),
      fontFamily: spec.family,
      fontSize: Math.round(spec.size * unit),
      fontWeight: spec.weight,
      textAlign: spec.align,
      fill: '#14201a',
      lineHeight: 1.3,
      paintFirst: 'stroke',
      strokeLineJoin: 'round',
      strokeWidth: 0,
    })
    extra(box).kind = 'text'
    this.place(box)
    this.commit()
    box.enterEditing()
    box.selectAll()
  }

  addShape(kind: ShapeKind) {
    const f = this.f
    const s = Math.round(Math.min(this.page.width, this.page.height) * 0.32)
    const base = { fill: '#0b7a53', stroke: null, strokeWidth: 0, strokeUniform: true }
    let o: FObject
    if (kind === 'rect' || kind === 'round') {
      const r = kind === 'round' ? Math.round(s * 0.12) : 0
      o = new f.Rect({ ...base, width: s, height: Math.round(s * 0.7), rx: r, ry: r })
      extra(o).kind = 'rect'
    } else if (kind === 'ellipse') {
      o = new f.Ellipse({ ...base, rx: s / 2, ry: s / 2 })
      extra(o).kind = 'ellipse'
    } else if (kind === 'triangle') {
      o = new f.Triangle({ ...base, width: s, height: Math.round(s * 0.88) })
      extra(o).kind = 'triangle'
    } else {
      const width = Math.max(4, Math.round(Math.min(this.page.width, this.page.height) / 180))
      const arrow: ArrowKind = kind === 'arrow' ? 'end' : 'none'
      o = new f.Path(linePathData(s * 1.4, width, arrow), { fill: null, stroke: '#14201a', strokeWidth: width, strokeLineCap: 'round', strokeLineJoin: 'round', strokeUniform: true })
      Object.assign(extra(o), { kind: 'line', arrow })
    }
    this.place(o)
    this.commit()
  }

  async addImage(asset: Asset, at?: { x: number; y: number }) {
    const img = await this.f.FabricImage.fromURL(asset.url)
    if (this.disposed) return
    Object.assign(extra(img), { assetId: asset.id, kind: 'image' })
    const scale = Math.min(1, (this.page.width * 0.8) / asset.width, (this.page.height * 0.8) / asset.height)
    img.set({ scaleX: scale, scaleY: scale })
    this.place(img, at)
    this.commit()
  }

  private async insertJSON(objects: ObjectJSON[], offset: number, select = true) {
    if (!objects.length) return
    const json = reassignUids(objects).map((o) => ({ ...o, left: Number(o.left ?? 0) + offset, top: Number(o.top ?? 0) + offset }))
    const live = (await this.f.util.enlivenObjects(mapImageSources(json, (id) => this.assets.url(id)))) as FObject[]
    if (this.disposed) return
    const c = this.canvas
    c.discardActiveObject()
    live.forEach((o) => {
      extra(o).locked = false
      this.decorate(o)
    })
    c.add(...live)
    if (select) this.selectObjects(live)
    this.commit()
  }

  private selectObjects(objs: FObject[]) {
    const c = this.canvas
    c.discardActiveObject()
    const list = objs.filter((o) => c.contains(o))
    if (list.length === 1) c.setActiveObject(list[0])
    else if (list.length > 1) c.setActiveObject(new this.f.ActiveSelection(list, { canvas: c }))
    c.requestRenderAll()
  }

  // ── 그리기 모드 ─────────────────────────────────────────
  getMode(): ToolMode {
    return this.mode
  }

  getBrushes(): BrushSettings {
    return this.brushes
  }

  setMode(mode: ToolMode) {
    if (mode !== this.mode) this.ev.onMode(mode)
    this.mode = mode
    const c = this.canvas
    c.isDrawingMode = mode !== 'select'
    if (mode !== 'select') {
      c.discardActiveObject()
      this.applyBrush()
      c.requestRenderAll()
    }
  }

  setBrush(mode: 'pen' | 'highlighter', patch: Partial<{ color: string; width: number }>) {
    this.brushes = { ...this.brushes, [mode]: { ...this.brushes[mode], ...patch } }
    if (this.mode === mode) this.applyBrush()
  }

  private applyBrush() {
    if (this.mode === 'select') return
    const c = this.canvas
    const brush = c.freeDrawingBrush instanceof this.f.PencilBrush ? c.freeDrawingBrush : new this.f.PencilBrush(c)
    const s = this.brushes[this.mode]
    if (this.mode === 'highlighter') {
      const col = new this.f.Color(s.color)
      col.setAlpha(HIGHLIGHT_ALPHA)
      brush.color = col.toRgba()
      brush.strokeLineCap = 'butt'
    } else {
      brush.color = s.color
      brush.strokeLineCap = 'round'
    }
    brush.width = s.width
    c.freeDrawingBrush = brush
  }

  // ── 편집 동작 ───────────────────────────────────────────
  private actives(): FObject[] {
    return this.canvas.getActiveObjects()
  }

  hasSelection(): boolean {
    return !!this.canvas.getActiveObject()
  }

  isEditingText(): boolean {
    const a = this.canvas.getActiveObject()
    return !!a && this.isText(a) && !!a.isEditing
  }

  deselect() {
    this.canvas.discardActiveObject()
    this.canvas.requestRenderAll()
  }

  selectAll() {
    this.setMode('select')
    this.selectObjects(this.canvas.getObjects().filter((o) => o.visible && !extra(o).locked))
  }

  deleteSelection() {
    const objs = this.actives()
    if (!objs.length) return
    this.canvas.discardActiveObject()
    this.canvas.remove(...objs)
    this.commit()
  }

  /** 선택한 객체들의 JSON(페이지 좌표 기준, 쌓인 순서대로) */
  private selectedJSON(): ObjectJSON[] {
    const all = this.canvas.getObjects()
    const picked = new Set(this.actives())
    const json = this.serialize()
    return json.filter((_, i) => picked.has(all[i]))
  }

  copy(): boolean {
    const json = this.selectedJSON()
    if (!json.length) return false
    this.clip = json
    this.pasteCount = 0
    return true
  }

  cut(): boolean {
    if (!this.copy()) return false
    this.deleteSelection()
    return true
  }

  hasClip(): boolean {
    return this.clip.length > 0
  }

  async paste() {
    if (!this.clip.length) return
    this.pasteCount++
    await this.insertJSON(this.clip, 24 * this.pasteCount)
  }

  async duplicate() {
    await this.insertJSON(this.selectedJSON(), 24)
  }

  group() {
    const c = this.canvas
    const all = c.getObjects()
    const objs = this.actives()
      .slice()
      .sort((a, b) => all.indexOf(a) - all.indexOf(b))
    if (objs.length < 2) return
    const top = all.indexOf(objs[objs.length - 1])
    c.discardActiveObject()
    c.remove(...objs)
    const g = new this.f.Group(objs)
    extra(g).kind = 'group'
    this.decorate(g)
    c.insertAt(Math.max(0, top - objs.length + 1), g)
    c.setActiveObject(g)
    this.commit()
  }

  ungroup() {
    const c = this.canvas
    const g = c.getActiveObject()
    if (!(g instanceof this.f.Group) || g instanceof this.f.ActiveSelection) return
    const index = c.getObjects().indexOf(g)
    c.discardActiveObject()
    const items = g.removeAll() as FObject[]
    c.remove(g)
    items.forEach((o) => {
      this.decorate(o)
      o.setCoords()
    })
    c.insertAt(Math.max(0, index), ...items)
    this.selectObjects(items)
    this.commit()
  }

  order(op: OrderOp) {
    const c = this.canvas
    const all = c.getObjects()
    const objs = this.actives()
      .slice()
      .sort((a, b) => all.indexOf(a) - all.indexOf(b))
    if (!objs.length) return
    if (op === 'front') objs.forEach((o) => c.bringObjectToFront(o))
    else if (op === 'back') objs.reverse().forEach((o) => c.sendObjectToBack(o))
    else if (op === 'forward') objs.reverse().forEach((o) => c.bringObjectForward(o))
    else objs.forEach((o) => c.sendObjectBackwards(o))
    c.requestRenderAll()
    this.commit()
  }

  private shift(o: FObject, dx: number, dy: number) {
    if (!dx && !dy) return
    o.set({ left: o.left + dx, top: o.top + dy })
    o.setCoords()
  }

  nudge(dx: number, dy: number) {
    const a = this.canvas.getActiveObject()
    if (!a || extra(a).locked) return
    this.shift(a, dx, dy)
    this.canvas.requestRenderAll()
    this.emitSelectionSoon()
    this.commitSoon(450)
  }

  /** basis page: 페이지 기준, selection: 선택한 것들끼리(여러 개일 때만 의미가 있다) */
  align(how: AlignHow, basis: 'page' | 'selection') {
    const c = this.canvas
    const a = c.getActiveObject()
    if (!a) return
    const pageBox: Box = { left: 0, top: 0, width: this.page.width, height: this.page.height }
    if (a instanceof this.f.ActiveSelection) {
      const objs = [...a.getObjects()]
      a.setCoords()
      const target = basis === 'page' ? pageBox : a.getBoundingRect()
      c.discardActiveObject()
      for (const o of objs) {
        o.setCoords()
        const d = alignDelta(o.getBoundingRect(), target, how)
        this.shift(o, d.dx, d.dy)
      }
      this.selectObjects(objs)
    } else {
      a.setCoords()
      const d = alignDelta(a.getBoundingRect(), pageBox, how)
      this.shift(a, d.dx, d.dy)
    }
    c.requestRenderAll()
    this.commit()
  }

  distribute(axis: 'x' | 'y') {
    const c = this.canvas
    const a = c.getActiveObject()
    if (!(a instanceof this.f.ActiveSelection)) return
    const objs = [...a.getObjects()]
    if (objs.length < 3) return
    c.discardActiveObject()
    const deltas = distributeDeltas(
      objs.map((o) => (o.setCoords(), o.getBoundingRect())),
      axis,
    )
    objs.forEach((o, i) => this.shift(o, axis === 'x' ? deltas[i] : 0, axis === 'y' ? deltas[i] : 0))
    this.selectObjects(objs)
    this.commit()
  }

  setGeometry(patch: Partial<{ x: number; y: number; w: number; h: number; angle: number }>, keepRatio = true) {
    const a = this.canvas.getActiveObject()
    if (!a) return
    if (patch.angle != null) a.rotate(patch.angle)
    if (patch.w != null || patch.h != null) {
      // 테두리 굵기는 늘어나지 않으므로(strokeUniform) 그만큼을 빼고 배율을 구한다.
      const edge = a.strokeUniform && a.stroke ? a.strokeWidth : 0
      const cw = a.getScaledWidth() - edge
      const ch = a.getScaledHeight() - edge
      let fx = patch.w != null && cw > 0 ? Math.max(1, patch.w - edge) / cw : 1
      let fy = patch.h != null && ch > 0 ? Math.max(1, patch.h - edge) / ch : 1
      const isText = this.isText(a)
      if (isText) fy = 1
      else if (keepRatio || extra(a).kind === 'line') {
        if (patch.w != null) fy = fx
        else fx = fy
      }
      if (extra(a).kind === 'line') fy = 1
      a.set({ scaleX: a.scaleX * fx, scaleY: a.scaleY * fy })
      a.setCoords()
      this.normalize(a)
    }
    const cur = this.canvas.getActiveObject()
    if (cur && (patch.x != null || patch.y != null)) {
      cur.setCoords()
      const box = cur.getBoundingRect()
      this.shift(cur, patch.x != null ? patch.x - box.left : 0, patch.y != null ? patch.y - box.top : 0)
    }
    this.canvas.requestRenderAll()
    this.emitSelection()
    this.commitSoon()
  }

  setCommon(patch: Partial<{ opacity: number; flipX: boolean; flipY: boolean; anim: EntranceEffect }>) {
    const a = this.canvas.getActiveObject()
    if (!a) return
    if (patch.opacity != null) a.set({ opacity: Math.max(0, Math.min(100, patch.opacity)) / 100 })
    if (patch.flipX != null) a.set({ flipX: patch.flipX })
    if (patch.flipY != null) a.set({ flipY: patch.flipY })
    if (patch.anim != null) for (const o of this.actives()) extra(o).anim = patch.anim
    this.canvas.requestRenderAll()
    this.emitSelection()
    this.commitSoon()
  }

  async setText(patch: Partial<TextProps>) {
    const a = this.canvas.getActiveObject()
    if (!a || !this.isText(a)) return
    const cur = this.readSelection().text
    if (!cur) return
    const n = { ...cur, ...patch }
    if (patch.fontFamily || patch.bold != null || patch.italic != null) {
      await ensureFonts([{ family: n.fontFamily, weight: n.bold ? 'bold' : 'normal', style: n.italic ? 'italic' : 'normal', text: a.text }])
      if (this.disposed || this.canvas.getActiveObject() !== a) return
    }
    a.set({
      fontFamily: n.fontFamily,
      fontSize: Math.max(4, Math.min(2000, n.fontSize)),
      fontWeight: n.bold ? 'bold' : 'normal',
      fontStyle: n.italic ? 'italic' : 'normal',
      underline: n.underline,
      textAlign: n.align,
      fill: n.fill,
      stroke: n.outline ? n.outlineColor : null,
      strokeWidth: n.outline ? Math.max(0.5, n.outlineWidth) : 0,
      paintFirst: 'stroke',
      strokeLineJoin: 'round',
      textBackgroundColor: n.bg ? n.bgColor : '',
      shadow: n.shadow ? new this.f.Shadow({ color: n.shadowColor, blur: n.shadowBlur, offsetX: n.shadowX, offsetY: n.shadowY }) : null,
      charSpacing: n.charSpacing,
      lineHeight: Math.max(0.5, Math.min(4, n.lineHeight)),
    })
    a.setCoords()
    this.canvas.requestRenderAll()
    this.emitSelection()
    this.commitSoon()
  }

  setImage(patch: Partial<ImageProps>) {
    const a = this.canvas.getActiveObject()
    if (!a || !this.isImage(a)) return
    const cur = this.readSelection().image
    if (!cur) return
    const n = { ...cur, ...patch }
    const fl = this.f.filters
    const list = []
    if (n.brightness) list.push(new fl.Brightness({ brightness: (n.brightness / 100) * BRIGHTNESS_RANGE }))
    if (n.contrast) list.push(new fl.Contrast({ contrast: (n.contrast / 100) * CONTRAST_RANGE }))
    if (n.saturation) list.push(new fl.Saturation({ saturation: n.saturation / 100 }))
    a.filters = list
    a.applyFilters()
    this.canvas.requestRenderAll()
    this.emitSelection()
    this.commitSoon()
  }

  setShape(patch: Partial<ShapeProps>) {
    const a = this.canvas.getActiveObject()
    if (!a) return
    const cur = this.readSelection().shape
    if (!cur) return
    const n = { ...cur, ...patch }
    const width = n.strokeOn ? Math.max(0.5, n.strokeWidth) : 0
    a.set({
      fill: n.fillOn ? n.fill : null,
      stroke: n.strokeOn ? n.stroke : null,
      strokeWidth: width,
      strokeDashArray: n.strokeOn ? dashArray(n.dash, width, false) : null,
      strokeUniform: true,
    })
    if (a instanceof this.f.Rect) {
      const r = Math.max(0, Math.min(n.radius, a.width / 2, a.height / 2))
      a.set({ rx: r, ry: r })
    }
    a.setCoords()
    this.canvas.requestRenderAll()
    this.emitSelection()
    this.commitSoon()
  }

  setLine(patch: Partial<LineProps>) {
    let a = this.canvas.getActiveObject()
    if (!a || extra(a).kind !== 'line') return
    const cur = this.readSelection().line
    if (!cur) return
    const n = { ...cur, ...patch }
    const width = Math.max(1, n.width)
    if (width !== cur.width || n.arrow !== cur.arrow) a = this.rebuildLine(a as Path, { width, arrow: n.arrow })
    a.set({ stroke: n.color, strokeDashArray: dashArray(n.dash, width, true) })
    this.canvas.requestRenderAll()
    this.emitSelection()
    this.commitSoon()
  }

  setDraw(patch: Partial<DrawProps>) {
    const a = this.canvas.getActiveObject()
    if (!a) return
    if (patch.color) {
      const prev = typeof a.stroke === 'string' ? new this.f.Color(a.stroke).getAlpha() : 1
      const col = new this.f.Color(patch.color)
      col.setAlpha(prev)
      a.set({ stroke: prev < 1 ? col.toRgba() : patch.color })
    }
    if (patch.width != null) a.set({ strokeWidth: Math.max(1, patch.width) })
    a.setCoords()
    this.canvas.requestRenderAll()
    this.emitSelection()
    this.commitSoon()
  }

  // ── 레이어 목록에서 쓰는 동작 ───────────────────────────
  private byUid(uid: string): FObject | undefined {
    return this.canvas.getObjects().find((o) => extra(o).uid === uid)
  }

  selectByUid(uid: string, additive = false) {
    const o = this.byUid(uid)
    if (!o) return
    this.setMode('select')
    if (additive) {
      const cur = this.actives()
      this.selectObjects(cur.includes(o) ? cur.filter((it) => it !== o) : [...cur, o])
    } else {
      this.selectObjects([o])
    }
  }

  setVisible(uid: string, visible: boolean) {
    const o = this.byUid(uid)
    if (!o) return
    if (!visible && this.actives().includes(o)) this.canvas.discardActiveObject()
    o.set({ visible })
    this.canvas.requestRenderAll()
    this.commit()
  }

  setLocked(uid: string, locked: boolean) {
    const o = this.byUid(uid)
    if (!o) return
    extra(o).locked = locked
    if (locked && this.actives().includes(o)) this.canvas.discardActiveObject()
    this.decorate(o)
    this.canvas.requestRenderAll()
    this.commit()
  }

  rename(uid: string, name: string) {
    const o = this.byUid(uid)
    if (!o) return
    extra(o).name = name.trim().slice(0, 40) || undefined
    this.commit()
  }

  /** 레이어 목록의 한 칸 위/아래로 */
  moveLayer(uid: string, dir: 'up' | 'down') {
    const o = this.byUid(uid)
    if (!o) return
    const all = this.canvas.getObjects()
    const i = all.indexOf(o)
    const to = dir === 'up' ? i + 1 : i - 1
    if (to < 0 || to >= all.length) return
    this.canvas.moveObjectTo(o, to)
    this.canvas.requestRenderAll()
    this.commit()
  }
}
