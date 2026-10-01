import { describe, expect, it } from 'vitest'
import { h264Candidates } from './capabilities'
import { DelayRounder, GifWriter, inspectGif } from './gifCore'
import { computeLayout } from './layout'
import { clampRange, formatDuration, formatTime, frameTimes, outputName, parseTime } from './time'
import { clampGifLongSide, DEFAULT_OUTPUT, effectiveSize, resolveBitrate } from './types'
import { extractImageChunks, inspectWebp, muxAnimatedWebp } from './webpMux'

describe('computeLayout', () => {
  it('원본 비율은 긴 변만 줄인다', () => {
    const l = computeLayout(1920, 1080, { aspect: 'source', fit: 'pad', longSide: 480 })
    expect([l.width, l.height]).toEqual([480, 270])
    expect([l.dx, l.dy, l.dw, l.dh]).toEqual([0, 0, 480, 270])
    expect([l.sx, l.sy, l.sw, l.sh]).toEqual([0, 0, 1920, 1080])
  })

  it('원본보다 키우지 않는다', () => {
    const l = computeLayout(320, 240, { aspect: 'source', fit: 'pad', longSide: 960 })
    expect([l.width, l.height]).toEqual([320, 240])
  })

  it('여백 추가: 가로 영상을 1:1 틀에 넣으면 위아래 여백이 생긴다', () => {
    const l = computeLayout(1920, 1080, { aspect: '1:1', fit: 'pad', longSide: 480 })
    expect([l.width, l.height]).toEqual([480, 480])
    expect(l.dw).toBeCloseTo(480)
    expect(l.dh).toBeCloseTo(270)
    expect(l.dx).toBeCloseTo(0)
    expect(l.dy).toBeCloseTo(105)
    expect(l.sw).toBe(1920)
  })

  it('꽉 채우기: 가로 영상을 9:16 으로 자르면 가운데만 쓴다', () => {
    const l = computeLayout(1920, 1080, { aspect: '9:16', fit: 'cover', longSide: 960 })
    expect([l.width, l.height]).toEqual([540, 960])
    expect(l.sh).toBeCloseTo(1080)
    expect(l.sw).toBeCloseTo(607.5)
    expect(l.sx).toBeCloseTo((1920 - 607.5) / 2)
    expect([l.dx, l.dy, l.dw, l.dh]).toEqual([0, 0, 540, 960])
  })

  it('세로 영상을 16:9 틀에 여백으로 넣는다', () => {
    const l = computeLayout(1080, 1920, { aspect: '16:9', fit: 'pad', longSide: 1280 })
    expect([l.width, l.height]).toEqual([1280, 720])
    expect(l.dh).toBeCloseTo(720)
    expect(l.dw).toBeCloseTo(405)
    expect(l.dx).toBeCloseTo(437.5)
  })

  it('영상용은 짝수 크기로 맞춘다', () => {
    const l = computeLayout(1279, 719, { aspect: 'source', fit: 'pad', longSide: 853, even: true })
    expect(l.width % 2).toBe(0)
    expect(l.height % 2).toBe(0)
    expect(l.dw).toBe(l.width)
    // 비율이 조금 달라진 만큼만 원본을 잘라 쓴다(찌그러뜨리지 않는다).
    expect(l.sw / l.sh).toBeCloseTo(l.width / l.height, 6)
  })

  it('녹화 영역(crop) 안에서만 읽는다', () => {
    const l = computeLayout(1920, 1080, { aspect: 'source', fit: 'pad', longSide: Infinity, crop: { x: 100, y: 50, w: 800, h: 600 } })
    expect([l.width, l.height]).toEqual([800, 600])
    expect([l.sx, l.sy, l.sw, l.sh]).toEqual([100, 50, 800, 600])
  })

  it('긴 변 0·Infinity 는 원본 크기', () => {
    expect(computeLayout(3840, 2160, { aspect: 'source', fit: 'pad', longSide: Infinity }).width).toBe(3840)
    expect(computeLayout(3840, 2160, { aspect: 'source', fit: 'pad', longSide: 0 }).width).toBe(3840)
  })
})

