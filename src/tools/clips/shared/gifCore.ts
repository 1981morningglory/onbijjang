// gifenc 는 타입 선언이 없다. 쓰는 함수만 여기서 타입을 붙인다.
// @ts-ignore -- 타입 선언 없는 패키지
import * as gifencModule from 'gifenc'
import type { QualityLevel } from './types'

type Palette = number[][]
type PixelFormat = 'rgb565' | 'rgb444'
interface GifStream {
  writeFrame(
    index: Uint8Array,
    width: number,
    height: number,
    opts: { palette?: Palette; delay?: number; transparent?: boolean; transparentIndex?: number; dispose?: number; repeat?: number },
  ): void
  finish(): void
  bytes(): Uint8Array
}
interface GifencApi {
  GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GifStream
  quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: PixelFormat }): Palette
  applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: PixelFormat): Uint8Array
}

// 번들러에 따라 named export 가 default 아래에 들어오는 경우가 있어 둘 다 본다.
const raw = gifencModule as unknown as Partial<GifencApi> & { default?: Partial<GifencApi> }
const api = (typeof raw.GIFEncoder === 'function' ? raw : raw.default) as GifencApi

export interface GifWriterOptions {
  width: number
  height: number
  quality: QualityLevel
}

const PRESET: Record<QualityLevel, { colors: number; format: PixelFormat; threshold: number }> = {
  high: { colors: 256, format: 'rgb565', threshold: 0 },
  medium: { colors: 128, format: 'rgb565', threshold: 6 },
  low: { colors: 64, format: 'rgb444', threshold: 14 },
}

/**
 * GIF 는 지연 시간을 1/100초 단위로만 적는다(15fps = 66.7ms → 60 또는 70ms).
 * 반올림 오차가 쌓이지 않도록 지금까지의 합을 기준으로 다음 값을 정한다.
 */
export class DelayRounder {
  private idealMs = 0
  private writtenCs = 0
  next(delayMs: number): number {
    this.idealMs += Math.max(0, delayMs)
    const cs = Math.max(2, Math.round(this.idealMs / 10) - this.writtenCs)
    this.writtenCs += cs
    return cs * 10
  }
}

/**
 * RGBA 프레임을 받아 GIF 를 만든다. DOM 을 쓰지 않아 워커와 테스트에서 그대로 돈다.
 * 프레임마다 팔레트를 새로 뽑고, 앞 프레임과 같은 화소는 투명으로 남겨 용량을 줄인다.
 */
export class GifWriter {
  private readonly gif: GifStream
  private readonly preset: (typeof PRESET)[QualityLevel]
  private readonly pixels: number
  private shown: Uint8Array | null = null
  private readonly delays = new DelayRounder()
  frames = 0

  constructor(private readonly opts: GifWriterOptions) {
    this.gif = api.GIFEncoder({ initialCapacity: 1024 * 1024 })
    this.preset = PRESET[opts.quality]
    this.pixels = opts.width * opts.height
  }

  addFrame(rgba: Uint8Array | Uint8ClampedArray, delayMs: number) {
    const { width, height } = this.opts
    if (rgba.length !== this.pixels * 4) throw new Error('프레임 크기가 맞지 않습니다.')
    const { colors, format, threshold } = this.preset
    const delay = this.delays.next(delayMs)

    if (!this.shown) {
      const palette = api.quantize(rgba, colors, { format })
      const index = api.applyPalette(rgba, palette, format)
      this.gif.writeFrame(index, width, height, { palette, delay, repeat: 0, dispose: 1 })
      this.shown = new Uint8Array(rgba)
      this.frames++
      return
    }

    // 화면에 이미 보이는 색과 다른 화소만 모은다.
    const shown = this.shown
    const positions = new Uint32Array(this.pixels)
    let changed = 0
    for (let p = 0, i = 0; p < this.pixels; p++, i += 4) {
      const diff = Math.abs(rgba[i] - shown[i]) + Math.abs(rgba[i + 1] - shown[i + 1]) + Math.abs(rgba[i + 2] - shown[i + 2])
      if (diff > threshold) positions[changed++] = p
    }

    const transparentIndex = colors - 1
    const index = new Uint8Array(this.pixels).fill(transparentIndex)
    let palette: Palette = [[0, 0, 0]]
    if (changed > 0) {
      const part = new Uint8Array(changed * 4)
      for (let k = 0; k < changed; k++) {
        const i = positions[k] * 4
        const o = k * 4
        part[o] = rgba[i]
        part[o + 1] = rgba[i + 1]
        part[o + 2] = rgba[i + 2]
        part[o + 3] = 255
        shown[i] = rgba[i]
        shown[i + 1] = rgba[i + 1]
        shown[i + 2] = rgba[i + 2]
      }
      palette = api.quantize(part, colors - 1, { format })
      const partIndex = api.applyPalette(part, palette, format)
      for (let k = 0; k < changed; k++) index[positions[k]] = partIndex[k]
    }
    // 투명 색 자리를 팔레트 마지막에 둔다.
    const full: Palette = palette.slice()
    while (full.length < colors) full.push([0, 0, 0])
    this.gif.writeFrame(index, width, height, { palette: full, delay, transparent: true, transparentIndex, dispose: 1 })
    this.frames++
  }

  finish(): Uint8Array {
    this.gif.finish()
    return this.gif.bytes()
  }
}

/** GIF 머리말에서 크기와 프레임 수·총 재생 시간을 읽는다(확인·테스트용). */
export function inspectGif(bytes: Uint8Array): { width: number; height: number; frames: number; durationMs: number } {
  const sig = String.fromCharCode(...bytes.subarray(0, 6))
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('GIF 파일이 아닙니다.')
  const width = bytes[6] | (bytes[7] << 8)
  const height = bytes[8] | (bytes[9] << 8)
  let pos = 13
  if (bytes[10] & 0x80) pos += 3 * (1 << ((bytes[10] & 7) + 1))
  let frames = 0
  let durationMs = 0
  const skipBlocks = () => {
    while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1
    pos++
  }
  while (pos < bytes.length) {
    const b = bytes[pos++]
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = bytes[pos++]
      if (label === 0xf9) durationMs += (bytes[pos + 2] | (bytes[pos + 3] << 8)) * 10
      skipBlocks()
    } else if (b === 0x2c) {
      const packed = bytes[pos + 8]
      pos += 9
      if (packed & 0x80) pos += 3 * (1 << ((packed & 7) + 1))
      pos++ // LZW 최소 코드 크기
      skipBlocks()
      frames++
    } else {
      throw new Error('GIF 구조를 읽지 못했습니다.')
    }
  }
  return { width, height, frames, durationMs }
}
