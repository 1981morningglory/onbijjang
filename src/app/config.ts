import { create } from 'zustand'
import { api, ApiError } from '@/lib/api'
import { GROUPS, TOOLS, type GroupId, type ToolDef } from './registry'

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

export interface SiteConfig {
  version: 1
  tools: Record<string, { enabled: boolean; badge: 'new' | null }>
  groups: Record<GroupId, { enabled: boolean }>
  /** 전체 도구 id 순서. 그룹 안에서의 순서로 쓰인다. */
  toolOrder: string[]
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
    tools: Object.fromEntries(TOOLS.map((t) => [t.id, { enabled: true, badge: null }])),
    groups: Object.fromEntries(GROUPS.map((g) => [g.id, { enabled: true }])) as SiteConfig['groups'],
    toolOrder: TOOLS.map((t) => t.id),
    notice: { enabled: false, text: '' },
    presets: structuredClone(DEFAULT_PRESETS),
  }
}

/** 서버에 저장된 설정을 현재 도구 목록에 맞춘다. 새로 추가된 도구는 켜진 상태로 끝에 붙는다. */
export function normalizeConfig(raw: unknown): SiteConfig {
  const base = defaultConfig()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<SiteConfig>
  for (const t of TOOLS) {
    const saved = r.tools?.[t.id]
    if (saved) base.tools[t.id] = { enabled: saved.enabled !== false, badge: saved.badge === 'new' ? 'new' : null }
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

export function isToolVisible(config: SiteConfig, tool: ToolDef) {
  return config.groups[tool.group].enabled && config.tools[tool.id]?.enabled !== false
}

/** 관리자 설정을 반영한, 화면에 보이는 도구 목록(그룹별·순서 적용). */
export function useVisibleGroups() {
  const config = useSite((s) => s.config)
  const rank = new Map(config.toolOrder.map((id, i) => [id, i]))
  return GROUPS.filter((g) => config.groups[g.id].enabled)
    .map((group) => ({
      group,
      tools: TOOLS.filter((t) => t.group === group.id && isToolVisible(config, t)).sort(
        (a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999),
      ),
    }))
    .filter((g) => g.tools.length > 0)
}

/** 팀 프리셋(관리자가 등록). 도구는 이 값을 초기값·빠른 선택지로 쓴다. */
export function useTeamPresets(): TeamPresets {
  return useSite((s) => s.config.presets)
}
