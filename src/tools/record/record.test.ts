import { describe, expect, it } from 'vitest'
import { MIN_CROP, clampRect, fitRatio, fullRect, isFullRect, moveRect, ratioValue, rectFromDrag, resizeRect, setRectField } from './crop'
import { captureProblem, isMobile, pickRecorderFormat, shareErrorMessage } from './support'
import { patchWebmHead, readWebmDuration } from './webmDuration'

const BW = 1920
const BH = 1080

describe('녹화 영역', () => {
  it('화면 안으로 넣고 정수로 맞춘다', () => {
    expect(clampRect({ x: -20, y: 10.4, w: 300.6, h: 5000 }, BW, BH)).toEqual({ x: 0, y: 0, w: 301, h: 1080 })
    expect(clampRect({ x: 1900, y: 1070, w: 100, h: 100 }, BW, BH)).toEqual({ x: 1820, y: 980, w: 100, h: 100 })
    expect(clampRect({ x: 5, y: 5, w: 1, h: 1 }, BW, BH)).toEqual({ x: 5, y: 5, w: MIN_CROP, h: MIN_CROP })
  })

  it('비율 값', () => {
    expect(ratioValue('free')).toBeNull()
    expect(ratioValue('1:1')).toBe(1)
    expect(ratioValue('16:9')).toBeCloseTo(1.7778, 3)
    expect(ratioValue('4:3')).toBeCloseTo(1.3333, 3)
  })

  it('비율을 걸면 가운데를 유지하며 줄인다', () => {
    expect(fitRatio(fullRect(BW, BH), 1, BW, BH)).toEqual({ x: 420, y: 0, w: 1080, h: 1080 })
    expect(fitRatio(fullRect(BW, BH), 4 / 3, BW, BH)).toEqual({ x: 240, y: 0, w: 1440, h: 1080 })
    expect(fitRatio({ x: 100, y: 100, w: 400, h: 400 }, 16 / 9, BW, BH)).toEqual({ x: 100, y: 188, w: 400, h: 225 })
    expect(fitRatio({ x: 100, y: 100, w: 400, h: 300 }, null, BW, BH)).toEqual({ x: 100, y: 100, w: 400, h: 300 })
  })

  it('옮길 때 화면 밖으로 나가지 않는다', () => {
    const r = { x: 100, y: 100, w: 400, h: 300 }
    expect(moveRect(r, 10, -1, BW, BH)).toEqual({ x: 110, y: 99, w: 400, h: 300 })
    expect(moveRect(r, -500, -500, BW, BH)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
    expect(moveRect(r, 5000, 5000, BW, BH)).toEqual({ x: 1520, y: 780, w: 400, h: 300 })
  })

  it('손잡이로 크기를 바꾼다(자유 비율)', () => {
    const r = { x: 100, y: 100, w: 400, h: 300 }
    expect(resizeRect(r, 'se', 700, 500, null, BW, BH)).toEqual({ x: 100, y: 100, w: 600, h: 400 })
    expect(resizeRect(r, 'nw', 50, 60, null, BW, BH)).toEqual({ x: 50, y: 60, w: 450, h: 340 })
    expect(resizeRect(r, 'e', 5000, 0, null, BW, BH)).toEqual({ x: 100, y: 100, w: 1820, h: 300 })
    // 반대쪽을 넘겨 끌어도 최소 크기에서 멈춘다
    expect(resizeRect(r, 'w', 900, 0, null, BW, BH)).toEqual({ x: 484, y: 100, w: MIN_CROP, h: 300 })
    expect(resizeRect(r, 'n', 0, 900, null, BW, BH)).toEqual({ x: 100, y: 384, w: 400, h: MIN_CROP })
  })

  it('비율 고정: 모서리를 끌어도 비율과 반대쪽 모서리가 유지된다', () => {
    const r = { x: 100, y: 100, w: 400, h: 400 }
    const a = resizeRect(r, 'se', 700, 300, 1, BW, BH)
    expect(a).toEqual({ x: 100, y: 100, w: 600, h: 600 })
    const b = resizeRect(r, 'nw', 0, 0, 1, BW, BH)
    expect(b.w).toBe(b.h)
    expect(b.x + b.w).toBe(500)
    expect(b.y + b.h).toBe(500)
    // 화면 끝에서 멈춘다
    const c = resizeRect(r, 'se', 9000, 9000, 1, BW, BH)
    expect(c).toEqual({ x: 100, y: 100, w: 980, h: 980 })
  })

  it('비율 고정: 변을 끌면 다른 방향이 가운데 기준으로 함께 변한다', () => {
    const r = { x: 400, y: 300, w: 320, h: 180 }
    const a = resizeRect(r, 'e', 1040, 0, 16 / 9, BW, BH)
    expect(a).toEqual({ x: 400, y: 210, w: 640, h: 360 })
    const b = resizeRect(r, 's', 0, 660, 16 / 9, BW, BH)
    expect(b).toEqual({ x: 240, y: 300, w: 640, h: 360 })
  })

  it('빈 곳을 끌어 새로 그린다', () => {
    expect(rectFromDrag(100, 100, 500, 400, null, BW, BH)).toEqual({ x: 100, y: 100, w: 400, h: 300 })
    expect(rectFromDrag(500, 400, 100, 100, null, BW, BH)).toEqual({ x: 100, y: 100, w: 400, h: 300 })
    const sq = rectFromDrag(100, 100, 500, 200, 1, BW, BH)
    expect(sq).toEqual({ x: 100, y: 100, w: 400, h: 400 })
    // 왼쪽 위로 끌어도 처음 누른 곳이 고정된다
    const back = rectFromDrag(500, 500, 300, 450, 1, BW, BH)
    expect(back).toEqual({ x: 300, y: 300, w: 200, h: 200 })
    // 화면 밖까지 끌면 화면 안에서 멈춘다
    expect(rectFromDrag(1800, 1000, 5000, 5000, null, BW, BH)).toEqual({ x: 1800, y: 1000, w: 120, h: 80 })
  })

  it('숫자 입력', () => {
    const r = { x: 100, y: 100, w: 400, h: 300 }
    expect(setRectField(r, 'x', 250, null, BW, BH)).toEqual({ x: 250, y: 100, w: 400, h: 300 })
    expect(setRectField(r, 'w', 5000, null, BW, BH)).toEqual({ x: 100, y: 100, w: 1820, h: 300 })
    expect(setRectField(r, 'h', 2, null, BW, BH)).toEqual({ x: 100, y: 100, w: 400, h: MIN_CROP })
    expect(setRectField(r, 'w', 800, 16 / 9, BW, BH)).toEqual({ x: 100, y: 100, w: 800, h: 450 })
    expect(setRectField(r, 'h', 360, 16 / 9, BW, BH)).toEqual({ x: 100, y: 100, w: 640, h: 360 })
    expect(setRectField(r, 'w', NaN, null, BW, BH)).toBe(r)
  })

  it('전체 영역 여부', () => {
    expect(isFullRect(fullRect(BW, BH), BW, BH)).toBe(true)
    expect(isFullRect({ x: 0, y: 0, w: 100, h: 100 }, BW, BH)).toBe(false)
  })
})

describe('녹화 환경 확인', () => {
  const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  const android = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

  it('모바일 판별(아이패드는 맥으로 표시된다)', () => {
    expect(isMobile(desktop, 0)).toBe(false)
    expect(isMobile(android, 5)).toBe(true)
    expect(isMobile(mac, 0)).toBe(false)
    expect(isMobile(mac, 5)).toBe(true)
  })

  it('HTTP 주소가 가장 먼저 안내된다', () => {
    expect(captureProblem({ secure: false, hasDisplayMedia: false, userAgent: desktop, maxTouchPoints: 0 })).toBe('insecure')
    expect(captureProblem({ secure: false, hasDisplayMedia: false, userAgent: android, maxTouchPoints: 5 })).toBe('insecure')
    expect(captureProblem({ secure: true, hasDisplayMedia: false, userAgent: android, maxTouchPoints: 5 })).toBe('mobile')
    expect(captureProblem({ secure: true, hasDisplayMedia: false, userAgent: desktop, maxTouchPoints: 0 })).toBe('unsupported')
    expect(captureProblem({ secure: true, hasDisplayMedia: true, userAgent: desktop, maxTouchPoints: 0 })).toBeNull()
  })

  it('녹화 형식: MP4 가 되면 MP4, 아니면 WebM', () => {
    expect(pickRecorderFormat(() => true, true)).toEqual({ kind: 'mp4', mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2' })
    expect(pickRecorderFormat(() => true, false)).toEqual({ kind: 'mp4', mimeType: 'video/mp4;codecs=avc1.640028' })
    expect(pickRecorderFormat((t) => t.startsWith('video/webm'), true)).toEqual({ kind: 'webm', mimeType: 'video/webm;codecs=vp9,opus' })
    expect(pickRecorderFormat((t) => t === 'video/webm', false)).toEqual({ kind: 'webm', mimeType: 'video/webm' })
    expect(pickRecorderFormat(() => false, false)).toBeNull()
  })

  it('공유 창을 닫은 것은 오류로 보지 않는다', () => {
    const named = (name: string) => Object.assign(new Error('x'), { name })
    expect(shareErrorMessage(named('AbortError'))).toBeNull()
    expect(shareErrorMessage(named('NotAllowedError'))).toContain('권한')
    expect(shareErrorMessage(named('SomethingElse'))).toContain('새로고침')
  })
})

/** 크롬 MediaRecorder 가 만드는 WebM 머리말을 흉내 낸다: EBML · Segment(길이 모름) · Info · Tracks · Cluster */
function fakeWebmHead(opts: { withDuration?: boolean; seekHead?: boolean; knownSegment?: boolean } = {}): Uint8Array {
  const el = (id: number[], data: number[]) => [...id, 0x80 | data.length, ...data]
  const ebml = el([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])
  const timecodeScale = el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40])
  const muxingApp = el([0x4d, 0x80], [0x43, 0x68, 0x72, 0x6f, 0x6d, 0x65])
  const duration = opts.withDuration ? el([0x44, 0x89], [0, 0, 0, 0, 0, 0, 0, 0]) : []
  const info = el([0x15, 0x49, 0xa9, 0x66], [...timecodeScale, ...muxingApp, ...duration])
  const seekHead = opts.seekHead ? el([0x11, 0x4d, 0x9b, 0x74], [0xec, 0x80]) : []
  const tracks = el([0x16, 0x54, 0xae, 0x6b], [0xae, 0x83, 0xd7, 0x81, 0x01])
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00]
  const body = [...seekHead, ...info, ...tracks, ...cluster]
  const segmentSize = opts.knownSegment ? [0x80 | body.length] : [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
  return new Uint8Array([...ebml, 0x18, 0x53, 0x80, 0x67, ...segmentSize, ...body])
}

describe('WebM 길이 적어 넣기', () => {
  it('길이가 없는 머리말에 끼워 넣는다', () => {
    const head = fakeWebmHead()
    expect(readWebmDuration(head)).toBeNull()
    const patched = patchWebmHead(head, 12_345)
    expect(patched).not.toBeNull()
    expect(patched!.length).toBe(head.length + 11)
    expect(readWebmDuration(patched!)).toBeCloseTo(12_345, 6)
    // 뒤따르는 Tracks·Cluster 는 그대로 11바이트 뒤로 밀린다
    const tail = Array.from(head.subarray(head.length - 15))
    expect(Array.from(patched!.subarray(patched!.length - 15))).toEqual(tail)
    // 원본은 건드리지 않는다
    expect(readWebmDuration(head)).toBeNull()
  })

  it('이미 자리가 있으면 값만 바꾼다', () => {
    const head = fakeWebmHead({ withDuration: true })
    expect(readWebmDuration(head)).toBe(0)
    const patched = patchWebmHead(head, 2_500)
    expect(patched!.length).toBe(head.length)
    expect(readWebmDuration(patched!)).toBeCloseTo(2_500, 6)
  })

  it('위치가 밀리면 안 되는 파일은 건드리지 않는다', () => {
    expect(patchWebmHead(fakeWebmHead({ seekHead: true }), 1000)).toBeNull()
    expect(patchWebmHead(fakeWebmHead({ knownSegment: true }), 1000)).toBeNull()
    // 자리가 이미 있으면 찾아보기 표가 있어도 안전하다
    expect(patchWebmHead(fakeWebmHead({ seekHead: true, withDuration: true }), 1000)).not.toBeNull()
  })

  it('WebM 이 아니면 null', () => {
    expect(patchWebmHead(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 1000)).toBeNull()
    expect(patchWebmHead(new Uint8Array(0), 1000)).toBeNull()
  })
})