describe('time', () => {
  it('formatTime', () => {
    expect(formatTime(0)).toBe('0:00.0')
    expect(formatTime(83.44)).toBe('1:23.4')
    expect(formatTime(59.96)).toBe('1:00.0')
    expect(formatTime(3723.5)).toBe('1:02:03.5')
    expect(formatTime(125, false)).toBe('2:05')
    expect(formatTime(NaN)).toBe('0:00.0')
  })

  it('parseTime', () => {
    expect(parseTime('83.5')).toBe(83.5)
    expect(parseTime('1:23.5')).toBe(83.5)
    expect(parseTime('1:02:03')).toBe(3723)
    expect(parseTime(' 0:05 ')).toBe(5)
    expect(parseTime('1:23,5')).toBe(83.5)
    expect(parseTime('.5')).toBe(0.5)
    expect(parseTime('')).toBeNull()
    expect(parseTime('abc')).toBeNull()
    expect(parseTime('1:2:3:4')).toBeNull()
    expect(parseTime('1.5:20')).toBeNull()
    expect(parseTime('-3')).toBeNull()
  })

  it('formatTime 과 parseTime 은 서로 되돌린다', () => {
    for (const t of [0, 0.1, 9.9, 60, 61.5, 599.9, 3600, 3723.4]) expect(parseTime(formatTime(t))).toBeCloseTo(t, 5)
  })

  it('formatDuration', () => {
    expect(formatDuration(12)).toBe('12초')
    expect(formatDuration(2.54)).toBe('2.5초')
    expect(formatDuration(65)).toBe('1분 5초')
    expect(formatDuration(120)).toBe('2분')
    expect(formatDuration(119.7)).toBe('2분')
  })

  it('clampRange 는 순서를 바로잡고 길이 안으로 넣는다', () => {
    expect(clampRange(5, 2, 10)).toEqual({ start: 2, end: 5 })
    expect(clampRange(-1, 20, 10)).toEqual({ start: 0, end: 10 })
    expect(clampRange(3, 3, 10)).toEqual({ start: 3, end: 3.1 })
    expect(clampRange(10, 10, 10)).toEqual({ start: 9.9, end: 10 })
  })

  it('frameTimes 는 끝 시각을 넘지 않는다', () => {
    const t = frameTimes(2, 4, 10)
    expect(t).toHaveLength(20)
    expect(t[0]).toBe(2)
    expect(t[19]).toBeCloseTo(3.9)
    expect(frameTimes(0, 0.01, 10)).toHaveLength(1)
    expect(frameTimes(1, 2.5, 30)).toHaveLength(45)
  })

  it('outputName 은 원본 이름을 살린다', () => {
    expect(outputName('제품 소개.mp4', '구간 1', 'gif')).toBe('제품 소개_구간-1.gif')
    expect(outputName('a.b.mov', '', 'mp4')).toBe('a.b.mp4')
    expect(outputName('x.mp4', 'a/b:c', 'webp')).toBe('x_abc.webp')
  })
})

describe('출력 설정', () => {
  it('비트레이트: 화질 단계는 크기·프레임 수에 비례한다', () => {
    const medium = resolveBitrate({ videoBitrate: 'medium', videoMbps: 2 }, 1280, 720, 30)
    expect(medium).toBe(Math.round(1280 * 720 * 30 * 0.1))
    expect(resolveBitrate({ videoBitrate: 'high', videoMbps: 2 }, 1280, 720, 30)).toBeGreaterThan(medium)
    expect(resolveBitrate({ videoBitrate: 'low', videoMbps: 2 }, 1280, 720, 30)).toBeLessThan(medium)
  })

  it('비트레이트: 직접 입력은 0.1–50 Mbps 로 제한한다', () => {
    expect(resolveBitrate({ videoBitrate: 'custom', videoMbps: 3 }, 100, 100, 30)).toBe(3_000_000)
    expect(resolveBitrate({ videoBitrate: 'custom', videoMbps: 0 }, 100, 100, 30)).toBe(100_000)
    expect(resolveBitrate({ videoBitrate: 'custom', videoMbps: 999 }, 100, 100, 30)).toBe(50_000_000)
    expect(resolveBitrate({ videoBitrate: 'custom', videoMbps: NaN }, 100, 100, 30)).toBe(2_000_000)
  })

  it('GIF 긴 변은 320–960', () => {
    expect(clampGifLongSide(100)).toBe(320)
    expect(clampGifLongSide(2000)).toBe(960)
    expect(clampGifLongSide(640)).toBe(640)
  })

  it('형식별 크기·프레임 수', () => {
    expect(effectiveSize({ ...DEFAULT_OUTPUT, format: 'gif', gifLongSide: 640, gifFps: 15 })).toEqual({ longSide: 640, fps: 15 })
    expect(effectiveSize({ ...DEFAULT_OUTPUT, format: 'mp4', videoLongSide: 0, videoFps: 30 })).toEqual({ longSide: Infinity, fps: 30 })
  })

  it('H.264 레벨은 화소 수에 맞춘다', () => {
    expect(h264Candidates(1280, 720)[0]).toBe('avc1.64001f')
    expect(h264Candidates(1920, 1080)[0]).toBe('avc1.640028')
    expect(h264Candidates(3840, 2160)[0]).toBe('avc1.640033')
    expect(h264Candidates(640, 360)).toHaveLength(3)
  })
})

