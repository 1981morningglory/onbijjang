import { create } from 'zustand'
import { api, ApiError } from '@/lib/api'

/** 지금 보고 있는 사람 — 방문자(로그인 안 함) · 직원 · 관리자. 메뉴 노출과 계정별 예외 권한에 쓴다. */

export type Role = 'guest' | 'member' | 'admin'
export const ROLE_OPTIONS: ReadonlyArray<{ value: Role; label: string }> = [
  { value: 'guest', label: '방문자' },
  { value: 'member', label: '직원' },
  { value: 'admin', label: '관리자' },
]
export const ALL_ROLES: Role[] = ['guest', 'member', 'admin']
export const ROLE_LABEL: Record<Role, string> = { guest: '방문자', member: '직원', admin: '관리자' }

export type Access = Record<string, 'allow' | 'deny'>

export interface PublicUser {
  id: string
  username: string
  name: string
  role: 'admin' | 'member'
  access: Access
  disabled: boolean
  createdAt: string
  lastLoginAt: string | null
}

export interface Viewer {
  role: Role
  access: Access
}

interface ViewerState {
  user: PublicUser | null
  /** 관리자 화면을 쓸 수 있음(관리자 등급 계정 또는 관리자 비밀번호) */
  admin: boolean
  /** 관리자 비밀번호로 들어온 상태 */
  master: boolean
  status: 'loading' | 'ready' | 'offline'
  load: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  user: null,
  admin: false,
  master: false,
  status: 'loading',
  async load() {
    try {
      const r = await api<{ user: PublicUser | null; admin: boolean; master: boolean }>('/auth/me')
      set({ user: r.user, admin: r.admin, master: r.master, status: 'ready' })
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) set({ status: 'offline' })
      else set({ status: 'ready' })
    }
  },
  async login(username, password) {
    await api('/auth/login', { method: 'POST', body: { username, password } })
    await get().load()
  },
  async logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    await api('/admin/logout', { method: 'POST' }).catch(() => {})
    await get().load()
  },
}))

export function viewerOf(s: Pick<ViewerState, 'user' | 'master'>): Viewer {
  if (s.user) return { role: s.user.role, access: s.user.access ?? {} }
  return { role: s.master ? 'admin' : 'guest', access: {} }
}

/** 지금 보는 사람(등급 + 계정별 예외) */
export function useViewer(): Viewer {
  const user = useViewerStore((s) => s.user)
  const master = useViewerStore((s) => s.master)
  return viewerOf({ user, master })
}
