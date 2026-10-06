import { create } from 'zustand'
import { api, ApiError } from '@/lib/api'
import { GROUPS, TOOLS, type GroupId, type ToolDef } from './registry'
import { ALL_ROLES, useViewer, type Role, type Viewer } from './viewer'

export type Pos9 = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'

export interface WatermarkSettings {
  enabled: boolean
  kind: 'text' | 'logo'
  text: string
  /** data URL. 팀 프리셋이면 서버 설정에 저장된다. */
  logoDataUrl: string | null
  position: Pos9
  /** 0–100 */
  opacity: number
  /** 가장자리 여백(px, 출력 기준) */
  margin: number
  /** 짧은 변 대비 크기(%) — 글자는 글자 높이, 로고는 너비 */
  sizePct: number
  color: string
}

export interface TeamPresets {
  brandColors: Array<{ name: string; hex: string }>
  watermark: WatermarkSettings
  canvasSizes: Array<{ name: string; w: number; h: number }>
  filename: { base: string; start: number; digits: number }
}

/** 메뉴 항목 하나의 노출 설정 */
export interface MenuEntry {
  enabled: boolean
  badge: 'new' | null
  /** 볼 수 있는 등급. 계정별 예외(허용·차단)가 이보다 우선한다. */
  roles: Role[]
  /** 메뉴에서 삭제(관리자 화면의 '삭제한 앱'에서 복원 가능) */
  deleted: boolean
}

/** 관리자가 추가한 링크 앱(새로 출시한 앱·외부 도구) */
export interface LinkApp extends MenuEntry {
  id: string
  title: string
  summary: string
  /** https://… 또는 사이트 안 주소(/…) */
  url: string
  group: GroupId
}

/** 신상앱 칸 설정. items 는 도구 id 또는 'link-<링크 앱 id>' (앞쪽이 먼저 보임) */
export interface NewApps {
  enabled: boolean
  title: string
  items: string[]
  /** 새로 들어오는 도구·링크 앱을 자동으로 신상앱 맨 앞에 넣기 */
  autoAdd: boolean
}

/** 처음 신상앱 칸을 만들 때 올려 둘 앱 */
const FIRST_NEW_APPS = ['barcode']
/** 신상앱 칸을 만든 날(2026-10-06)의 도구 목록. 이후 registry 에 생기는 도구는 '새로 들어온 앱'이다. */
const LAUNCH_TOOLS = ['image', 'template', 'background', 'split', 'mosaic', 'cleanup', 'signature', 'qr', 'rename', 'capture', 'clips', 'gif', 'record', 'pdf', 'quote', 'label', 'barcode', 'fee-compare', 'smartstore', 'coupang', 'rocket-margin', 'rocket-policy', 'gmarket', 'auction', 'elevenst', 'blog']

/** 도구 하나의 노출 설정 — group 이 있으면 원래 카테고리 대신 그 카테고리에 보인다 */
export interface ToolEntry extends MenuEntry {
  group?: GroupId
}

export interface SiteConfig {
  version: 1
  tools: Record<string, ToolEntry>
  groups: Record<GroupId, { enabled: boolean }>
  /** 전체 도구 id 순서. 그룹 안에서의 순서로 쓰인다. */
  toolOrder: string[]
  links: LinkApp[]
  /** 등급 체계 버전. 2 = 4단계(전체공개·일반등급·직원등급·전체마스터) */
  rolesV?: 2
  /** 메인 화면의 '(NEW) 신상앱' 소개 칸 */
  newApps: NewApps
  /** 지금까지 알려진 도구 목록 — 여기에 없는 도구가 생기면 '새로 들어온 앱'으로 본다 */
  knownTools?: string[]
  /** 카테고리 순서(관리자가 정함). 없는 카테고리는 기본 순서대로 뒤에 붙는다 */
  groupOrder: GroupId[]
  notice: { enabled: boolean; text: string }
  presets: TeamPresets
  updatedAt?: string
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  kind: 'text',
  text: '온비짱',
  logoDataUrl: null,
  position: 'br',
  opacity: 60,
  margin: 24,
  sizePct: 5,
  color: '#ffffff',
}

export const DEFAULT_PRESETS: TeamPresets = {
  brandColors: [
    { name: '잉크', hex: '#14201a' },
    { name: '매트 초록', hex: '#0b7a53' },
    { name: '형광펜', hex: '#ffe55c' },
    { name: '귤색', hex: '#e8551f' },
    { name: '흰색', hex: '#ffffff' },
  ],
  watermark: DEFAULT_WATERMARK,
  canvasSizes: [
    { name: '상세페이지', w: 860, h: 3000 },
    { name: '정사각 썸네일', w: 1000, h: 1000 },
    { name: '카드뉴스', w: 1080, h: 1350 },
    { name: '유튜브 썸네일', w: 1280, h: 720 },
  ],
  filename: { base: '상품', start: 1, digits: 3 },
}

