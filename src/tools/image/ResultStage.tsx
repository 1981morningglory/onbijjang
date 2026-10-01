import { ArrowRight, Download, SquarePen } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { blobToFile, downloadBlob, formatBytes } from '@/lib/files'
import { useObjectUrl } from '@/lib/hooks'
import { ctx2d, loadBitmap } from '@/lib/image'
import { Button, Callout, SendToMenu, Spinner, Stage } from '@/ui'
import { photoSeed, plannedSize } from './geometry'
import { FORMAT_LABEL, encodeCanvas, type ResolvedExport } from './output'
import { ensureFonts, releaseCanvas, renderPhoto, type WatermarkDraw } from './render'
import type { EncodedResult, Photo, ResolvedBatch } from './types'

export interface ResultStageProps {
  photo: Photo
  batch: ResolvedBatch
  watermark: WatermarkDraw | null
  shuffle: number
  exp: ResolvedExport
  /** 이 사진이 저장될 파일 이름 */
  fileName: string
  busy: boolean
  onEdit: () => void
  /** "크기를 줄여서 맞추기" */
  onAllowShrink: () => void
}

const MAX_VIEW_H = 440

/**
 * 고른 사진의 결과 미리보기. 설정을 바꾸면 작은 미리보기로 바로 반응하고,
 * 잠시 뒤 원본 해상도로 실제 저장본을 만들어 크기·용량을 보여 준다.
 */
