import { Brush, Download, Eraser, Eye, FolderArchive, Hand, ImagePlus, Lasso, Redo2, RotateCcw, Square, Trash2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useHandoffFiles } from '@/app/handoff'
import { blobToFile, downloadBlob, downloadZip, todayStamp } from '@/lib/files'
import { useAbortable, useObjectUrl, usePersistentState } from '@/lib/hooks'
import { ctx2d, makeCanvas } from '@/lib/image'
import { Button, Callout, Dialog, Dropzone, EmptyState, Field, IconButton, Kbd, Progress, Section, Segmented, SendToMenu, Slider, ToolLayout, toast } from '@/ui'
import { ACCEPT_IMAGES, DEFAULT_EXPORT, ExportFields, FileStrip, encodeCanvas, exportName, makeThumb, newId, openImage, takeImageFiles, type ExportSettings } from './common'
import { planRegions, type FillMode, type Rect } from './inpaint'
import type { InpaintRequest, InpaintResponse } from './inpaint.worker'
import { Viewport, ZoomControls, type ImagePoint } from './viewport'

const MAX_FILES = 30
/** 한 번에 지울 수 있는 넓이(화소). 이보다 넓으면 계산이 지나치게 오래 걸린다. */
const MAX_HOLE_PIXELS = 1_500_000
/** 사진 한 장에 쌓아 둘 수 있는 되돌리기 기록의 크기 */
const MAX_HISTORY_BYTES = 320 * 1024 * 1024
/** 캔버스에 칠하는 표시 색(귤색) */
const MASK_COLOR = 'rgb(232, 85, 31)'

type Tool = 'brush' | 'rect' | 'lasso' | 'pan'
type PaintMode = 'add' | 'sub'

interface Patch extends Rect {
  before: ImageData
  after: ImageData
}
interface Op {
  patches: Patch[]
  bytes: number
}
interface Item {
  id: string
  file: File
  name: string
  width: number
  height: number
  thumb: string | null
  ops: Op[]
  /** 적용된 작업 수(되돌리면 줄어든다) */
  cursor: number
}

function replay(canvas: HTMLCanvasElement, item: Pick<Item, 'ops' | 'cursor'>) {
  const ctx = ctx2d(canvas)
  for (let i = 0; i < item.cursor; i++) for (const p of item.ops[i].patches) ctx.putImageData(p.after, p.x, p.y)
}

/** 원본에 지금까지의 수정을 다시 입혀 결과 캔버스를 만든다. */
async function renderItem(item: Item): Promise<HTMLCanvasElement> {
  const bmp = await openImage(item.file)
  const canvas = makeCanvas(bmp.width, bmp.height)
  ctx2d(canvas).drawImage(bmp, 0, 0)
  bmp.close()
  replay(canvas, item)
  return canvas
}

