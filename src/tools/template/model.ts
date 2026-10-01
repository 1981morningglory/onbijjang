/**
 * 템플릿 캔버스의 문서 모델 — 화면(fabric)과 분리된 순수 데이터와 계산.
 * 내보내기·자동 저장·되돌리기·팀 보관함이 모두 이 데이터에서 출발한다.
 */

/** fabric 이 직렬화한 객체 하나. 이미지의 src 는 'asset:<id>' 로 바꿔 담는다. */
export type ObjectJSON = Record<string, unknown>

export interface PageDoc {
  id: string
  /** 배경색(#rrggbb). null 이면 투명 */
  background: string | null
  objects: ObjectJSON[]
  /** 움직이는 파일로 내보낼 때 이 페이지를 보여 줄 시간(초). null 이면 공통 설정을 따른다. */
  seconds: number | null
}

export interface CanvasDoc {
  version: 1
  width: number
  height: number
  pages: PageDoc[]
}

export const MIN_SIDE = 16
export const MAX_SIDE = 8000
export const MAX_PAGES = 50
export const ASSET_PREFIX = 'asset:'

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function clampSide(n: number): number {
  if (!Number.isFinite(n)) return MIN_SIDE
  return Math.max(MIN_SIDE, Math.min(MAX_SIDE, Math.round(n)))
}

export function createPage(background: string | null = '#ffffff'): PageDoc {
  return { id: newId(), background, objects: [], seconds: null }
}

export function createDoc(width: number, height: number): CanvasDoc {
  return { version: 1, width: clampSide(width), height: clampSide(height), pages: [createPage()] }
}

export function isDocEmpty(doc: CanvasDoc): boolean {
  return doc.pages.every((p) => p.objects.length === 0)
}

// ── 페이지 조작 (모두 새 문서를 돌려준다) ──────────────────
export function addPage(doc: CanvasDoc, afterIndex: number, page: PageDoc = createPage()): CanvasDoc {
  if (doc.pages.length >= MAX_PAGES) return doc
  const at = Math.max(0, Math.min(doc.pages.length, afterIndex + 1))
  const pages = [...doc.pages.slice(0, at), page, ...doc.pages.slice(at)]
  return { ...doc, pages }
}

/** 객체마다 붙어 있는 uid 를 새로 매겨 복제본이 원본과 구분되게 한다. */
export function reassignUids(objects: ObjectJSON[]): ObjectJSON[] {
  return objects.map((o) => {
    const next: ObjectJSON = { ...o, uid: newId() }
    if (Array.isArray(o.objects)) next.objects = reassignUids(o.objects as ObjectJSON[])
    return next
  })
}

export function duplicatePage(doc: CanvasDoc, index: number): CanvasDoc {
  const src = doc.pages[index]
  if (!src) return doc
  return addPage(doc, index, { ...src, id: newId(), objects: reassignUids(src.objects) })
}

export function removePage(doc: CanvasDoc, index: number): CanvasDoc {
  if (doc.pages.length <= 1 || !doc.pages[index]) return doc
  return { ...doc, pages: doc.pages.filter((_, i) => i !== index) }
}

export function movePage(doc: CanvasDoc, from: number, to: number): CanvasDoc {
  if (from === to || !doc.pages[from] || to < 0 || to >= doc.pages.length) return doc
  const pages = [...doc.pages]
  const [moved] = pages.splice(from, 1)
  pages.splice(to, 0, moved)
  return { ...doc, pages }
}

export function updatePage(doc: CanvasDoc, id: string, patch: Partial<Omit<PageDoc, 'id'>>): CanvasDoc {
  let changed = false
  const pages = doc.pages.map((p) => {
    if (p.id !== id) return p
    changed = true
    return { ...p, ...patch }
  })
  return changed ? { ...doc, pages } : doc
}

/**
 * 객체를 새 캔버스 크기에 맞춰 옮긴다. 비율을 유지한 채 가능한 한 크게 넣고 가운데에 둔다.
 * 최상위 객체의 left/top/scale 만 바꾸면 되므로 원점 설정과 상관없이 동작한다.
 */
