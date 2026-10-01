import { useCallback, useRef, useState } from 'react'

const LIMIT = 80
const MERGE_MS = 900

export interface History<T> {
  state: T
  /** 바꾸고 되돌리기 기록에 남긴다. 같은 tag 로 잇달아 바꾸면(글자 입력 등) 한 단계로 묶는다. */
  set: (next: T | ((prev: T) => T), tag?: string) => void
  /** 끌어 옮기는 동안처럼 기록 없이 바꾼다. 끝나면 commitPreview 로 한 단계만 남긴다. */
  preview: (next: T | ((prev: T) => T)) => void
  commitPreview: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** 기록을 비우고 새 상태로 시작한다(저장본 불러오기). */
  reset: (next: T) => void
}

export function useHistory<T>(initial: T | (() => T)): History<T> {
  const [state, setState] = useState<T>(initial)
  const current = useRef(state)
  current.current = state
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const base = useRef<T | null>(null)
  const last = useRef<{ tag: string; at: number } | null>(null)
  const [, bump] = useState(0)

  const push = (prev: T) => {
    past.current.push(prev)
    if (past.current.length > LIMIT) past.current.shift()
    future.current = []
  }

  const set = useCallback<History<T>['set']>((next, tag) => {
    const prev = current.current
    const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
    if (value === prev) return
    const now = Date.now()
    const merge = tag !== undefined && last.current?.tag === tag && now - last.current.at < MERGE_MS
    if (!merge) push(base.current ?? prev)
    base.current = null
    last.current = tag !== undefined ? { tag, at: now } : null
    current.current = value
    setState(value)
    bump((n) => n + 1)
  }, [])

  const preview = useCallback<History<T>['preview']>((next) => {
    const prev = current.current
    base.current ??= prev
    const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
    current.current = value
    setState(value)
  }, [])

  const commitPreview = useCallback(() => {
    if (base.current !== null && base.current !== current.current) {
      push(base.current)
      last.current = null
      bump((n) => n + 1)
    }
    base.current = null
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (prev === undefined) return
    future.current.push(current.current)
    base.current = null
    last.current = null
    current.current = prev
    setState(prev)
    bump((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (next === undefined) return
    past.current.push(current.current)
    base.current = null
    last.current = null
    current.current = next
    setState(next)
    bump((n) => n + 1)
  }, [])

  const reset = useCallback((next: T) => {
    past.current = []
    future.current = []
    base.current = null
    last.current = null
    current.current = next
    setState(next)
    bump((n) => n + 1)
  }, [])

  return { state, set, preview, commitPreview, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0, reset }
}
