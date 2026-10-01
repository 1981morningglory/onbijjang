import clsx from 'clsx'
import { Download, FileArchive, ImageDown, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { footerText } from '../../../extension/capture/lib/plan.js'
import { useTeamPresets } from '@/app/config'
import { useHandoffFiles } from '@/app/handoff'
import { blobToFile, downloadBlob, downloadZip, formatBytes } from '@/lib/files'
import { fmt, useAbortable, usePersistentState } from '@/lib/hooks'
import { FORMAT_EXT, isCanvasSizeSafe, loadBitmap, type RasterFormat } from '@/lib/image'
import { Button, Callout, Dropzone, EmptyState, Field, NumberInput, Panel, Progress, Section, Segmented, SendToMenu, Slider, Stage, Switch, TextInput, ToolLayout, toast } from '@/ui'
import { CropBox } from './CropBox'
import { useExtensionHandover, type CaptureMeta } from './handover'
import { MIN_SPLIT_HEIGHT, NO_TRIM, baseNameOf, clampTrim, isTrimmed, outputName, splitByHeight, trimToRect, type Trim } from './logic'
import { encodePieces, piecesToPdf, renderPieces } from './render'

const MAX_FILE_BYTES = 80 * 1024 * 1024
const MAX_ITEMS = 20
const FALLBACK_HEIGHTS = [1000, 2000, 5000]

type SaveFormat = 'png' | 'jpg' | 'pdf'

interface Settings {
  splitOn: boolean
  splitHeight: number
  format: SaveFormat
  /** JPG·PDF 화질(50–100) */
  quality: number
  pdfA4: boolean
  footerOn: boolean
}

const DEFAULT_SETTINGS: Settings = { splitOn: false, splitHeight: 2000, format: 'png', quality: 92, pdfA4: true, footerOn: false }

interface Item {
  id: string
  file: File
  url: string
  w: number
  h: number
  trim: Trim
  /** 이미지 아래에 넣을 한 줄 */
  caption: string
}

let itemSeq = 0

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

/** 캡처 이미지 받기 → 자르기·나누기 → 저장. 확장 프로그램·끌어놓기·붙여넣기·다른 도구에서 받는다. */
export function Editor({ active, onReceived }: { active: boolean; onReceived: () => void }) {
  const [settings, setSettings] = usePersistentState<Settings>('onbijjang:capture:settings', DEFAULT_SETTINGS)
  const [items, setItems] = useState<Item[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<{ label: string; value: number | null } | null>(null)
  const { start, abort } = useAbortable()
  const presets = useTeamPresets()

  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))
  const current = items.find((i) => i.id === selectedId) ?? items[0] ?? null

  // 화면을 떠날 때 미리보기 주소를 정리한다.
  const itemsRef = useRef(items)
  itemsRef.current = items
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url)), [])

  const addFiles = useCallback(
    async (files: File[], meta?: CaptureMeta) => {
      onReceived()
      const added: Item[] = []
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          toast.warn(`${file.name}: 이미지 파일만 넣을 수 있습니다.`)
          continue
        }
        if (file.size > MAX_FILE_BYTES) {
          toast.error(`${file.name}: 한 장 ${formatBytes(MAX_FILE_BYTES)} 이하만 넣을 수 있습니다.`)
          continue
        }
        try {
          const bmp = await loadBitmap(file)
          const { width, height } = bmp
          bmp.close()
          if (!isCanvasSizeSafe(width, height)) {
            toast.error(`${file.name}: 이미지가 너무 큽니다(${fmt.format(width)} × ${fmt.format(height)}px). 한 변 16,384px, 전체 1억 2천만 화소까지 편집할 수 있습니다.`)
            continue
          }
          const caption = meta && (meta.url || meta.capturedAt) ? footerText(meta.url, meta.capturedAt ?? Date.now()) : ''
          added.push({ id: `c${Date.now().toString(36)}-${++itemSeq}`, file, url: URL.createObjectURL(file), w: width, h: height, trim: NO_TRIM, caption })
        } catch (err) {
          toast.error(`${file.name}: ${err instanceof Error ? err.message : '이미지를 열 수 없습니다.'}`)
        }
      }
      const room = Math.max(0, MAX_ITEMS - itemsRef.current.length)
      const kept = added.slice(0, room)
      if (added.length > room) {
        toast.warn(`한 번에 ${MAX_ITEMS}장까지 올려 둘 수 있어 ${added.length - room}장은 넣지 않았습니다.`)
        added.slice(room).forEach((i) => URL.revokeObjectURL(i.url))
      }
      if (!kept.length) return
      setItems((prev) => [...prev, ...kept])
      setSelectedId(kept[0].id)
      if (meta?.footer) setSettings((s) => ({ ...s, footerOn: true }))
    },
    [onReceived, setSettings],
  )

  useHandoffFiles('capture', (files) => void addFiles(files))
  const receiving = useExtensionHandover(
    (files, meta) => {
      void addFiles(files, meta)
      toast.success(files.length > 1 ? `확장 프로그램에서 캡처 ${files.length}장을 받았습니다.` : '확장 프로그램에서 캡처를 받았습니다.')
    },
    (reason) => toast.error(reason),
  )

  const patchCurrent = (patch: Partial<Item>) => {
    if (!current) return
    setItems((prev) => prev.map((i) => (i.id === current.id ? { ...i, ...patch } : i)))
  }
  const removeItem = (id: string) => {
    const gone = itemsRef.current.find((i) => i.id === id)
    if (gone) URL.revokeObjectURL(gone.url)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const rect = current ? trimToRect(current.trim, current.w, current.h) : null
  const splitHeight = Math.max(MIN_SPLIT_HEIGHT, Math.round(settings.splitHeight) || MIN_SPLIT_HEIGHT)
  // PDF 를 A4 쪽으로 나눌 때는 높이 기준 분할을 쓰지 않는다(쪽 나누기가 대신한다).
  const splitApplies = settings.splitOn && !(settings.format === 'pdf' && settings.pdfA4)
  const parts = useMemo(() => (rect && settings.splitOn ? splitByHeight(rect.h, splitHeight) : null), [rect?.h, settings.splitOn, splitHeight])
  const tooMany = Boolean(rect && settings.splitOn && !parts)
  const pieceCount = splitApplies && parts ? parts.length : 1
  const cuts = rect && settings.splitOn && parts ? parts.slice(1).map((p) => rect.y + p.y) : []
  const caption = settings.footerOn && current ? current.caption.trim() : ''

  const quickHeights = useMemo(() => {
    const fromTeam = [...new Set(presets.canvasSizes.map((s) => s.h).filter((h) => h >= MIN_SPLIT_HEIGHT))].slice(0, 4).sort((x, y) => x - y)
    return fromTeam.length ? fromTeam : FALLBACK_HEIGHTS
  }, [presets.canvasSizes])

  /** 지금 설정대로 결과 조각을 만든다. */
  const produce = (item: Item, signal?: AbortSignal, forPdfA4 = false) =>
    renderPieces(item.file, { trim: item.trim, splitHeight: settings.splitOn && !forPdfA4 ? splitHeight : null, footer: settings.footerOn ? item.caption : '' }, signal)

  const save = async (each: boolean) => {
    if (!current || busy) return
    const item = current
    const base = baseNameOf(item.file.name)
    const signal = start()
    setBusy({ label: '이미지를 만드는 중', value: null })
    try {
      if (settings.format === 'pdf') {
        const pieces = await produce(item, signal, settings.pdfA4)
        const { blob, pages } = await piecesToPdf(pieces, { a4: settings.pdfA4, quality: settings.quality / 100, title: base }, (done, total) => setBusy({ label: `PDF ${total}쪽 중 ${done}쪽`, value: (done / total) * 100 }), signal)
        downloadBlob(blob, `${base}_편집.pdf`)
        toast.success(`${pages}쪽 PDF 로 저장했습니다.`)
        return
      }
      const format: RasterFormat = settings.format === 'png' ? 'image/png' : 'image/jpeg'
      const ext = FORMAT_EXT[format]
      const pieces = await produce(item, signal)
      const blobs = await encodePieces(pieces, format, settings.quality / 100, (done, total) => setBusy({ label: `${total}장 중 ${done}장`, value: (done / total) * 100 }), signal)
      if (blobs.length === 1) {
        downloadBlob(blobs[0], outputName(base, 0, 1, ext))
        toast.success('저장했습니다.')
      } else if (each) {
        for (let i = 0; i < blobs.length; i++) {
          if (signal.aborted) throw new DOMException('취소했습니다.', 'AbortError')
          downloadBlob(blobs[i], outputName(base, i, blobs.length, ext))
          await new Promise((r) => setTimeout(r, 250))
        }
        toast.success(`${blobs.length}장을 저장했습니다. 브라우저가 여러 파일 저장을 물으면 허용해 주세요.`)
      } else {
        await downloadZip(blobs.map((blob, i) => ({ name: outputName(base, i, blobs.length, ext), data: blob })), `${base}_분할.zip`, (p) => setBusy({ label: 'ZIP 으로 묶는 중', value: p }))
        toast.success(`${blobs.length}장을 ZIP 으로 저장했습니다.`)
      }
    } catch (err) {
      if (isAbort(err)) toast.info('저장을 취소했습니다.')
      else toast.error(err instanceof Error ? err.message : '저장하지 못했습니다. 이미지가 너무 크면 나누는 높이를 줄여 보세요.')
    } finally {
      setBusy(null)
    }
  }

  /** 다른 도구로는 항상 PNG 로 넘긴다. */
  const filesForSend = async () => {
    if (!current) return []
    const base = baseNameOf(current.file.name)
    const pieces = await produce(current)
    const blobs = await encodePieces(pieces, 'image/png', 1)
    return blobs.map((blob, i) => blobToFile(blob, outputName(base, i, blobs.length, 'png')))
  }

  const setTrim = (patch: Partial<Trim>) => current && patchCurrent({ trim: clampTrim({ ...current.trim, ...patch }, current.w, current.h) })
  const trimField = (label: string, key: keyof Trim) => (
    <Field label={label}>{(id) => <NumberInput id={id} unit="px" min={0} step={1} value={current ? current.trim[key] : 0} onValue={(v) => setTrim({ [key]: v ?? 0 })} disabled={Boolean(busy)} />}</Field>
  )

  const saveLabel = settings.format === 'pdf' ? 'PDF 로 저장' : pieceCount > 1 ? `ZIP 으로 저장 (${pieceCount}장)` : settings.format === 'png' ? 'PNG 로 저장' : 'JPG 로 저장'

  const panel = current && rect ? (
    <>
      <Section
        title="자르기"
        hint="미리보기의 노란 틀을 끌거나, 잘라낼 만큼을 숫자로 적으세요."
        action={
          <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!isTrimmed(current.trim) || Boolean(busy)} onClick={() => patchCurrent({ trim: NO_TRIM })}>
            처음으로
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {trimField('위에서', 'top')}
          {trimField('아래에서', 'bottom')}
          {trimField('왼쪽에서', 'left')}
          {trimField('오른쪽에서', 'right')}
        </div>
        <p className="num text-sm text-muted">
          남는 크기 {fmt.format(rect.w)} × {fmt.format(rect.h)} px
        </p>
      </Section>

      <Section title="나누기">
        <Switch checked={settings.splitOn} onChange={(splitOn) => set({ splitOn })} label="높이 기준으로 나누기" hint="긴 캡처를 같은 높이로 잘라 여러 장으로 저장합니다." disabled={Boolean(busy)} />
        {settings.splitOn && (
          <>
            <Field label="한 장 높이" error={tooMany ? '조각이 200장을 넘습니다. 높이를 더 크게 정해 주세요.' : undefined}>
              {(id) => <NumberInput id={id} unit="px" min={MIN_SPLIT_HEIGHT} step={100} value={settings.splitHeight} onValue={(v) => set({ splitHeight: v ?? MIN_SPLIT_HEIGHT })} aria-invalid={tooMany || undefined} />}
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {quickHeights.map((hgt) => (
                <Button key={hgt} size="sm" variant={splitHeight === hgt ? 'secondary' : 'ghost'} className="num" aria-pressed={splitHeight === hgt} onClick={() => set({ splitHeight: hgt })}>
                  {fmt.format(hgt)}px
                </Button>
              ))}
            </div>
            {parts && (
              <p className="num text-sm text-muted">
                {parts.length}장으로 나뉩니다{parts.length > 1 ? ` · 마지막 장 ${fmt.format(parts[parts.length - 1].h)}px` : ''}
              </p>
            )}
            {settings.format === 'pdf' && settings.pdfA4 && <p className="text-sm text-muted">PDF 를 A4 쪽으로 나눌 때는 이 설정 대신 쪽 나누기를 따릅니다.</p>}
          </>
        )}
      </Section>

      <Section title="주소와 시각">
        <Switch checked={settings.footerOn} onChange={(footerOn) => set({ footerOn })} label="이미지 아래에 한 줄 넣기" hint="어디서 언제 캡처했는지 남깁니다." disabled={Boolean(busy)} />
        {settings.footerOn && (
          <Field label="넣을 문구" hint={current.caption.trim() ? undefined : '확장 프로그램으로 캡처한 이미지는 주소와 시각이 자동으로 채워집니다. 직접 적어도 됩니다.'}>
            {(id) => <TextInput id={id} value={current.caption} maxLength={300} placeholder="예: https://example.com · 2026-10-01 14:05 캡처" onChange={(e) => patchCurrent({ caption: e.target.value })} />}
          </Field>
        )}
      </Section>

      <Section title="저장">
        <Segmented
          label="저장 형식"
          block
          value={settings.format}
          onValue={(format) => set({ format })}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
            { value: 'pdf', label: 'PDF' },
          ]}
        />
        {settings.format !== 'png' && (
          <Field label="화질" aside={`${settings.quality}%`}>
            {(id) => <Slider id={id} min={50} max={100} step={1} value={settings.quality} onValue={(quality) => set({ quality })} />}
          </Field>
        )}
        {settings.format === 'pdf' && <Switch checked={settings.pdfA4} onChange={(pdfA4) => set({ pdfA4 })} label="A4 폭에 맞춰 여러 쪽으로" hint="끄면 이미지 크기 그대로 한 쪽에 담습니다." />}
        {busy ? (
          <div className="flex flex-col gap-2">
            <Progress value={busy.value} label={busy.label} />
            <Button icon={X} onClick={abort}>
              취소
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button variant="primary" block icon={pieceCount > 1 && settings.format !== 'pdf' ? FileArchive : Download} disabled={tooMany} onClick={() => save(false)}>
              {saveLabel}
            </Button>
            {pieceCount > 1 && settings.format !== 'pdf' && (
              <Button block icon={ImageDown} disabled={tooMany} onClick={() => save(true)}>
                하나씩 저장
              </Button>
            )}
            <SendToMenu files={filesForSend} exclude="capture" disabled={tooMany} />
          </div>
        )}
      </Section>
    </>
  ) : (
    <EmptyState title="아직 이미지가 없습니다">이미지를 넣으면 자르기, 나누기, 저장 설정이 여기에 나타납니다.</EmptyState>
  )

  return (
    <div hidden={!active} className="flex flex-col gap-4">
      {receiving != null && (
        <Panel className="p-4">
          <Progress value={receiving} label="확장 프로그램에서 캡처를 받는 중" />
        </Panel>
      )}
      <ToolLayout panel={panel}>
        <Dropzone
          accept="image/*"
          onFiles={(files) => void addFiles(files)}
          compact={items.length > 0}
          paste={active}
          title={items.length ? '이미지 더 넣기' : '캡처 이미지를 끌어다 놓으세요'}
          hint={items.length ? undefined : `확장 프로그램에서 '온비짱에서 편집'을 누르면 바로 들어옵니다. 한 장 ${formatBytes(MAX_FILE_BYTES)} 이하, Ctrl+V 로 붙여넣기도 됩니다.`}
          disabled={Boolean(busy)}
        />

        {items.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="받은 이미지">
            {items.map((item) => {
              const selected = item.id === current?.id
              return (
                <div key={item.id} className={clsx('group relative shrink-0 rounded-md border bg-surface shadow-1 transition-colors duration-150', selected ? 'border-brand ring-2 ring-brand/30' : 'border-line-strong hover:border-faint')}>
                  <button type="button" role="option" aria-selected={selected} title={item.file.name} disabled={Boolean(busy)} onClick={() => setSelectedId(item.id)} className="block size-20 overflow-hidden rounded-[9px]">
                    <img src={item.url} alt={item.file.name} className="size-full object-cover object-top" />
                  </button>
                  <button
                    type="button"
                    aria-label={`${item.file.name} 빼기`}
                    title="목록에서 빼기"
                    disabled={Boolean(busy)}
                    onClick={() => removeItem(item.id)}
                    className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-line-strong bg-surface text-muted shadow-1 transition-colors duration-150 hover:bg-danger-soft hover:text-danger disabled:opacity-45"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {current && rect && (
          <>
            <Stage className="items-start! p-3! sm:p-5!">
              <div className="max-h-[70dvh] w-full overflow-auto p-2 text-center">
                <CropBox src={current.url} alt={`${current.file.name} 미리보기`} w={current.w} h={current.h} trim={current.trim} onTrim={(trim) => !busy && patchCurrent({ trim })} cuts={cuts} />
              </div>
            </Stage>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted">
              <span className="min-w-0 truncate font-semibold text-ink-2">{current.file.name}</span>
              <span className="num">
                원본 {fmt.format(current.w)} × {fmt.format(current.h)} px · {formatBytes(current.file.size)}
              </span>
            </div>
            {items.length === 1 && (
              <div>
                <Button size="sm" variant="ghost" icon={X} disabled={Boolean(busy)} onClick={() => removeItem(current.id)}>
                  이 이미지 빼기
                </Button>
              </div>
            )}
            {caption && (
              <Callout tone="info">
                저장할 때 맨 아래에 이 줄이 붙습니다: <span className="font-semibold text-ink">{caption}</span>
              </Callout>
            )}
          </>
        )}
      </ToolLayout>
    </div>
  )
}