export function defaultConfig(): SiteConfig {
  return {
    version: 1,
    tools: Object.fromEntries(TOOLS.map((t) => [t.id, { enabled: true, badge: null, roles: t.roles ? ALL_ROLES.filter((r) => t.roles!.includes(r)) : [...ALL_ROLES], deleted: false }])),
    groups: Object.fromEntries(GROUPS.map((g) => [g.id, { enabled: true }])) as SiteConfig['groups'],
    groupOrder: GROUPS.map((g) => g.id),
    toolOrder: TOOLS.map((t) => t.id),
    links: [],
    rolesV: 2,
    newApps: { enabled: true, title: '신상앱', items: [...FIRST_NEW_APPS], autoAdd: true },
    knownTools: TOOLS.map((t) => t.id),
    notice: { enabled: false, text: '' },
    presets: structuredClone(DEFAULT_PRESETS),
  }
}

/** 서버에 저장된 설정을 현재 도구 목록에 맞춘다. 새로 추가된 도구는 켜진 상태로 끝에 붙는다. */
export function normalizeConfig(raw: unknown): SiteConfig {
  const base = defaultConfig()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<SiteConfig>
  // 3단계(방문자·직원·관리자) 시절 저장분: 방문자에게 보이던 것은 일반등급에게도 보이게 옮긴다
  const migrate = r.rolesV !== 2
  const cleanRoles = (v: unknown): Role[] => {
    const roles = cleanRoleList(v)
    if (migrate && roles.includes('guest') && !roles.includes('general')) roles.push('general')
    return ALL_ROLES.filter((x) => roles.includes(x))
  }
  for (const t of TOOLS) {
    const saved = r.tools?.[t.id]
    if (saved) {
      base.tools[t.id] = { enabled: saved.enabled !== false, badge: saved.badge === 'new' ? 'new' : null, roles: cleanRoles(saved.roles), deleted: saved.deleted === true }
      if (saved.group && saved.group !== t.group && GROUPS.some((g) => g.id === saved.group)) base.tools[t.id].group = saved.group
    }
  }
  if (Array.isArray(r.groupOrder)) {
    const ids = GROUPS.map((g) => g.id)
    const saved = r.groupOrder.filter((id): id is GroupId => ids.includes(id as GroupId))
    base.groupOrder = [...new Set(saved), ...ids.filter((id) => !saved.includes(id))]
  }
  for (const g of GROUPS) {
    const saved = r.groups?.[g.id]
    if (saved) base.groups[g.id] = { enabled: saved.enabled !== false }
  }
  if (Array.isArray(r.toolOrder)) {
    const known = new Set(TOOLS.map((t) => t.id))
    const ordered = r.toolOrder.filter((id): id is string => typeof id === 'string' && known.has(id))
    const seen = new Set(ordered)
    base.toolOrder = [...ordered, ...TOOLS.map((t) => t.id).filter((id) => !seen.has(id))]
  }
  if (Array.isArray(r.links)) {
    const groupIds = new Set(GROUPS.map((g) => g.id))
    base.links = r.links
      .filter((l): l is LinkApp => Boolean(l) && typeof l.id === 'string' && typeof l.title === 'string' && typeof l.url === 'string' && groupIds.has(l.group))
      .slice(0, 60)
      .map((l) => ({
        id: l.id, title: l.title.slice(0, 30), summary: typeof l.summary === 'string' ? l.summary.slice(0, 120) : '', url: l.url.slice(0, 500), group: l.group,
        enabled: l.enabled !== false, badge: l.badge === 'new' ? 'new' : null, roles: cleanRoles(l.roles), deleted: l.deleted === true,
      }))
  }
  if (r.notice && typeof r.notice.text === 'string') {
    base.notice = { enabled: Boolean(r.notice.enabled), text: r.notice.text.slice(0, 300) }
  }
  if (r.presets && typeof r.presets === 'object') {
    const p = r.presets
    if (Array.isArray(p.brandColors)) base.presets.brandColors = p.brandColors.filter((c) => c && typeof c.hex === 'string').slice(0, 24)
    if (p.watermark) base.presets.watermark = { ...DEFAULT_WATERMARK, ...p.watermark }
    if (Array.isArray(p.canvasSizes)) base.presets.canvasSizes = p.canvasSizes.filter((s) => s && s.w > 0 && s.h > 0).slice(0, 40)
    if (p.filename) base.presets.filename = { ...DEFAULT_PRESETS.filename, ...p.filename }
  }
  // 신상앱 칸
  const na = r.newApps
  if (na && typeof na === 'object') {
    base.newApps = {
      enabled: na.enabled !== false,
      title: typeof na.title === 'string' && na.title.trim() ? na.title.trim().slice(0, 20) : '신상앱',
      items: Array.isArray(na.items) ? na.items.filter((x): x is string => typeof x === 'string') : [],
      autoAdd: na.autoAdd !== false,
    }
  }
  // 저장 뒤에 새로 생긴 도구 → (자동 등록이 켜져 있으면) 신상앱 맨 앞 + NEW 표시
  {
    const known = new Set(Array.isArray(r.knownTools) ? r.knownTools : LAUNCH_TOOLS)
    const fresh = TOOLS.map((t) => t.id).filter((id) => !known.has(id))
    if (fresh.length && base.newApps.autoAdd) {
      base.newApps.items = [...fresh.filter((id) => !base.newApps.items.includes(id)), ...base.newApps.items]
      for (const id of fresh) if (!r.tools?.[id]) base.tools[id].badge = 'new'
    }
  }
  // 없는 도구·지운 링크 앱은 신상앱에서 뺀다
  const liveKeys = new Set([...TOOLS.map((t) => t.id), ...base.links.map((l) => `link-${l.id}`)])
  base.newApps.items = Array.from(new Set(base.newApps.items)).filter((k) => liveKeys.has(k)).slice(0, 24)
  base.updatedAt = r.updatedAt
  return base
}

