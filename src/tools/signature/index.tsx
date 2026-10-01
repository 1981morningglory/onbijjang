import '@fontsource/nanum-pen-script/400.css'
import '@fontsource/gaegu/400.css'
import clsx from 'clsx'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  Copy,
  CopyPlus,
  Dot,
  Download,
  FileSignature,
  FolderOpen,
  Maximize,
  MoveHorizontal,
  Redo2,
  RotateCcw,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHandoffFiles } from '@/app/handoff'
import { downloadBlob, formatBytes, makeZip } from '@/lib/files'
import { useAbortable, usePersistentState } from '@/lib/hooks'
import {
  Badge,
  Button,
  Callout,
  Dialog,
  Dropzone,
  EmptyState,
  Field,
  IconButton,
  Kbd,
  LibraryMenu,
  Progress,
  Section,
  Segmented,
  Select,
  SendToMenu,
  Slider,
  Spinner,
  Stage,
  Switch,
  TextInput,
  toast,
  ToolLayout,
} from '@/ui'
import { AssetView } from './AssetView'
import { isCancelError, OpenCancelled, openDocument } from './docs'
import { ensureFont, FONT_CHOICES, resolveFont } from './fonts'
import { cascadePosition, clampCenter, defaultItemSize, mapToPage, type Point } from './geometry'
import { canRedo, canUndo, commit, initHistory, redo, undo, type History } from './history'
import { InkColorField, MakerSection } from './Makers'
import { makeThumb, renderMarkCanvas, renderTextCanvas, type MarkShape } from './raster'
import { outputBaseName, PdfStructureError, savePageImages, savePagesAsPdf, savePdfKeepingOriginal } from './save'
import { addMySignature, isAssetLike, KIND_LABEL, listMySignatures, MY_SIGNATURE_LIMIT, removeMySignature } from './store'
import { MAX_PAGES, type Asset, type DocSource, type Item, type SavedSignature, type TextSpec } from './types'
import { Viewer, type Zoom } from './Viewer'

const ACCEPT = 'image/*,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOC_KIND_LABEL = { image: '사진', pdf: 'PDF', docx: 'Word' } as const

type DateFormat = 'dots' | 'korean' | 'dash' | 'compact'
function formatDate(d: Date, format: DateFormat): string {
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const two = (n: number) => String(n).padStart(2, '0')
  if (format === 'korean') return `${y}년 ${m}월 ${day}일`
  if (format === 'dash') return `${y}-${two(m)}-${two(day)}`
  if (format === 'compact') return `${y}.${two(m)}.${two(day)}`
  return `${y}. ${m}. ${day}.`
}

interface SaveSettings {
  image: 'png' | 'jpg'
  pdf: 'pdf' | 'png'
  docx: 'pdf' | 'png'
  jpgQuality: number
}

interface QuickSettings {
  dateFormat: DateFormat
  font: string
}

interface SaveResult {
  files: File[]
  download: { blob: Blob; name: string }
  note: string | null
}

interface PasswordPrompt {
  wrong: boolean
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

async function textAsset(spec: TextSpec, label: string): Promise<Asset | null> {
  const { family, weight } = resolveFont(spec)
  await ensureFont(family, weight, spec.value)
  const canvas = renderTextCanvas(spec.value, family, weight, false)
  if (!canvas) return null
  return { src: canvas.toDataURL('image/png'), aspect: canvas.width / canvas.height, tint: '#111111', kind: 'text', label, text: spec }
}

const MARKS: Array<{ shape: MarkShape; label: string; icon: LucideIcon }> = [
  { shape: 'check', label: '체크', icon: Check },
  { shape: 'cross', label: '가위표', icon: X },
  { shape: 'circle', label: '동그라미', icon: Circle },
  { shape: 'dot', label: '점', icon: Dot },
]

export default function SignatureTool() {
  const [doc, setDoc] = useState<DocSource | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState<Zoom>('page')
  const [scale, setScale] = useState(1)
  const [hist, setHist] = useState<History<Item[]>>(() => initHistory<Item[]>([]))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mine, setMine] = useState<SavedSignature[] | null>(null)
  const [pending, setPending] = useState<File | null>(null)
  const [closing, setClosing] = useState(false)
  const [password, setPassword] = useState<PasswordPrompt | null>(null)
  const [passwordValue, setPasswordValue] = useState('')
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [result, setResult] = useState<SaveResult | null>(null)
  const [quickText, setQuickText] = useState('')
  const [saveSettings, setSaveSettings] = usePersistentState<SaveSettings>('onbijjang:signature:save', { image: 'png', pdf: 'pdf', docx: 'pdf', jpgQuality: 92 })
  const [quick, setQuick] = usePersistentState<QuickSettings>('onbijjang:signature:quick', { dateFormat: 'dots', font: 'sans' })

