import { Download, FileArchive, Trash2, X } from 'lucide-react'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_WATERMARK, useTeamPresets, type WatermarkSettings } from '@/app/config'
import { useHandoffFiles } from '@/app/handoff'
import { blobToFile, downloadBlob, downloadZip, formatBytes, todayStamp, uniqueName } from '@/lib/files'
import { useAbortable, useDebounced, usePersistentState } from '@/lib/hooks'
import { fitWithin, isCanvasSizeSafe, loadBitmap, resizeCanvas } from '@/lib/image'
import { prepareWatermark } from '@/lib/watermark'
import { Button, Callout, Dropzone, Panel, Progress, SendToMenu, ToolLayout, toast } from '@/ui'
import { BatchPanel } from './BatchPanel'
import { DEFAULT_BATCH, EMPTY_EDITS, photoSeed, resolveBatch } from './geometry'
import { DEFAULT_EXPORT, encodeCanvas, isAbort, outputName, resolveExport, throwIfAborted } from './output'
import { PhotoCard, type GridSettings } from './PhotoGrid'
import { ensureFonts, releaseCanvas, renderPhoto, type WatermarkDraw } from './render'
import { ResultStage } from './ResultStage'
import type { BatchSettings, EncodedResult, ExportSettings, Photo, PhotoEdits } from './types'

const Editor = lazy(() => import('./Editor'))

const MAX_PHOTOS = 100
const MAX_FILE_BYTES = 40 * 1024 * 1024
const PREVIEW_SIDE = 512

