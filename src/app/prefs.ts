import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PrefsState {
  favorites: string[]
  recents: string[]
  sidebarCollapsed: boolean
  toggleFavorite: (id: string) => void
  touchRecent: (id: string) => void
  setSidebarCollapsed: (v: boolean) => void
}

/** 이 브라우저에만 저장되는 개인 설정: 즐겨찾기, 최근 사용, 사이드바 상태 */
export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      favorites: [],
      recents: [],
      sidebarCollapsed: false,
      toggleFavorite: (id) =>
        set((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [...s.favorites, id] })),
      touchRecent: (id) => set((s) => ({ recents: [id, ...s.recents.filter((r) => r !== id)].slice(0, 8) })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    }),
    { name: 'onbijjang:prefs', version: 1 },
  ),
)
