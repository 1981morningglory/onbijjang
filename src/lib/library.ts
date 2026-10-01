import { get, set } from 'idb-keyval'
import { api, ApiError } from './api'

/**
 * 팀 보관함 — 템플릿·서명·라벨 양식처럼 팀이 같이 쓰는 저장물.
 * 서버에 저장할 수 있으면 서버(data/library)에, 아니면 이 브라우저(IndexedDB)에 저장한다.
 * 인터넷에 공개된 배포에서는 관리자로 로그인한 사람만 서버(팀 공용)에 저장할 수 있다.
 */
export interface LibraryEntry {
  id: string
  name: string
  createdAt: string
  /** 작은 미리보기 data URL (선택) */
  thumb?: string
  /** 서버가 없어 이 브라우저에만 저장된 항목 */
  local?: boolean
}

const localKey = (kind: string) => `onbijjang:library:${kind}`
type LocalItem = LibraryEntry & { data: unknown }

async function localItems(kind: string): Promise<LocalItem[]> {
  return ((await get(localKey(kind))) as LocalItem[] | undefined) ?? []
}

export async function listLibrary(kind: string): Promise<LibraryEntry[]> {
  const local = (await localItems(kind)).map(({ data: _data, ...entry }) => ({ ...entry, local: true }))
  try {
    const { items } = await api<{ items: LibraryEntry[] }>(`/library/${kind}`)
    return [...items, ...local]
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) return local
    throw err
  }
}

export async function loadLibraryItem<T>(kind: string, entry: LibraryEntry): Promise<T> {
  if (entry.local) {
    const found = (await localItems(kind)).find((i) => i.id === entry.id)
    if (!found) throw new Error('저장된 항목을 찾을 수 없습니다.')
    return found.data as T
  }
  const { item } = await api<{ item: { data: T } }>(`/library/${kind}/${entry.id}`)
  return item.data
}

export async function saveLibraryItem(kind: string, name: string, data: unknown, thumb?: string): Promise<LibraryEntry> {
  try {
    const { item } = await api<{ item: LibraryEntry }>(`/library/${kind}`, { method: 'POST', body: { name, data, thumb } })
    return item
  } catch (err) {
    // 서버가 없거나(0), 공개 배포라 관리자만 팀 보관함에 저장할 수 있는 경우(401) — 이 브라우저에 저장한다.
    if (!(err instanceof ApiError && (err.status === 0 || err.status === 401))) throw err
    const entry: LocalItem = {
      id: Math.random().toString(36).slice(2, 12) + Date.now().toString(36),
      name,
      createdAt: new Date().toISOString(),
      thumb,
      local: true,
      data,
    }
    await set(localKey(kind), [entry, ...(await localItems(kind))])
    const { data: _data, ...rest } = entry
    return rest
  }
}

/** 서버 항목 삭제는 관리자만 가능(401 이면 안내 문구가 담긴 오류). 로컬 항목은 누구나. */
export async function deleteLibraryItem(kind: string, entry: LibraryEntry): Promise<void> {
  if (entry.local) {
    await set(localKey(kind), (await localItems(kind)).filter((i) => i.id !== entry.id))
    return
  }
  await api(`/library/${kind}/${entry.id}`, { method: 'DELETE' })
}
