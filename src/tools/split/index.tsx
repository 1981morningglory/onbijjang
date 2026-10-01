import clsx from 'clsx'
import { Download, FileArchive, RotateCcw, Scissors, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useHandoffFiles } from '@/app/handoff'
import { blobToFile, downloadBlob, downloadZip, formatBytes, sanitizeFilename, stripExt } from '@/lib/files'
import { fmt, useAbortable, useObjectUrl, usePersistentState } from '@/lib/hooks'
import { FORMAT_EXT, canvasToBlob, ctx2d, isCanvasSizeSafe, loadBitmap, makeCanvas, resizeCanvas, type RasterFormat } from '@/lib/image'
import { Button, Callout, Dropzone, EmptyState, Field, IconButton, NumberInput, Panel, Progress, Section, Segmented, SendToMenu, Slider, Stage, TextInput, ToolLayout, toast } from '@/ui'
import {
  COUNT_OPTIONS, MAX_GRID, MAX_PIECES, countToGrid, everyPieceCount, moveCut, pieceName, pieceRects, planCuts, rescaleCuts, scaledSize,
  type CountDirection, type EveryAxis, type PieceRect, type ScaleChoice, type SplitMode,
} from './logic'

const MAX_FILE_BYTES = 40 * 1024 * 1024

interface Settings {
  mode: SplitMode
  count: number
  direction: CountDirection
  rows: number
  cols: number
  everyAxis: EveryAxis
  everyPx: number
  scale: '1' | '2' | '3' | 'custom'
  customWidth: number
  format: RasterFormat
  quality: number
}

const DEFAULT_SETTINGS: Settings = {
  mode: 'count',
  count: 4,
  direction: 'stack',
  rows: 3,
  cols: 3,
  everyAxis: 'height',
  everyPx: 1000,
  scale: '1',
  customWidth: 860,
  format: 'image/png',
  quality: 90,
}

interface Source {
  id: number
  file: File
  canvas: HTMLCanvasElement
  width: number
  height: number
}

let sourceSeq = 0