export default function CleanupTool() {
  const [items, setItems] = useState<Item[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = items.find((i) => i.id === activeId) ?? null
  const itemsRef = useRef(items)
  itemsRef.current = items

  const [tool, setTool] = useState<Tool>('brush')
  const [paintMode, setPaintMode] = useState<PaintMode>('add')
  const [brush, setBrush] = usePersistentState('onbijjang:cleanup:brush', 40)
  const [fill, setFill] = usePersistentState<FillMode>('onbijjang:cleanup:fill', 'texture')
  const [exp, setExp] = usePersistentState<ExportSettings>('onbijjang:cleanup:export', DEFAULT_EXPORT)
  const [zoom, setZoom] = useState(1)
  const [comparing, setComparing] = useState(false)
  const [painted, setPainted] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [hover, setHover] = useState<ImagePoint | null>(null)
  const [draft, setDraft] = useState<{ kind: 'rect'; a: ImagePoint; b: ImagePoint } | { kind: 'lasso'; pts: ImagePoint[] } | null>(null)

  const baseRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  /** 칠한 곳을 모두 포함하는 범위. 지울 때 이 안만 살핀다. */
  const dirty = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const last = useRef<ImagePoint | null>(null)
  const worker = useRef<Worker | null>(null)
  const jobSeq = useRef(0)
  const cancelJob = useRef<(() => void) | null>(null)
  const zipTask = useAbortable()
  const originalUrl = useObjectUrl(active?.file)
  const busy = progress !== null

  // ── 파일 받기 ───────────────────────────────────────────
  const addFiles = useCallback(async (incoming: File[]) => {
    const files = takeImageFiles(incoming, itemsRef.current.length, MAX_FILES)
    if (!files.length) return
    const fresh: Item[] = files.map((file) => ({ id: newId(), file, name: file.name, width: 0, height: 0, thumb: null, ops: [], cursor: 0 }))
    setItems((prev) => [...prev, ...fresh])
    setActiveId((cur) => cur ?? fresh[0].id)
    for (const it of fresh) {
      try {
        const bmp = await openImage(it.file)
        const patch = { width: bmp.width, height: bmp.height, thumb: makeThumb(bmp) }
        bmp.close()
        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, ...patch } : p)))
      } catch (err) {
        toast.error(`${it.name}: ${err instanceof Error ? err.message : '사진을 열 수 없습니다.'}`)
        setItems((prev) => prev.filter((p) => p.id !== it.id))
        setActiveId((cur) => (cur === it.id ? (itemsRef.current.find((p) => p.id !== it.id)?.id ?? null) : cur))
      }
    }
  }, [])
  useHandoffFiles('cleanup', addFiles)

  // ── 고른 사진을 작업 캔버스에 올리기 ────────────────────
  const activeFile = active?.file
  const mounted = !!active && active.width > 0
  useEffect(() => {
    setReady(false)
    setLoadError(null)
    setPainted(false)
    setDraft(null)
    dirty.current = null
    if (!activeFile || !activeId || !mounted) return
    let alive = true
    openImage(activeFile)
      .then((bmp) => {
        const base = baseRef.current
        const mask = maskRef.current
        if (!alive || !base || !mask) return bmp.close()
        base.width = mask.width = bmp.width
        base.height = mask.height = bmp.height
        ctx2d(base, true).drawImage(bmp, 0, 0)
        bmp.close()
        const item = itemsRef.current.find((i) => i.id === activeId)
        if (item) replay(base, item)
        setZoom(1)
        setReady(true)
      })
      .catch((err) => alive && setLoadError(err instanceof Error ? err.message : '사진을 열 수 없습니다.'))
    return () => {
      alive = false
    }
  }, [activeId, activeFile, mounted])

  useEffect(() => () => worker.current?.terminate(), [])

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id))
    if (id === activeId) {
      const rest = items.filter((p) => p.id !== id)
      setActiveId(rest[0]?.id ?? null)
    }
  }

  // ── 칠하기 ──────────────────────────────────────────────
  const touch = (x0: number, y0: number, x1: number, y1: number) => {
    const d = dirty.current
    dirty.current = d ? { x0: Math.min(d.x0, x0), y0: Math.min(d.y0, y0), x1: Math.max(d.x1, x1), y1: Math.max(d.y1, y1) } : { x0, y0, x1, y1 }
  }
  const maskCtx = () => {
    const ctx = ctx2d(maskRef.current!, true)
    ctx.globalCompositeOperation = paintMode === 'add' ? 'source-over' : 'destination-out'
    ctx.fillStyle = ctx.strokeStyle = MASK_COLOR
    return ctx
  }
  const strokeTo = (pt: ImagePoint) => {
    const ctx = maskCtx()
    const from = last.current ?? pt
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.lineWidth = brush
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(pt.x + 0.01, pt.y + 0.01)
    ctx.stroke()
    const r = brush / 2 + 2
    if (paintMode === 'add') touch(Math.min(from.x, pt.x) - r, Math.min(from.y, pt.y) - r, Math.max(from.x, pt.x) + r, Math.max(from.y, pt.y) + r)
    last.current = pt
  }

  const onDown = (pt: ImagePoint) => {
    if (!ready || busy) return
    if (tool === 'brush') {
      last.current = null
      strokeTo(pt)
      if (paintMode === 'add') setPainted(true)
    } else if (tool === 'rect') setDraft({ kind: 'rect', a: pt, b: pt })
    else if (tool === 'lasso') setDraft({ kind: 'lasso', pts: [pt] })
  }
  const onMove = (pt: ImagePoint) => {
    if (!ready || busy) return
    if (tool === 'brush') strokeTo(pt)
    else if (draft?.kind === 'rect') setDraft({ ...draft, b: pt })
    else if (draft?.kind === 'lasso') {
      const prev = draft.pts[draft.pts.length - 1]
      if (Math.hypot(pt.x - prev.x, pt.y - prev.y) >= 2) setDraft({ kind: 'lasso', pts: [...draft.pts, pt] })
    }
  }
  const onUp = () => {
    last.current = null
    if (!draft) return
    const ctx = maskCtx()
    if (draft.kind === 'rect') {
      const x = Math.min(draft.a.x, draft.b.x)
      const y = Math.min(draft.a.y, draft.b.y)
      const w = Math.abs(draft.a.x - draft.b.x)
      const h = Math.abs(draft.a.y - draft.b.y)
      if (w >= 2 && h >= 2) {
        ctx.fillRect(x, y, w, h)
        if (paintMode === 'add') {
          touch(x - 2, y - 2, x + w + 2, y + h + 2)
          setPainted(true)
        }
      }
    } else if (draft.pts.length >= 3) {
      ctx.beginPath()
      draft.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.closePath()
      ctx.fill()
      if (paintMode === 'add') {
        const xs = draft.pts.map((p) => p.x)
        const ys = draft.pts.map((p) => p.y)
        touch(Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2)
        setPainted(true)
      }
    }
    setDraft(null)
  }

  const clearMask = () => {
    const mask = maskRef.current
    if (mask) ctx2d(mask).clearRect(0, 0, mask.width, mask.height)
    dirty.current = null
    setPainted(false)
  }

  // ── 지우기 실행 ─────────────────────────────────────────
  const runJob = (req: Omit<InpaintRequest, 'id'>, onRatio: (r: number) => void) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      if (!worker.current) worker.current = new Worker(new URL('./inpaint.worker.ts', import.meta.url), { type: 'module' })
      const w = worker.current
      const id = ++jobSeq.current
      const cleanup = () => {
        w.removeEventListener('message', onMessage)
        w.removeEventListener('error', onError)
        cancelJob.current = null
      }
      const onMessage = (e: MessageEvent<InpaintResponse>) => {
        if (e.data.id !== id) return
        if (e.data.type === 'progress') return onRatio(e.data.ratio)
        cleanup()
        if (e.data.type === 'done') resolve(e.data.rgba)
        else reject(new Error(e.data.message))
      }
      const onError = () => {
        cleanup()
        worker.current?.terminate()
        worker.current = null
        reject(new Error('계산 중 문제가 생겼습니다. 칠한 곳을 줄여 다시 시도해 주세요.'))
      }
      cancelJob.current = () => {
        cleanup()
        w.terminate()
        worker.current = null
        reject(new DOMException('취소', 'AbortError'))
      }
      w.addEventListener('message', onMessage)
      w.addEventListener('error', onError)
      w.postMessage({ id, ...req } satisfies InpaintRequest, [req.rgba, req.mask])
    })

  const erase = async () => {
    const base = baseRef.current
    const mask = maskRef.current
    const item = active
    if (!base || !mask || !item || !ready || busy) return
    const d = dirty.current
    if (!d) return toast.info('먼저 지울 곳을 칠해 주세요.')
    const bx = Math.max(0, Math.floor(d.x0))
    const by = Math.max(0, Math.floor(d.y0))
    const bw = Math.min(base.width, Math.ceil(d.x1)) - bx
    const bh = Math.min(base.height, Math.ceil(d.y1)) - by
    if (bw <= 0 || bh <= 0) return toast.info('먼저 지울 곳을 칠해 주세요.')
    if (item.ops.slice(0, item.cursor).reduce((s, o) => s + o.bytes, 0) > MAX_HISTORY_BYTES) {
      return toast.warn('이 사진은 수정 기록이 너무 많이 쌓였습니다. 지금 결과를 저장한 뒤, 저장한 사진을 다시 올려 이어서 작업해 주세요.')
    }

    const mctx = ctx2d(mask, true)
    const alpha = mctx.getImageData(bx, by, bw, bh).data
    const bits = new Uint8Array(bw * bh)
    let count = 0
    for (let i = 0; i < bits.length; i++) {
      if (alpha[i * 4 + 3] > 24) {
        bits[i] = 1
        count++
      }
    }
    if (!count) return toast.info('칠한 곳이 없습니다. 지울 곳을 칠해 주세요.')
    if (count > MAX_HOLE_PIXELS || count > base.width * base.height * 0.4) {
      return toast.warn('칠한 부분이 너무 넓습니다. 이 도구는 작은 표시를 지우는 용도라, 더 좁게 나눠서 칠해 주세요.')
    }

    const regions = planRegions(bits, bw, bh, bx, by, base.width, base.height)
    const total = regions.reduce((s, r) => s + r.w * r.h, 0)
    const bctx = ctx2d(base, true)
    const patches: Patch[] = []
    let doneArea = 0
    setProgress({ label: '주변 무늬로 채우는 중', value: 0 })
    try {
      for (const r of regions) {
        const before = bctx.getImageData(r.x, r.y, r.w, r.h)
        const m = mctx.getImageData(r.x, r.y, r.w, r.h).data
        const hole = new Uint8Array(r.w * r.h)
        for (let i = 0; i < hole.length; i++) hole[i] = m[i * 4 + 3] > 24 ? 1 : 0
        const result = await runJob(
          { rgba: before.data.slice().buffer as ArrayBuffer, mask: hole.buffer as ArrayBuffer, width: r.w, height: r.h, mode: fill, grow: 2 },
          (ratio) => setProgress({ label: '주변 무늬로 채우는 중', value: ((doneArea + ratio * r.w * r.h) / total) * 100 }),
        )
        doneArea += r.w * r.h
        patches.push({ ...r, before, after: new ImageData(new Uint8ClampedArray(result), r.w, r.h) })
      }
      for (const p of patches) bctx.putImageData(p.after, p.x, p.y)
      const op: Op = { patches, bytes: patches.reduce((s, p) => s + p.w * p.h * 8, 0) }
      const thumb = makeThumb(base)
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, ops: [...p.ops.slice(0, p.cursor), op], cursor: p.cursor + 1, thumb } : p)))
      clearMask()
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) toast.error(err instanceof Error ? err.message : '지우지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setProgress(null)
    }
  }

  // ── 되돌리기 ────────────────────────────────────────────
  const canUndo = !!active && active.cursor > 0
  const canRedo = !!active && active.cursor < active.ops.length
  const stepHistory = (dir: -1 | 1) => {
    const base = baseRef.current
    if (!active || !base || !ready || busy) return
    if (dir === -1 ? !canUndo : !canRedo) return
    const op = active.ops[dir === -1 ? active.cursor - 1 : active.cursor]
    const ctx = ctx2d(base, true)
    for (const p of op.patches) ctx.putImageData(dir === -1 ? p.before : p.after, p.x, p.y)
    const thumb = makeThumb(base)
    setItems((prev) => prev.map((p) => (p.id === active.id ? { ...p, cursor: p.cursor + dir, thumb } : p)))
  }
  const resetToOriginal = () => {
    const base = baseRef.current
    setConfirmReset(false)
    if (!active || !base) return
    const ctx = ctx2d(base, true)
    for (let i = active.cursor - 1; i >= 0; i--) for (const p of active.ops[i].patches) ctx.putImageData(p.before, p.x, p.y)
    const thumb = makeThumb(base)
    setItems((prev) => prev.map((p) => (p.id === active.id ? { ...p, ops: [], cursor: 0, thumb } : p)))
    clearMask()
    toast.success('원본으로 되돌렸습니다.')
  }

  const keyState = useRef({ stepHistory, erase })
  keyState.current = { stepHistory, erase }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        keyState.current.stepHistory(e.shiftKey ? 1 : -1)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        keyState.current.stepHistory(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── 저장 ────────────────────────────────────────────────
  const resultCanvas = async (item: Item) => (item.id === activeId && ready && baseRef.current ? baseRef.current : renderItem(item))
  const resultFile = async (item: Item) => blobToFile(await encodeCanvas(await resultCanvas(item), exp), exportName(item.name, '_지움', exp.format))

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
    const signal = zipTask.start()
    try {
      const entries = []
      for (let i = 0; i < items.length; i++) {
        setProgress({ label: `저장할 사진 준비 중 (${i + 1}/${items.length})`, value: (i / items.length) * 100 })
        const file = await resultFile(items[i])
        if (signal.aborted) return
        entries.push({ name: file.name, data: file })
      }
      await downloadZip(entries, `작은표시지우기_${todayStamp()}`)
      toast.success(`${entries.length}장을 ZIP 으로 저장했습니다.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ZIP 을 만들지 못했습니다.')
    } finally {
      setProgress(null)
    }
  }
  const cancel = () => {
    cancelJob.current?.()
    zipTask.abort()
    setProgress(null)
  }

  // ── 화면 ────────────────────────────────────────────────
  const notice = (
    <Callout tone="warn" title="내 사진에만 쓰세요">
      직접 찍었거나 수정 권한이 있는 사진에만 쓰세요. 다른 사람의 저작권·출처 표시를 지우는 데 쓰면 안 됩니다.
    </Callout>
  )

  if (!items.length) {
    return (
      <div className="flex flex-col gap-4">
        {notice}
        <Dropzone onFiles={addFiles} accept={ACCEPT_IMAGES} icon={ImagePlus} title="지울 표시가 있는 사진을 끌어다 놓으세요" hint={`한 장 40MB · 4천만 화소 이하 · 최대 ${MAX_FILES}장 · Ctrl+V 로 붙여넣기`} />
        <EmptyState icon={Eraser} title="사진을 올리면 여기서 바로 칠해서 지웁니다">
          잡티·먼지·작은 글씨처럼 좁은 부분을 칠하면 주변 색과 무늬로 채워 넣습니다. 사진은 서버로 올라가지 않습니다.
        </EmptyState>
      </div>
    )
  }

  const cursor = tool === 'pan' ? 'grab' : tool === 'brush' ? 'none' : 'crosshair'
  const panel = (
    <>
      <Section title="지울 곳 칠하기" hint="브러시·사각형·올가미로 지울 곳을 덮습니다. 표시보다 조금 넉넉하게 칠하면 깔끔합니다.">
        <Field label="브러시 크기" aside={`${brush}px`}>
          {(id) => <Slider id={id} min={4} max={300} step={2} value={brush} onValue={setBrush} />}
        </Field>
        <Button icon={Trash2} disabled={!painted || busy} onClick={clearMask}>
          칠한 곳 비우기
        </Button>
      </Section>
      <Section title="채우는 방법">
        <Segmented
          label="채우는 방법"
          block
          value={fill}
          onValue={setFill}
          options={[
            { value: 'texture', label: '무늬 살리기' },
            { value: 'smooth', label: '매끈하게' },
          ]}
        />
        <p className="text-sm text-muted">{fill === 'texture' ? '주변에서 비슷한 무늬를 찾아 이어 붙입니다. 천·나무결·잔디처럼 결이 있는 배경에 알맞습니다.' : '주변 색이 부드럽게 번지도록 채웁니다. 하늘·벽지처럼 무늬가 없는 배경에 빠르고 깔끔합니다.'}</p>
        <Button variant="primary" icon={Eraser} block disabled={!ready || !painted || busy} onClick={erase}>
          칠한 부분 지우기
        </Button>
        {progress && (
          <div className="flex flex-col gap-2">
            <Progress value={progress.value} label={progress.label} />
            <Button size="sm" onClick={cancel}>
              취소
            </Button>
          </div>
        )}
      </Section>
      <Section title="되돌리기">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={Undo2} disabled={!canUndo || busy} onClick={() => stepHistory(-1)}>
            실행 취소
          </Button>
          <Button size="sm" icon={Redo2} disabled={!canRedo || busy} onClick={() => stepHistory(1)}>
            다시 실행
          </Button>
          <Button size="sm" variant="danger" icon={RotateCcw} disabled={!active || active.ops.length === 0 || busy} onClick={() => setConfirmReset(true)}>
            원본으로 되돌리기
          </Button>
        </div>
      </Section>
      <Section title="저장">
        <ExportFields value={exp} onChange={setExp} />
        <div className="flex flex-col gap-2">
          <Button icon={Download} block disabled={!ready || busy} onClick={saveCurrent}>
            이 사진 저장
          </Button>
          <Button icon={FolderArchive} block disabled={busy || items.length < 2} onClick={saveZip}>
            ZIP 으로 모두 저장 ({items.length}장)
          </Button>
          <SendToMenu exclude="cleanup" disabled={busy || !ready} files={() => Promise.all(items.map(resultFile))} />
        </div>
        <p className="text-sm text-muted">저장한 파일에는 촬영 위치 같은 부가 정보가 남지 않습니다.</p>
      </Section>
    </>
  )

  return (
    <ToolLayout panel={panel}>
      {notice}
      <Dropzone compact onFiles={addFiles} accept={ACCEPT_IMAGES} disabled={busy || items.length >= MAX_FILES} title="사진 더 올리기" hint={`${items.length}/${MAX_FILES}장`} />
      <FileStrip items={items} activeId={activeId} onSelect={setActiveId} onRemove={removeItem} disabled={busy} badge={(it) => (it.cursor > 0 ? `${it.cursor}번 지움` : null)} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented
          label="칠하는 도구"
          size="sm"
          value={tool}
          onValue={setTool}
          options={[
            { value: 'brush', label: '브러시', icon: Brush },
            { value: 'rect', label: '사각형', icon: Square },
            { value: 'lasso', label: '올가미', icon: Lasso },
            { value: 'pan', label: '이동', icon: Hand },
          ]}
        />
        <Segmented
          label="칠하기 또는 빼기"
          size="sm"
          value={paintMode}
          onValue={setPaintMode}
          options={[
            { value: 'add', label: '칠하기' },
            { value: 'sub', label: '칠한 곳 빼기' },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          <IconButton icon={Undo2} label="실행 취소 (Ctrl+Z)" size="sm" disabled={!canUndo || busy} onClick={() => stepHistory(-1)} />
          <IconButton icon={Redo2} label="다시 실행 (Ctrl+Y)" size="sm" disabled={!canRedo || busy} onClick={() => stepHistory(1)} />
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
        active.width > 0 && (
          <Viewport
            label="사진 작업 영역. 끌어서 지울 곳을 칠합니다."
            width={active.width}
            height={active.height}
            zoom={zoom}
            onZoom={setZoom}
            panMode={tool === 'pan'}
            cursor={cursor}
            onDown={onDown}
            onMove={onMove}
            onUp={onUp}
            onHover={setHover}
          >
            {({ scale }) => (
              <>
                <canvas ref={baseRef} className="checker absolute inset-0 size-full shadow-3" />
                <canvas ref={maskRef} className="absolute inset-0 size-full opacity-55" style={{ visibility: comparing ? 'hidden' : 'visible' }} />
                {comparing && originalUrl && <img src={originalUrl} alt="원본" className="absolute inset-0 size-full" draggable={false} />}
                {comparing && <span className="absolute left-2 top-2 rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-paper">원본</span>}
                <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${active.width} ${active.height}`} preserveAspectRatio="none" aria-hidden>
                  {draft?.kind === 'rect' && (
                    <>
                      <rect x={Math.min(draft.a.x, draft.b.x)} y={Math.min(draft.a.y, draft.b.y)} width={Math.abs(draft.a.x - draft.b.x)} height={Math.abs(draft.a.y - draft.b.y)} fill="none" className="stroke-ink" strokeWidth={3 / scale} />
                      <rect x={Math.min(draft.a.x, draft.b.x)} y={Math.min(draft.a.y, draft.b.y)} width={Math.abs(draft.a.x - draft.b.x)} height={Math.abs(draft.a.y - draft.b.y)} fill="none" className="stroke-mark" strokeWidth={1.5 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} />
                    </>
                  )}
                  {draft?.kind === 'lasso' && (
                    <>
                      <polyline points={draft.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" className="stroke-ink" strokeWidth={3 / scale} />
                      <polyline points={draft.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" className="stroke-mark" strokeWidth={1.5 / scale} />
                    </>
                  )}
                  {tool === 'brush' && hover && !comparing && (
                    <>
                      <circle cx={hover.x} cy={hover.y} r={brush / 2} fill="none" className="stroke-ink" strokeWidth={3 / scale} />
                      <circle cx={hover.x} cy={hover.y} r={brush / 2} fill="none" className="stroke-surface" strokeWidth={1.5 / scale} />
                    </>
                  )}
                </svg>
                {!ready && <div className="skeleton absolute inset-0 rounded-none!" aria-label="사진을 여는 중" />}
              </>
            )}
          </Viewport>
        )
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1">
          <Kbd>Ctrl</Kbd>+<Kbd>휠</Kbd> 확대
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Space</Kbd>+끌기 이동
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> 실행 취소
        </span>
        {active && active.width > 0 && (
          <span className="num ml-auto">
            {active.width}×{active.height}px
          </span>
        )}
      </p>

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="원본으로 되돌릴까요?"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>그대로 두기</Button>
            <Button variant="danger" icon={RotateCcw} onClick={resetToOriginal}>
              원본으로 되돌리기
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">이 사진에서 지금까지 지운 내용이 모두 사라지고, 다시 실행할 수 없습니다.</p>
      </Dialog>
    </ToolLayout>
  )
}