interface SiteState {
  config: SiteConfig
  /** loading: 첫 응답 전 · ready: 서버 설정 사용 중 · offline: 서버 없음(기본 설정) */
  status: 'loading' | 'ready' | 'offline'
  load: () => Promise<void>
  save: (config: SiteConfig) => Promise<void>
}

export const useSite = create<SiteState>((set) => ({
  config: defaultConfig(),
  status: 'loading',
  async load() {
    try {
      const { config } = await api<{ config: unknown }>('/config')
      set({ config: normalizeConfig(config), status: 'ready' })
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) set({ status: 'offline' })
      else throw err
    }
  },
  async save(config) {
    const res = await api<{ config: unknown }>('/config', { method: 'PUT', body: { config } })
    set({ config: normalizeConfig(res.config), status: 'ready' })
  },
}))

function cleanRoleList(v: unknown): Role[] {
  if (!Array.isArray(v)) return [...ALL_ROLES]
  return ALL_ROLES.filter((r) => v.includes(r))
}

/** 이 사람에게 보이는가: 꺼짐·삭제면 아무에게도 안 보이고, 그 밖에는 계정별 예외 → 등급 순서로 정한다. */
export function canSee(entry: MenuEntry | undefined, id: string, viewer: Viewer): boolean {
  if (!entry) return true
  if (!entry.enabled || entry.deleted) return false
  const ov = viewer.access[id]
  if (ov === 'deny') return false
  if (ov === 'allow') return true
  return entry.roles.includes(viewer.role)
}

/** 등급 때문에 못 보는 것인가(꺼짐·삭제가 아니라) */
export function hiddenByRole(entry: MenuEntry | undefined, id: string, viewer: Viewer): boolean {
  return Boolean(entry && entry.enabled && !entry.deleted && !canSee(entry, id, viewer))
}

/** 관리자가 정한 순서의 카테고리 목록 */
export function orderedGroups(config: Pick<SiteConfig, 'groupOrder'>) {
  return config.groupOrder.map((id) => GROUPS.find((g) => g.id === id)!).filter(Boolean)
}

/** 도구가 지금 놓인 카테고리(관리자가 옮겼으면 그 카테고리) */
export function groupOf(config: Pick<SiteConfig, 'tools'>, tool: ToolDef): GroupId {
  return config.tools[tool.id]?.group ?? tool.group
}

export function isToolVisible(config: SiteConfig, tool: ToolDef, viewer: Viewer) {
  return config.groups[groupOf(config, tool)].enabled && canSee(config.tools[tool.id], tool.id, viewer)
}

/** 이 사람에게 보이는 링크 앱(그룹별) */
export function useVisibleLinks() {
  const config = useSite((s) => s.config)
  const viewer = useViewer()
  return config.links.filter((l) => config.groups[l.group].enabled && canSee(l, `link-${l.id}`, viewer))
}

/** 관리자 설정을 반영한, 화면에 보이는 도구 목록(그룹별·순서 적용). */
export function useVisibleGroups() {
  const config = useSite((s) => s.config)
  const viewer = useViewer()
  const rank = new Map(config.toolOrder.map((id, i) => [id, i]))
  return orderedGroups(config).filter((g) => config.groups[g.id].enabled)
    .map((group) => ({
      group,
      tools: TOOLS.filter((t) => groupOf(config, t) === group.id && isToolVisible(config, t, viewer)).sort(
        (a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999),
      ),
    }))
    .filter((g) => g.tools.length > 0)
}

/** 팀 프리셋(관리자가 등록). 도구는 이 값을 초기값·빠른 선택지로 쓴다. */
export function useTeamPresets(): TeamPresets {
  return useSite((s) => s.config.presets)
}