  const items = hist.present
  const pageItems = useMemo(() => items.filter((i) => i.page === page), [items, page])
  const selected = pageItems.find((i) => i.id === selectedId) ?? null
  const pageInfo = doc?.pages[page] ?? null

  const centerRef = useRef<(() => Point) | null>(null)
  const makerAsset = useRef<Asset | null>(null)
  const passwordAnswer = useRef<((value: string | null) => void) | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const openAbort = useAbortable()
  const saveAbort = useAbortable()
  const docRef = useRef<DocSource | null>(null)
  docRef.current = doc
  const textSeq = useRef(0)

  // ── 내 서명 ────────────────────────────────────────────
  useEffect(() => {
    listMySignatures()
      .then(setMine)
      .catch(() => setMine([]))
  }, [])

  // 떠날 때 문서 정리
  useEffect(() => () => docRef.current?.destroy(), [])

  // 내용이 바뀌면 앞서 저장한 결과는 옛것이 된다
  useEffect(() => {
    setResult(null)
    setSaveError(null)
  }, [items, doc, saveSettings])

  // ── 문서 열기 ──────────────────────────────────────────
  const answerPassword = (value: string | null) => {
    const answer = passwordAnswer.current
    passwordAnswer.current = null
    setPassword(null)
    setPasswordValue('')
    answer?.(value)
  }

  const open = useCallback(
    async (file: File) => {
      const signal = openAbort.start()
      setOpening(file.name)
      setOpenError(null)
      try {
        const next = await openDocument(file, {
          signal,
          askPassword: (wrong) =>
            new Promise((resolve) => {
              passwordAnswer.current = resolve
              setPassword({ wrong })
            }),
        })
        if (signal.aborted) {
          next.destroy()
          return
        }
        docRef.current?.destroy()
        setDoc(next)
        setPage(0)
        setZoom('page')
        setHist(initHistory<Item[]>([]))
        setSelectedId(null)
      } catch (err) {
        if (signal.aborted || err instanceof OpenCancelled || isCancelError(err)) return
        setOpenError(err instanceof Error ? err.message : '파일을 열지 못했습니다.')
      } finally {
        if (!signal.aborted) setOpening(null)
      }
    },
    [openAbort],
  )

  const cancelOpen = () => {
    openAbort.abort()
    answerPassword(null)
    setOpening(null)
  }

  const receive = (files: File[]) => {
    if (!files.length) return
    if (files.length > 1) toast.info('첫 번째 파일만 열었습니다. 서명은 한 번에 한 파일씩 합니다.')
    if (doc && items.length) setPending(files[0])
    else void open(files[0])
  }
  useHandoffFiles('signature', receive)

  const closeDoc = () => {
    doc?.destroy()
    setDoc(null)
    setHist(initHistory<Item[]>([]))
    setSelectedId(null)
    setOpenError(null)
  }

