/** 낱장 WebP 여러 개를 움직이는 WebP 하나로 묶는다(RIFF 컨테이너만 다루고 화소는 건드리지 않는다). */

export interface WebpFrame {
  /** canvas.toBlob('image/webp') 로 만든 낱장 파일 전체 */
  data: Uint8Array
  durationMs: number
}

function fourCC(bytes: Uint8Array, pos: number): string {
  return String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3])
}

function u32(bytes: Uint8Array, pos: number): number {
  return (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)) >>> 0
}

/** 낱장 WebP 에서 그림 데이터 청크(ALPH, VP8, VP8L)만 머리말째 꺼낸다. */
export function extractImageChunks(file: Uint8Array): { chunks: Uint8Array[]; hasAlpha: boolean } {
  if (file.length < 20 || fourCC(file, 0) !== 'RIFF' || fourCC(file, 8) !== 'WEBP') throw new Error('WebP 프레임을 읽지 못했습니다.')
  const chunks: Uint8Array[] = []
  let hasAlpha = false
  let pos = 12
  while (pos + 8 <= file.length) {
    const id = fourCC(file, pos)
    const size = u32(file, pos + 4)
    const end = Math.min(file.length, pos + 8 + size + (size & 1))
    if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') {
      if (id === 'ALPH') hasAlpha = true
      let chunk = file.subarray(pos, end)
      // 홀수 길이인데 채움 바이트가 잘려 있으면 붙여 준다.
      if ((size & 1) === 1 && chunk.length === 8 + size) {
        const padded = new Uint8Array(chunk.length + 1)
        padded.set(chunk)
        chunk = padded
      }
      chunks.push(chunk)
    }
    pos = end
  }
  if (!chunks.some((c) => fourCC(c, 0) !== 'ALPH')) throw new Error('WebP 프레임에 그림 데이터가 없습니다.')
  return { chunks, hasAlpha }
}

function put24(out: Uint8Array, pos: number, v: number) {
  out[pos] = v & 255
  out[pos + 1] = (v >> 8) & 255
  out[pos + 2] = (v >> 16) & 255
}

function put32(out: Uint8Array, pos: number, v: number) {
  put24(out, pos, v)
  out[pos + 3] = (v >>> 24) & 255
}

function putTag(out: Uint8Array, pos: number, tag: string) {
  for (let i = 0; i < 4; i++) out[pos + i] = tag.charCodeAt(i)
}

export function muxAnimatedWebp(frames: WebpFrame[], width: number, height: number, loopCount = 0): Uint8Array<ArrayBuffer> {
  if (!frames.length) throw new Error('프레임이 없습니다.')
  if (width < 1 || height < 1 || width > 16384 || height > 16384) throw new Error('WebP 로 만들 수 없는 크기입니다.')
  const parts = frames.map((f) => ({ ...extractImageChunks(f.data), durationMs: f.durationMs }))
  const anyAlpha = parts.some((p) => p.hasAlpha)

  let total = 12 + 18 + 14
  for (const p of parts) total += 8 + 16 + p.chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let pos = 0

  putTag(out, 0, 'RIFF')
  put32(out, 4, total - 8)
  putTag(out, 8, 'WEBP')
  pos = 12

  putTag(out, pos, 'VP8X')
  put32(out, pos + 4, 10)
  out[pos + 8] = 0x02 | (anyAlpha ? 0x10 : 0)
  put24(out, pos + 12, width - 1)
  put24(out, pos + 15, height - 1)
  pos += 18

  putTag(out, pos, 'ANIM')
  put32(out, pos + 4, 6)
  // 배경색 4바이트는 0(투명), 반복 횟수 0 = 무한
  out[pos + 12] = loopCount & 255
  out[pos + 13] = (loopCount >> 8) & 255
  pos += 14

  for (const p of parts) {
    const dataLength = p.chunks.reduce((n, c) => n + c.length, 0)
    putTag(out, pos, 'ANMF')
    put32(out, pos + 4, 16 + dataLength)
    // 위치 X, Y 는 0
    put24(out, pos + 14, width - 1)
    put24(out, pos + 17, height - 1)
    put24(out, pos + 20, Math.min(0xffffff, Math.max(0, Math.round(p.durationMs))))
    out[pos + 23] = 0x02 // 겹쳐 그리지 않고 덮어쓴다
    pos += 24
    for (const c of p.chunks) {
      out.set(c, pos)
      pos += c.length
    }
  }
  return out
}

/** 움직이는 WebP 의 크기·프레임 수·총 재생 시간(확인·테스트용) */
export function inspectWebp(bytes: Uint8Array): { width: number; height: number; frames: number; durationMs: number } {
  if (fourCC(bytes, 0) !== 'RIFF' || fourCC(bytes, 8) !== 'WEBP') throw new Error('WebP 파일이 아닙니다.')
  let width = 0
  let height = 0
  let frames = 0
  let durationMs = 0
  let pos = 12
  while (pos + 8 <= bytes.length) {
    const id = fourCC(bytes, pos)
    const size = u32(bytes, pos + 4)
    if (id === 'VP8X') {
      width = (bytes[pos + 12] | (bytes[pos + 13] << 8) | (bytes[pos + 14] << 16)) + 1
      height = (bytes[pos + 15] | (bytes[pos + 16] << 8) | (bytes[pos + 17] << 16)) + 1
    } else if (id === 'ANMF') {
      frames++
      durationMs += bytes[pos + 20] | (bytes[pos + 21] << 8) | (bytes[pos + 22] << 16)
    }
    pos += 8 + size + (size & 1)
  }
  return { width, height, frames, durationMs }
}
