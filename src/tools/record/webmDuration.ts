/**
 * MediaRecorder 가 만든 WebM 에는 길이(Duration)가 적혀 있지 않아
 * 재생기에서 전체 시간이 보이지 않고 이동도 잘 안 된다. 머리말에 길이를 적어 넣는다.
 */

const ID_EBML = 0x1a45dfa3
const ID_SEGMENT = 0x18538067
const ID_INFO = 0x1549a966
const ID_SEEK_HEAD = 0x114d9b74
const ID_CLUSTER = 0x1f43b675
const ID_TIMECODE_SCALE = 0x2ad7b1
const ID_DURATION = 0x4489

interface Element {
  id: number
  /** 크기 칸이 시작하는 위치 */
  sizePos: number
  sizeLen: number
  /** 내용 길이. 길이를 모르는 요소(실시간 기록)는 -1 */
  size: number
  dataPos: number
}

function vintLength(first: number): number {
  for (let i = 0; i < 8; i++) if (first & (0x80 >> i)) return i + 1
  return 0
}

function readElement(bytes: Uint8Array, pos: number): Element | null {
  if (pos >= bytes.length) return null
  const idLen = vintLength(bytes[pos])
  if (!idLen || idLen > 4 || pos + idLen >= bytes.length) return null
  let id = 0
  for (let i = 0; i < idLen; i++) id = id * 256 + bytes[pos + i]
  const sizePos = pos + idLen
  const sizeLen = vintLength(bytes[sizePos])
  if (!sizeLen || sizePos + sizeLen > bytes.length) return null
  let size = bytes[sizePos] & (0xff >> sizeLen)
  let unknown = size === 0xff >> sizeLen
  for (let i = 1; i < sizeLen; i++) {
    size = size * 256 + bytes[sizePos + i]
    if (bytes[sizePos + i] !== 0xff) unknown = false
  }
  return { id, sizePos, sizeLen, size: unknown ? -1 : size, dataPos: sizePos + sizeLen }
}

function readUint(bytes: Uint8Array, pos: number, len: number): number {
  let v = 0
  for (let i = 0; i < len; i++) v = v * 256 + bytes[pos + i]
  return v
}

function durationElement(ticks: number): Uint8Array {
  const out = new Uint8Array(11)
  out[0] = 0x44
  out[1] = 0x89
  out[2] = 0x88 // 길이 8
  new DataView(out.buffer).setFloat64(3, ticks)
  return out
}

/**
 * 파일 앞부분(head)에 길이를 적어 넣은 새 앞부분을 돌려준다.
 * 구조가 예상과 다르면(찾아보기 표가 있어 위치가 밀리면 안 되는 파일 등) null — 원본을 그대로 쓴다.
 */
export function patchWebmHead(head: Uint8Array, durationMs: number): Uint8Array<ArrayBuffer> | null {
  const ebml = readElement(head, 0)
  if (!ebml || ebml.id !== ID_EBML || ebml.size < 0) return null
  const segment = readElement(head, ebml.dataPos + ebml.size)
  if (!segment || segment.id !== ID_SEGMENT) return null

  let pos = segment.dataPos
  let hasSeekHead = false
  let info: Element | null = null
  while (pos < head.length) {
    const el = readElement(head, pos)
    if (!el || el.id === ID_CLUSTER) break
    if (el.id === ID_SEEK_HEAD) hasSeekHead = true
    if (el.id === ID_INFO) {
      info = el
      break
    }
    if (el.size < 0) break
    pos = el.dataPos + el.size
  }
  if (!info || info.size < 0 || info.dataPos + info.size > head.length) return null

  let scale = 1_000_000
  let existing: Element | null = null
  pos = info.dataPos
  const infoEnd = info.dataPos + info.size
  while (pos < infoEnd) {
    const el = readElement(head, pos)
    if (!el || el.size < 0) return null
    if (el.id === ID_TIMECODE_SCALE) scale = readUint(head, el.dataPos, el.size) || scale
    if (el.id === ID_DURATION) existing = el
    pos = el.dataPos + el.size
  }
  const ticks = (durationMs * 1_000_000) / scale

  if (existing) {
    // 이미 자리가 있으면 값만 바꾼다(위치가 밀리지 않는다).
    const out = new Uint8Array(head)
    const view = new DataView(out.buffer)
    if (existing.size === 8) view.setFloat64(existing.dataPos, ticks)
    else if (existing.size === 4) view.setFloat32(existing.dataPos, ticks)
    else return null
    return out
  }

  // 새로 끼워 넣으면 뒤가 11바이트 밀린다. 위치를 적어 둔 표가 있거나 전체 길이가 정해진 파일은 건드리지 않는다.
  if (hasSeekHead || segment.size >= 0) return null
  const newSize = info.size + 11
  if (newSize >= 2 ** (7 * info.sizeLen) - 1) return null
  const out = new Uint8Array(head.length + 11)
  out.set(head.subarray(0, infoEnd), 0)
  // Info 크기 칸을 같은 자릿수로 다시 쓴다.
  let v = newSize
  for (let i = info.sizeLen - 1; i >= 0; i--) {
    out[info.sizePos + i] = v & 0xff
    v = Math.floor(v / 256)
  }
  out[info.sizePos] |= 0x80 >> (info.sizeLen - 1)
  out.set(durationElement(ticks), infoEnd)
  out.set(head.subarray(infoEnd), infoEnd + 11)
  return out
}

const HEAD_BYTES = 4096

/** 녹화한 WebM 에 길이를 적어 넣는다. 고칠 수 없는 구조면 원본을 그대로 돌려준다. */
export async function fixWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  try {
    const headLength = Math.min(HEAD_BYTES, blob.size)
    const head = new Uint8Array(await blob.slice(0, headLength).arrayBuffer())
    const patched = patchWebmHead(head, durationMs)
    if (!patched) return blob
    return new Blob([patched, blob.slice(headLength)], { type: blob.type })
  } catch {
    return blob
  }
}

/** 머리말에 적힌 길이(ms). 없으면 null. (확인·테스트용) */
export function readWebmDuration(head: Uint8Array): number | null {
  const ebml = readElement(head, 0)
  if (!ebml || ebml.id !== ID_EBML || ebml.size < 0) return null
  const segment = readElement(head, ebml.dataPos + ebml.size)
  if (!segment || segment.id !== ID_SEGMENT) return null
  let pos = segment.dataPos
  while (pos < head.length) {
    const el = readElement(head, pos)
    if (!el || el.id === ID_CLUSTER || el.size < 0) return null
    if (el.id === ID_INFO) {
      let scale = 1_000_000
      let ticks: number | null = null
      let p = el.dataPos
      const end = Math.min(head.length, el.dataPos + el.size)
      while (p < end) {
        const c = readElement(head, p)
        if (!c || c.size < 0) break
        if (c.id === ID_TIMECODE_SCALE) scale = readUint(head, c.dataPos, c.size) || scale
        if (c.id === ID_DURATION) {
          const view = new DataView(head.buffer, head.byteOffset + c.dataPos, c.size)
          ticks = c.size === 8 ? view.getFloat64(0) : c.size === 4 ? view.getFloat32(0) : null
        }
        p = c.dataPos + c.size
      }
      return ticks == null ? null : (ticks * scale) / 1_000_000
    }
    pos = el.dataPos + el.size
  }
  return null
}
