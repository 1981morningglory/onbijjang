/** 되돌리기·다시 하기. 같은 tag 로 이어지는 변경(끌기, 슬라이더)은 한 단계로 묶는다. */

export interface History<T> {
  past: T[]
  present: T
  future: T[]
  /** 마지막 변경의 묶음 이름 */
  tag: string | null
  /** 마지막 변경 시각(ms) */
  at: number
}

const LIMIT = 100
const MERGE_WINDOW_MS = 1200

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], tag: null, at: 0 }
}

export function commit<T>(h: History<T>, next: T, tag: string | null = null, now = Date.now()): History<T> {
  if (next === h.present) return h
  if (tag && tag === h.tag && now - h.at < MERGE_WINDOW_MS && h.past.length > 0) {
    return { past: h.past, present: next, future: [], tag, at: now }
  }
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [], tag, at: now }
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], tag: null, at: 0 }
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), tag: null, at: 0 }
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0
export const canRedo = <T>(h: History<T>) => h.future.length > 0
