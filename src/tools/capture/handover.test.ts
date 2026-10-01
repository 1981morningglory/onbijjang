import { describe, expect, it } from 'vitest'
import { HANDOVER, base64ToBytes, bytesToBase64, chunkCount, chunkRange, dataUrlToBlob } from '../../../extension/capture/lib/protocol.js'
import { createReceiver, isOwnMessage, type ReceiverEvent } from './handover'

function randomBytes(n: number) {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (i * 31 + (i >> 7) * 17 + 5) & 255
  return out
}

/** 확장 프로그램 결과 화면(result.js)이 보내는 순서를 그대로 만든다. */
function messagesFor(id: string, files: Array<{ name: string; mime: string; bytes: Uint8Array }>, meta: unknown = {}) {
  const out: unknown[] = [
    { type: HANDOVER.BEGIN, v: HANDOVER.VERSION, id, files: files.map((f) => ({ name: f.name, mime: f.mime, size: f.bytes.length, chunks: chunkCount(f.bytes.length) })), meta },
  ]
  files.forEach((f, fi) => {
    for (let i = 0; i < chunkCount(f.bytes.length); i++) {
      const [from, to] = chunkRange(i, f.bytes.length)
      out.push({ type: HANDOVER.CHUNK, id, file: fi, index: i, data: bytesToBase64(f.bytes.subarray(from, to)) })
    }
  })
  out.push({ type: HANDOVER.END, id })
  return out
}

function feed(messages: unknown[]) {
  const r = createReceiver()
  const events = messages.map((m) => r.handle(m))
  return { r, events, last: events[events.length - 1] }
}

function join(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('조각 계산', () => {
  it('조각 크기는 3의 배수라 조각마다 따로 base64 로 풀 수 있다', () => {
    expect(HANDOVER.CHUNK_BYTES % 3).toBe(0)
  })
  it('조각 수와 범위', () => {
    expect(chunkCount(0)).toBe(1)
    expect(chunkCount(HANDOVER.CHUNK_BYTES)).toBe(1)
    expect(chunkCount(HANDOVER.CHUNK_BYTES + 1)).toBe(2)
    expect(chunkRange(0, 10, 4)).toEqual([0, 4])
    expect(chunkRange(2, 10, 4)).toEqual([8, 10])
  })
  it('base64 로 바꿨다가 되돌리면 같다(큰 것도)', () => {
    const bytes = randomBytes(200_001)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
  it('data URL 을 Blob 으로', async () => {
    const blob = dataUrlToBlob(`data:image/png;base64,${bytesToBase64(new Uint8Array([1, 2, 3, 250]))}`)
    expect(blob.type).toBe('image/png')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 250]))
    expect(() => dataUrlToBlob('data:text/plain,hello')).toThrow()
  })
})

