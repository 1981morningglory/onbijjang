/**
 * 확장 프로그램이 넘기는 이미지 받기.
 * 확장은 이 탭에 스크립트를 넣어 window.postMessage 로 begin → chunk… → end 를 보낸다
 * (약속은 extension/capture/lib/protocol.js). 여기서는 모양을 검사하며 조립하고 ack 로 답한다.
 */
import { useEffect, useRef, useState } from 'react'
import { HANDOVER, base64ToBytes } from '../../../extension/capture/lib/protocol.js'

export interface CaptureMeta {
  url: string
  title: string
  capturedAt: number | null
  /** 확장에서 "주소·시각 한 줄"을 켜 두었는지 */
  footer: boolean
}

export interface ReceivedFile {
  name: string
  mime: string
  size: number
  parts: Uint8Array<ArrayBuffer>[]
}

export type ReceiverEvent =
  | { kind: 'ignored' }
  | { kind: 'progress'; id: string; received: number; total: number }
  | { kind: 'done'; id: string; files: ReceivedFile[]; meta: CaptureMeta }
  | { kind: 'error'; id: string | null; reason: string; /** 이미 알린 실패를 끝 신호에 다시 답하는 경우 */ repeat?: boolean }

interface Session {
  id: string
  specs: Array<{ name: string; mime: string; size: number; chunks: number }>
  meta: CaptureMeta
  files: ReceivedFile[]
  file: number
  chunk: number
  bytes: number
  received: number
  total: number
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const MAX_CHUNKS_PER_FILE = Math.ceil(HANDOVER.MAX_FILE_BYTES / 1024)
/** base64 조각 한 개의 최대 길이. 약속된 크기보다 넉넉히 잡되 터무니없이 큰 것은 막는다. */
const MAX_CHUNK_CHARS = 4 * 1024 * 1024

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max

function readMeta(raw: unknown): CaptureMeta {
  const m = isObject(raw) ? raw : {}
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  let url = text(m.url, 2000)
  // 화면에 그대로 찍히는 값이라 웹 주소 꼴만 받는다.
  if (url && !/^(https?|file):/i.test(url)) url = ''
  const at = typeof m.capturedAt === 'number' && Number.isFinite(m.capturedAt) && m.capturedAt > 0 ? m.capturedAt : null
  return { url, title: text(m.title, 300), capturedAt: at, footer: m.footer === true }
}

/** 받은 메시지를 차례로 넣으면 진행·완료·오류를 알려 주는 조립기. DOM 을 쓰지 않는다. */
export function createReceiver() {
  let session: Session | null = null
  let failed: { id: string; reason: string } | null = null

  const fail = (id: string | null, reason: string): ReceiverEvent => {
    if (id) failed = { id, reason }
    session = null
    return { kind: 'error', id, reason }
  }

  return {
    handle(data: unknown): ReceiverEvent {
      if (!isObject(data) || typeof data.type !== 'string') return { kind: 'ignored' }
      const type = data.type
      if (type !== HANDOVER.BEGIN && type !== HANDOVER.CHUNK && type !== HANDOVER.END) return { kind: 'ignored' }
      const id = typeof data.id === 'string' && ID_RE.test(data.id) ? data.id : null
      if (!id) return { kind: 'error', id: null, reason: '확장 프로그램이 보낸 내용을 알아볼 수 없습니다.' }

      if (type === HANDOVER.BEGIN) {
        if (data.v !== HANDOVER.VERSION) return fail(id, '확장 프로그램 버전이 이 화면과 맞지 않습니다. 설치 안내에서 최신 버전으로 업데이트해 주세요.')
        if (!Array.isArray(data.files) || data.files.length < 1 || data.files.length > HANDOVER.MAX_FILES) return fail(id, '한 번에 받을 수 있는 이미지 수를 넘었습니다.')
        const specs: Session['specs'] = []
        for (const f of data.files) {
          if (!isObject(f) || typeof f.name !== 'string' || !f.name || f.name.length > 200) return fail(id, '이미지 이름을 알아볼 수 없습니다.')
          if (typeof f.mime !== 'string' || !HANDOVER.MIMES.includes(f.mime)) return fail(id, 'PNG·JPG 이미지만 받을 수 있습니다.')
          if (!isCount(f.size, HANDOVER.MAX_FILE_BYTES)) return fail(id, '이미지가 너무 큽니다. 확장 프로그램에서 PNG 로 저장한 뒤 끌어다 놓아 주세요.')
          if (!isCount(f.chunks, MAX_CHUNKS_PER_FILE)) return fail(id, '이미지 조각 수를 알아볼 수 없습니다.')
          specs.push({ name: f.name, mime: f.mime, size: f.size, chunks: f.chunks })
        }
        failed = null
        session = {
          id,
          specs,
          meta: readMeta(data.meta),
          files: specs.map((s) => ({ name: s.name, mime: s.mime, size: s.size, parts: [] })),
          file: 0,
          chunk: 0,
          bytes: 0,
          received: 0,
          total: specs.reduce((sum, s) => sum + s.chunks, 0),
        }
        return { kind: 'progress', id, received: 0, total: session.total }
      }

      if (!session || session.id !== id) {
        // 이미 실패를 알린 전송의 나머지 조각은 조용히 버리고, 끝 신호에는 이유를 다시 알려 준다.
        if (failed?.id === id) return type === HANDOVER.END ? { kind: 'error', id, reason: failed.reason, repeat: true } : { kind: 'ignored' }
        return type === HANDOVER.END ? { kind: 'error', id, reason: '받는 중이던 이미지가 없습니다. 확장 프로그램에서 다시 보내 주세요.' } : { kind: 'ignored' }
      }
      const s = session

      if (type === HANDOVER.CHUNK) {
        if (s.file >= s.specs.length || data.file !== s.file || data.index !== s.chunk) return fail(id, '이미지 조각이 순서대로 오지 않았습니다. 다시 보내 주세요.')
        if (typeof data.data !== 'string' || !data.data || data.data.length > MAX_CHUNK_CHARS) return fail(id, '이미지 조각을 읽지 못했습니다. 다시 보내 주세요.')
        let bytes: Uint8Array<ArrayBuffer>
        try {
          bytes = base64ToBytes(data.data)
        } catch {
          return fail(id, '이미지 조각을 읽지 못했습니다. 다시 보내 주세요.')
        }
        const spec = s.specs[s.file]
        s.bytes += bytes.length
        if (s.bytes > spec.size) return fail(id, '받은 이미지가 알려 준 크기보다 큽니다. 다시 보내 주세요.')
        s.files[s.file].parts.push(bytes)
        s.chunk++
        s.received++
        if (s.chunk === spec.chunks) {
          if (s.bytes !== spec.size) return fail(id, '이미지가 끝까지 오지 않았습니다. 다시 보내 주세요.')
          s.file++
          s.chunk = 0
          s.bytes = 0
        }
        return { kind: 'progress', id, received: s.received, total: s.total }
      }

      // END
      if (s.file !== s.specs.length) return fail(id, '이미지가 끝까지 오지 않았습니다. 다시 보내 주세요.')
      session = null
      return { kind: 'done', id, files: s.files, meta: s.meta }
    },
  }
}

/** 우리 창에서, 우리 주소로 온 메시지인지 */
export function isOwnMessage(e: Pick<MessageEvent, 'source' | 'origin'>, win: Pick<Window, 'location'>): boolean {
  return e.source === win && e.origin === win.location.origin
}

/**
 * 확장 프로그램에서 넘어오는 이미지를 받는다. 받을 준비가 됐다는 표시를 <html> 에 달아 둔다.
 * @returns 받는 중이면 진행률(0–100), 아니면 null
 */
export function useExtensionHandover(onFiles: (files: File[], meta: CaptureMeta) => void, onError: (reason: string) => void): number | null {
  const handlers = useRef({ onFiles, onError })
  handlers.current = { onFiles, onError }
  const [progress, setProgress] = useState<number | null>(null)

  useEffect(() => {
    const receiver = createReceiver()
    const ack = (id: string, ok: boolean, reason = '') => window.postMessage({ type: HANDOVER.ACK, id, ok, reason }, window.location.origin)
    const onMessage = (e: MessageEvent) => {
      if (!isOwnMessage(e, window)) return
      const ev = receiver.handle(e.data)
      if (ev.kind === 'ignored') return
      if (ev.kind === 'progress') {
        setProgress(ev.total ? (ev.received / ev.total) * 100 : 0)
        return
      }
      setProgress(null)
      if (ev.kind === 'error') {
        if (ev.id) ack(ev.id, false, ev.reason)
        if (!ev.repeat) handlers.current.onError(ev.reason)
        return
      }
      const files = ev.files.map((f) => new File(f.parts, f.name, { type: f.mime, lastModified: ev.meta.capturedAt ?? Date.now() }))
      ack(ev.id, true)
      handlers.current.onFiles(files, ev.meta)
    }
    window.addEventListener('message', onMessage)
    document.documentElement.setAttribute(HANDOVER.READY_ATTR, HANDOVER.READY_VALUE)
    return () => {
      window.removeEventListener('message', onMessage)
      document.documentElement.removeAttribute(HANDOVER.READY_ATTR)
    }
  }, [])

  return progress
}