export function fitObjectsToSize(objects: ObjectJSON[], from: { width: number; height: number }, to: { width: number; height: number }): ObjectJSON[] {
  const s = Math.min(to.width / from.width, to.height / from.height)
  const ox = (to.width - from.width * s) / 2
  const oy = (to.height - from.height * s) / 2
  return objects.map((o) => ({
    ...o,
    left: num(o.left) * s + ox,
    top: num(o.top) * s + oy,
    scaleX: num(o.scaleX, 1) * s,
    scaleY: num(o.scaleY, 1) * s,
  }))
}

export function resizeDoc(doc: CanvasDoc, width: number, height: number, fitContent: boolean): CanvasDoc {
  const w = clampSide(width)
  const h = clampSide(height)
  if (w === doc.width && h === doc.height) return doc
  const pages = fitContent ? doc.pages.map((p) => ({ ...p, objects: fitObjectsToSize(p.objects, doc, { width: w, height: h }) })) : doc.pages
  return { ...doc, width: w, height: h, pages }
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

// ── 크기 프리셋 ───────────────────────────────────────────
export interface SizePreset {
  name: string
  w: number
  h: number
  /** 팀(관리자)이 등록한 크기 */
  team?: boolean
}

export const SIZE_PRESETS: SizePreset[] = [
  { name: '상세페이지', w: 860, h: 3000 },
  { name: '정사각', w: 1080, h: 1080 },
  { name: '카드뉴스', w: 1080, h: 1350 },
  { name: '썸네일', w: 1280, h: 720 },
  { name: '스토리', w: 1080, h: 1920 },
  { name: '배너', w: 1200, h: 400 },
  { name: '링크 미리보기', w: 1200, h: 630 },
  { name: '풀HD 가로', w: 1920, h: 1080 },
  { name: 'A4 세로', w: 1240, h: 1754 },
  { name: 'A4 가로', w: 1754, h: 1240 },
  { name: '명함', w: 1063, h: 591 },
]

/** 팀 크기를 앞에 두고, 같은 이름·크기는 한 번만 남긴다. */
export function mergePresets(team: Array<{ name: string; w: number; h: number }>, builtin: SizePreset[] = SIZE_PRESETS): SizePreset[] {
  const seen = new Set<string>()
  const out: SizePreset[] = []
  for (const p of [...team.map((t) => ({ ...t, team: true })), ...builtin]) {
    if (!(p.w >= MIN_SIDE && p.h >= MIN_SIDE && p.w <= MAX_SIDE && p.h <= MAX_SIDE)) continue
    const key = `${p.name.trim()}|${p.w}x${p.h}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

/** 이름 또는 숫자("1080", "1080x1350", "860 3000")로 찾는다. */
export function searchPresets(list: SizePreset[], query: string): SizePreset[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!tokens.length) return list
  // 숫자만으로 된 토막("1080", "1080x1350")은 크기로, 나머지("a4", "가로")는 이름으로 본다.
  const nums: string[] = []
  const words: string[] = []
  for (const t of tokens) {
    if (/^\d+([x×*]\d+)?$/.test(t)) nums.push(...t.split(/[x×*]/))
    else words.push(t)
  }
  return list.filter((p) => {
    const name = p.name.toLowerCase()
    if (!words.every((w) => name.includes(w))) return false
    if (!nums.length) return true
    const dims = [String(p.w), String(p.h)]
    if (nums.length >= 2) return dims[0].startsWith(nums[0]) && dims[1].startsWith(nums[1])
    return dims.some((d) => d.startsWith(nums[0]))
  })
}

/** "1080x1350" 처럼 직접 적은 크기를 읽는다. 읽을 수 없으면 null */
export function parseSizeText(text: string): { w: number; h: number } | null {
  const m = text.trim().match(/^(\d{2,5})\s*[x×*,\s]\s*(\d{2,5})$/i)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (w < MIN_SIDE || h < MIN_SIDE || w > MAX_SIDE || h > MAX_SIDE) return null
  return { w, h }
}

// ── 객체 트리 순회 ────────────────────────────────────────
export function walkObjects(objects: ObjectJSON[], visit: (o: ObjectJSON) => void): void {
  for (const o of objects) {
    visit(o)
    if (Array.isArray(o.objects)) walkObjects(o.objects as ObjectJSON[], visit)
  }
}

export function isImageObject(o: ObjectJSON): boolean {
  return typeof o.type === 'string' && o.type.toLowerCase() === 'image'
}

export function isTextObject(o: ObjectJSON): boolean {
  return typeof o.type === 'string' && ['textbox', 'i-text', 'itext', 'text'].includes(o.type.toLowerCase())
}

/** 변경이 있는 가지만 새로 만들어 돌려준다(없으면 원래 배열 그대로). */
export function mapObjects(objects: ObjectJSON[], fn: (o: ObjectJSON) => ObjectJSON): ObjectJSON[] {
  let changed = false
  const out = objects.map((o) => {
    let next = fn(o)
    if (Array.isArray(next.objects)) {
      const kids = mapObjects(next.objects as ObjectJSON[], fn)
      if (kids !== next.objects) next = { ...next, objects: kids }
    }
    if (next !== o) changed = true
    return next
  })
  return changed ? out : objects
}

export function assetIdOf(o: ObjectJSON): string | null {
  if (!isImageObject(o)) return null
  if (typeof o.assetId === 'string' && o.assetId) return o.assetId
  if (typeof o.src === 'string' && o.src.startsWith(ASSET_PREFIX)) return o.src.slice(ASSET_PREFIX.length)
  return null
}

export function collectAssetIds(pages: PageDoc[]): string[] {
  const ids = new Set<string>()
  for (const p of pages) {
    walkObjects(p.objects, (o) => {
      const id = assetIdOf(o)
      if (id) ids.add(id)
    })
  }
  return [...ids]
}

/** 이미지 src 를 바꾼다. 저장용('asset:id')과 화면용(blob URL)을 오갈 때 쓴다. */
export function mapImageSources(objects: ObjectJSON[], resolve: (assetId: string, o: ObjectJSON) => string): ObjectJSON[] {
  return mapObjects(objects, (o) => {
    const id = assetIdOf(o)
    if (!id) return o
    const src = resolve(id, o)
    return src === o.src && o.assetId === id ? o : { ...o, src, assetId: id }
  })
}

/**
 * 자산 이미지의 해상도를 줄였을 때, 그 이미지를 쓰는 객체가 화면에서 같은 크기로 보이도록 맞춘다.
 * kx, ky 는 (새 크기 / 원래 크기). renameTo 를 주면 줄인 사진의 새 id 로 바꿔 가리킨다.
 */
export function rescaleImageRefs(objects: ObjectJSON[], assetId: string, kx: number, ky: number, renameTo: string = assetId): ObjectJSON[] {
  return mapObjects(objects, (o) => {
    if (assetIdOf(o) !== assetId) return o
    return {
      ...o,
      assetId: renameTo,
      src: ASSET_PREFIX + renameTo,
      width: num(o.width) * kx,
      height: num(o.height) * ky,
      cropX: num(o.cropX) * kx,
      cropY: num(o.cropY) * ky,
      scaleX: num(o.scaleX, 1) / kx,
      scaleY: num(o.scaleY, 1) / ky,
    }
  })
}

export interface FontUsage {
  family: string
  weight: string
  style: string
  text: string
}

export function collectFontUsage(pages: Array<Pick<PageDoc, 'objects'>>): FontUsage[] {
  const map = new Map<string, FontUsage>()
  for (const p of pages) {
    walkObjects(p.objects, (o) => {
      if (!isTextObject(o) || typeof o.fontFamily !== 'string') return
      const weight = String(o.fontWeight ?? 'normal')
      const style = String(o.fontStyle ?? 'normal')
      const key = `${o.fontFamily}|${weight}|${style}`
      const text = typeof o.text === 'string' ? o.text : ''
      const prev = map.get(key)
      if (prev) prev.text += text
      else map.set(key, { family: o.fontFamily, weight, style, text })
    })
  }
  return [...map.values()]
}

// ── 되돌리기 ──────────────────────────────────────────────
export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

export function historyInit<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

export function historyPush<T>(h: History<T>, next: T, limit = 100): History<T> {
  if (next === h.present) return h
  const past = [...h.past, h.present]
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] }
}

/** 기록을 남기지 않고 현재 상태만 바꾼다(선택한 페이지 바꾸기 등). */
export function historyReplace<T>(h: History<T>, next: T): History<T> {
  return next === h.present ? h : { ...h, present: next }
}

export function historyUndo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}

export function historyRedo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}

// ── 파일 이름 ─────────────────────────────────────────────
/** 페이지가 여럿이면 "이름_01.png" 처럼 번호를 붙인다. */
export function pageFileName(base: string, index: number, total: number, ext: string): string {
  if (total <= 1) return `${base}.${ext}`
  const digits = Math.max(2, String(total).length)
  return `${base}_${String(index + 1).padStart(digits, '0')}.${ext}`
}

// ── 움직이는 파일(GIF·MP4) 시간표 ─────────────────────────
export type EntranceEffect = 'none' | 'fade' | 'rise' | 'pop'
export const ENTRANCE_MS = 450
export const ENTRANCE_STAGGER_MS = 140

/** 한 페이지의 등장 효과가 모두 끝나는 데 걸리는 시간(ms). 효과가 없으면 0 */
export function entranceTotalMs(effects: EntranceEffect[]): number {
  const n = effects.filter((e) => e !== 'none').length
  return n ? (n - 1) * ENTRANCE_STAGGER_MS + ENTRANCE_MS : 0
}

export function pageEffects(page: Pick<PageDoc, 'objects'>): EntranceEffect[] {
  return page.objects.map((o) => (o.visible === false ? 'none' : toEffect(o.anim)))
}

function toEffect(v: unknown): EntranceEffect {
  return v === 'fade' || v === 'rise' || v === 'pop' ? v : 'none'
}

export interface EntranceState {
  /** 원래 불투명도에 곱할 값 0–1 */
  opacity: number
  /** 아래로 밀려 있는 정도(0–1). 1 이면 시작 위치 */
  offset: number
  /** 크기 배율 */
  scale: number
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2

/** order 는 효과가 있는 객체들 사이에서의 순번(아래 레이어부터 0). */
export function entranceAt(effect: EntranceEffect, order: number, localMs: number): EntranceState {
  if (effect === 'none') return { opacity: 1, offset: 0, scale: 1 }
  const t = Math.max(0, Math.min(1, (localMs - order * ENTRANCE_STAGGER_MS) / ENTRANCE_MS))
  if (t >= 1) return { opacity: 1, offset: 0, scale: 1 }
  if (effect === 'fade') return { opacity: t, offset: 0, scale: 1 }
  if (effect === 'rise') return { opacity: Math.min(1, t * 1.6), offset: 1 - easeOutCubic(t), scale: 1 }
  return { opacity: Math.min(1, t * 2.5), offset: 0, scale: 0.6 + 0.4 * easeOutBack(t) }
}

export interface AnimFrame {
  page: number
  /** 페이지가 나타난 뒤 흐른 시간(ms) */
  localMs: number
  /** 다음 페이지로 넘어가는 중이면 그 페이지와 섞는 정도(0–1) */
  blend?: { page: number; alpha: number }
  /** 이 그림이 화면에 머무는 시간(ms) */
  durationMs: number
}

export interface TimelineInput {
  /** 페이지별 표시 시간(ms) — 전환 시간은 따로 더해진다 */
  pageMs: number[]
  /** 페이지별 등장 효과가 끝나는 시간(ms) */
  entranceMs: number[]
  fadeMs: number
  fps: number
}

/**
 * 그려야 할 그림 목록을 만든다. 멈춰 있는 구간은 긴 시간의 그림 한 장으로 둔다
 * (GIF 는 그대로 쓰고, MP4 는 같은 그림을 프레임 수만큼 반복해 넣는다).
 */
export function buildFrames({ pageMs, entranceMs, fadeMs, fps }: TimelineInput): AnimFrame[] {
  const step = 1000 / fps
  const frames: AnimFrame[] = []
  pageMs.forEach((total, page) => {
    const show = Math.max(step, total)
    const moving = Math.min(entranceMs[page] ?? 0, show)
    const movingFrames = Math.round(moving / step)
    for (let i = 0; i < movingFrames; i++) frames.push({ page, localMs: i * step, durationMs: step })
    const rest = show - movingFrames * step
    if (rest > 0.5) frames.push({ page, localMs: show, durationMs: rest })
    const next = page + 1
    if (next < pageMs.length && fadeMs > 0) {
      const n = Math.max(1, Math.round(fadeMs / step))
      for (let i = 1; i <= n; i++) frames.push({ page, localMs: show, blend: { page: next, alpha: i / (n + 1) }, durationMs: fadeMs / n })
    }
  })
  return frames
}

export function framesDurationMs(frames: AnimFrame[]): number {
  return frames.reduce((sum, f) => sum + f.durationMs, 0)
}

/** 긴 변을 maxSide 이하로 줄인 크기. even 이면 짝수로 맞춘다(MP4 는 짝수 크기만 받는다). */
export function outputSize(width: number, height: number, maxSide: number | null, even = false): { width: number; height: number } {
  const scale = maxSide ? Math.min(1, maxSide / Math.max(width, height)) : 1
  let w = Math.max(2, Math.round(width * scale))
  let h = Math.max(2, Math.round(height * scale))
  if (even) {
    w -= w % 2
    h -= h % 2
  }
  return { width: w, height: h }
}

// ── 팀 보관함에 담는 묶음 ─────────────────────────────────
export interface TemplatePack {
  format: 'onbijjang-canvas'
  version: 1
  name: string
  width: number
  height: number
  pages: PageDoc[]
  assets: Record<string, { dataUrl: string; width: number; height: number }>
}

export function isTemplatePack(v: unknown): v is TemplatePack {
  if (!v || typeof v !== 'object') return false
  const p = v as Partial<TemplatePack>
  return p.format === 'onbijjang-canvas' && typeof p.width === 'number' && typeof p.height === 'number' && Array.isArray(p.pages) && p.pages.length > 0 && typeof p.assets === 'object' && p.assets !== null
}

/** 불러온 묶음을 믿지 않고 모양을 다듬는다. */
export function docFromPack(pack: TemplatePack): CanvasDoc {
  const pages = pack.pages.slice(0, MAX_PAGES).map((p) => ({
    id: newId(),
    background: typeof p.background === 'string' ? p.background : null,
    objects: Array.isArray(p.objects) ? reassignUids(p.objects) : [],
    seconds: typeof p.seconds === 'number' && p.seconds > 0 ? p.seconds : null,
  }))
  return { version: 1, width: clampSide(pack.width), height: clampSide(pack.height), pages }
}

/** JSON 으로 보냈을 때의 대략적인 크기(바이트). data URL 은 ASCII 라 글자 수와 같다. */
export function packSize(pack: Pick<TemplatePack, 'pages' | 'assets'>): number {
  let total = JSON.stringify(pack.pages).length * 1.1
  for (const a of Object.values(pack.assets)) total += a.dataUrl.length + 64
  return Math.ceil(total)
}

/** 용량을 맞추기 위해 차례로 시도하는 축소 단계(긴 변 px, 품질) */
export const SHRINK_STEPS: ReadonlyArray<{ maxSide: number; quality: number }> = [
  { maxSide: 2400, quality: 0.86 },
  { maxSide: 1800, quality: 0.84 },
  { maxSide: 1400, quality: 0.82 },
  { maxSide: 1000, quality: 0.78 },
  { maxSide: 720, quality: 0.72 },
  { maxSide: 480, quality: 0.64 },
]
