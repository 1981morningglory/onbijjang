import { get as idbGet, set as idbSet } from 'idb-keyval'
import { ChevronLeft, ChevronRight, Eraser, FileDown, FilePlus2, PencilRuler, Play, Printer, Redo2, StickyNote, Undo2, X, Ban } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { blobToFile, downloadBlob, formatBytes, readAsDataURL, sanitizeFilename, todayStamp } from '@/lib/files'
import { useAbortable, useDebounced, usePersistentState } from '@/lib/hooks'
import { canvasToBlob, fileToCanvas, fitWithin, resizeCanvas } from '@/lib/image'
import { Button, Callout, IconButton, LibraryMenu, Progress, Segmented, SendToMenu, Tabs, ToolLayout, toast } from '@/ui'
import { isBarcodeLibReady, loadBarcodeLib, validateBarcode } from './barcode'
import { DataTableEditor } from './DataTableEditor'
import { DesignEditor } from './DesignEditor'
import { DesignPanel } from './DesignPanel'
import { addColumn, applySheet, clearRows, fromTemplate, pasteIntoDoc, removeColumn, renameColumn, setRowValues, toTemplate, type LabelTemplate, type PasteMode } from './docops'
import { exportPdf, makeThumb, prepareOutput } from './exporter'
import { addColumnTexts, autoBind, createBarcode, createImage, createShape, createText, defaultDoc, elementTitles, usedColumns, withContent } from './factory'
import { useFontsVersion } from './fonts'
import { useHistory } from './history'
import {
  MAX_LABELS,
  SERIAL_KEY,
  cellsPerSheet,
  clampElement,
  editSheet,
  findPlaceholders,
  newId,
  normalizeDoc,
  parseClipboardTable,
  planDoc,
  resolveText,
  round2,
  slotIndex,
  tableFromGrid,
  writeColumn,
  type LabelDoc,
  type LabelElement,
  type SheetField,
  type SheetSpec,
} from './model'
import { PrintSheets } from './print'
import { SheetPanel } from './SheetPanel'
import { SheetPicker } from './SheetPicker'
import { SheetPreview } from './SheetPreview'
import { SHEET_BY_ID } from './sheets'

const DOC_KEY = 'onbijjang:label:doc'
const MAX_IMPORT_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_IMAGE_SIDE = 1200

type Tab = 'sheet' | 'design'

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable))
}

/** 엑셀·CSV 파일의 첫 시트를 격자로 읽는다. */
async function readSpreadsheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase()
  const decode = (buf: ArrayBuffer) => {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf)
    } catch {
      return new TextDecoder('euc-kr').decode(buf)
    }
  }
  if (name.endsWith('.tsv') || name.endsWith('.txt')) return parseClipboardTable(decode(await file.arrayBuffer()))
  const XLSX = await import('xlsx')
  const book = name.endsWith('.csv') ? XLSX.read(decode(await file.arrayBuffer()), { type: 'string' }) : XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheet = book.Sheets[book.SheetNames[0]]
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false })
  return rows.map((row) => row.map((cell) => String(cell ?? '')))
}