/** 조각 하나를 그려 Blob 으로 만드는 함수를 돌려준다. 줄일 때는 전체를 한 번만 줄여 두고 잘라 쓴다. */
function createPieceRenderer(src: Source, out: { width: number; height: number }, format: RasterFormat, quality: number) {
  let reduced: HTMLCanvasElement | null = null
  return (r: PieceRect): Promise<Blob> => {
    if (!isCanvasSizeSafe(r.w, r.h)) throw new Error(`${r.index + 1}번 조각(${fmt.format(r.w)}×${fmt.format(r.h)}px)이 너무 큽니다. 전체 크기를 줄이거나 더 잘게 나눠 주세요.`)
    const piece = makeCanvas(r.w, r.h)
    const ctx = ctx2d(piece)
    ctx.imageSmoothingQuality = 'high'
    if (out.width === src.width && out.height === src.height) {
      ctx.drawImage(src.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
    } else if (out.width < src.width) {
      reduced ??= resizeCanvas(src.canvas, out.width, out.height)
      ctx.drawImage(reduced, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
    } else {
      const fx = src.width / out.width
      const fy = src.height / out.height
      ctx.drawImage(src.canvas, r.x * fx, r.y * fy, r.w * fx, r.h * fy, 0, 0, r.w, r.h)
    }
    return canvasToBlob(piece, format, quality / 100)
  }
}

interface DividerProps {
  axis: 'x' | 'y'
  pos: number
  total: number
  label: string
  disabled: boolean
  onMove: (pos: number) => void
  getRect: () => DOMRect | null
}

/** 끌어서 옮기는 분할선. 방향키로 1px(Shift 10px)씩 옮길 수 있다. */
function Divider({ axis, pos, total, label, disabled, onMove, getRect }: DividerProps) {
  const dragging = useRef(false)
  const [active, setActive] = useState(false)
  const fromPointer = (e: PointerEvent) => {
    const rect = getRect()
    if (!rect || !rect.width || !rect.height) return
    onMove(axis === 'x' ? ((e.clientX - rect.left) / rect.width) * total : ((e.clientY - rect.top) / rect.height) * total)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    if (e.key !== back && e.key !== forward) return
    e.preventDefault()
    onMove(pos + (e.key === forward ? 1 : -1) * (e.shiftKey ? 10 : 1))
  }
  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={pos}
      aria-valuemin={1}
      aria-valuemax={total - 1}
      tabIndex={disabled ? -1 : 0}
      title={`${label} · ${fmt.format(pos)}px`}
      onPointerDown={(e) => {
        if (disabled) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        e.currentTarget.focus()
        dragging.current = true
        setActive(true)
      }}
      onPointerMove={(e) => dragging.current && fromPointer(e)}
      onPointerUp={() => {
        dragging.current = false
        setActive(false)
      }}
      onPointerCancel={() => {
        dragging.current = false
        setActive(false)
      }}
      onKeyDown={onKeyDown}
      style={axis === 'x' ? { left: `${(pos / total) * 100}%` } : { top: `${(pos / total) * 100}%` }}
      className={clsx(
        'group absolute z-10 flex touch-none items-center justify-center rounded-none! outline-none',
        axis === 'x' ? 'inset-y-0 w-4 -translate-x-1/2 cursor-col-resize' : 'inset-x-0 h-4 -translate-y-1/2 cursor-row-resize',
        disabled && 'pointer-events-none',
      )}
    >
      <span
        className={clsx(
          'block bg-mark ring-1 ring-ink/55 transition-[background-color,transform] duration-150 group-hover:bg-accent group-focus-visible:bg-accent',
          axis === 'x' ? 'h-full w-0.5 group-hover:scale-x-150' : 'h-0.5 w-full group-hover:scale-y-150',
          active && 'bg-accent!',
        )}
      />
    </div>
  )
}

export default function SplitTool() {
  const [settings, setSettings] = usePersistentState<Settings>('onbijjang:split:settings', DEFAULT_SETTINGS)
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))
  const [src, setSrc] = useState<Source | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nameBase, setNameBase] = useState('')
  const [view, setView] = useState<'fit' | 'width'>('fit')
  const [cuts, setCuts] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [dirty, setDirty] = useState(false)
  const [resetNonce, setResetNonce] = useState(0)
  const [capped, setCapped] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const previewUrl = useObjectUrl(src?.file)
  const { start, abort } = useAbortable()

  const load = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    if (files.length > 1) toast.info('사진 분할은 한 장씩 합니다. 첫 번째 사진만 열었습니다.')
    if (file.size > MAX_FILE_BYTES) {
      setLoadError(`사진이 ${formatBytes(file.size)}로 너무 큽니다. 한 장 ${formatBytes(MAX_FILE_BYTES)} 이하로 줄여서 다시 올려 주세요.`)
      return
    }
    setLoading(true)
    setLoadError(null)
    setSaveError(null)
    try {
      const bmp = await loadBitmap(file)
      if (!isCanvasSizeSafe(bmp.width, bmp.height)) {
        const size = `${fmt.format(bmp.width)}×${fmt.format(bmp.height)}px`
        bmp.close()
        throw new Error(`사진이 ${size}로 브라우저가 다룰 수 있는 크기를 넘습니다. 한 변 16,384px·전체 1억 2천만 화소 이하로 줄여 주세요.`)
      }
      const canvas = makeCanvas(bmp.width, bmp.height)
      ctx2d(canvas).drawImage(bmp, 0, 0)
      bmp.close()
      setSrc({ id: ++sourceSeq, file, canvas, width: canvas.width, height: canvas.height })
      setNameBase(sanitizeFilename(stripExt(file.name), '사진'))
      setView(canvas.height / canvas.width > 2 ? 'width' : 'fit')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '사진을 열지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])
  useHandoffFiles('split', load)

  // ── 저장될 전체 크기 ──
  const out = useMemo(() => {
    if (!src) return { width: 0, height: 0, scale: 1 }
    const choice: ScaleChoice = settings.scale === 'custom' ? { kind: 'width', width: settings.customWidth } : { kind: 'factor', factor: Number(settings.scale) }
    return scaledSize(src.width, src.height, choice)
  }, [src, settings.scale, settings.customWidth])

  // ── 분할선: 설정이 바뀌면 다시 놓고, 크기만 바뀌면 손으로 옮긴 위치를 비율대로 유지 ──
  const { mode, count, direction, rows, cols, everyAxis, everyPx } = settings
  const prev = useRef<{ key: string; w: number; h: number } | null>(null)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  useEffect(() => {
    if (!src) return
    const key = JSON.stringify([src.id, mode, count, direction, rows, cols, everyAxis, everyPx, resetNonce])
    const p = prev.current
    if (p && p.key === key && dirtyRef.current && mode !== 'every') {
      setCuts((c) => ({ x: rescaleCuts(c.x, p.w, out.width), y: rescaleCuts(c.y, p.h, out.height) }))
    } else {
      const plan = planCuts({ mode, count, direction, rows, cols, everyAxis, everyPx }, out.width, out.height)
      setCuts({ x: plan.xCuts, y: plan.yCuts })
      setCapped(plan.capped)
      setDirty(false)
    }
    prev.current = { key, w: out.width, h: out.height }
  }, [src, mode, count, direction, rows, cols, everyAxis, everyPx, resetNonce, out.width, out.height])

  const rects = useMemo(() => (src ? pieceRects(cuts.x, cuts.y, out.width, out.height) : []), [src, cuts, out.width, out.height])
  const ext = FORMAT_EXT[settings.format]
  const base = sanitizeFilename(nameBase, '사진')
  const busy = progress !== null

  // ── 무대 안 표시 크기 ──
  const frame = useRef<HTMLDivElement>(null)
  const imageBox = useRef<HTMLDivElement>(null)
  const [frameWidth, setFrameWidth] = useState(0)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(() => setFrameWidth(el.clientWidth))
    ro.observe(el)
    setFrameWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [src])
  const display = useMemo(() => {
    if (!src || !frameWidth) return { w: 0, h: 0 }
    const maxH = Math.max(320, Math.round(window.innerHeight * 0.68))
    const k = view === 'fit' ? Math.min(frameWidth / src.width, maxH / src.height, 1) : Math.min(frameWidth / src.width, 1)
    return { w: Math.max(1, Math.round(src.width * k)), h: Math.max(1, Math.round(src.height * k)) }
  }, [src, frameWidth, view])

  const moveLine = (axis: 'x' | 'y', index: number, pos: number) => {
    setCuts((c) => (axis === 'x' ? { ...c, x: moveCut(c.x, index, pos, out.width) } : { ...c, y: moveCut(c.y, index, pos, out.height) }))
    setDirty(true)
  }

  // ── 저장 ──
  const renderAll = async (): Promise<File[]> => {
    if (!src) return []
    const signal = start()
    const render = createPieceRenderer(src, out, settings.format, settings.quality)
    const files: File[] = []
    setSaveError(null)
    setProgress({ done: 0, total: rects.length })
    try {
      for (const r of rects) {
        if (signal.aborted) throw new DOMException('조각 만들기를 취소했습니다.', 'AbortError')
        files.push(blobToFile(await render(r), pieceName(base, r.index, rects.length, ext)))
        setProgress({ done: files.length, total: rects.length })
      }
      return files
    } finally {
      setProgress(null)
    }
  }
  const report = (err: unknown) => {
    if (err instanceof DOMException && err.name === 'AbortError') return toast.info('저장을 취소했습니다.')
    setSaveError(err instanceof Error ? err.message : '조각을 만들지 못했습니다.')
  }
  const saveZip = async () => {
    try {
      const files = await renderAll()
      if (!files.length) return
      await downloadZip(files.map((f) => ({ name: f.name, data: f })), `${base}_분할`)
      toast.success(`조각 ${files.length}개를 ZIP 으로 저장했습니다.`)
    } catch (err) {
      report(err)
    }
  }
  const saveOne = async (r: PieceRect) => {
    if (!src) return
    try {
      setSaveError(null)
      const blob = await createPieceRenderer(src, out, settings.format, settings.quality)(r)
      downloadBlob(blob, pieceName(base, r.index, rects.length, ext))
    } catch (err) {
      report(err)
    }
  }

  const grid = mode === 'count' ? countToGrid(count, direction) : null
  const everyTotal = everyAxis === 'height' ? out.height : out.width
  const customWidthError = settings.scale === 'custom' && (!settings.customWidth || settings.customWidth < 1) ? '너비를 1px 이상으로 입력하세요.' : null
  const outUnsafe = src ? rects.some((r) => !isCanvasSizeSafe(r.w, r.h)) : false

  const panel = (
    <>
      <Section
        title="나누는 방법"
        action={
          <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!src || !dirty} onClick={() => setResetNonce((n) => n + 1)}>
            균등 분할로 초기화
          </Button>
        }
      >
        <Segmented
          label="나누는 방법"
          block
          value={mode}
          onValue={(v) => set({ mode: v })}
          options={[
            { value: 'count', label: '조각 수' },
            { value: 'grid', label: '행 × 열' },
            { value: 'every', label: '일정 간격' },
          ]}
        />
        {mode === 'count' && (
          <>
            <Segmented
              label="조각 수"
              block
              value={String(count)}
              onValue={(v) => set({ count: Number(v) })}
              options={COUNT_OPTIONS.map((n) => ({ value: String(n), label: `${n}조각` }))}
            />
            <Segmented
              label="나누는 방향"
              block
              size="sm"
              value={direction}
              onValue={(v) => set({ direction: v })}
              options={[
                { value: 'stack', label: '세로 우선' },
                { value: 'side', label: '가로 우선' },
              ]}
            />
            {grid && (
              <p className="text-sm text-muted">
                {direction === 'stack' ? '위아래로 더 많이 나눕니다.' : '좌우로 더 많이 나눕니다.'} <span className="num">{grid.rows}행 × {grid.cols}열</span>
              </p>
            )}
          </>
        )}
        {mode === 'grid' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="행(위아래)">{(id) => <NumberInput id={id} min={1} max={MAX_GRID} step={1} value={rows} onValue={(v) => set({ rows: Math.min(MAX_GRID, Math.max(1, Math.floor(v ?? 1))) })} unit="행" />}</Field>
            <Field label="열(좌우)">{(id) => <NumberInput id={id} min={1} max={MAX_GRID} step={1} value={cols} onValue={(v) => set({ cols: Math.min(MAX_GRID, Math.max(1, Math.floor(v ?? 1))) })} unit="열" />}</Field>
            <p className="col-span-2 text-sm text-muted">각각 1–{MAX_GRID} 사이로 정할 수 있습니다.</p>
          </div>
        )}
        {mode === 'every' && (
          <>
            <Segmented
              label="자르는 기준"
              block
              size="sm"
              value={everyAxis}
              onValue={(v) => set({ everyAxis: v })}
              options={[
                { value: 'height', label: '높이 기준' },
                { value: 'width', label: '가로 기준' },
              ]}
            />
            <Field
              label={everyAxis === 'height' ? '이 높이마다 자르기' : '이 너비마다 자르기'}
              hint={src ? `${fmt.format(everyTotal)}px 을 ${fmt.format(Math.min(MAX_PIECES, everyPieceCount(everyTotal, everyPx)))}조각으로. 마지막 조각은 남는 만큼입니다.` : '긴 상세페이지를 올리기 좋은 길이로 자릅니다.'}
              error={!everyPx || everyPx < 1 ? '1px 이상으로 입력하세요.' : undefined}
            >
              {(id) => <NumberInput id={id} min={1} step={10} value={everyPx || null} onValue={(v) => set({ everyPx: Math.max(0, Math.floor(v ?? 0)) })} unit="px" />}
            </Field>
            {capped && (
              <Callout tone="warn" title={`조각이 ${MAX_PIECES}개를 넘습니다`}>
                앞에서부터 {MAX_PIECES}조각까지만 나눴습니다. 간격을 더 크게 입력해 주세요.
              </Callout>
            )}
          </>
        )}
        <p className="text-sm text-muted">사진 위의 노란 선을 끌면 자르는 위치를 바꿀 수 있습니다.</p>
      </Section>

      <Section title="전체 크기" hint="나누기 전에 사진 전체를 키우거나 줄입니다. 비율은 그대로입니다.">
        <Segmented
          label="전체 크기"
          block
          value={settings.scale}
          onValue={(v) => set({ scale: v })}
          options={[
            { value: '1', label: '원본' },
            { value: '2', label: '2배' },
            { value: '3', label: '3배' },
            { value: 'custom', label: '직접' },
          ]}
        />
        {settings.scale === 'custom' && (
          <Field label="전체 너비" error={customWidthError}>
            {(id) => <NumberInput id={id} min={1} step={10} value={settings.customWidth || null} onValue={(v) => set({ customWidth: Math.max(0, Math.floor(v ?? 0)) })} unit="px" />}
          </Field>
        )}
        {src && (
          <p className="num text-sm text-muted">
            {fmt.format(src.width)}×{fmt.format(src.height)}px 에서 {fmt.format(out.width)}×{fmt.format(out.height)}px 로
          </p>
        )}
      </Section>

      <Section title="저장">
        <Segmented
          label="저장 형식"
          block
          value={settings.format}
          onValue={(v) => set({ format: v })}
          options={[
            { value: 'image/png', label: 'PNG' },
            { value: 'image/jpeg', label: 'JPG' },
            { value: 'image/webp', label: 'WebP' },
          ]}
        />
        {settings.format !== 'image/png' && (
          <Field label="품질" aside={`${settings.quality}`} hint={settings.format === 'image/jpeg' ? '투명한 부분은 흰색으로 채워집니다.' : undefined}>
            {(id) => <Slider id={id} min={40} max={100} step={5} value={settings.quality} onValue={(quality) => set({ quality })} />}
          </Field>
        )}
        <Field label="파일 이름" hint={<span className="num">{pieceName(base, 0, Math.max(1, rects.length), ext)} 부터 순서대로</span>}>
          {(id) => <TextInput id={id} value={nameBase} onChange={(e) => setNameBase(e.target.value)} placeholder="사진" maxLength={80} disabled={!src} />}
        </Field>
        {saveError && (
          <Callout tone="danger" title="저장하지 못했습니다">
            {saveError}
          </Callout>
        )}
        {outUnsafe && !saveError && (
          <Callout tone="warn" title="너무 큰 조각이 있습니다">
            한 조각이 브라우저가 만들 수 있는 크기를 넘습니다. 전체 크기를 줄이거나 더 잘게 나눠 주세요.
          </Callout>
        )}
        {busy ? (
          <div className="flex flex-col gap-2">
            <Progress value={(progress.done / Math.max(1, progress.total)) * 100} label={`조각 만드는 중 ${progress.done}/${progress.total}`} />
            <Button icon={X} onClick={abort}>
              취소
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="lg" block icon={FileArchive} disabled={!src || outUnsafe || Boolean(customWidthError)} onClick={saveZip}>
              ZIP 으로 저장{src ? ` (${rects.length}조각)` : ''}
            </Button>
            <SendToMenu exclude="split" label="조각을 다른 도구로 보내기" disabled={!src || outUnsafe || Boolean(customWidthError)} files={renderAll} />
          </div>
        )}
      </Section>
    </>
  )

  return (
    <ToolLayout panel={panel}>
      {loadError && (
        <Callout tone="danger" title="사진을 열지 못했습니다">
          {loadError}
        </Callout>
      )}
      {!src ? (
        <Dropzone accept="image/*" multiple={false} onFiles={load} disabled={loading} title={loading ? '사진을 여는 중입니다' : '나눌 사진 한 장을 끌어다 놓으세요'} hint={`JPG·PNG·WebP · 한 장 ${formatBytes(MAX_FILE_BYTES)} 이하 · Ctrl+V 로 붙여넣기`} icon={Scissors} />
      ) : (
        <>
          <Dropzone
            compact
            accept="image/*"
            multiple={false}
            onFiles={load}
            disabled={loading || busy}
            title={src.file.name}
            hint={<span className="num">{fmt.format(src.width)}×{fmt.format(src.height)}px · {formatBytes(src.file.size)} · 다른 사진을 놓으면 바뀝니다</span>}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-2">
              <span className="num font-bold">{rects.length}조각</span>
              <span className="text-muted"> · 세로선 {cuts.x.length}개, 가로선 {cuts.y.length}개</span>
            </p>
            <Segmented
              label="미리보기 크기"
              size="sm"
              value={view}
              onValue={setView}
              options={[
                { value: 'fit', label: '한눈에 보기' },
                { value: 'width', label: '크게 보기' },
              ]}
            />
          </div>
          <Stage minHeight={320} className="p-4!">
            <div ref={frame} className={clsx('flex w-full justify-center', view === 'width' && 'max-h-[72dvh] overflow-y-auto overflow-x-hidden')}>
              {previewUrl && display.w > 0 && (
                <div ref={imageBox} className="checker relative shrink-0 select-none shadow-2" style={{ width: display.w, height: display.h }}>
                  <img src={previewUrl} alt="나눌 사진 미리보기" draggable={false} className="block size-full" />
                  {rects.map((r) => (
                    <span
                      key={r.index}
                      className="num pointer-events-none absolute z-[5] m-1 rounded-xs bg-ink/80 px-1.5 py-0.5 text-2xs font-bold leading-none text-paper"
                      style={{ left: `${(r.x / out.width) * 100}%`, top: `${(r.y / out.height) * 100}%` }}
                    >
                      {r.index + 1}
                    </span>
                  ))}
                  {cuts.y.map((pos, i) => (
                    <Divider key={`y${i}`} axis="y" pos={pos} total={out.height} label={`가로 분할선 ${i + 1}`} disabled={busy} onMove={(p) => moveLine('y', i, p)} getRect={() => imageBox.current?.getBoundingClientRect() ?? null} />
                  ))}
                  {cuts.x.map((pos, i) => (
                    <Divider key={`x${i}`} axis="x" pos={pos} total={out.width} label={`세로 분할선 ${i + 1}`} disabled={busy} onMove={(p) => moveLine('x', i, p)} getRect={() => imageBox.current?.getBoundingClientRect() ?? null} />
                  ))}
                </div>
              )}
            </div>
          </Stage>
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h3 className="text-sm font-bold text-ink">조각 목록</h3>
              <span className="text-sm text-muted">필요한 조각만 따로 저장할 수 있습니다</span>
            </div>
            {rects.length <= 1 ? (
              <EmptyState title="아직 나뉘지 않았습니다">오른쪽에서 조각 수나 간격을 정하면 조각이 여기에 나옵니다.</EmptyState>
            ) : (
              <div className="max-h-80 overflow-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead className="sticky top-0 bg-paper text-left text-muted">
                    <tr>
                      <th className="w-14 px-4 py-2 font-semibold">번호</th>
                      <th className="px-2 py-2 font-semibold">파일 이름</th>
                      <th className="px-2 py-2 text-right font-semibold">크기</th>
                      <th className="w-14 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rects.map((r) => (
                      <tr key={r.index} className="border-t border-line hover:bg-sunken">
                        <td className="num px-4 py-1.5 text-muted">{r.index + 1}</td>
                        <td className="px-2 py-1.5 text-ink">{pieceName(base, r.index, rects.length, ext)}</td>
                        <td className="num whitespace-nowrap px-2 py-1.5 text-right text-ink-2">
                          {fmt.format(r.w)}×{fmt.format(r.h)}px
                        </td>
                        <td className="px-2 py-1 text-right">
                          <IconButton icon={Download} size="sm" label={`${r.index + 1}번 조각 저장`} disabled={busy || !isCanvasSizeSafe(r.w, r.h)} onClick={() => saveOne(r)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </ToolLayout>
  )
}