let seq = 0
const newPhotoId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`

/** 원본 크기를 알아내고 작은 미리보기를 만든 뒤 큰 비트맵은 바로 놓아준다. */
async function decodePhoto(file: File): Promise<Pick<Photo, 'status' | 'width' | 'height' | 'preview' | 'error'>> {
  try {
    const bmp = await loadBitmap(file)
    try {
      if (!isCanvasSizeSafe(bmp.width, bmp.height)) {
        return { status: 'error', width: bmp.width, height: bmp.height, preview: null, error: '사진이 너무 큽니다. 가로·세로 16,384px, 1억 2천만 화소까지 됩니다.' }
      }
      const fit = fitWithin(bmp.width, bmp.height, PREVIEW_SIDE)
      return { status: 'ready', width: bmp.width, height: bmp.height, preview: resizeCanvas(bmp, fit.width, fit.height) }
    } finally {
      bmp.close()
    }
  } catch (err) {
    return { status: 'error', width: 0, height: 0, preview: null, error: err instanceof Error ? err.message : '이미지를 열 수 없습니다.' }
  }
}

interface Processed {
  photo: Photo
  name: string
  enc: EncodedResult
}

interface Summary {
  count: number
  before: number
  after: number
  over: number
  shrunk: number
  failed: number
}

export default function ImageTool() {
  const team = useTeamPresets()
  const [batch, setBatch] = usePersistentState<BatchSettings>('onbijjang:image:batch', DEFAULT_BATCH)
  const [watermark, setWatermark] = usePersistentState<WatermarkSettings>('onbijjang:image:watermark', DEFAULT_WATERMARK)
  const [exp, setExp] = usePersistentState<ExportSettings>('onbijjang:image:export', DEFAULT_EXPORT)
  const [shuffle, setShuffle] = useState(1)

  const [photos, setPhotos] = useState<Photo[]>([])
  const photosRef = useRef<Photo[]>([])
  const update = useCallback((fn: (list: Photo[]) => Photo[]) => {
    photosRef.current = fn(photosRef.current)
    setPhotos(photosRef.current)
  }, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [job, setJob] = useState<{ done: number; total: number; label: string } | null>(null)
  const [saved, setSaved] = useState<{ stamp: object; bytes: Record<string, { edits: PhotoEdits; bytes: number }> } | null>(null)
  const [summary, setSummary] = useState<{ stamp: object; data: Summary } | null>(null)
  const abortable = useAbortable()

  // ── 설정을 그릴 수 있는 값으로 ──
  const resolved = useMemo(() => resolveBatch(batch), [batch])
  const resolvedExp = useMemo(() => resolveExport(exp), [exp])
  const gridBatch = useDebounced(resolved, 120)
  const wmSettled = useDebounced(watermark, 150)
  const [wmDraw, setWmDraw] = useState<WatermarkDraw | null>(null)
  useEffect(() => {
    if (!wmSettled.enabled) {
      setWmDraw(null)
      return
    }
    let alive = true
    prepareWatermark(wmSettled)
      .then((draw) => alive && setWmDraw(() => draw))
      .catch(() => {
        if (!alive) return
        setWmDraw(null)
        toast.error('워터마크 로고를 열지 못했습니다. 다른 이미지를 선택해 주세요.')
      })
    return () => {
      alive = false
    }
  }, [wmSettled])
  const gridSettings: GridSettings = useMemo(() => ({ batch: gridBatch, watermark: wmDraw, shuffle }), [gridBatch, wmDraw, shuffle])
  /** 결과에 영향을 주는 설정이 바뀌면 새 표식이 된다(지난 저장 결과를 감춘다). */
  const stamp = useMemo(() => ({}), [resolved, resolvedExp, watermark, shuffle])

  // ── 사진 넣기 ──
  const addFiles = useCallback(
    (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/'))
      const tooBig = images.filter((f) => f.size > MAX_FILE_BYTES)
      const ok = images.filter((f) => f.size <= MAX_FILE_BYTES)
      const room = Math.max(0, MAX_PHOTOS - photosRef.current.length)
      const accepted = ok.slice(0, room)
      if (images.length < files.length) toast.warn(`이미지가 아닌 파일 ${files.length - images.length}개는 넣지 않았습니다.`)
      if (tooBig.length) toast.warn(`한 장 40MB 를 넘는 사진 ${tooBig.length}장은 넣지 않았습니다.`)
      if (ok.length > accepted.length) toast.warn(`한 번에 ${MAX_PHOTOS}장까지 다룰 수 있습니다. ${ok.length - accepted.length}장은 넣지 않았습니다.`)
      if (!accepted.length) return
      const items: Photo[] = accepted.map((file) => ({ id: newPhotoId(), file, name: file.name, bytes: file.size, status: 'pending', width: 0, height: 0, preview: null, edits: EMPTY_EDITS }))
      update((list) => [...list, ...items])
      setSelectedId((cur) => cur ?? items[0].id)
    },
    [update],
  )
  useHandoffFiles('image', addFiles)

  // ── 차례로 읽기(동시에 두 장) ──
  const decoding = useRef(new Set<string>())
  const mounted = useRef(true)
  const pump = useCallback(() => {
    while (decoding.current.size < 2) {
      const next = photosRef.current.find((p) => p.status === 'pending' && !decoding.current.has(p.id))
      if (!next) break
      decoding.current.add(next.id)
      void decodePhoto(next.file).then((patch) => {
        decoding.current.delete(next.id)
        if (!mounted.current) return releaseCanvas(patch.preview)
        if (photosRef.current.some((p) => p.id === next.id)) update((list) => list.map((p) => (p.id === next.id ? { ...p, ...patch } : p)))
        else releaseCanvas(patch.preview)
        pump()
      })
    }
  }, [update])
  useEffect(() => {
    pump()
  }, [photos, pump])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const p of photosRef.current) releaseCanvas(p.preview)
    }
  }, [])

  // ── 목록 조작 ──
  const selected = photos.find((p) => p.id === selectedId) ?? photos[0] ?? null
  const editing = photos.find((p) => p.id === editingId && p.status === 'ready') ?? null
  const remove = useCallback(
    (id: string) => {
      const list = photosRef.current
      const i = list.findIndex((p) => p.id === id)
      if (i < 0) return
      releaseCanvas(list[i].preview)
      update((l) => l.filter((p) => p.id !== id))
      setSelectedId((cur) => (cur === id ? (list[i + 1]?.id ?? list[i - 1]?.id ?? null) : cur))
    },
    [update],
  )
  const move = useCallback(
    (id: string, dir: -1 | 1) => {
      update((list) => {
        const i = list.findIndex((p) => p.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= list.length) return list
        const next = [...list]
        ;[next[i], next[j]] = [next[j], next[i]]
        return next
      })
    },
    [update],
  )
  const reorder = useCallback(
    (dragId: string, targetId: string) => {
      update((list) => {
        const from = list.findIndex((p) => p.id === dragId)
        const to = list.findIndex((p) => p.id === targetId)
        if (from < 0 || to < 0 || from === to) return list
        const next = [...list]
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        return next
      })
    },
    [update],
  )
  const clearAll = () => {
    abortable.abort()
    for (const p of photosRef.current) releaseCanvas(p.preview)
    update(() => [])
    setSelectedId(null)
    setSaved(null)
    setSummary(null)
  }
  const openEditor = useCallback((id: string) => setEditingId(id), [])
  const select = useCallback((id: string) => setSelectedId(id), [])

  // ── 저장 ──
  const usable = photos.filter((p) => p.status !== 'error')
  const nameOf = (photo: Photo) => outputName(photo.name, Math.max(0, usable.indexOf(photo)), exp, { team: team.filename })

  /** 모든 사진을 차례로 원본 해상도에서 만들어 인코딩한다. 한 장씩 처리하고 바로 놓아줘 메모리를 아낀다. */
  const processAll = async (label: string): Promise<Processed[]> => {
    const list = photosRef.current.filter((p) => p.status !== 'error')
    if (!list.length) throw new Error('저장할 사진이 없습니다.')
    const signal = abortable.start()
    setJob({ done: 0, total: list.length, label })
    setSummary(null)
    const out: Processed[] = []
    const used = new Set<string>()
    let failed = 0
    try {
      const draw = watermark.enabled ? await prepareWatermark(watermark) : null
      for (let i = 0; i < list.length; i++) {
        throwIfAborted(signal)
        const photo = list[i]
        try {
          const bmp = await loadBitmap(photo.file)
          let canvas: HTMLCanvasElement
          try {
            await ensureFonts(photo.edits)
            canvas = renderPhoto({ image: bmp, width: bmp.width, height: bmp.height }, photo.edits, { batch: resolved, watermark: draw, seed: photoSeed(photo.id, shuffle) })
          } finally {
            bmp.close()
          }
          const enc = await encodeCanvas(canvas, resolvedExp, signal)
          releaseCanvas(canvas)
          out.push({ photo, name: uniqueName(outputName(photo.name, i, exp, { team: team.filename }), used), enc })
        } catch (err) {
          if (isAbort(err)) throw err
          failed++
        }
        setJob({ done: i + 1, total: list.length, label })
        await new Promise((r) => setTimeout(r, 0))
      }
    } finally {
      setJob(null)
    }
    if (!out.length) throw new Error('사진을 한 장도 만들지 못했습니다. 다른 형식으로 다시 넣어 주세요.')
    setSaved({ stamp, bytes: Object.fromEntries(out.map((r) => [r.photo.id, { edits: r.photo.edits, bytes: r.enc.blob.size }])) })
    setSummary({
      stamp,
      data: {
        count: out.length,
        before: out.reduce((s, r) => s + r.photo.bytes, 0),
        after: out.reduce((s, r) => s + r.enc.blob.size, 0),
        over: out.filter((r) => r.enc.over).length,
        shrunk: out.filter((r) => r.enc.scale < 1).length,
        failed,
      },
    })
    return out
  }

  const run = async (kind: 'zip' | 'each') => {
    try {
      const files = await processAll(kind === 'zip' ? 'ZIP 으로 묶는 중' : '저장할 사진을 만드는 중')
      if (kind === 'zip') {
        await downloadZip(files.map((f) => ({ name: f.name, data: f.enc.blob })), `이미지편집_${todayStamp()}_${files.length}장.zip`)
        toast.success(`${files.length}장을 ZIP 으로 저장했습니다.`)
      } else {
        for (const f of files) {
          downloadBlob(f.enc.blob, f.name)
          await new Promise((r) => setTimeout(r, 180))
        }
        toast.success(`${files.length}장을 저장했습니다.`)
      }
    } catch (err) {
      if (isAbort(err)) toast.info('저장을 취소했습니다.')
      else toast.error(err instanceof Error ? err.message : '저장하지 못했습니다.')
    }
  }
  const filesForSend = async () => (await processAll('보낼 사진을 만드는 중')).map((f) => blobToFile(f.enc.blob, f.name))

  const busy = job !== null
  const pending = photos.filter((p) => p.status === 'pending').length
  const errored = photos.length - usable.length
  const totalBytes = photos.reduce((s, p) => s + p.bytes, 0)
  const sum = summary?.stamp === stamp ? summary.data : null
  const savedBytes = saved?.stamp === stamp ? saved.bytes : null

  return (
    <ToolLayout
      panel={
        <BatchPanel
          batch={batch}
          resolved={resolved}
          onBatch={(patch) => setBatch((b) => ({ ...b, ...patch }))}
          watermark={watermark}
          onWatermark={setWatermark}
          exp={exp}
          onExport={(patch) => setExp((e) => ({ ...e, ...patch }))}
          onShuffle={() => setShuffle((n) => n + 1)}
          onResetAll={() => {
            setBatch(DEFAULT_BATCH)
            setExp(DEFAULT_EXPORT)
            setWatermark(DEFAULT_WATERMARK)
            toast.info('설정을 처음 상태로 되돌렸습니다.')
          }}
          team={team}
          sampleName={usable[0]?.name ?? '사진.jpg'}
        />
      }
    >
      <Dropzone
        accept="image/*"
        onFiles={addFiles}
        compact={photos.length > 0}
        disabled={busy}
        title={photos.length ? '사진 더 넣기' : '편집할 사진을 끌어다 놓으세요'}
        hint={photos.length ? `${photos.length}/${MAX_PHOTOS}장 · 끌어놓기·붙여넣기(Ctrl+V)도 됩니다` : `JPG·PNG·WebP · 한 장 40MB 이하 · 최대 ${MAX_PHOTOS}장 · 붙여넣기(Ctrl+V)도 됩니다`}
      />

      {selected && (
        <ResultStage
          photo={selected}
          batch={resolved}
          watermark={wmDraw}
          shuffle={shuffle}
          exp={resolvedExp}
          fileName={nameOf(selected)}
          busy={busy}
          onEdit={() => setEditingId(selected.id)}
          onAllowShrink={() => setExp((e) => ({ ...e, shrinkToFit: true }))}
        />
      )}

      {photos.length > 0 && (
        <Panel className="flex flex-col gap-3 p-3">
          {job ? (
            <div className="flex items-end gap-3">
              <Progress className="flex-1" value={(job.done / job.total) * 100} label={`${job.label} · ${job.done}/${job.total}장`} />
              <Button size="sm" icon={X} onClick={abortable.abort}>
                취소
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="num text-sm text-ink-2">
                사진 <span className="font-bold text-ink">{usable.length}장</span> · 원본 {formatBytes(totalBytes)}
                {pending > 0 && <span className="text-muted"> · {pending}장 읽는 중</span>}
                {errored > 0 && <span className="text-danger"> · {errored}장은 열 수 없어 제외</span>}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" icon={FileArchive} disabled={!usable.length} onClick={() => run('zip')}>
                  ZIP 으로 저장
                </Button>
                <Button icon={Download} disabled={!usable.length} onClick={() => run('each')}>
                  한 장씩 저장
                </Button>
                <SendToMenu exclude="image" label="모두 다른 도구로" disabled={!usable.length} files={filesForSend} />
              </div>
            </div>
          )}
          {sum && (
            <Callout tone={sum.over ? 'warn' : 'success'} title={`${sum.count}장 완료 · ${formatBytes(sum.before)} → ${formatBytes(sum.after)}${sum.after < sum.before ? ` (${Math.floor((1 - sum.after / sum.before) * 100)}% 줄어듦)` : ''}`}>
              {sum.failed > 0 && <p>{sum.failed}장은 열지 못해 빠졌습니다.</p>}
              {sum.shrunk > 0 && <p>{sum.shrunk}장은 목표 용량에 맞추려고 크기를 줄였습니다.</p>}
              {sum.over > 0 && (
                <>
                  <p>
                    {sum.over}장은 {resolvedExp.format === 'image/png' ? 'PNG 라서 품질을 낮출 수 없어' : '품질을 가장 낮춰도'} 목표 용량 {resolvedExp.maxBytes ? formatBytes(resolvedExp.maxBytes) : ''} 를 넘습니다.
                    {exp.shrinkToFit ? ' 목표 용량을 조금 올려 주세요.' : ' 크기를 줄이면 맞출 수 있습니다.'}
                  </p>
                  {!exp.shrinkToFit && (
                    <Button size="sm" className="mt-2" onClick={() => setExp((e) => ({ ...e, shrinkToFit: true }))}>
                      넘는 사진은 크기를 줄여서 맞추기
                    </Button>
                  )}
                </>
              )}
            </Callout>
          )}
        </Panel>
      )}

      {photos.length > 0 && (
        <Panel className="flex flex-col gap-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-ink">사진 목록</h3>
              <p className="text-sm text-muted">누르면 위에 결과가 보입니다. 끌어서 순서를 바꾸고, 두 번 누르면 정밀 편집이 열립니다.</p>
            </div>
            <Button size="sm" variant="danger" icon={Trash2} disabled={busy} onClick={clearAll}>
              모두 빼기
            </Button>
          </div>
          <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2.5 p-0">
            {photos.map((photo, i) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                index={i}
                total={photos.length}
                selected={photo.id === selected?.id}
                settings={gridSettings}
                savedBytes={savedBytes?.[photo.id]?.edits === photo.edits ? savedBytes[photo.id].bytes : undefined}
                disabled={busy}
                onSelect={select}
                onEdit={openEditor}
                onRemove={remove}
                onMove={move}
                onReorder={reorder}
              />
            ))}
          </ul>
        </Panel>
      )}

      {editing && (
        <Suspense fallback={null}>
          <Editor
            key={editing.id}
            photo={editing}
            onApply={(edits) => update((list) => list.map((p) => (p.id === editing.id ? { ...p, edits } : p)))}
            onClose={() => setEditingId(null)}
          />
        </Suspense>
      )}
    </ToolLayout>
  )
}