  // ── 항목 다루기 ────────────────────────────────────────
  const apply = (fn: (list: Item[]) => Item[], tag: string | null = null) => setHist((h) => commit(h, fn(h.present), tag))
  const patchItem = (id: string, patch: Partial<Item>, tag: string) => apply((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)), tag)

  const nudgeItem = (id: string, dx: number, dy: number) =>
    apply((list) => {
      const info = doc?.pages[page]
      return list.map((it) => (it.id === id && info ? { ...it, ...clampCenter({ cx: it.cx + dx, cy: it.cy + dy }, info.width, info.height) } : it))
    }, `nudge-${id}`)

  const goPage = (next: number) => {
    if (!doc) return
    const clamped = Math.min(doc.pages.length - 1, Math.max(0, next))
    if (clamped === page) return
    setPage(clamped)
    setSelectedId(null)
  }

  const place = (asset: Asset) => {
    if (!doc || !pageInfo) return
    const size = defaultItemSize(asset.kind, asset.aspect, pageInfo.width, pageInfo.height)
    const center = centerRef.current?.() ?? { x: pageInfo.width / 2, y: pageInfo.height / 2 }
    const pos = cascadePosition(
      center,
      pageItems.map((i) => ({ x: i.cx, y: i.cy })),
      pageInfo.width * 0.03,
      pageInfo.width,
      pageInfo.height,
    )
    const item: Item = { id: newId(), page, cx: pos.x, cy: pos.y, w: size.w, h: size.h, rot: 0, opacity: 1, src: asset.src, tint: asset.tint, kind: asset.kind, label: asset.label, text: asset.text }
    apply((list) => [...list, item])
    setSelectedId(item.id)
  }

  const removeItem = (id: string) => {
    apply((list) => list.filter((i) => i.id !== id))
    setSelectedId(null)
  }

  const duplicateItem = (id: string) => {
    const src = items.find((i) => i.id === id)
    if (!src || !doc) return
    const info = doc.pages[src.page]
    const offset = info.width * 0.03
    const copy: Item = { ...src, ...clampCenter({ cx: src.cx + offset, cy: src.cy + offset }, info.width, info.height), id: newId() }
    apply((list) => [...list, copy])
    setSelectedId(copy.id)
  }

  const copyToAllPages = (id: string) => {
    const src = items.find((i) => i.id === id)
    if (!src || !doc || doc.pages.length < 2) return
    const from = doc.pages[src.page]
    const copies = doc.pages.flatMap((to, p) => (p === src.page ? [] : [{ ...mapToPage(src, from, to), id: newId(), page: p }]))
    apply((list) => [...list, ...copies])
    toast.success(`나머지 ${copies.length}쪽의 같은 자리에 복사했습니다.`)
  }

  const editText = (item: Item, spec: TextSpec) => {
    const tag = `text-${item.id}`
    patchItem(item.id, { text: spec }, tag)
    if (!spec.value.trim()) return
    const seq = ++textSeq.current
    void textAsset(spec, item.label).then((asset) => {
      if (!asset || seq !== textSeq.current) return
      setHist((h) =>
        commit(
          h,
          h.present.map((it) => (it.id === item.id ? { ...it, src: asset.src, w: it.h * asset.aspect } : it)),
          tag,
        ),
      )
    })
  }

  const step = (direction: 'undo' | 'redo') => {
    const next = direction === 'undo' ? undo(hist) : redo(hist)
    if (next === hist) return
    const before = hist.present
    const after = next.present
    const changed = after.find((i) => !before.includes(i)) ?? before.find((i) => !after.includes(i))
    setHist(next)
    if (changed && changed.page !== page) {
      setPage(changed.page)
      setSelectedId(null)
    }
  }

  // 단축키: 되돌리기·다시 하기·쪽 넘기기
  const keys = useRef({ step, goPage, page })
  keys.current = { step, goPage, page }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (document.querySelector('dialog[open]')) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        keys.current.step(e.shiftKey ? 'redo' : 'undo')
      } else if (mod && key === 'y') {
        e.preventDefault()
        keys.current.step('redo')
      } else if (e.key === 'PageDown') {
        e.preventDefault()
        keys.current.goPage(keys.current.page + 1)
      } else if (e.key === 'PageUp') {
        e.preventDefault()
        keys.current.goPage(keys.current.page - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── 내 서명·팀 보관함 ──────────────────────────────────
  const saveMine = async (asset: Asset, name: string) => {
    try {
      setMine(await addMySignature(asset, name))
      toast.success('내 서명에 저장했습니다. 이 브라우저에만 남습니다.')
    } catch {
      toast.error('저장하지 못했습니다. 브라우저 저장 공간이 가득 찼거나 사생활 보호 창일 수 있습니다.')
    }
  }

  const deleteMine = async (id: string) => {
    try {
      setMine(await removeMySignature(id))
    } catch {
      toast.error('삭제하지 못했습니다.')
    }
  }

  const placeSaved = (sig: SavedSignature) => place({ src: sig.src, tint: sig.tint, aspect: sig.aspect, kind: sig.kind, label: KIND_LABEL[sig.kind] ?? '서명' })

  // ── 날짜·글자·체크 ─────────────────────────────────────
  const addText = async (value: string, label: string) => {
    const text = value.trim()
    if (!text) return toast.info('넣을 글자를 입력해 주세요.')
    const asset = await textAsset({ value: text, font: quick.font }, label)
    if (asset) place(asset)
  }

  const addMark = (shape: MarkShape, label: string) => {
    place({ src: renderMarkCanvas(shape).toDataURL('image/png'), aspect: 1, tint: '#111111', kind: 'mark', label })
  }

  // ── 저장 ───────────────────────────────────────────────
  const format = doc ? saveSettings[doc.kind] : 'png'

  const save = async () => {
    if (!doc || !items.length) return
    const signal = saveAbort.start()
    const onProgress = (done: number, total: number) => setSaving({ done, total })
    setSaving({ done: 0, total: 1 })
    setSaveError(null)
    setSelectedId(null)
    try {
      let files: File[]
      let note: string | null = null
      if (format === 'pdf') {
        if (doc.kind === 'pdf') {
          try {
            files = [await savePdfKeepingOriginal(doc, items, onProgress, signal)]
          } catch (err) {
            if (!(err instanceof PdfStructureError)) throw err
            files = [await savePagesAsPdf(doc, items, onProgress, signal)]
            note =
              err.reason === 'encrypted'
                ? '암호나 편집 제한이 걸린 PDF 라 원본을 그대로 둘 수 없어, 쪽을 이미지로 바꾼 새 PDF 로 저장했습니다. 글자는 선택되지 않고 암호는 걸려 있지 않습니다.'
                : '이 PDF 는 구조를 그대로 고칠 수 없어, 쪽을 이미지로 바꾼 새 PDF 로 저장했습니다. 글자는 선택되지 않습니다.'
          }
        } else {
          files = [await savePagesAsPdf(doc, items, onProgress, signal)]
        }
      } else {
        files = await savePageImages(doc, items, format === 'jpg' ? 'image/jpeg' : 'image/png', saveSettings.jpgQuality / 100, onProgress, signal)
      }
      if (signal.aborted) return
      const download =
        files.length === 1
          ? { blob: files[0] as Blob, name: files[0].name }
          : { blob: await makeZip(files.map((f) => ({ name: f.name, data: f }))), name: `${outputBaseName(doc)}.zip` }
      downloadBlob(download.blob, download.name)
      setResult({ files, download, note })
      toast.success('서명한 파일을 저장했습니다.')
    } catch (err) {
      if (signal.aborted || isCancelError(err)) toast.info('저장을 취소했습니다.')
      else setSaveError('저장하지 못했습니다. 쪽 수가 많거나 사진이 아주 크면 메모리가 모자랄 수 있습니다. 다른 탭을 닫고 다시 시도해 주세요.')
    } finally {
      setSaving(null)
    }
  }

  // ── 화면 ───────────────────────────────────────────────
  const percent = doc ? Math.round((scale / doc.unitPx) * 100) : 100
  const zoomBy = (factor: number) => {
    if (!doc) return
    setZoom(Math.min(doc.unitPx * 8, Math.max(doc.unitPx * 0.05, scale * factor)))
  }

  const today = new Date()
  const fontOptions = FONT_CHOICES.filter((f) => f.id !== 'local').map((f) => ({ value: f.id, label: f.label }))

  const panel = (
    <>
      {doc && (
        <Section title="선택한 항목">
          {selected && pageInfo ? (
            <SelectedControls
              item={selected}
              pageWidth={pageInfo.width}
              multiPage={doc.pages.length > 1}
              fontOptions={fontOptions}
              onPatch={(patch, tag) => patchItem(selected.id, patch, `${tag}-${selected.id}`)}
              onText={(spec) => editText(selected, spec)}
              onDuplicate={() => duplicateItem(selected.id)}
              onCopyAll={() => copyToAllPages(selected.id)}
              onDelete={() => removeItem(selected.id)}
            />
          ) : (
            <p className="text-sm text-muted">{items.length ? '문서 위의 서명을 누르면 크기·회전·색을 바꿀 수 있습니다.' : '아래에서 서명을 만들어 "문서에 넣기"를 누르면 여기서 다듬을 수 있습니다.'}</p>
          )}
        </Section>
      )}

      <MakerSection canPlace={!!doc} onPlace={place} onSaveMine={saveMine} onCurrent={(a) => (makerAsset.current = a)} />

      <Section
        title="내 서명 · 팀 직인"
        action={
          <LibraryMenu<Pick<SavedSignature, 'src' | 'tint' | 'aspect' | 'kind'>>
            kind="signature"
            noun="직인"
            size="sm"
            getData={async () => {
              const a: Pick<Asset, 'src' | 'tint' | 'aspect' | 'kind'> | null = selected ? { src: selected.src, tint: selected.tint, aspect: selected.w / selected.h, kind: selected.kind } : makerAsset.current
              if (!a) return null
              return { data: { src: a.src, tint: a.tint, aspect: a.aspect, kind: a.kind }, thumb: await makeThumb(a.src, a.tint) }
            }}
            onLoad={(data, entry) => {
              if (!isAssetLike(data)) return toast.error('서명 이미지가 아니어서 불러올 수 없습니다.')
              const asset: Asset = { src: data.src, tint: data.tint, aspect: data.aspect, kind: data.kind, label: KIND_LABEL[data.kind] ?? '직인' }
              if (doc) place(asset)
              else void saveMine(asset, entry.name)
            }}
          />
        }
        hint="팀 보관함에는 지금 선택한 항목(없으면 만들고 있는 서명)이 저장됩니다."
      >
        {mine === null ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted">
            <Spinner /> 불러오는 중
          </div>
        ) : mine.length === 0 ? (
          <EmptyState title="저장한 서명이 없습니다" className="py-5!">
            위에서 만든 서명을 "내 서명에 저장"하면 여기에 모여, 다음부터는 눌러서 바로 넣을 수 있습니다.
          </EmptyState>
        ) : (
          <>
            <ul className="grid grid-cols-3 gap-2">
              {mine.map((sig) => (
                <li key={sig.id} className="group relative">
                  <button
                    type="button"
                    disabled={!doc}
                    onClick={() => placeSaved(sig)}
                    title={doc ? `${sig.name} — 문서에 넣기` : `${sig.name} — 문서를 열면 넣을 수 있습니다`}
                    className="flex w-full flex-col gap-1 rounded-md border border-line-strong bg-surface p-1.5 text-left shadow-1 transition-colors duration-150 hover:border-brand hover:bg-brand-soft disabled:opacity-60 disabled:hover:border-line-strong disabled:hover:bg-surface"
                  >
                    <span className="checker block h-14 rounded-xs p-1">
                      <AssetView src={sig.src} tint={sig.tint} contain />
                    </span>
                    <span className="truncate text-2xs font-semibold text-ink-2">{sig.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${sig.name} 삭제`}
                    title="삭제"
                    onClick={() => deleteMine(sig.id)}
                    className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-line-strong bg-surface text-muted opacity-0 shadow-1 transition-opacity duration-150 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-2xs text-muted">
              이 브라우저에만 저장됩니다 · {mine.length}/{MY_SIGNATURE_LIMIT}
            </p>
          </>
        )}
      </Section>

      <Section title="날짜 · 글자 · 체크" hint={doc ? undefined : '문서를 열면 넣을 수 있습니다.'}>
        <Field label="날짜 형식">
          {(id) => (
            <Select
              id={id}
              value={quick.dateFormat}
              onValue={(dateFormat) => setQuick((q) => ({ ...q, dateFormat }))}
              options={(['dots', 'korean', 'dash', 'compact'] as const).map((f) => ({ value: f, label: formatDate(today, f) }))}
            />
          )}
        </Field>
        <Button icon={CalendarDays} disabled={!doc} onClick={() => addText(formatDate(new Date(), quick.dateFormat), '날짜')}>
          오늘 날짜 넣기
        </Button>
        <Field label="글자">
          {(id) => (
            <div className="flex gap-2">
              <TextInput
                id={id}
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                placeholder="예: 위 내용을 확인함"
                maxLength={80}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && doc) void addText(quickText, '글자')
                }}
              />
              <Button icon={Type} disabled={!doc || !quickText.trim()} onClick={() => addText(quickText, '글자')} className="shrink-0">
                넣기
              </Button>
            </div>
          )}
        </Field>
        <Field label="날짜·글자 글꼴">{(id) => <Select id={id} value={quick.font} onValue={(font) => setQuick((q) => ({ ...q, font }))} options={fontOptions} />}</Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-2">표시</span>
          <div className="flex flex-wrap gap-2">
            {MARKS.map((m) => (
              <Button key={m.shape} size="sm" icon={m.icon} disabled={!doc} onClick={() => addMark(m.shape, m.label)}>
                {m.label}
              </Button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="저장">
        {doc ? (
          <>
            {doc.kind === 'image' && (
              <Segmented
                label="저장 형식"
                block
                size="sm"
                value={saveSettings.image}
                onValue={(image) => setSaveSettings((p) => ({ ...p, image }))}
                options={[
                  { value: 'png', label: 'PNG' },
                  { value: 'jpg', label: 'JPG' },
                ]}
              />
            )}
            {doc.kind === 'image' && saveSettings.image === 'jpg' && (
              <Field label="JPG 화질" aside={`${saveSettings.jpgQuality}%`}>
                {(id) => <Slider id={id} min={50} max={100} step={1} value={saveSettings.jpgQuality} onValue={(jpgQuality) => setSaveSettings((p) => ({ ...p, jpgQuality }))} />}
              </Field>
            )}
            {doc.kind === 'pdf' && (
              <>
                <Segmented
                  label="저장 형식"
                  block
                  size="sm"
                  value={saveSettings.pdf}
                  onValue={(pdf) => setSaveSettings((p) => ({ ...p, pdf }))}
                  options={[
                    { value: 'pdf', label: 'PDF' },
                    { value: 'png', label: 'PNG 이미지' },
                  ]}
                />
                <p className="text-sm text-muted">
                  {saveSettings.pdf === 'pdf' ? '원본 PDF 에 서명 이미지만 얹습니다. 글자 선택과 선명도는 그대로입니다.' : doc.pages.length > 1 ? '쪽마다 PNG 한 장씩, ZIP 으로 묶어 저장합니다.' : '쪽을 PNG 이미지로 저장합니다.'}
                </p>
              </>
            )}
            {doc.kind === 'docx' && (
              <>
                <Segmented
                  label="저장 형식"
                  block
                  size="sm"
                  value={saveSettings.docx}
                  onValue={(docx) => setSaveSettings((p) => ({ ...p, docx }))}
                  options={[
                    { value: 'pdf', label: 'PDF' },
                    { value: 'png', label: 'PNG 이미지' },
                  ]}
                />
                <p className="text-sm text-muted">Word 파일로는 저장하지 않습니다. 화면에 보이는 쪽을 이미지로 만들어 {saveSettings.docx === 'pdf' ? 'PDF 로 묶습니다(글자 선택 불가).' : doc.pages.length > 1 ? 'ZIP 으로 묶습니다.' : '저장합니다.'}</p>
              </>
            )}
            {saving ? (
              <div className="flex flex-col gap-2">
                <Progress value={(saving.done / Math.max(1, saving.total)) * 100} label="저장할 파일을 만드는 중" />
                <Button onClick={() => saveAbort.abort()}>취소</Button>
              </div>
            ) : (
              <Button variant="primary" size="lg" block icon={Download} disabled={!items.length} onClick={save}>
                서명한 파일 저장
              </Button>
            )}
            {!items.length && !saving && <p className="text-sm text-muted">서명이나 도장을 하나 이상 놓으면 저장할 수 있습니다.</p>}
            {saveError && (
              <Callout tone="danger" title="저장하지 못했습니다">
                {saveError}
              </Callout>
            )}
            {result && (
              <div className="flex flex-col gap-2">
                {result.note && <Callout tone="warn">{result.note}</Callout>}
                <p className="text-sm text-ink-2">
                  <span className="font-semibold break-all">{result.download.name}</span> <span className="num text-muted">{formatBytes(result.download.blob.size)}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={Download} onClick={() => downloadBlob(result.download.blob, result.download.name)}>
                    다시 내려받기
                  </Button>
                  <SendToMenu files={result.files} exclude="signature" size="sm" />
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">문서를 열고 서명을 놓으면 여기서 저장합니다. PDF 는 원본 그대로 PDF 로, 사진은 PNG·JPG 로 저장됩니다.</p>
        )}
      </Section>
    </>
  )

  return (
    <ToolLayout panel={panel}>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          receive(Array.from(e.target.files ?? []).slice(0, 1))
          e.target.value = ''
        }}
      />

      {openError && (
        <Callout tone="danger" title="파일을 열 수 없습니다">
          {openError}
        </Callout>
      )}

      {opening ? (
        <Stage minHeight={320}>
          <div className="flex flex-col items-center gap-3 text-center">
            <Spinner className="size-6" />
            <p className="max-w-[40ch] text-sm break-all">{opening} 여는 중</p>
            <Button size="sm" onClick={cancelOpen}>
              취소
            </Button>
          </div>
        </Stage>
      ) : doc && pageInfo ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2 shadow-1">
            <div className="flex min-w-0 flex-1 basis-40 items-center gap-2">
              <Badge tone="brand">{DOC_KIND_LABEL[doc.kind]}</Badge>
              <span className="truncate text-sm font-semibold text-ink" title={doc.file.name}>
                {doc.file.name}
              </span>
            </div>
            {doc.pages.length > 1 && (
              <div className="flex items-center gap-0.5" role="group" aria-label="쪽 이동">
                <IconButton icon={ChevronsLeft} label="첫 쪽" size="sm" disabled={page === 0} onClick={() => goPage(0)} />
                <IconButton icon={ChevronLeft} label="이전 쪽 (PageUp)" size="sm" disabled={page === 0} onClick={() => goPage(page - 1)} />
                <span className="num min-w-14 text-center text-sm text-ink-2" aria-live="polite">
                  {page + 1} / {doc.pages.length}
                </span>
                <IconButton icon={ChevronRight} label="다음 쪽 (PageDown)" size="sm" disabled={page === doc.pages.length - 1} onClick={() => goPage(page + 1)} />
                <IconButton icon={ChevronsRight} label="마지막 쪽" size="sm" disabled={page === doc.pages.length - 1} onClick={() => goPage(doc.pages.length - 1)} />
              </div>
            )}
            <div className="flex items-center gap-0.5" role="group" aria-label="확대·축소">
              <IconButton icon={ZoomOut} label="축소" size="sm" onClick={() => zoomBy(1 / 1.25)} />
              <span className="num min-w-12 text-center text-sm text-ink-2">{percent}%</span>
              <IconButton icon={ZoomIn} label="확대" size="sm" onClick={() => zoomBy(1.25)} />
              <IconButton icon={Maximize} label="쪽 전체 보기" size="sm" active={zoom === 'page'} onClick={() => setZoom('page')} />
              <IconButton icon={MoveHorizontal} label="너비에 맞추기" size="sm" active={zoom === 'width'} onClick={() => setZoom('width')} />
            </div>
            <div className="flex items-center gap-0.5" role="group" aria-label="되돌리기">
              <IconButton icon={Undo2} label="되돌리기 (Ctrl+Z)" size="sm" disabled={!canUndo(hist)} onClick={() => step('undo')} />
              <IconButton icon={Redo2} label="다시 하기 (Ctrl+Y)" size="sm" disabled={!canRedo(hist)} onClick={() => step('redo')} />
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" icon={FolderOpen} onClick={() => fileInput.current?.click()}>
                다른 파일
              </Button>
              <IconButton icon={X} label="문서 닫기" size="sm" onClick={() => (items.length ? setClosing(true) : closeDoc())} />
            </div>
          </div>

          {doc.kind === 'docx' && (
            <Callout tone="warn" title="Word 문서는 원본과 모양이 다를 수 있습니다">
              글·표·그림을 옮겨 다시 배치한 모습입니다. 글꼴, 줄 간격, 머리글·바닥글, 쪽이 나뉘는 위치가 Word 와 다를 수 있고, 저장하면 쪽 이미지(PDF·PNG)가 됩니다. 서식이 중요한 문서는 Word 에서 PDF 로 저장한 뒤 올려 주세요.
            </Callout>
          )}
          {doc.notes.map((note) => (
            <Callout key={note} tone="info">
              {note}
            </Callout>
          ))}

          <Viewer
            source={doc}
            page={page}
            zoom={zoom}
            onScale={setScale}
            items={pageItems}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={patchItem}
            onNudge={nudgeItem}
            onDelete={removeItem}
            onDuplicate={duplicateItem}
            centerRef={centerRef}
          />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>끌어서 옮기고, 모서리로 크기를, 위쪽 손잡이로 회전을 바꿉니다.</span>
            <span className="hidden items-center gap-1 sm:inline-flex">
              <Kbd>←</Kbd>
              <Kbd>→</Kbd>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> 조금씩 이동 · <Kbd>Shift</Kbd> 크게 · <Kbd>Delete</Kbd> 삭제 · <Kbd>Ctrl</Kbd>
              <Kbd>D</Kbd> 복제
            </span>
          </p>
        </>
      ) : (
        <Dropzone
          onFiles={receive}
          accept={ACCEPT}
          multiple={false}
          icon={FileSignature}
          title="서명할 사진·PDF·Word 파일을 끌어다 놓으세요"
          hint={`파일 1개 · 100MB 이하 · 문서는 ${MAX_PAGES}쪽까지 · 파일은 내 기기 안에서만 처리됩니다`}
        />
      )}

      <Callout tone="info" title="인증서 기반 전자서명이 아닙니다">
        문서 위에 서명·도장 이미지를 얹는 방식입니다. 공동인증서 등으로 하는 전자서명과 달리 서명한 사람과 위·변조 여부를 증명하지 못하며, 법적 효력은 쓰는 곳에 따라 다릅니다.
      </Callout>

      <Dialog
        open={!!password}
        onClose={() => answerPassword(null)}
        title="암호가 걸린 PDF 입니다"
        size="sm"
        footer={
          <>
            <Button onClick={() => answerPassword(null)}>취소</Button>
            <Button variant="primary" disabled={!passwordValue} onClick={() => answerPassword(passwordValue)}>
              열기
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (passwordValue) answerPassword(passwordValue)
          }}
        >
          <Field label="문서 암호" error={password?.wrong ? '암호가 맞지 않습니다. 다시 입력해 주세요.' : undefined} hint="암호는 이 기기 안에서 문서를 여는 데만 쓰입니다.">
            {(id) => <TextInput id={id} type="password" autoComplete="off" autoFocus value={passwordValue} onChange={(e) => setPasswordValue(e.target.value)} aria-invalid={password?.wrong || undefined} />}
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={!!pending || closing}
        onClose={() => {
          setPending(null)
          setClosing(false)
        }}
        title={pending ? '다른 파일을 열까요?' : '문서를 닫을까요?'}
        size="sm"
        footer={
          <>
            <Button
              onClick={() => {
                setPending(null)
                setClosing(false)
              }}
            >
              계속 작업
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const file = pending
                setPending(null)
                setClosing(false)
                if (file) void open(file)
                else closeDoc()
              }}
            >
              {pending ? '버리고 새 파일 열기' : '버리고 닫기'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          지금 문서에 놓은 항목 {items.length}개가 사라집니다. 필요하면 먼저 저장해 주세요.
        </p>
      </Dialog>
    </ToolLayout>
  )
}

function SelectedControls({
  item,
  pageWidth,
  multiPage,
  fontOptions,
  onPatch,
  onText,
  onDuplicate,
  onCopyAll,
  onDelete,
}: {
  item: Item
  pageWidth: number
  multiPage: boolean
  fontOptions: Array<{ value: string; label: string }>
  onPatch: (patch: Partial<Item>, tag: string) => void
  onText: (spec: TextSpec) => void
  onDuplicate: () => void
  onCopyAll: () => void
  onDelete: () => void
}) {
  const widthPct = Math.round((item.w / pageWidth) * 1000) / 10
  const setWidth = (pct: number) => {
    const w = (pageWidth * pct) / 100
    onPatch({ w, h: w * (item.h / item.w) }, 'size')
  }
  return (
    <>
      <div className="flex items-center gap-2">
        <span className={clsx('checker block h-10 w-16 shrink-0 rounded-xs border border-line p-1')}>
          <AssetView src={item.src} tint={item.tint} contain />
        </span>
        <span className="text-sm font-semibold text-ink-2">{item.label}</span>
      </div>
      {item.text && (
        <>
          <Field label="내용" hint={item.text.value.trim() ? undefined : '비워 두면 이전 글자가 그대로 남습니다.'}>
            {(id) => <TextInput id={id} value={item.text!.value} maxLength={80} onChange={(e) => onText({ ...item.text!, value: e.target.value })} />}
          </Field>
          <Field label="글꼴">
            {(id) => <Select id={id} value={fontOptions.some((f) => f.value === item.text!.font) ? item.text!.font : 'sans'} onValue={(font) => onText({ ...item.text!, font })} options={fontOptions} />}
          </Field>
        </>
      )}
      <Field label="크기" aside={`쪽 너비의 ${widthPct}%`}>
        {(id) => <Slider id={id} min={1} max={100} step={0.5} value={Math.min(100, Math.max(1, widthPct))} onValue={setWidth} />}
      </Field>
      <Field label="회전" aside={`${Math.round(item.rot)}°`}>
        {(id) => (
          <div className="flex items-center gap-2">
            <Slider id={id} min={-180} max={180} step={1} value={Math.round(item.rot)} onValue={(rot) => onPatch({ rot }, 'rot')} />
            <IconButton icon={RotateCcw} label="회전 되돌리기(0°)" size="sm" disabled={item.rot === 0} onClick={() => onPatch({ rot: 0 }, 'rot-reset')} />
          </div>
        )}
      </Field>
      <Field label="불투명도" aside={`${Math.round(item.opacity * 100)}%`}>
        {(id) => <Slider id={id} min={10} max={100} step={5} value={Math.round(item.opacity * 100)} onValue={(v) => onPatch({ opacity: v / 100 }, 'opacity')} />}
      </Field>
      {item.kind === 'image' && <Switch checked={item.tint !== null} onChange={(on) => onPatch({ tint: on ? '#111111' : null }, 'mono')} label="한 가지 색으로 바꾸기" />}
      {item.tint !== null && <InkColorField label="색" value={item.tint} onValue={(tint) => onPatch({ tint }, 'tint')} />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={Copy} onClick={onDuplicate}>
          복제
        </Button>
        {multiPage && (
          <Button size="sm" icon={CopyPlus} onClick={onCopyAll}>
            모든 쪽 같은 위치에
          </Button>
        )}
        <Button size="sm" variant="danger" icon={Trash2} onClick={onDelete}>
          삭제
        </Button>
      </div>
    </>
  )
}
