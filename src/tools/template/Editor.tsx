import '@fontsource/nanum-pen-script/400.css'
import '@fontsource/gaegu/400.css'
import '@fontsource/gaegu/700.css'
import clsx from 'clsx'
import {
  ArrowLeft,
  ArrowRight,
  Circle,
  CopyPlus,
  Download,
  FilePlus2,
  Highlighter,
  ImagePlus,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  MoveRight,
  Pencil,
  Plus,
  Redo2,
  Shapes,
  Square,
  SquareRoundCorner,
  Trash2,
  Triangle,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ButtonHTMLAttributes, type Ref } from 'react'
import { useHandoffFiles } from '@/app/handoff'
import { usePersistentState } from '@/lib/hooks'
import type { LibraryEntry } from '@/lib/library'
import { Button, Callout, IconButton, LibraryMenu, MenuItem, Popover, Tabs, TextInput, toast } from '@/ui'
import { AssetStore, importImage } from './assets'
import { CanvasController, NO_SELECTION, type BrushSettings, type Layer, type Selection, type ShapeKind, type TextPreset, type ToolMode } from './controller'
import { ExportPanel } from './ExportPanel'
import type { Fabric } from './fabricKit'
import { BASE_FONTS, addFontFile, canQueryLocalFonts, queryLocalFamilies, restoreFontFiles, type FontOption } from './fonts'
import {
  MAX_PAGES,
  addPage,
  createDoc,
  duplicatePage,
  historyInit,
  historyPush,
  historyRedo,
  historyReplace,
  historyUndo,
  isDocEmpty,
  isTemplatePack,
  movePage,
  removePage,
  resizeDoc,
  updatePage,
  type CanvasDoc,
  type History,
  type ObjectJSON,
  type PageDoc,
  type TemplatePack,
} from './model'
import { LayerList, PropertiesPanel } from './PropertiesPanel'
import { renderThumb } from './render'
import { SizeMenu } from './SizeMenu'
import { buildPack, clearCurrentWork, discardPreviousWork, openPack, restoreAssets, saveWork, takePreviousWork, type SavedWork } from './storage'

interface Snap {
  doc: CanvasDoc
  activeId: string
}

type PanelTab = 'props' | 'layers' | 'export'

const MAX_IMAGES_AT_ONCE = 30
/** 이 도구에서 복사했다는 표시. 붙여넣을 때 시스템 클립보드의 다른 내용과 구분한다. */
const CLIP_MARK = `onbijjang-canvas-clip:${Math.random().toString(36).slice(2)}`

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

function looksLikeImage(f: File): boolean {
  return f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(f.name)
}

function RailButton({ icon: Icon, label, active, ref, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      className={clsx(
        'flex h-14 min-w-11 flex-1 shrink-0 flex-col items-center justify-center gap-1 rounded-md border text-2xs font-semibold transition-colors duration-150 disabled:opacity-45 lg:w-14 lg:flex-none',
        active ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-transparent text-ink-2 hover:bg-sunken hover:text-ink',
        className,
      )}
      {...rest}
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </button>
  )
}

/** 페이지 미리보기. 바뀐 페이지만 잠시 뒤에 다시 그린다. */
function useThumbs(doc: CanvasDoc, assets: AssetStore): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const done = useRef(new Map<string, { objects: ObjectJSON[]; background: string | null; w: number; h: number }>())
  useEffect(() => {
    let alive = true
    const timer = setTimeout(async () => {
      for (const page of doc.pages) {
        const prev = done.current.get(page.id)
        if (prev && prev.objects === page.objects && prev.background === page.background && prev.w === doc.width && prev.h === doc.height) continue
        try {
          const url = await renderThumb(page, doc, assets)
          if (!alive) return
          done.current.set(page.id, { objects: page.objects, background: page.background, w: doc.width, h: doc.height })
          setThumbs((t) => ({ ...t, [page.id]: url }))
        } catch {
          // 미리보기를 못 만들어도 편집에는 지장이 없다.
        }
      }
    }, 280)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [doc, assets])
  return thumbs
}