export function ResultStage({ photo, batch, watermark, shuffle, exp, fileName, busy, onEdit, onAllowShrink }: ResultStageProps) {
  const quickRef = useRef<HTMLCanvasElement>(null)
  const cache = useRef<{ id: string; bitmap: ImageBitmap } | null>(null)
  const [exact, setExact] = useState<{ stamp: object; result: EncodedResult } | null>(null)
  const [error, setError] = useState<{ stamp: object; message: string } | null>(null)
  const seed = photoSeed(photo.id, shuffle)
  const ready = photo.status === 'ready'

  // 그림에 영향을 주는 값이 바뀔 때마다 새 표식을 만든다.
  const drawStamp = useMemo(() => ({}), [photo.id, photo.edits, photo.preview, batch, watermark, shuffle])
  const stamp = useMemo(() => ({}), [drawStamp, exp])
  const current = exact?.stamp === stamp ? exact.result : null
  const failure = error?.stamp === stamp ? error.message : null
  const url = useObjectUrl(current?.blob)

  // 바로 보이는 작은 미리보기
  useEffect(() => {
    const canvas = quickRef.current
    if (!canvas || !photo.preview || !photo.preview.width) return
    try {
      const out = renderPhoto({ image: photo.preview, width: photo.width, height: photo.height }, photo.edits, { batch, watermark, seed }, { maxSide: 640 })
      canvas.width = out.width
      canvas.height = out.height
      ctx2d(canvas).drawImage(out, 0, 0)
      releaseCanvas(out)
    } catch {
      // 정확한 결과 쪽에서 오류를 알려 준다.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawStamp])

  // 실제 저장본(원본 해상도) — 잠깐 기다렸다가 만든다.
  useEffect(() => {
    if (!ready) return
    let alive = true
    const timer = setTimeout(async () => {
      try {
        let entry = cache.current
        if (!entry || entry.id !== photo.id) {
          entry?.bitmap.close()
          cache.current = null
          const bitmap = await loadBitmap(photo.file)
          if (!alive) return bitmap.close()
          entry = cache.current = { id: photo.id, bitmap }
        }
        await ensureFonts(photo.edits)
        if (!alive) return
        const canvas = renderPhoto({ image: entry.bitmap, width: entry.bitmap.width, height: entry.bitmap.height }, photo.edits, { batch, watermark, seed })
        const result = await encodeCanvas(canvas, exp)
        releaseCanvas(canvas)
        if (alive) setExact({ stamp, result })
      } catch (err) {
        if (alive) setError({ stamp, message: err instanceof Error ? err.message : '결과를 만들지 못했습니다.' })
      }
    }, 350)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, ready])

  useEffect(
    () => () => {
      cache.current?.bitmap.close()
      cache.current = null
    },
    [],
  )

  const planned = ready ? plannedSize(photo.width, photo.height, photo.edits, batch, seed) : { width: 4, height: 3 }
  const outW = current?.width ?? planned.width
  const outH = current?.height ?? planned.height
  const viewW = Math.round(Math.min(outW, (MAX_VIEW_H * outW) / outH))
  const saving = current ? Math.floor((1 - current.blob.size / photo.bytes) * 100) : 0

  return (
    <Stage minHeight={300}>
      <div className="flex w-full flex-col items-center gap-3">
        {photo.status === 'error' ? (
          <Callout tone="danger" title="이 사진은 열 수 없습니다" className="max-w-md">
            {photo.error} 목록에서 빼고 다른 형식(JPG·PNG·WebP)으로 다시 넣어 주세요.
          </Callout>
        ) : !ready ? (
          <p className="flex items-center gap-2 py-16 text-sm">
            <Spinner /> 사진을 읽는 중
          </p>
        ) : (
          <div className="checker relative overflow-hidden shadow-3" style={{ width: `min(100%, ${viewW}px)`, aspectRatio: `${outW} / ${outH}` }}>
            <canvas ref={quickRef} className="absolute inset-0 size-full" />
            {url && current && <img src={url} alt={`${photo.name} 저장 결과 미리보기`} className="absolute inset-0 size-full" draggable={false} />}
          </div>
        )}

        <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md bg-surface px-3 py-2 text-ink shadow-1">
          <div className="min-w-0 flex-1 basis-56">
            <p className="truncate text-sm font-semibold" title={photo.name}>
              {photo.name}
            </p>
            {ready && (
              <p className="num flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
                <span>
                  원본 {photo.width}×{photo.height} · {formatBytes(photo.bytes)}
                </span>
                <ArrowRight className="size-3.5 shrink-0" aria-hidden />
                {current ? (
                  <span className="font-semibold text-brand-ink" data-testid="result-info">
                    저장 {current.width}×{current.height} · {formatBytes(current.blob.size)} · {FORMAT_LABEL[exp.format]}
                    {exp.format !== 'image/png' && ` 품질 ${Math.round(current.quality * 100)}`}
                    {saving > 0 && ` · ${saving}% 줄어듦`}
                  </span>
                ) : failure ? (
                  <span className="text-danger">계산하지 못함</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    저장 {planned.width}×{planned.height} · <Spinner className="size-3.5" /> 용량 계산 중
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={SquarePen} disabled={!ready || busy} onClick={onEdit}>
              정밀 편집
            </Button>
            <Button size="sm" icon={Download} disabled={!current || busy} onClick={() => current && downloadBlob(current.blob, fileName)}>
              이 사진 저장
            </Button>
            <SendToMenu size="sm" label="이 사진 보내기" exclude="image" disabled={!current || busy} files={current ? [blobToFile(current.blob, fileName)] : []} />
          </div>
        </div>

        {failure && (
          <Callout tone="danger" title="결과를 만들지 못했습니다" className="w-full">
            {failure}
          </Callout>
        )}
        {current?.over && exp.maxBytes != null && (
          <Callout tone="warn" title={`목표 용량 ${formatBytes(exp.maxBytes)} 를 넘습니다 (${formatBytes(current.blob.size)})`} className="w-full">
            <p>
              {exp.format === 'image/png'
                ? 'PNG 는 품질을 낮출 수 없습니다. JPG·WebP 로 바꾸거나 크기를 줄이면 맞출 수 있습니다.'
                : exp.shrinkToFit
                  ? '품질과 크기를 줄여도 맞추지 못했습니다. 목표 용량을 조금 올려 주세요.'
                  : '품질을 가장 낮춰도 넘습니다. 크기를 줄이면 맞출 수 있습니다.'}
            </p>
            {!exp.shrinkToFit && (
              <Button size="sm" className="mt-2" onClick={onAllowShrink}>
                크기를 줄여서 맞추기
              </Button>
            )}
          </Callout>
        )}
        {current && current.scale < 1 && !current.over && (
          <Callout tone="info" className="w-full">
            목표 용량에 맞추려고 크기를 {current.width}×{current.height} 로 줄였습니다.
          </Callout>
        )}
      </div>
    </Stage>
  )
}
