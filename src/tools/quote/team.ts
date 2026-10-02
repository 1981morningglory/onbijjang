/**
 * 팀 공간 — 서버(/api/quote/*)와 주고받는 상태.
 * 팀 코드로 들어온 브라우저만 그 팀의 회사 자료·담당자·문서를 볼 수 있다.
 */
import { create } from 'zustand'
import { api, ApiError } from '@/lib/api'
import { normalizeKit } from './kit'
import { emptyKit, type CompanyKit, type Contact, type QuoteDoc } from './model'

export interface TeamInfo {
  id: string
  name: string
}

/** 문서함 목록 한 줄(서버가 만든 요약) */
export interface DocEntry {
  id: string
  type: 'quote' | 'statement'
  date: string
  docNo: string
  customer: string
  customerBizNo: string
  title: string
  vatMode: string
  supply: number
  tax: number
  total: number
  items: Array<{ name: string; spec: string; qty: number; unitPrice: number; total: number }>
  author: string
  createdAt: string
  updatedAt: string
}

type Phase = 'loading' | 'out' | 'in' | 'offline'

interface TeamState {
  phase: Phase
  team: TeamInfo | null
  admin: boolean
  /** 관리자에게만: 들어갈 수 있는 팀 목록 */
  teams: TeamInfo[]
  hasTeams: boolean
  /** 문서에 쓰는 회사 자료(팀 자료 → 없으면 회사 공통 자료). 담당자는 팀 담당자 */
  kit: CompanyKit
  kitSource: 'team' | 'common' | 'none'
  contacts: Contact[]
  docs: DocEntry[] | null
  load: () => Promise<void>
  login: (code: string) => Promise<void>
  adminEnter: (teamId: string) => Promise<void>
  logout: () => Promise<void>
  changeCode: (current: string, next: string) => Promise<void>
  refreshKit: () => Promise<void>
  saveTeamKit: (kit: CompanyKit) => Promise<void>
  useCommonKit: () => Promise<void>
  saveContacts: (contacts: Contact[]) => Promise<void>
  loadDocs: () => Promise<void>
  getDoc: (id: string) => Promise<QuoteDoc>
  saveDoc: (doc: QuoteDoc, id: string | null) => Promise<DocEntry>
  deleteDoc: (id: string) => Promise<void>
}

const withContacts = (kit: CompanyKit, contacts: Contact[]): CompanyKit => ({ ...kit, contacts })

export const useTeam = create<TeamState>((setState, getState) => {
  /** 팀 세션이 끊기면(코드가 바뀜 등) 입장 화면으로 돌린다 */
  const guard = async <T,>(p: Promise<T>): Promise<T> => {
    try {
      return await p
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setState({ phase: 'out', team: null, docs: null })
        throw new Error('팀 코드가 바뀌었거나 입장이 끝났습니다. 팀 코드를 다시 넣어 주세요.')
      }
      throw err
    }
  }
  const enter = async (team: TeamInfo) => {
    setState({ team, phase: 'in', docs: null })
    await Promise.all([getState().refreshKit(), getState().loadDocs()])
  }

  return {
    phase: 'loading',
    team: null,
    admin: false,
    teams: [],
    hasTeams: false,
    kit: emptyKit(),
    kitSource: 'none',
    contacts: [],
    docs: null,
    async load() {
      try {
        const s = await api<{ team: TeamInfo | null; admin: boolean; teams?: TeamInfo[]; hasTeams: boolean }>('/quote/session')
        setState({ admin: s.admin, teams: s.teams ?? [], hasTeams: s.hasTeams })
        if (s.team) await enter(s.team)
        else setState({ phase: 'out', team: null })
      } catch (err) {
        if (err instanceof ApiError && err.status === 0) setState({ phase: 'offline' })
        else setState({ phase: 'out' })
      }
    },
    async login(code) {
      const { team } = await api<{ team: TeamInfo }>('/quote/login', { method: 'POST', body: { code } })
      await enter(team)
    },
    async adminEnter(teamId) {
      const { team } = await api<{ team: TeamInfo }>('/quote/admin-enter', { method: 'POST', body: { teamId } })
      await enter(team)
    },
    async logout() {
      await api('/quote/logout', { method: 'POST' }).catch(() => {})
      // 함께 쓰는 PC 에 거래처·금액이 남지 않도록 작성 중 문서를 지운다
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('onbijjang:quote:draft')) localStorage.removeItem(k)
      } catch {
        // 저장소를 못 쓰면 지울 것도 없다
      }
      setState({ phase: 'out', team: null, docs: null, kit: emptyKit(), kitSource: 'none', contacts: [] })
      await getState().load()
    },
    async changeCode(current, next) {
      await guard(api('/quote/team/code', { method: 'POST', body: { current, next } }))
    },
    async refreshKit() {
      const res = await guard(api<{ kit: unknown; source: 'team' | 'common' | 'none'; contacts: Contact[] }>('/quote/kit'))
      const contacts = (Array.isArray(res.contacts) ? res.contacts : []).map((c) => normalizeKit({ company: {}, contacts: [c] }).contacts[0])
      const kit = res.kit ? normalizeKit(res.kit) : emptyKit()
      setState({ kit: withContacts(kit, contacts), kitSource: res.source, contacts })
    },
    async saveTeamKit(kit) {
      await guard(api('/quote/kit', { method: 'PUT', body: { kit: { ...kit, contacts: [] } } }))
      await getState().refreshKit()
    },
    async useCommonKit() {
      await guard(api('/quote/kit', { method: 'DELETE' }))
      await getState().refreshKit()
    },
    async saveContacts(contacts) {
      const res = await guard(api<{ contacts: Contact[] }>('/quote/contacts', { method: 'PUT', body: { contacts } }))
      setState((s) => ({ contacts: res.contacts, kit: withContacts(s.kit, res.contacts) }))
    },
    async loadDocs() {
      const { docs } = await guard(api<{ docs: DocEntry[] }>('/quote/docs'))
      setState({ docs })
    },
    async getDoc(id) {
      const res = await guard(api<{ doc: QuoteDoc }>(`/quote/docs/${id}`))
      return res.doc
    },
    async saveDoc(doc, id) {
      const create = () => api<{ entry: DocEntry }>('/quote/docs', { method: 'POST', body: { doc } })
      // 고치던 문서를 다른 팀원이 지웠으면 새 문서로 저장한다
      const res = await guard(id ? api<{ entry: DocEntry }>(`/quote/docs/${id}`, { method: 'PUT', body: { doc } }).catch((err) => (err instanceof ApiError && err.status === 404 ? create() : Promise.reject(err))) : create())
      setState((s) => ({ docs: [res.entry, ...(s.docs ?? []).filter((d) => d.id !== res.entry.id)] }))
      return res.entry
    },
    async deleteDoc(id) {
      await guard(api(`/quote/docs/${id}`, { method: 'DELETE' }))
      setState((s) => ({ docs: (s.docs ?? []).filter((d) => d.id !== id) }))
    },
  }
})