export default function LabelTool() {
  const history = useHistory<LabelDoc>(defaultDoc)
  const doc = history.state
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = usePersistentState<Tab>('onbijjang:label:tab', 'sheet')
  const [customSheets, setCustomSheets] = usePersistentState<SheetSpec[]>('onbijjang:label:custom-sheets', [])
  const [pasteMode, setPasteMode] = usePersistentState<PasteMode>('onbijjang:label:paste-mode', 'cells')
  const [zoom, setZoom] = usePersistentState<'fit' | 'actual'>('onbijjang:label:zoom', 'fit')
  const [pasteColumn, setPasteColumn] = useState('')
  const [page, setPage] = useState(0)
  const [selection, setSelection] = useState<number[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [pdfJob, setPdfJob] = useState<{ done: number; total: number } | null>(null)
  const [lastPdf, setLastPdf] = useState<File | null>(null)
  const [barcodeRev, setBarcodeRev] = useState(0)
  const imageInput = useRef<HTMLInputElement>(null)
  const replaceTarget = useRef<string | null>(null)
  const abortable = useAbortable()
  const fontsVersion = useFontsVersion()
  const rev = fontsVersion + barcodeRev * 100000

  // ── 자동 저장 ──
  useEffect(() => {
    let alive = true
    idbGet(DOC_KEY)
      .then((raw) => {
        if (!alive) return
        const saved = normalizeDoc(raw, defaultDoc())
        if (saved) history.reset(saved)
      })
      .catch(() => undefined)
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
    // 처음 한 번만 불러온다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const settled = useDebounced(doc, 500)
  useEffect(() => {
    if (loaded) idbSet(DOC_KEY, settled).catch(() => undefined)
  }, [loaded, settled])

  // ── 바코드 라이브러리는 바코드가 있을 때만 ──
  const hasBarcode = doc.design.some((el) => el.type === 'barcode')
  useEffect(() => {
    if (!hasBarcode || isBarcodeLibReady()) return
    let alive = true
    loadBarcodeLib()
      .then(() => alive && setBarcodeRev((n) => n + 1))
      .catch(() => toast.error('바코드 기능을 불러오지 못했습니다. 새로고침한 뒤 다시 해 보세요.'))
    return () => {
      alive = false
    }
  }, [hasBarcode])

  const plan = useMemo(() => planDoc(doc), [doc])
  const perSheet = cellsPerSheet(doc.sheet)
  const printed = useMemo(() => plan.labels.filter(Boolean).length, [plan])
  const titles = useMemo(() => elementTitles(doc.design), [doc.design])
  const currentPage = Math.min(page, plan.pages - 1)
  useEffect(() => {
    if (page !== currentPage) setPage(currentPage)
  }, [page, currentPage])
  // 용지가 바뀌어 없어진 칸은 선택에서 뺀다.
  const cells = useMemo(() => selection.filter((c) => c < perSheet), [selection, perSheet])

  const selectedLabels = useMemo(() => cells.map((cell) => slotIndex({ page: currentPage, cell }, plan.perSheet, plan.free0)).filter((i) => i >= 0), [cells, currentPage, plan])
  const selectedRows = useMemo(() => [...new Set(selectedLabels.map((i) => Math.floor(i / Math.max(1, doc.repeat))))].sort((a, b) => a - b), [selectedLabels, doc.repeat])
  const sampleLabel = useMemo(() => {
    for (const i of selectedLabels) if (plan.labels[i]) return plan.labels[i]
    return plan.labels.find(Boolean) ?? null
  }, [selectedLabels, plan])
  const selected = doc.design.find((el) => el.id === selectedId) ?? null

  /** 값이 규칙에 맞지 않아 비어 나올 바코드 */
  const barcodeIssues = useMemo(() => {
    const codes = doc.design.filter((el) => el.type === 'barcode')
    if (!codes.length) return null
    let count = 0
    let first: string | null = null
    plan.labels.forEach((label, i) => {
      if (!label) return
      for (const el of codes) {
        const value = resolveText(el.value, label)
        const check = validateBarcode(el.symbology, value)
        if (check.ok) continue
        count++
        first ??= `${i + 1}번째 라벨 ‘${value.slice(0, 24) || '(빈 값)'}’ — ${check.message}`
      }
    })
    return count ? { count, first: first as string | null } : null
  }, [doc.design, plan])

  const update = history.set

  // ── 용지 ──
  const pickSheet = (sheet: SheetSpec) => {
    const resized = sheet.labelW !== doc.sheet.labelW || sheet.labelH !== doc.sheet.labelH
    update((d) => applySheet(d, sheet, true))
    setSelection([])
    if (resized && doc.design.length) toast.info('디자인을 새 칸 크기에 맞췄습니다. 어색하면 되돌리기(Ctrl+Z)를 누르세요.')
  }
  const onSheetField = (field: SheetField, value: number) => update((d) => applySheet(d, editSheet(d.sheet, field, value), false), `sheet:${field}`)
  const builtin = SHEET_BY_ID[doc.sheet.id]
  const sheetEdited = builtin ? JSON.stringify(builtin) !== JSON.stringify({ ...doc.sheet, custom: undefined }) : false
  const saveCustom = () => {
    const exists = customSheets.some((s) => s.id === doc.sheet.id)
    const sheet: SheetSpec = exists ? doc.sheet : { ...doc.sheet, id: `custom-${newId()}`, name: `${doc.sheet.name.replace(/ \(내 규격\)$/, '')} (내 규격)`, custom: true }
    setCustomSheets((list) => (exists ? list.map((s) => (s.id === sheet.id ? sheet : s)) : [sheet, ...list].slice(0, 40)))
    if (!exists) update((d) => ({ ...d, sheet }))
    toast.success('내 규격으로 저장했습니다. ‘용지 바꾸기’에서 다시 고를 수 있습니다.')
  }

  // ── 내용 ──
  const selectionStart = cells.length ? Math.min(...cells) : null
  const pasteText = useCallback(
    (text: string) => {
      let startLabel: number | null = null
      if (selectionStart !== null) {
        startLabel = slotIndex({ page: currentPage, cell: selectionStart }, plan.perSheet, plan.free0)
        if (startLabel < 0) return toast.warn('고른 칸은 건너뛰는 칸이라 채울 수 없습니다. 다른 칸을 고르거나 선택을 풀어 주세요.')
      }
      const out = pasteIntoDoc(doc, text, pasteMode, startLabel, pasteColumn)
      if (!out.ok) return toast.warn(out.message)
      update(out.doc)
      toast.success(`${pasteMode === 'cells' ? `라벨 ${out.count}칸` : `${out.count}줄`}을 채웠습니다.${out.bound ? ` 디자인의 글자를 ‘${out.bound}’ 열에 연결했습니다.` : ''}`)
      if (out.truncated) toast.warn(`한 번에 ${MAX_LABELS}장까지 만들 수 있어 나머지는 뺐습니다.`)
    },
    [doc, pasteMode, pasteColumn, selectionStart, currentPage, plan, update],
  )

  const importFile = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) return toast.error(`파일이 너무 큽니다(${formatBytes(file.size)}). 10MB 이하 파일만 불러올 수 있습니다.`)
    setImporting(true)
    try {
      const table = tableFromGrid(await readSpreadsheet(file), true)
      if (!table.rows.length) return toast.warn('파일에서 내용을 찾지 못했습니다. 첫 시트의 첫 줄이 열 이름, 그 아래가 내용인지 확인하세요.')
      const limit = Math.floor(MAX_LABELS / Math.max(1, doc.repeat))
      const rows = table.rows.slice(0, limit)
      update((d) => ({ ...d, mode: 'data', table: { columns: table.columns, rows }, design: autoBind(d.design, table.columns, d.sheet).design }))
      setSelection([])
      toast.success(`${file.name} 에서 ${rows.length}줄, 열 ${table.columns.length}개를 불러왔습니다. ‘열 연결’에서 디자인과 이어 주세요.`)
      if (table.rows.length > limit) toast.warn(`한 번에 ${MAX_LABELS}장까지 만들 수 있어 ${table.rows.length - limit}줄은 뺐습니다.`)
    } catch {
      toast.error('파일을 읽지 못했습니다. 엑셀(xlsx·xls)이나 CSV 파일인지 확인하세요.')
    } finally {
      setImporting(false)
    }
  }

  // ── 디자인 ──
  const setDesign = (design: LabelElement[], tag?: string) => update((d) => ({ ...d, design }), tag)
  const addElement = (el: LabelElement) => {
    update((d) => ({ ...d, design: [...d.design, el] }))
    setSelectedId(el.id)
  }
  const addText = () => {
    const unused = doc.mode === 'data' ? doc.table.columns.find((c) => !usedColumns(doc.design, doc.table.columns).has(c)) : undefined
    addElement(createText(doc.sheet, unused ? `{${unused}}` : '새 글자'))
  }
  const duplicate = () => {
    if (!selected) return
    addElement(clampElement({ ...selected, id: newId(), x: selected.x + 2, y: selected.y + 2 }, doc.sheet.labelW, doc.sheet.labelH))
  }
  const addImageFile = async (file: File, replaceId: string | null) => {
    if (!file.type.startsWith('image/')) return toast.warn('이미지 파일(PNG, JPG, WebP 등)만 넣을 수 있습니다.')
    if (file.size > MAX_IMAGE_BYTES) return toast.error(`이미지가 너무 큽니다(${formatBytes(file.size)}). 15MB 이하로 줄여 주세요.`)
    try {
      let canvas = await fileToCanvas(file)
      const fit = fitWithin(canvas.width, canvas.height, MAX_IMAGE_SIDE)
      if (fit.scale < 1) canvas = resizeCanvas(canvas, fit.width, fit.height)
      const src = await readAsDataURL(await canvasToBlob(canvas, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9))
      const existing = replaceId ? doc.design.find((el) => el.id === replaceId) : null
      if (existing?.type === 'image') setDesign(doc.design.map((el) => (el.id === existing.id ? { ...existing, src, natW: canvas.width, natH: canvas.height } : el)))
      else addElement(createImage(doc.sheet, src, canvas.width, canvas.height))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이미지를 열 수 없습니다.')
    }
  }
  const pickImage = (replaceId: string | null) => {
    replaceTarget.current = replaceId
    imageInput.current?.click()
  }

  // ── 단축키·붙여넣기 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        history.undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        history.redo()
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const image = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (tab === 'design' && image) {
        e.preventDefault()
        void addImageFile(image, null)
        return
      }
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (tab === 'sheet' && text.trim()) {
        e.preventDefault()
        pasteText(text)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  })

  // ── 인쇄·PDF ──
  const nothingToPrint = printed === 0
  const print = async () => {
    if (nothingToPrint) return toast.info('찍을 라벨이 없습니다. 내용을 넣거나 장수를 정해 주세요.')
    setPreparing(true)
    try {
      await prepareOutput(doc)
      setBarcodeRev((n) => n + 1)
      setPrinting(true)
    } catch {
      toast.error('인쇄 화면을 준비하지 못했습니다. 잠시 뒤 다시 해 보세요.')
    } finally {
      setPreparing(false)
    }
  }
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    // 인쇄용 배치가 문서에 붙은 뒤(이 효과는 커밋 다음에 돈다) 인쇄 창을 연다.
    // requestAnimationFrame 은 탭이 가려져 있으면 멈추므로 setTimeout 을 쓴다.
    const timer = window.setTimeout(() => window.print(), 60)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('afterprint', done)
    }
  }, [printing])

  const savePdf = async () => {
    if (nothingToPrint) return toast.info('저장할 라벨이 없습니다. 내용을 넣거나 장수를 정해 주세요.')
    const signal = abortable.start()
    setPdfJob({ done: 0, total: printed })
    try {
      const result = await exportPdf(doc, { signal, onProgress: (done, total) => setPdfJob({ done, total }) })
      const name = `${sanitizeFilename(`라벨_${doc.sheet.name}`, '라벨')}_${todayStamp()}.pdf`
      setLastPdf(blobToFile(result.blob, name))
      downloadBlob(result.blob, name)
      toast.success(`PDF 를 저장했습니다 — 용지 ${result.stats.pages}장, 라벨 ${result.stats.labels}장.`)
      if (result.stats.skippedBarcodes) toast.warn(`값이 맞지 않는 바코드 ${result.stats.skippedBarcodes}개는 비워 두었습니다.`)
      if (result.fontFallback) toast.info('글꼴 파일을 받지 못해 글자를 그림으로 넣었습니다. 인쇄 품질은 같습니다.')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') toast.info('PDF 만들기를 취소했습니다.')
      else toast.error('PDF 를 만들지 못했습니다. 이미지가 너무 크지 않은지 확인하고 다시 해 보세요.')
    } finally {
      setPdfJob(null)
    }
  }

  // ── 고른 칸에 하는 일 ──
  const allSkipped = cells.length > 0 && cells.every((c) => doc.skip.includes(c))
  const toggleSkip = () => {
    update((d) => ({ ...d, skip: allSkipped ? d.skip.filter((c) => !cells.includes(c)) : [...new Set([...d.skip, ...cells])].sort((a, b) => a - b) }))
    setSelection([])
  }
  const startHere = () => {
    if (selectionStart === null) return
    update((d) => ({ ...d, startCell: selectionStart, skip: d.skip.filter((c) => c !== selectionStart) }))
    setSelection([])
  }
  const clearSelected = () => {
    if (doc.mode === 'data' && selectedRows.length) update((d) => clearRows(d, selectedRows))
  }

  if (!loaded) {
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true" aria-label="저장된 작업을 불러오는 중">
        <div className="skeleton h-96" />
        <div className="skeleton h-96" />
      </div>
    )
  }

  const pdfBusy = pdfJob !== null
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line">
        <Tabs<Tab>
          label="작업 단계"
          value={tab}
          onValue={setTab}
          className="min-w-0 border-b-0! pb-px"
          tabs={[
            { value: 'sheet', label: '용지와 내용', icon: StickyNote },
            { value: 'design', label: '라벨 디자인', icon: PencilRuler },
          ]}
        />
        <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
          <IconButton icon={Undo2} label="되돌리기 (Ctrl+Z)" size="sm" disabled={!history.canUndo} onClick={history.undo} />
          <IconButton icon={Redo2} label="다시 하기 (Ctrl+Y)" size="sm" disabled={!history.canRedo} onClick={history.redo} />
          <IconButton
            icon={FilePlus2}
            label="새 라벨로 시작"
            size="sm"
            onClick={() => {
              update(defaultDoc())
              setSelection([])
              setSelectedId(null)
              toast.info('새 라벨로 시작했습니다. 이전 작업은 되돌리기(Ctrl+Z)로 돌아옵니다.')
            }}
          />
          <LibraryMenu<LabelTemplate>
            kind="label-template"
            noun="양식"
            size="sm"
            getData={async () => ({ data: toTemplate(doc), thumb: await makeThumb(doc) })}
            onLoad={(data, entry) => {
              const next = fromTemplate(data, doc)
              if (!next) return toast.error('이 양식은 읽을 수 없습니다. 다시 저장해 주세요.')
              update(next)
              setSelection([])
              setSelectedId(null)
              toast.success(`‘${entry.name}’ 양식을 불러왔습니다.`)
            }}
          />
          <Button size="sm" icon={FileDown} loading={pdfBusy} disabled={printing || preparing} onClick={savePdf}>
            PDF 로 저장
          </Button>
          <Button size="sm" variant="primary" icon={Printer} loading={preparing} disabled={pdfBusy || printing} onClick={print}>
            인쇄
          </Button>
        </div>
      </div>

      {pdfJob && (
        <div className="flex items-end gap-3 rounded-md border border-line bg-surface px-4 py-3">
          <Progress className="flex-1" value={pdfJob.total ? (pdfJob.done / pdfJob.total) * 100 : null} label={`PDF 를 만드는 중 — 라벨 ${pdfJob.done}/${pdfJob.total}`} />
          <Button size="sm" icon={Ban} onClick={abortable.abort}>
            취소
          </Button>
        </div>
      )}
      {lastPdf && !pdfJob && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-4 py-2.5 text-sm">
          <FileDown className="size-4 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">{lastPdf.name}</span>
          <span className="num text-muted">{formatBytes(lastPdf.size)}</span>
          <Button size="sm" variant="ghost" onClick={() => downloadBlob(lastPdf, lastPdf.name)}>
            다시 받기
          </Button>
          <SendToMenu files={[lastPdf]} exclude="label" size="sm" />
          <IconButton icon={X} label="닫기" size="sm" onClick={() => setLastPdf(null)} />
        </div>
      )}

      <ToolLayout
        panel={
          tab === 'sheet' ? (
            <SheetPanel
              doc={doc}
              plan={plan}
              titles={titles}
              update={update}
              onOpenPicker={() => setPickerOpen(true)}
              onSheetField={onSheetField}
              onResetSheet={sheetEdited && builtin ? () => update((d) => applySheet(d, builtin, false)) : null}
              onSaveCustom={saveCustom}
              pasteMode={pasteMode}
              setPasteMode={setPasteMode}
              pasteColumn={pasteColumn}
              setPasteColumn={setPasteColumn}
              onPasteText={pasteText}
              onImportFile={importFile}
              importing={importing}
              onClearData={() => {
                update((d) => ({ ...d, table: { columns: d.table.columns, rows: [] } }))
                setSelection([])
              }}
              onBind={(id, column) => setDesign(doc.design.map((el) => (el.id === id ? withContent(el, `{${column}}`) : el)))}
              onAddColumnTexts={() => setDesign(addColumnTexts(doc.design, doc.table.columns, doc.sheet))}
              onAddSerialText={() => {
                if (doc.design.some((el) => el.type === 'text' && findPlaceholders(el.text).includes(SERIAL_KEY))) return toast.info('디자인에 이미 연번 글자가 있습니다.')
                const el = createText(doc.sheet, `{${SERIAL_KEY}}`)
                addElement({ ...el, h: round2(Math.min(el.h, doc.sheet.labelH / 3)), y: 1, align: 'right' })
                toast.success('연번 글자를 넣었습니다. ‘라벨 디자인’에서 위치를 옮길 수 있습니다.')
              }}
              selectionNote={selectionStart !== null ? `${selectionStart + 1}번째 칸` : null}
              selectedRows={selectedRows}
              onSetSelectedValue={(column, value) => update((d) => setRowValues(d, selectedRows, column, value), `cell:${column}:${selectedRows.join(',')}`)}
            />
          ) : (
            <DesignPanel
              sheet={doc.sheet}
              design={doc.design}
              titles={titles}
              selected={selected}
              columns={doc.table.columns}
              label={sampleLabel}
              rev={rev}
              onSelect={setSelectedId}
              onChange={setDesign}
              onDuplicate={duplicate}
              onReplaceImage={() => pickImage(selectedId)}
            />
          )
        }
      >
        {tab === 'sheet' ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex items-center gap-1">
                <IconButton icon={ChevronLeft} label="앞 장" size="sm" variant="secondary" disabled={currentPage === 0} onClick={() => (setPage(currentPage - 1), setSelection([]))} />
                <span className="num min-w-16 text-center text-sm font-semibold text-ink-2">
                  {currentPage + 1} / {plan.pages} 장
                </span>
                <IconButton icon={ChevronRight} label="다음 장" size="sm" variant="secondary" disabled={currentPage >= plan.pages - 1} onClick={() => (setPage(currentPage + 1), setSelection([]))} />
              </div>
              <Segmented
                label="미리보기 크기"
                size="sm"
                value={zoom}
                onValue={setZoom}
                options={[
                  { value: 'fit', label: '화면에 맞춤' },
                  { value: 'actual', label: '실제 크기' },
                ]}
              />
              <p className="num ml-auto text-sm text-muted">
                라벨 {printed}장 · 용지 {plan.pages}장
              </p>
            </div>
            <SheetPreview doc={doc} plan={plan} page={currentPage} selection={cells} onSelect={setSelection} onClear={clearSelected} zoom={zoom} rev={rev} />
            {cells.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                <span className="num text-sm font-semibold text-ink">{cells.length}칸 고름</span>
                {currentPage === 0 && (
                  <>
                    <Button size="sm" icon={Play} onClick={startHere}>
                      {selectionStart! + 1}번째 칸부터 인쇄
                    </Button>
                    <Button size="sm" icon={Ban} onClick={toggleSkip}>
                      {allSkipped ? '쓴 칸 표시 풀기' : '이미 쓴 칸으로 표시'}
                    </Button>
                  </>
                )}
                {doc.mode === 'data' && selectedRows.length > 0 && (
                  <Button size="sm" icon={Eraser} onClick={clearSelected}>
                    내용 지우기
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelection([])}>
                  선택 풀기
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">칸을 누르거나 끌어서 고르면 그 칸의 내용을 적거나, 시작 칸·이미 쓴 칸을 정할 수 있습니다. 엑셀에서 복사한 뒤 여기서 Ctrl+V 를 눌러도 됩니다.</p>
            )}
            {barcodeIssues && (
              <Callout tone="warn" title={`바코드 ${barcodeIssues.count}개는 값이 맞지 않아 비어 나옵니다`}>
                {barcodeIssues.first}
              </Callout>
            )}
            {doc.mode === 'data' && (
              <DataTableEditor
                table={doc.table}
                highlight={new Set(selectedRows)}
                onCell={(r, c, value) => update((d) => ({ ...d, table: writeColumn(d.table, r, d.table.columns[c], [value]) }), `table:${r}:${c}`)}
                onRenameColumn={(c, name) => update((d) => renameColumn(d, c, name))}
                onRemoveColumn={(c) => update((d) => removeColumn(d, c))}
                onAddColumn={() => update((d) => addColumn(d))}
                onAddRow={() => update((d) => ({ ...d, table: { columns: d.table.columns, rows: [...d.table.rows, d.table.columns.map(() => '')] } }))}
                onRemoveRow={(r) => update((d) => ({ ...d, table: { columns: d.table.columns, rows: d.table.rows.filter((_, i) => i !== r) } }))}
              />
            )}
          </>
        ) : (
          <>
            <DesignEditor
              sheet={doc.sheet}
              design={doc.design}
              label={sampleLabel}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onPreview={(design) => history.preview((d) => ({ ...d, design }))}
              onCommit={history.commitPreview}
              onChange={setDesign}
              onAddText={addText}
              onAddShape={(shape) => addElement(createShape(doc.sheet, shape))}
              onAddBarcode={(symbology) => addElement(createBarcode(doc.sheet, symbology))}
              onPickImage={() => pickImage(null)}
              onDuplicate={duplicate}
              rev={rev}
            />
            <p className="text-sm text-muted">
              끌어서 옮기고 모서리 점을 끌어 크기를 바꿉니다. 가장자리·가운데·다른 요소에 맞춰 붙고, Alt 를 누른 채 끌면 붙지 않습니다. 화살표 키는 0.5mm, Shift+화살표는 0.1mm 씩 움직입니다.
              {sampleLabel && sampleLabel.row >= 0 && ` 자리표시는 표의 ${sampleLabel.row + 1}번째 줄 내용으로 보여 줍니다.`}
            </p>
          </>
        )}
      </ToolLayout>

      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/bmp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void addImageFile(file, replaceTarget.current)
        }}
      />
      <SheetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentId={doc.sheet.id}
        custom={customSheets}
        onPick={pickSheet}
        onAddCustom={(sheet) => setCustomSheets((list) => [sheet, ...list].slice(0, 40))}
        onRemoveCustom={(id) => setCustomSheets((list) => list.filter((s) => s.id !== id))}
      />
      {printing && <PrintSheets doc={doc} rev={rev} />}
    </div>
  )
}