export function Editor({ fabric }: { fabric: Fabric }) {
  const [savedSize, setSavedSize] = usePersistentState('onbijjang:template:size', { w: 1080, h: 1080 })
  const assets = useMemo(() => new AssetStore(), [])

  // 문서와 되돌리기 기록. 값은 ref 에 두어 언제 읽어도 최신이고, 바뀔 때만 다시 그린다.
  const histRef = useRef<History<Snap> | null>(null)
  if (!histRef.current) {
    const doc = createDoc(savedSize.w, savedSize.h)
    histRef.current = historyInit<Snap>({ doc, activeId: doc.pages[0].id })
  }
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const lastPush = useRef({ key: '', at: 0 })
  const mutate = useCallback((fn: (h: History<Snap>) => History<Snap>) => {
    const next = fn(histRef.current!)
    if (next !== histRef.current) {
      histRef.current = next
      bump()
    }
  }, [])
  /** 문서를 바꾸고 기록한다. coalesce 가 같은 변경이 잇따르면(색 고르기 등) 기록 하나로 합친다. */
  const change = useCallback(
    (fn: (s: Snap) => Snap, coalesce = '') => {
      const now = Date.now()
      const merge = !!coalesce && lastPush.current.key === coalesce && now - lastPush.current.at < 900
      lastPush.current = { key: coalesce, at: now }
      mutate((h) => (merge ? historyReplace(h, fn(h.present)) : historyPush(h, fn(h.present))))
    },
    [mutate],
  )

  const hist = histRef.current
  const { doc } = hist.present
  const pageIndex = Math.max(
    0,
    doc.pages.findIndex((p) => p.id === hist.present.activeId),
  )
  const page = doc.pages[pageIndex]

  const [name, setName] = useState('제목 없는 디자인')
  const [sel, setSel] = useState<Selection>(NO_SELECTION)
  const [layers, setLayers] = useState<Layer[]>([])
  const [zoom, setZoom] = useState(1)
  const [mode, setModeState] = useState<ToolMode>('select')
  const [brushes, setBrushes] = useState<BrushSettings>({ pen: { color: '#14201a', width: 6 }, highlighter: { color: '#ffe55c', width: 28 } })
  const [tab, setTab] = useState<PanelTab>('props')
  const [wide, setWide] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [ready, setReady] = useState(0)
  const [previous, setPrevious] = useState<SavedWork | null>(null)
  const [resuming, setResuming] = useState(false)

  const hostRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const ctl = useRef<CanvasController | null>(null)

  // ── 편집 화면 만들기 ────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const c = new CanvasController(fabric, host, assets, {
      onCommit: (pageId, objects) => {
        lastPush.current = { key: '', at: 0 }
        mutate((h) => historyPush(h, { ...h.present, doc: updatePage(h.present.doc, pageId, { objects }) }))
      },
      onSelection: setSel,
      onLayers: setLayers,
      onZoom: setZoom,
      onMode: (m) => {
        setModeState(m)
        // 펜 설정은 속성 탭에 있다.
        if (m !== 'select') setTab('props')
      },
    })
    ctl.current = c
    setReady((n) => n + 1)
    return () => {
      ctl.current = null
      c.dispose()
    }
  }, [fabric, assets, mutate])

  useEffect(() => () => assets.dispose(), [assets])

  useEffect(() => {
    ctl.current?.setPage({ width: doc.width, height: doc.height, background: page.background })
  }, [ready, doc.width, doc.height, page.background])

  useEffect(() => {
    const c = ctl.current
    if (c && !c.isShowing(page.id, page.objects)) void c.load(page.id, page.objects)
  }, [ready, page.id, page.objects])

  // ── 글꼴 ────────────────────────────────────────────────
  const [localFamilies, setLocalFamilies] = usePersistentState<string[]>('onbijjang:template:localFonts', [])
  const [fileFamilies, setFileFamilies] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    void restoreFontFiles().then((list) => {
      if (!alive || !list.length) return
      setFileFamilies(list)
      ctl.current?.remeasureText()
    })
    return () => {
      alive = false
    }
  }, [])
  const fonts = useMemo<FontOption[]>(() => {
    const known = new Set(BASE_FONTS.map((f) => f.family))
    const files = fileFamilies.filter((f) => !known.has(f)).map((family): FontOption => ({ family, label: `${family} (추가한 파일)`, source: 'file' }))
    files.forEach((f) => known.add(f.family))
    const locals = localFamilies.filter((f) => !known.has(f)).map((family): FontOption => ({ family, label: family, source: 'local' }))
    return [...BASE_FONTS, ...files, ...locals]
  }, [fileFamilies, localFamilies])

  const queryFonts = async () => {
    try {
      const list = await queryLocalFamilies()
      setLocalFamilies(list.slice(0, 800))
      toast.success(`내 PC 글꼴 ${list.length}개를 글꼴 목록에 넣었습니다.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '글꼴을 불러오지 못했습니다.')
    }
  }
  const addFont = async (file: File) => {
    try {
      const family = await addFontFile(file)
      setFileFamilies((prev) => (prev.includes(family) ? prev : [...prev, family]))
      await ctl.current?.setText({ fontFamily: family })
      toast.success(`‘${family}’ 글꼴을 추가했습니다. 이 브라우저에 보관됩니다.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '글꼴을 추가하지 못했습니다.')
    }
  }

  // ── 사진 올리기 ─────────────────────────────────────────
  const addImages = useCallback(
    async (incoming: File[], at?: { x: number; y: number }) => {
      let files = incoming.filter(looksLikeImage)
      if (!files.length) {
        toast.warn('사진 파일(PNG, JPG, WebP 등)만 올릴 수 있습니다.')
        return
      }
      if (files.length > MAX_IMAGES_AT_ONCE) {
        toast.warn(`한 번에 ${MAX_IMAGES_AT_ONCE}장까지 올릴 수 있어 앞의 ${MAX_IMAGES_AT_ONCE}장만 넣었습니다.`)
        files = files.slice(0, MAX_IMAGES_AT_ONCE)
      }
      let resized = 0
      let failure: string | null = null
      let placed = 0
      for (const file of files) {
        try {
          const r = await importImage(file)
          const asset = assets.add(r.blob, r.width, r.height)
          await ctl.current?.addImage(asset, at ? { x: at.x + placed * 24, y: at.y + placed * 24 } : undefined)
          if (r.resized) resized++
          placed++
        } catch (err) {
          failure = err instanceof Error ? err.message : '사진을 열 수 없습니다.'
        }
      }
      if (failure) toast.error(placed ? `일부 사진을 넣지 못했습니다. ${failure}` : failure)
      if (resized) toast.info(`큰 사진 ${resized}장은 긴 변 4096px 로 줄여 넣었습니다.`)
    },
    [assets],
  )
  useHandoffFiles('template', (files) => void addImages(files))

  // ── 되돌리기·페이지 ─────────────────────────────────────
  const undo = useCallback(() => {
    ctl.current?.flush()
    mutate(historyUndo)
  }, [mutate])
  const redo = useCallback(() => {
    ctl.current?.flush()
    mutate(historyRedo)
  }, [mutate])

  const selectPage = (id: string) => {
    ctl.current?.flush()
    mutate((h) => historyReplace(h, { ...h.present, activeId: id }))
  }
  const pageOp = (fn: (d: CanvasDoc, index: number) => { doc: CanvasDoc; active: number }) => {
    ctl.current?.flush()
    change((s) => {
      const index = Math.max(
        0,
        s.doc.pages.findIndex((p) => p.id === s.activeId),
      )
      const r = fn(s.doc, index)
      return r.doc === s.doc ? s : { doc: r.doc, activeId: r.doc.pages[Math.max(0, Math.min(r.doc.pages.length - 1, r.active))].id }
    })
  }
  const canAddPage = doc.pages.length < MAX_PAGES

  const applySize = (w: number, h: number, fitContent: boolean) => {
    ctl.current?.flush()
    setSavedSize({ w, h })
    change((s) => ({ ...s, doc: resizeDoc(s.doc, w, h, fitContent) }))
  }

  const patchPage = (patch: Partial<Pick<PageDoc, 'background' | 'seconds'>>, coalesce: string) => {
    ctl.current?.flush()
    change((s) => ({ ...s, doc: updatePage(s.doc, s.activeId, patch) }), coalesce ? `${coalesce}:${page.id}` : '')
  }

  const replaceDoc = (next: CanvasDoc, nextName?: string) => {
    ctl.current?.flush()
    change(() => ({ doc: next, activeId: next.pages[0].id }))
    if (nextName) setName(nextName)
  }

  const newDesign = () => {
    replaceDoc(createDoc(doc.width, doc.height), '제목 없는 디자인')
    toast.info('새 디자인을 열었습니다. 되돌리기(Ctrl+Z)로 이전 작업으로 돌아갈 수 있습니다.')
  }

  // ── 자동 저장·이어서 하기 ───────────────────────────────
  useEffect(() => {
    let alive = true
    void takePreviousWork().then((work) => alive && setPrevious(work))
    return () => {
      alive = false
    }
  }, [])

  const saveWarned = useRef(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      const job = isDocEmpty(doc) ? clearCurrentWork() : saveWork(doc, name, assets)
      job.catch(() => {
        if (saveWarned.current) return
        saveWarned.current = true
        toast.warn('자동 저장을 하지 못했습니다. 브라우저 저장 공간이 부족하거나 막혀 있습니다. 작업은 팀 보관함이나 파일로 저장해 주세요.')
      })
    }, 1500)
    return () => clearTimeout(timer)
  }, [doc, name, assets])

  const resume = async () => {
    if (!previous) return
    setResuming(true)
    try {
      const missing = await restoreAssets(previous, assets)
      replaceDoc(previous.doc, previous.name)
      setPrevious(null)
      if (missing) toast.warn(`사진 ${missing}장은 찾지 못해 빈 칸으로 남았습니다.`)
      else toast.success('지난 작업을 불러왔습니다.')
    } catch {
      toast.error('지난 작업을 불러오지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setResuming(false)
    }
  }

  // ── 팀 보관함 ───────────────────────────────────────────
  const loadPack = async (data: TemplatePack, entry: LibraryEntry) => {
    if (!isTemplatePack(data)) {
      toast.error('이 항목은 템플릿 캔버스에서 만든 것이 아니라 열 수 없습니다.')
      return
    }
    try {
      const next = await openPack(data, assets)
      replaceDoc(next, data.name || entry.name)
      toast.success(`‘${entry.name}’ 템플릿을 불러왔습니다.`)
    } catch {
      toast.error('템플릿을 불러오지 못했습니다. 다시 시도해 주세요.')
    }
  }

  // ── 단축키·복사 붙여넣기 ────────────────────────────────
  const keys = useRef({ undo, redo, addImages })
  keys.current = { undo, redo, addImages }
  useEffect(() => {
    const blocked = (e: Event) => isTypingTarget(e.target) || !!document.querySelector('dialog[open]') || !ctl.current || ctl.current.isEditingText()
    const onKey = (e: KeyboardEvent) => {
      if (blocked(e)) return
      const c = ctl.current!
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      let handled = true
      if (mod && key === 'z') e.shiftKey ? keys.current.redo() : keys.current.undo()
      else if (mod && key === 'y') keys.current.redo()
      else if (mod && key === 'd') void c.duplicate()
      else if (mod && key === 'a') c.selectAll()
      else if (mod && key === 'g') e.shiftKey ? c.ungroup() : c.group()
      else if (mod && (key === ']' || key === '}')) c.order(e.shiftKey ? 'front' : 'forward')
      else if (mod && (key === '[' || key === '{')) c.order(e.shiftKey ? 'back' : 'backward')
      else if (mod && key === '0') c.fit('page')
      else if (mod && (key === '=' || key === '+')) c.zoomBy(1.25)
      else if (mod && key === '-') c.zoomBy(0.8)
      else if (mod || e.altKey) handled = false
      else if (key === 'delete' || key === 'backspace') c.deleteSelection()
      else if (key === 'escape') {
        if (c.getMode() !== 'select') c.setMode('select')
        else c.deselect()
      } else if (key.startsWith('arrow') && c.hasSelection()) {
        const d = e.shiftKey ? 10 : 1
        c.nudge(key === 'arrowleft' ? -d : key === 'arrowright' ? d : 0, key === 'arrowup' ? -d : key === 'arrowdown' ? d : 0)
      } else if (key === 'v') c.setMode('select')
      else if (key === 'p') c.setMode('pen')
      else if (key === 'h') c.setMode('highlighter')
      else handled = false
      if (handled) e.preventDefault()
    }
    const onCopy = (e: ClipboardEvent) => {
      if (blocked(e) || !ctl.current!.copy()) return
      e.clipboardData?.setData('text/plain', CLIP_MARK)
      e.preventDefault()
    }
    const onCut = (e: ClipboardEvent) => {
      if (blocked(e) || !ctl.current!.cut()) return
      e.clipboardData?.setData('text/plain', CLIP_MARK)
      e.preventDefault()
    }
    const onPaste = (e: ClipboardEvent) => {
      if (blocked(e)) return
      const files = Array.from(e.clipboardData?.files ?? []).filter(looksLikeImage)
      if (files.length) {
        e.preventDefault()
        void keys.current.addImages(files)
      } else if (ctl.current!.hasClip() && e.clipboardData?.getData('text/plain') === CLIP_MARK) {
        e.preventDefault()
        void ctl.current!.paste()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCut)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCut)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  const setMode = (m: ToolMode) => ctl.current?.setMode(m)
  const setBrush = (m: 'pen' | 'highlighter', patch: Partial<{ color: string; width: number }>) => {
    setBrushes((prev) => ({ ...prev, [m]: { ...prev[m], ...patch } }))
    ctl.current?.setBrush(m, patch)
  }
  const openExport = () => {
    setTab('export')
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  const thumbs = useThumbs(doc, assets)
  const thumbHeight = 72
  const thumbWidth = Math.round(Math.max(40, Math.min(150, (thumbHeight * doc.width) / doc.height)))
  const empty = isDocEmpty(doc)

  const TEXT_PRESETS: Array<{ preset: TextPreset; label: string }> = [
    { preset: 'title', label: '제목' },
    { preset: 'subtitle', label: '부제목' },
    { preset: 'body', label: '본문' },
    { preset: 'hand', label: '손글씨' },
  ]
  const SHAPES: Array<{ kind: ShapeKind; label: string; icon: LucideIcon }> = [
    { kind: 'rect', label: '사각형', icon: Square },
    { kind: 'round', label: '둥근 사각형', icon: SquareRoundCorner },
    { kind: 'ellipse', label: '원', icon: Circle },
    { kind: 'triangle', label: '삼각형', icon: Triangle },
    { kind: 'line', label: '선', icon: Minus },
    { kind: 'arrow', label: '화살표', icon: MoveRight },
  ]

  return (
    <div className={clsx('flex flex-col gap-3', wide && 'fixed inset-0 z-[60] overflow-y-auto bg-paper p-2 sm:p-3 lg:overflow-hidden')}>
      {previous && (
        <Callout tone="info" title="지난번에 하던 작업이 남아 있습니다">
          <p>
            ‘{previous.name}’ · {previous.doc.pages.length}페이지 · {new Date(previous.savedAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}
            {!empty && ' — 이어서 하면 지금 화면은 그 작업으로 바뀝니다(되돌리기 가능).'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" loading={resuming} onClick={resume}>
              이어서 하기
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={resuming}
              onClick={() => {
                void discardPreviousWork()
                setPrevious(null)
              }}
            >
              지우기
            </Button>
          </div>
        </Callout>
      )}

      <div className={clsx('flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-1', wide ? 'lg:min-h-0 lg:flex-1' : 'lg:h-[max(620px,calc(100dvh-11rem))]')}>
        {/* 위쪽 도구 모음 */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-3 py-2">
          <TextInput aria-label="디자인 이름" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => !name.trim() && setName('제목 없는 디자인')} className="h-8! w-36! px-2! text-sm! font-semibold sm:w-44!" />
          <SizeMenu width={doc.width} height={doc.height} hasContent={!empty} onApply={applySize} />
          <div className="flex items-center">
            <IconButton icon={Undo2} label="되돌리기 (Ctrl+Z)" size="sm" disabled={!hist.past.length} onClick={undo} />
            <IconButton icon={Redo2} label="다시 실행 (Ctrl+Y)" size="sm" disabled={!hist.future.length} onClick={redo} />
          </div>
          <div className="flex items-center">
            <IconButton icon={ZoomOut} label="축소 (Ctrl+-)" size="sm" onClick={() => ctl.current?.zoomBy(0.8)} />
            <Popover
              trigger={({ ref, ...props }) => (
                <button ref={ref} type="button" title="확대 배율" className="num h-8 min-w-14 rounded-md px-1.5 text-sm font-semibold text-ink-2 transition-colors duration-150 hover:bg-sunken hover:text-ink" {...props}>
                  {Math.round(zoom * 100)}%
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    onClick={() => {
                      ctl.current?.fit('page')
                      close()
                    }}
                  >
                    화면에 맞춤 (Ctrl+0)
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      ctl.current?.fit('width')
                      close()
                    }}
                  >
                    너비에 맞춤
                  </MenuItem>
                  {[50, 100, 200].map((z) => (
                    <MenuItem
                      key={z}
                      onClick={() => {
                        ctl.current?.zoomTo(z / 100)
                        close()
                      }}
                    >
                      {z}%
                    </MenuItem>
                  ))}
                </>
              )}
            </Popover>
            <IconButton icon={ZoomIn} label="확대 (Ctrl++)" size="sm" onClick={() => ctl.current?.zoomBy(1.25)} />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <IconButton icon={FilePlus2} label="새 디자인" size="sm" disabled={empty} onClick={newDesign} />
            <IconButton icon={wide ? Minimize2 : Maximize2} label={wide ? '원래 크기로' : '화면 가득 넓게 보기'} size="sm" active={wide} onClick={() => setWide((w) => !w)} />
            <LibraryMenu<TemplatePack>
              kind="canvas-template"
              noun="템플릿"
              size="sm"
              getData={async () => {
                ctl.current?.flush()
                const cur = histRef.current!.present.doc
                if (isDocEmpty(cur)) return null
                const r = await buildPack(cur, name, assets)
                if (r.shrunkTo) toast.warn(`사진 용량이 커서 긴 변 ${r.shrunkTo}px 이하로 줄여 담았습니다. 지금 화면의 사진은 그대로입니다.`)
                return { data: r.pack, thumb: r.thumb }
              }}
              onLoad={(data, entry) => void loadPack(data, entry)}
            />
            <Button size="sm" variant={tab === 'export' ? 'secondary' : 'primary'} icon={Download} onClick={openExport}>
              내보내기
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[72px_minmax(0,1fr)_312px] lg:grid-rows-[minmax(0,1fr)_auto]">
          {/* 왼쪽 도구 */}
          <div className="flex gap-1 overflow-x-auto border-b border-line p-1.5 lg:col-start-1 lg:row-start-1 lg:flex-col lg:items-center lg:overflow-y-auto lg:overflow-x-hidden lg:border-b-0 lg:border-r">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                if (files.length) void addImages(files)
              }}
            />
            <RailButton icon={MousePointer2} label="선택" title="선택 (V)" active={mode === 'select'} onClick={() => setMode('select')} />
            <RailButton icon={ImagePlus} label="사진" title="사진 넣기" onClick={() => fileInput.current?.click()} />
            <Popover
              trigger={({ ref, ...props }) => <RailButton ref={ref} icon={Type} label="글자" title="글자 넣기" {...props} />}
            >
              {(close) =>
                TEXT_PRESETS.map((t) => (
                  <MenuItem
                    key={t.preset}
                    icon={Type}
                    onClick={() => {
                      close()
                      void ctl.current?.addText(t.preset)
                    }}
                  >
                    {t.label}
                  </MenuItem>
                ))
              }
            </Popover>
            <Popover
              trigger={({ ref, ...props }) => <RailButton ref={ref} icon={Shapes} label="도형" title="도형 넣기" {...props} />}
            >
              {(close) =>
                SHAPES.map((s) => (
                  <MenuItem
                    key={s.kind}
                    icon={s.icon}
                    onClick={() => {
                      close()
                      ctl.current?.addShape(s.kind)
                    }}
                  >
                    {s.label}
                  </MenuItem>
                ))
              }
            </Popover>
            <RailButton icon={Pencil} label="펜" title="손글씨 펜 (P)" active={mode === 'pen'} onClick={() => setMode(mode === 'pen' ? 'select' : 'pen')} />
            <RailButton icon={Highlighter} label="형광펜" title="형광펜 (H)" active={mode === 'highlighter'} onClick={() => setMode(mode === 'highlighter' ? 'select' : 'highlighter')} />
          </div>

          {/* 가운데 작업 매트 */}
          <div
            className={clsx('mat relative h-[58dvh] min-h-[320px] overflow-hidden lg:col-start-2 lg:row-start-1 lg:h-auto lg:min-h-0', dragOver && 'ring-3 ring-inset ring-mark')}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return
              e.preventDefault()
              setDragOver(false)
              void addImages(Array.from(e.dataTransfer.files), ctl.current?.scenePoint(e.clientX, e.clientY))
            }}
          >
            <div ref={hostRef} className="absolute inset-0 touch-none" />
            {empty && mode === 'select' && (
              <p className="pointer-events-none absolute inset-x-3 bottom-3 text-center text-sm font-medium">사진을 끌어다 놓거나 붙여넣고(Ctrl+V), 왼쪽에서 글자·도형을 넣어 시작하세요.</p>
            )}
          </div>

          {/* 아래쪽 페이지 목록 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-3 py-2 lg:col-span-3 lg:row-start-2">
            <ol className="flex min-w-0 flex-1 items-end gap-2 overflow-x-auto py-1 pl-1" aria-label="페이지 목록">
              {doc.pages.map((p, i) => {
                const active = p.id === page.id
                return (
                  <li key={p.id} className="shrink-0">
                    <button
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      aria-label={`${i + 1}페이지`}
                      onClick={() => selectPage(p.id)}
                      className={clsx('flex flex-col items-center gap-1 rounded-sm transition-opacity duration-150', !active && 'opacity-75 hover:opacity-100')}
                    >
                      <span
                        className={clsx('checker block overflow-hidden rounded-xs border', active ? 'border-brand ring-2 ring-brand/35' : 'border-line-strong')}
                        style={{ width: thumbWidth, height: thumbHeight }}
                      >
                        {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" className="size-full object-contain" draggable={false} /> : <span className="skeleton block size-full rounded-none!" />}
                      </span>
                      <span className={clsx('num text-2xs font-bold', active ? 'text-brand-ink' : 'text-muted')}>{i + 1}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
            <div className="flex items-center gap-0.5">
              <span className="num mr-1.5 text-sm text-muted">
                {pageIndex + 1} / {doc.pages.length}
              </span>
              <IconButton icon={ArrowLeft} label="이 페이지를 앞으로" size="sm" disabled={pageIndex === 0} onClick={() => pageOp((d, i) => ({ doc: movePage(d, i, i - 1), active: i - 1 }))} />
              <IconButton icon={ArrowRight} label="이 페이지를 뒤로" size="sm" disabled={pageIndex === doc.pages.length - 1} onClick={() => pageOp((d, i) => ({ doc: movePage(d, i, i + 1), active: i + 1 }))} />
              <IconButton icon={CopyPlus} label="이 페이지 복제" size="sm" disabled={!canAddPage} onClick={() => pageOp((d, i) => ({ doc: duplicatePage(d, i), active: i + 1 }))} />
              <IconButton icon={Trash2} label="이 페이지 삭제" size="sm" variant="danger" disabled={doc.pages.length <= 1} onClick={() => pageOp((d, i) => ({ doc: removePage(d, i), active: Math.max(0, i - 1) }))} />
              <Button size="sm" icon={Plus} className="ml-1.5" disabled={!canAddPage} title={canAddPage ? undefined : `페이지는 ${MAX_PAGES}장까지 만들 수 있습니다.`} onClick={() => pageOp((d, i) => ({ doc: addPage(d, i), active: i + 1 }))}>
                페이지 추가
              </Button>
            </div>
          </div>

          {/* 오른쪽 설정 */}
          <aside ref={panelRef} className="flex min-h-0 flex-col border-t border-line lg:col-start-3 lg:row-start-1 lg:border-l lg:border-t-0">
            <Tabs
              label="설정 종류"
              value={tab}
              onValue={setTab}
              className="shrink-0 px-2"
              tabs={[
                { value: 'props', label: '속성' },
                { value: 'layers', label: `레이어 ${layers.length || ''}`.trim() },
                { value: 'export', label: '내보내기' },
              ]}
            />
            <div className="min-h-0 flex-1 lg:overflow-y-auto">
              {tab === 'props' && (
                <PropertiesPanel
                  ctl={ctl.current}
                  sel={sel}
                  layers={layers}
                  mode={mode}
                  brushes={brushes}
                  onBrush={setBrush}
                  page={page}
                  pageNumber={pageIndex + 1}
                  docSize={doc}
                  onPagePatch={patchPage}
                  fonts={fonts}
                  canQueryFonts={canQueryLocalFonts()}
                  onQueryFonts={() => void queryFonts()}
                  onFontFile={(f) => void addFont(f)}
                />
              )}
              {tab === 'layers' && <LayerList ctl={ctl.current} layers={layers} />}
              {tab === 'export' && (
                <ExportPanel
                  doc={doc}
                  assets={assets}
                  getDoc={() => {
                    ctl.current?.flush()
                    const s = histRef.current!.present
                    return { doc: s.doc, page: s.doc.pages.find((p) => p.id === s.activeId) ?? s.doc.pages[0], name: name.trim() || '디자인' }
                  }}
                />
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
