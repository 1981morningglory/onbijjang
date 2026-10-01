/**
 * PDF 작업대 상태. 모듈 수준에 두어 탭을 옮기거나 다른 도구에 다녀와도 추가한 문서가 남는다.
 * 파일은 메모리에만 있고 새로고침하면 사라진다(브라우저 저장소에 남기지 않는다).
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { create } from 'zustand'
import { toast } from '@/ui'
import type { Quarter } from './geometry'

export type TabId = 'organize' | 'split' | 'create' | 'image' | 'word' | 'excel' | 'ppt' | 'compress' | 'stamp' | 'protect' | 'ocr'

export interface PdfSource {
  id: string
  kind: 'pdf'
  name: string
  size: number
  file: File
  pdf: PDFDocumentProxy
  pageCount: number
  /** 암호화된 문서였는지 */
  encrypted: boolean
  /** 암호를 푼 사본(쪽 복사에 쓴다). 암호화되지 않은 문서는 null — 원본 파일을 그대로 쓴다. */
  editBytes: Uint8Array | null
  /** false 면 원본 구조를 복사할 수 없어, PDF 로 저장할 때 쪽을 그림으로 바꿔 넣는다 */
  editable: boolean
}

export interface ImageSource {
  id: string
  kind: 'image'
  name: string
  size: number
  file: File
  width: number
  height: number
}

export type Source = PdfSource | ImageSource

export interface PageItem {
  id: string
  sourceId: string
  /** 원본 안에서의 쪽 위치(0부터). 사진은 항상 0 */
  index: number
  /** 사용자가 더한 회전 */
  rotation: Quarter
  selected: boolean
}

export interface ResultFile {
  id: string
  file: File
}

export interface Sheet {
  name: string
  rows: string[][]
  /** 표로 보이는 줄 수(0 이면 표가 아닌 글) */
  tableRows: number
}

export interface PasswordPrompt {
  name: string
  wrong: boolean
  resolve: (value: string | null) => void
}

interface WorkspaceState {
  sources: Record<string, Source>
  sourceOrder: string[]
  pages: PageItem[]
  /** 파일을 여는 중인 개수 */
  opening: number
  job: { label: string; progress: number | null } | null
  error: string | null
  results: ResultFile[]
  resultsTitle: string
  resultsNote: string | null
  passwordPrompt: PasswordPrompt | null
  sheets: Sheet[] | null
  ocrText: string | null
  /** 'PDF 만들기' 탭에서 PDF 로 바꿀 Word·Excel 문서 */
  officeFile: File | null
}

export const useWorkspace = create<WorkspaceState>(() => ({
  sources: {},
  sourceOrder: [],
  pages: [],
  opening: 0,
  job: null,
  error: null,
  results: [],
  resultsTitle: '',
  resultsNote: null,
  passwordPrompt: null,
  sheets: null,
  ocrText: null,
  officeFile: null,
}))

const set = useWorkspace.setState
const get = useWorkspace.getState

