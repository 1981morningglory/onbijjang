import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * localStorage 에 남는 상태. 도구 설정을 새로고침 뒤에도 유지할 때 쓴다.
 * key 는 'onbijjang:<도구id>:<이름>' 형식으로 한다. 파일·이미지처럼 큰 값은 넣지 않는다(idb-keyval 사용).
 */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return initial
      const parsed = JSON.parse(raw)
      // 객체 설정은 새로 추가된 항목이 빠지지 않도록 기본값과 합친다.
      if (initial && typeof initial === 'object' && !Array.isArray(initial) && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...initial, ...parsed }
      }
      return parsed as T
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // 저장 공간이 없거나 차단된 경우 — 화면 동작에는 영향 없음
    }
  }, [key, value])
  return [value, setValue]
}

/** 페이지 어디서든 Ctrl+V 로 들어온 파일(캡처 이미지 포함)을 받는다. 입력창에 붙여넣을 때는 무시한다. */
export function usePasteFiles(onFiles: (files: File[]) => void, enabled = true) {
  const handler = useRef(onFiles)
  handler.current = onFiles
  useEffect(() => {
    if (!enabled) return
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) {
        e.preventDefault()
        handler.current(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [enabled])
}

/** 클립보드 읽기 버튼용. 권한이 없으면 null. */
export async function readClipboardImages(): Promise<File[] | null> {
  try {
    const items = await navigator.clipboard.read()
    const files: File[] = []
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (type) {
        const blob = await item.getType(type)
        files.push(new File([blob], `붙여넣기-${Date.now()}.${type.split('/')[1]}`, { type }))
      }
    }
    return files
  } catch {
    return null
  }
}

/** Blob/File 의 object URL 을 만들고 바뀌거나 사라질 때 해제한다. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/** 진행 중인 긴 작업을 취소할 수 있게 하는 도우미 */
export function useAbortable() {
  const ref = useRef<AbortController | null>(null)
  const start = useCallback(() => {
    ref.current?.abort()
    ref.current = new AbortController()
    return ref.current.signal
  }, [])
  const abort = useCallback(() => ref.current?.abort(), [])
  useEffect(() => () => ref.current?.abort(), [])
  return { start, abort }
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** 숫자 서식: 1,234,567 */
export const fmt = new Intl.NumberFormat('ko-KR')
export const won = (n: number) => `${fmt.format(Math.trunc(n))}원`