describe('createReceiver', () => {
  const meta = { url: 'https://example.com/page', title: '예시', capturedAt: 1_790_000_000_000, footer: true }

  it('여러 조각으로 온 큰 이미지를 그대로 되살린다', () => {
    const bytes = randomBytes(HANDOVER.CHUNK_BYTES * 2 + 12345)
    const { events, last } = feed(messagesFor('h1', [{ name: '캡처.png', mime: 'image/png', bytes }], meta))
    expect(events.filter((e) => e.kind === 'progress')).toHaveLength(1 + 3)
    expect(last.kind).toBe('done')
    if (last.kind !== 'done') return
    expect(last.files).toHaveLength(1)
    expect(last.files[0]).toMatchObject({ name: '캡처.png', mime: 'image/png', size: bytes.length })
    expect(join(last.files[0].parts)).toEqual(bytes)
    expect(last.meta).toEqual(meta)
  })

  it('여러 장을 차례로 받는다', () => {
    const a = randomBytes(1000)
    const b = randomBytes(HANDOVER.CHUNK_BYTES + 7)
    const { last } = feed(messagesFor('h2', [{ name: 'a_1.png', mime: 'image/png', bytes: a }, { name: 'a_2.png', mime: 'image/png', bytes: b }]))
    expect(last.kind).toBe('done')
    if (last.kind !== 'done') return
    expect(join(last.files[0].parts)).toEqual(a)
    expect(join(last.files[1].parts)).toEqual(b)
  })

  it('진행률이 끝에서 100%가 된다', () => {
    const { events } = feed(messagesFor('h3', [{ name: 'a.png', mime: 'image/png', bytes: randomBytes(HANDOVER.CHUNK_BYTES * 3) }]))
    const progress = events.filter((e): e is Extract<ReceiverEvent, { kind: 'progress' }> => e.kind === 'progress')
    expect(progress[0]).toMatchObject({ received: 0, total: 3 })
    expect(progress[progress.length - 1]).toMatchObject({ received: 3, total: 3 })
  })

  it('상관없는 메시지는 무시한다', () => {
    const r = createReceiver()
    for (const m of [null, 'text', 42, [], {}, { type: 5 }, { type: 'other' }, { type: HANDOVER.ACK, id: 'x', ok: true }]) {
      expect(r.handle(m).kind).toBe('ignored')
    }
  })

  it('시작 신호 없이 온 조각은 무시하고, 끝 신호에는 실패로 답한다', () => {
    const r = createReceiver()
    expect(r.handle({ type: HANDOVER.CHUNK, id: 'zz', file: 0, index: 0, data: 'AAAA' }).kind).toBe('ignored')
    expect(r.handle({ type: HANDOVER.END, id: 'zz' }).kind).toBe('error')
  })

  it.each([
    ['버전이 다름', { v: 99 }],
    ['파일 없음', { files: [] }],
    ['파일이 너무 많음', { files: Array.from({ length: HANDOVER.MAX_FILES + 1 }, () => ({ name: 'a.png', mime: 'image/png', size: 1, chunks: 1 })) }],
    ['이미지가 아님', { files: [{ name: 'a.html', mime: 'text/html', size: 1, chunks: 1 }] }],
    ['SVG 는 받지 않음', { files: [{ name: 'a.svg', mime: 'image/svg+xml', size: 1, chunks: 1 }] }],
    ['크기 초과', { files: [{ name: 'a.png', mime: 'image/png', size: HANDOVER.MAX_FILE_BYTES + 1, chunks: 1 }] }],
    ['크기가 숫자가 아님', { files: [{ name: 'a.png', mime: 'image/png', size: '10', chunks: 1 }] }],
    ['조각 수가 0', { files: [{ name: 'a.png', mime: 'image/png', size: 10, chunks: 0 }] }],
    ['이름 없음', { files: [{ name: '', mime: 'image/png', size: 10, chunks: 1 }] }],
    ['파일 목록이 배열이 아님', { files: 'a.png' }],
  ])('잘못된 시작 신호를 거절한다: %s', (_label, patch) => {
    const begin = { type: HANDOVER.BEGIN, v: HANDOVER.VERSION, id: 'bad', files: [{ name: 'a.png', mime: 'image/png', size: 3, chunks: 1 }], meta: {}, ...patch }
    const ev = createReceiver().handle(begin)
    expect(ev.kind).toBe('error')
    if (ev.kind === 'error') expect(ev.reason.length).toBeGreaterThan(0)
  })

  it('id 가 이상하면 거절한다', () => {
    for (const id of ['', 'a b', '<script>', 'x'.repeat(65), 7, null]) {
      expect(createReceiver().handle({ type: HANDOVER.BEGIN, v: HANDOVER.VERSION, id, files: [] }).kind).toBe('error')
    }
  })

  it('순서가 틀린 조각은 실패로 끝내고, 뒤따라오는 조각은 버리고, 끝 신호에 같은 이유를 다시 알려 준다', () => {
    const msgs = messagesFor('h4', [{ name: 'a.png', mime: 'image/png', bytes: randomBytes(HANDOVER.CHUNK_BYTES * 3) }])
    const r = createReceiver()
    expect(r.handle(msgs[0]).kind).toBe('progress')
    const wrong = r.handle(msgs[2]) // 0번을 건너뛰고 1번
    expect(wrong.kind).toBe('error')
    expect(r.handle(msgs[1]).kind).toBe('ignored')
    const end = r.handle(msgs[msgs.length - 1])
    expect(end).toMatchObject({ kind: 'error', repeat: true })
    if (wrong.kind === 'error' && end.kind === 'error') expect(end.reason).toBe(wrong.reason)
  })

  it('알려 준 크기와 다르면 실패', () => {
    const bytes = randomBytes(100)
    const msgs = messagesFor('h5', [{ name: 'a.png', mime: 'image/png', bytes }]) as Array<Record<string, unknown>>
    ;(msgs[0].files as Array<{ size: number }>)[0].size = 99
    expect(feed(msgs).events[1].kind).toBe('error')
    const msgs2 = messagesFor('h6', [{ name: 'a.png', mime: 'image/png', bytes }]) as Array<Record<string, unknown>>
    ;(msgs2[0].files as Array<{ size: number }>)[0].size = 101
    expect(feed(msgs2).events[1].kind).toBe('error')
  })

  it('조각이 덜 왔는데 끝 신호가 오면 실패', () => {
    const msgs = messagesFor('h7', [{ name: 'a.png', mime: 'image/png', bytes: randomBytes(HANDOVER.CHUNK_BYTES * 2) }])
    msgs.splice(2, 1)
    expect(feed(msgs).last.kind).toBe('error')
  })

  it('base64 가 아닌 조각은 실패', () => {
    const msgs = messagesFor('h8', [{ name: 'a.png', mime: 'image/png', bytes: randomBytes(10) }]) as Array<Record<string, unknown>>
    msgs[1].data = '***not base64***'
    expect(feed(msgs).events[1].kind).toBe('error')
    msgs[1].data = 12345
    expect(feed(msgs).events[1].kind).toBe('error')
  })

  it('다른 id 의 조각이 끼어들어도 진행 중인 전송은 망가지지 않는다', () => {
    const bytes = randomBytes(50)
    const msgs = messagesFor('h9', [{ name: 'a.png', mime: 'image/png', bytes }])
    const r = createReceiver()
    r.handle(msgs[0])
    expect(r.handle({ type: HANDOVER.CHUNK, id: 'other', file: 0, index: 0, data: 'AAAA' }).kind).toBe('ignored')
    r.handle(msgs[1])
    const done = r.handle(msgs[2])
    expect(done.kind).toBe('done')
  })

  it('실패한 뒤에도 새 전송은 받는다', () => {
    const r = createReceiver()
    r.handle({ type: HANDOVER.BEGIN, v: 99, id: 'x1', files: [] })
    const msgs = messagesFor('x2', [{ name: 'a.png', mime: 'image/png', bytes: randomBytes(10) }])
    expect(msgs.map((m) => r.handle(m)).pop()?.kind).toBe('done')
  })

  it('딸려 온 정보는 모양을 확인해 정리한다', () => {
    const base = [{ name: 'a.png', mime: 'image/png', bytes: randomBytes(3) }]
    const pick = (meta: unknown) => {
      const { last } = feed(messagesFor('m1', base, meta))
      return last.kind === 'done' ? last.meta : null
    }
    expect(pick(undefined)).toEqual({ url: '', title: '', capturedAt: null, footer: false })
    expect(pick({ url: 'javascript:alert(1)', title: 5, capturedAt: 'now', footer: 'yes' })).toEqual({ url: '', title: '', capturedAt: null, footer: false })
    expect(pick({ url: 'https://a.b/c', title: '가'.repeat(999), capturedAt: 123 })?.title).toHaveLength(300)
    expect(pick({ url: `https://a.b/${'x'.repeat(5000)}` })?.url.length).toBe(2000)
  })
})

describe('isOwnMessage', () => {
  const win = { location: { origin: 'http://localhost:5173' } } as unknown as Window
  it('같은 창, 같은 주소에서 온 것만 받는다', () => {
    expect(isOwnMessage({ source: win as unknown as MessageEventSource, origin: 'http://localhost:5173' }, win)).toBe(true)
    expect(isOwnMessage({ source: {} as MessageEventSource, origin: 'http://localhost:5173' }, win)).toBe(false)
    expect(isOwnMessage({ source: win as unknown as MessageEventSource, origin: 'https://evil.example' }, win)).toBe(false)
    expect(isOwnMessage({ source: null, origin: 'http://localhost:5173' }, win)).toBe(false)
  })
})