function solidFrame(w: number, h: number, r: number, g: number, b: number): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r
    out[i + 1] = g
    out[i + 2] = b
    out[i + 3] = 255
  }
  return out
}

describe('GIF', () => {
  it('지연 시간 반올림 오차가 쌓이지 않는다', () => {
    const r = new DelayRounder()
    let sum = 0
    for (let i = 0; i < 150; i++) sum += r.next(1000 / 15)
    expect(sum).toBe(10_000)
    const r2 = new DelayRounder()
    expect(r2.next(50)).toBe(50)
    expect(r2.next(5)).toBe(20) // 20ms 미만은 브라우저가 느리게 재생하므로 올린다
  })

  it.each(['high', 'medium', 'low'] as const)('프레임 수·크기·재생 시간이 맞다 (%s)', (quality) => {
    const w = 32
    const h = 20
    const writer = new GifWriter({ width: w, height: h, quality })
    writer.addFrame(solidFrame(w, h, 200, 30, 30), 100)
    // 일부만 바뀐 프레임
    const second = solidFrame(w, h, 200, 30, 30)
    for (let i = 0; i < 40; i += 4) {
      second[i] = 10
      second[i + 1] = 220
      second[i + 2] = 90
    }
    writer.addFrame(second, 100)
    // 하나도 바뀌지 않은 프레임
    writer.addFrame(second.slice(), 100)
    writer.addFrame(solidFrame(w, h, 20, 20, 240), 200)
    const bytes = writer.finish()
    const info = inspectGif(bytes)
    expect(info).toEqual({ width: w, height: h, frames: 4, durationMs: 500 })
    expect(bytes[bytes.length - 1]).toBe(0x3b)
  })

  it('크기가 다른 프레임은 거부한다', () => {
    const writer = new GifWriter({ width: 4, height: 4, quality: 'medium' })
    expect(() => writer.addFrame(new Uint8Array(10), 100)).toThrow()
  })
})

function fakeWebp(payload: number[], withAlpha = false): Uint8Array {
  const chunk = (tag: string, data: number[]) => {
    const pad = data.length & 1
    const out = new Uint8Array(8 + data.length + pad)
    for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(i)
    new DataView(out.buffer).setUint32(4, data.length, true)
    out.set(data, 8)
    return out
  }
  const parts = withAlpha ? [chunk('VP8X', new Array(10).fill(0)), chunk('ALPH', [1, 2, 3]), chunk('VP8 ', payload)] : [chunk('VP8 ', payload)]
  const body = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(12 + body)
  out.set([0x52, 0x49, 0x46, 0x46])
  new DataView(out.buffer).setUint32(4, 4 + body, true)
  out.set([0x57, 0x45, 0x42, 0x50], 8)
  let pos = 12
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

describe('움직이는 WebP 묶기', () => {
  it('그림 청크만 꺼낸다', () => {
    const { chunks, hasAlpha } = extractImageChunks(fakeWebp([9, 8, 7], true))
    expect(hasAlpha).toBe(true)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].length).toBe(12) // ALPH 3바이트 + 채움 1
    expect(chunks[1].length).toBe(12)
  })

  it('프레임 수·크기·재생 시간을 적는다', () => {
    const bytes = muxAnimatedWebp(
      [
        { data: fakeWebp([1, 2, 3, 4]), durationMs: 100 },
        { data: fakeWebp([5, 6, 7]), durationMs: 67 },
        { data: fakeWebp([8, 9], true), durationMs: 133 },
      ],
      640,
      360,
    )
    expect(inspectWebp(bytes)).toEqual({ width: 640, height: 360, frames: 3, durationMs: 300 })
    // RIFF 크기 = 전체 − 8, 전체는 짝수
    expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(bytes.length - 8)
    expect(bytes.length % 2).toBe(0)
    // 알파가 있는 프레임이 하나라도 있으면 표시한다 + 애니메이션 표시
    expect(bytes[20] & 0x12).toBe(0x12)
  })

  it('WebP 가 아닌 프레임은 거부한다', () => {
    expect(() => muxAnimatedWebp([{ data: new Uint8Array(40), durationMs: 100 }], 10, 10)).toThrow()
    expect(() => muxAnimatedWebp([], 10, 10)).toThrow()
  })
})