let seq = 0
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(++seq).toString(36)}`

// ── 쪽 목록 다루기 ────────────────────────────────────────
/** 작업 대상: 고른 쪽이 있으면 고른 쪽만, 없으면 전체 */
export function targetPages(pages: PageItem[]): PageItem[] {
  const picked = pages.filter((p) => p.selected)
  return picked.length ? picked : pages
}

export function toggleSelect(id: string, range = false) {
  set((s) => {
    const idx = s.pages.findIndex((p) => p.id === id)
    if (idx < 0) return s
    if (range && lastToggled) {
      const from = s.pages.findIndex((p) => p.id === lastToggled)
      if (from >= 0) {
        const [a, b] = from < idx ? [from, idx] : [idx, from]
        return { pages: s.pages.map((p, i) => (i >= a && i <= b ? { ...p, selected: true } : p)) }
      }
    }
    lastToggled = id
    return { pages: s.pages.map((p, i) => (i === idx ? { ...p, selected: !p.selected } : p)) }
  })
}
let lastToggled: string | null = null

export function selectWhere(predicate: (page: PageItem, position: number) => boolean) {
  set((s) => ({ pages: s.pages.map((p, i) => ({ ...p, selected: predicate(p, i) })) }))
}

export function rotatePages(ids: Set<string>, delta: 90 | -90 | 180) {
  set((s) => ({
    pages: s.pages.map((p) => (ids.has(p.id) ? { ...p, rotation: ((((p.rotation + delta) % 360) + 360) % 360) as Quarter } : p)),
  }))
}

export function removePages(ids: Set<string>) {
  set((s) => {
    const pages = s.pages.filter((p) => !ids.has(p.id))
    return pruneSources({ ...s, pages })
  })
}

/** 쪽이 하나도 남지 않은 원본은 목록에서도 뺀다. */
function pruneSources(s: WorkspaceState): Partial<WorkspaceState> {
  const alive = new Set(s.pages.map((p) => p.sourceId))
  const dead = s.sourceOrder.filter((id) => !alive.has(id))
  if (!dead.length) return { pages: s.pages }
  const sources = { ...s.sources }
  for (const id of dead) {
    disposeSource(sources[id])
    delete sources[id]
  }
  return { pages: s.pages, sources, sourceOrder: s.sourceOrder.filter((id) => alive.has(id)) }
}

const disposers = new Set<(source: Source) => void>()
/** 원본이 빠질 때 미리보기·캐시를 정리하려는 모듈이 등록한다. */
export function onSourceRemoved(fn: (source: Source) => void) {
  disposers.add(fn)
}
function disposeSource(source: Source | undefined) {
  if (!source) return
  for (const fn of disposers) fn(source)
  if (source.kind === 'pdf') void source.pdf.loadingTask.destroy().catch(() => {})
}

export function removeSource(id: string) {
  set((s) => pruneSources({ ...s, pages: s.pages.filter((p) => p.sourceId !== id) }))
}

export function clearWorkspace() {
  set((s) => ({ ...pruneSources({ ...s, pages: [] }), sheets: null, ocrText: null }))
}

/**
 * ids 의 쪽들을 (지금 순서를 지킨 채) before 쪽 앞으로 옮긴다. before 가 null 이면 맨 뒤로.
 */
export function movePages(ids: Set<string>, before: string | null) {
  set((s) => {
    // 놓는 자리가 옮기는 묶음 안이면, 그 뒤에 오는 첫 번째 "안 옮기는 쪽" 앞으로 본다.
    let anchor = before
    if (anchor && ids.has(anchor)) {
      const from = s.pages.findIndex((p) => p.id === anchor)
      anchor = s.pages.slice(from).find((p) => !ids.has(p.id))?.id ?? null
    }
    const moving = s.pages.filter((p) => ids.has(p.id))
    const rest = s.pages.filter((p) => !ids.has(p.id))
    const at = anchor ? rest.findIndex((p) => p.id === anchor) : rest.length
    const pos = at < 0 ? rest.length : at
    return { pages: [...rest.slice(0, pos), ...moving, ...rest.slice(pos)] }
  })
}

/** 고른 쪽들을 한 칸 앞/뒤로 */
export function nudgePages(ids: Set<string>, dir: -1 | 1) {
  set((s) => {
    const pages = [...s.pages]
    if (dir < 0) {
      for (let i = 1; i < pages.length; i++) {
        if (ids.has(pages[i].id) && !ids.has(pages[i - 1].id)) [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]
      }
    } else {
      for (let i = pages.length - 2; i >= 0; i--) {
        if (ids.has(pages[i].id) && !ids.has(pages[i + 1].id)) [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]
      }
    }
    return { pages }
  })
}

export function addSource(source: Source, pageCount: number) {
  set((s) => ({
    sources: { ...s.sources, [source.id]: source },
    sourceOrder: [...s.sourceOrder, source.id],
    pages: [...s.pages, ...Array.from({ length: pageCount }, (_, index) => ({ id: newId('p'), sourceId: source.id, index, rotation: 0 as Quarter, selected: false }))],
  }))
}

// ── 결과 ──────────────────────────────────────────────────
export function setResults(title: string, files: File[], note: string | null = null) {
  set({ results: files.map((file) => ({ id: newId('r'), file })), resultsTitle: title, resultsNote: note })
}
export function clearResults() {
  set({ results: [], resultsTitle: '', resultsNote: null })
}

// ── 긴 작업(한 번에 하나) ─────────────────────────────────
export interface JobControl {
  signal: AbortSignal
  /** percent: 0–100, null 이면 끝을 알 수 없는 진행 */
  progress: (percent: number | null, label?: string) => void
}

let currentAbort: AbortController | null = null

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : (err as { name?: string } | null)?.name === 'AbortError'
}

/** 화면이 멈추지 않게 한 박자 쉰다. */
export const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function runJob(label: string, work: (ctl: JobControl) => Promise<void>): Promise<boolean> {
  if (get().job) {
    toast.info('지금 하는 작업이 끝난 뒤에 다시 눌러 주세요.')
    return false
  }
  const ac = new AbortController()
  currentAbort = ac
  set({ job: { label, progress: null }, error: null })
  try {
    await work({
      signal: ac.signal,
      progress: (percent, next) => set((s) => (s.job ? { job: { label: next ?? s.job.label, progress: percent } } : s)),
    })
    return true
  } catch (err) {
    if (ac.signal.aborted || isAbort(err)) {
      toast.info('작업을 취소했습니다.')
    } else {
      console.error('[pdf]', err)
      const message = err instanceof Error && err.message ? err.message : '작업 중 문제가 생겼습니다. 다시 시도해 주세요.'
      set({ error: message })
      toast.error(message)
    }
    return false
  } finally {
    currentAbort = null
    set({ job: null })
  }
}

export function cancelJob() {
  currentAbort?.abort(new DOMException('취소했습니다.', 'AbortError'))
}

// ── 암호 묻기 ─────────────────────────────────────────────
export function askPassword(name: string, wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    set({
      passwordPrompt: {
        name,
        wrong,
        resolve: (value) => {
          set({ passwordPrompt: null })
          resolve(value)
        },
      },
    })
  })
}
