import { Download, Film, X } from 'lucide-react'
import { useState } from 'react'
import { blobToFile, downloadBlob, downloadZip, formatBytes, sanitizeFilename } from '@/lib/files'
import { useAbortable, usePersistentState } from '@/lib/hooks'
import { Button, Callout, Field, Progress, Section, Segmented, Select, SendToMenu, Switch, toast } from '@/ui'
import type { AssetStore } from './assets'
import { canEncodeMp4, exportMotion, exportStills, isAbort, type ExportJob, type OutFile, type StillFormat, type StillOptions } from './exporters'
import { outputSize, type CanvasDoc, type PageDoc } from './model'
import { Num, Range } from './parts'

interface ExportSettings {
  format: StillFormat
  scope: 'current' | 'all'
  bundle: 'zip' | 'each' | 'long'
  scale: '1' | '2'
  transparent: boolean
  quality: number
  motion: 'gif' | 'mp4'
  pageSeconds: number
  fadeSeconds: number
  maxSide: 'full' | '1280' | '720' | '480'
  loop: boolean
}

const DEFAULTS: ExportSettings = { format: 'png', scope: 'all', bundle: 'zip', scale: '1', transparent: false, quality: 92, motion: 'gif', pageSeconds: 2, fadeSeconds: 0.4, maxSide: '720', loop: true }

export interface ExportPanelProps {
  /** 내보내기 직전에 최신 문서를 돌려준다(아직 기록되지 않은 변경까지 반영). */
  getDoc: () => { doc: CanvasDoc; page: PageDoc; name: string }
  doc: CanvasDoc
  assets: AssetStore
}

