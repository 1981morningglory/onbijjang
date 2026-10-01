import { useEffect, useRef } from 'react'
import { create } from 'zustand'

interface HandoffState {
  pending: { toolId: string; files: File[] } | null
  send: (toolId: string, files: File[]) => void
  take: (toolId: string) => File[]
}

/**
 * 도구 간 파일 넘기기. 결과를 다시 내려받아 올리지 않고 다음 도구로 바로 보낸다.
 * 보내는 쪽: <SendToMenu files={...} /> (ui 키트)
 * 받는 쪽: useHandoffFiles('image', (files) => addFiles(files))
 */
export const useHandoff = create<HandoffState>((set, get) => ({
  pending: null,
  send: (toolId, files) => set({ pending: { toolId, files } }),
  take: (toolId) => {
    const p = get().pending
    if (!p || p.toolId !== toolId) return []
    set({ pending: null })
    return p.files
  },
}))

/** 도구가 열릴 때 다른 도구에서 넘어온 파일이 있으면 한 번 받아 처리한다. */
export function useHandoffFiles(toolId: string, onFiles: (files: File[]) => void) {
  const handler = useRef(onFiles)
  handler.current = onFiles
  useEffect(() => {
    const files = useHandoff.getState().take(toolId)
    if (files.length) handler.current(files)
  }, [toolId])
}