export function ExportPanel({ getDoc, doc, assets }: ExportPanelProps) {
  const [s, setS] = usePersistentState<ExportSettings>('onbijjang:template:export', DEFAULTS)
  const set = (patch: Partial<ExportSettings>) => setS((prev) => ({ ...prev, ...patch }))
  const [busy, setBusy] = useState<null | { label: string; percent: number }>(null)
  const [last, setLast] = useState<string | null>(null)
  const task = useAbortable()

  const many = doc.pages.length > 1 && s.scope === 'all'
  const scale = s.scale === '2' ? 2 : 1
  const canTransparent = s.format === 'png' || s.format === 'webp'
  const hasQuality = s.format !== 'png'
  const bundle = s.format === 'pdf' ? (s.bundle === 'long' ? 'long' : 'each') : s.bundle
  const mp4Ready = canEncodeMp4()
  const motionSize = outputSize(doc.width, doc.height, s.maxSide === 'full' ? (s.motion === 'mp4' ? 1920 : null) : Number(s.maxSide), s.motion === 'mp4')

  const makeJob = (label: string, scope: 'current' | 'all'): ExportJob => {
    const cur = getDoc()
    return {
      doc: cur.doc,
      pages: scope === 'all' ? cur.doc.pages : [cur.page],
      name: cur.name,
      assets,
      signal: task.start(),
      onProgress: (percent) => setBusy({ label, percent }),
    }
  }

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy({ label, percent: 0 })
    setLast(null)
    try {
      await work()
    } catch (err) {
      if (isAbort(err)) toast.info('내보내기를 취소했습니다.')
      else toast.error(err instanceof Error ? err.message : '내보내지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  const stillOptions = (scope: 'current' | 'all', format: StillFormat = s.format): StillOptions => ({ format, scale, transparent: s.transparent && canTransparent, quality: s.quality / 100, long: scope === 'all' && bundle === 'long' })

  const saveStills = () =>
    run('그림을 만드는 중', async () => {
      const job = makeJob('그림을 만드는 중', s.scope)
      const files: OutFile[] = await exportStills(job, stillOptions(s.scope))
      const total = files.reduce((sum, f) => sum + f.blob.size, 0)
      if (files.length === 1) {
        downloadBlob(files[0].blob, files[0].name)
        setLast(`${files[0].name} · ${formatBytes(total)}`)
      } else if (bundle === 'each') {
        for (const f of files) {
          downloadBlob(f.blob, f.name)
          await new Promise((r) => setTimeout(r, 150))
        }
        setLast(`${files.length}개 파일 · ${formatBytes(total)}`)
      } else {
        const zipName = `${sanitizeFilename(job.name, '디자인')}.zip`
        await downloadZip(
          files.map((f) => ({ name: f.name, data: f.blob })),
          zipName,
        )
        setLast(`${zipName} · ${files.length}장 · ${formatBytes(total)}`)
      }
      toast.success('저장했습니다.')
    })

  const saveMotion = () =>
    run(s.motion === 'gif' ? 'GIF 를 만드는 중' : 'MP4 를 만드는 중', async () => {
      const job = makeJob(s.motion === 'gif' ? 'GIF 를 만드는 중' : 'MP4 를 만드는 중', 'all')
      const file = await exportMotion(job, {
        format: s.motion,
        pageSeconds: Math.max(0.2, Math.min(60, s.pageSeconds)),
        fadeSeconds: s.fadeSeconds,
        maxSide: s.maxSide === 'full' ? (s.motion === 'mp4' ? 1920 : null) : Number(s.maxSide),
        loop: s.loop,
      })
      downloadBlob(file.blob, file.name)
      setLast(`${file.name} · ${formatBytes(file.blob.size)}`)
      toast.success('저장했습니다.')
    })

  const saveLabel = s.format === 'pdf' ? 'PDF 로 저장' : many && bundle === 'zip' ? 'ZIP 으로 저장' : many && bundle === 'each' ? `${doc.pages.length}장 따로 저장` : `${s.format.toUpperCase()} 로 저장`

  return (
    <>
      <Section title="그림·문서로 저장">
        <Segmented
          label="파일 형식"
          size="sm"
          block
          value={s.format}
          onValue={(format) => set({ format })}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
            { value: 'webp', label: 'WebP' },
            { value: 'pdf', label: 'PDF' },
          ]}
        />
        {doc.pages.length > 1 && (
          <Segmented
            label="내보낼 페이지"
            size="sm"
            block
            value={s.scope}
            onValue={(scope) => set({ scope })}
            options={[
              { value: 'all', label: `모든 페이지 (${doc.pages.length})` },
              { value: 'current', label: '지금 페이지만' },
            ]}
          />
        )}
        {many && (
          <Field label="여러 페이지는" hint={bundle === 'long' ? '페이지를 위에서 아래로 이어 붙입니다.' : undefined}>
            {(id) =>
              s.format === 'pdf' ? (
                <Select
                  id={id}
                  value={bundle === 'long' ? 'long' : 'each'}
                  onValue={(v) => set({ bundle: v })}
                  options={[
                    { value: 'each', label: '페이지마다 한 쪽씩' },
                    { value: 'long', label: '긴 한 쪽으로 잇기' },
                  ]}
                />
              ) : (
                <Select
                  id={id}
                  value={s.bundle}
                  onValue={(v) => set({ bundle: v })}
                  options={[
                    { value: 'zip', label: 'ZIP 하나로 묶기' },
                    { value: 'each', label: '파일로 따로 저장' },
                    { value: 'long', label: '긴 한 장으로 잇기' },
                  ]}
                />
              )
            }
          </Field>
        )}
        <Field label="크기" aside={`${doc.width * scale} × ${doc.height * scale * (many && bundle === 'long' ? doc.pages.length : 1)}px`}>
          {() => (
            <Segmented
              label="배율"
              size="sm"
              block
              value={s.scale}
              onValue={(v) => set({ scale: v })}
              options={[
                { value: '1', label: '1× 그대로' },
                { value: '2', label: '2× 선명하게' },
              ]}
            />
          )}
        </Field>
        {canTransparent && <Switch checked={s.transparent} onChange={(transparent) => set({ transparent })} label="배경 없이 저장" hint="페이지 배경색을 빼고 투명하게 저장합니다." />}
        {hasQuality && <Range label="화질" value={s.quality} min={50} max={100} format={(v) => `${v}%`} onValue={(quality) => set({ quality })} />}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={Download} disabled={!!busy} onClick={saveStills}>
            {saveLabel}
          </Button>
          <SendToMenu
            exclude="template"
            size="md"
            label="다른 도구로"
            disabled={!!busy}
            files={async () => {
              const cur = getDoc()
              const scope = s.scope === 'all' ? 'all' : 'current'
              const job: ExportJob = { doc: cur.doc, pages: scope === 'all' ? cur.doc.pages : [cur.page], name: cur.name, assets, signal: new AbortController().signal, onProgress: () => {} }
              const files = await exportStills(job, stillOptions(scope, s.format === 'pdf' ? 'png' : s.format))
              return files.map((f) => blobToFile(f.blob, f.name))
            }}
          />
        </div>
      </Section>

      <Section title="움직이는 파일로 저장" hint="페이지를 순서대로 넘기는 GIF·MP4 를 만듭니다. 객체의 ‘등장 효과’도 함께 들어갑니다.">
        <Segmented
          label="움직이는 파일 형식"
          size="sm"
          block
          value={s.motion}
          onValue={(motion) => set({ motion })}
          options={[
            { value: 'gif', label: 'GIF' },
            { value: 'mp4', label: 'MP4' },
          ]}
        />
        {s.motion === 'mp4' && !mp4Ready && (
          <Callout tone="warn" title="이 브라우저에서는 MP4 를 만들 수 없습니다">
            크롬이나 엣지 최신 버전에서 열거나 GIF 로 저장해 주세요.
          </Callout>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Num label="페이지당 시간" unit="초" min={0.2} max={60} step={0.5} value={s.pageSeconds} onCommit={(pageSeconds) => set({ pageSeconds })} />
          <Field label="크기" aside={`${motionSize.width}×${motionSize.height}`}>
            {(id) => (
              <Select
                id={id}
                value={s.maxSide}
                onValue={(maxSide) => set({ maxSide })}
                options={[
                  { value: 'full', label: s.motion === 'mp4' ? '원본(최대 1920)' : '원본 크기' },
                  { value: '1280', label: '긴 변 1280' },
                  { value: '720', label: '긴 변 720' },
                  { value: '480', label: '긴 변 480' },
                ]}
              />
            )}
          </Field>
        </div>
        <Range label="넘어갈 때 겹치기" value={s.fadeSeconds} min={0} max={1.5} step={0.1} format={(v) => (v > 0 ? `${v.toFixed(1)}초` : '없음')} onValue={(fadeSeconds) => set({ fadeSeconds })} />
        {s.motion === 'gif' && <Switch checked={s.loop} onChange={(loop) => set({ loop })} label="계속 반복" />}
        <Button icon={Film} disabled={!!busy || (s.motion === 'mp4' && !mp4Ready)} onClick={saveMotion}>
          {s.motion === 'gif' ? 'GIF 로 저장' : 'MP4 로 저장'}
        </Button>
      </Section>

      {(busy || last) && (
        <div className="sticky bottom-0 border-t border-line bg-surface px-4 py-3">
          {busy ? (
            <div className="flex items-end gap-3">
              <Progress className="flex-1" value={busy.percent} label={busy.label} />
              <Button size="sm" icon={X} onClick={task.abort}>
                취소
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted">
              마지막 저장: <span className="text-ink-2">{last}</span>
            </p>
          )}
        </div>
      )}
    </>
  )
}
