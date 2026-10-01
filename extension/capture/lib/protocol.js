/**
 * 확장 프로그램 → 온비짱 사이트로 이미지를 넘기는 약속.
 * 확장은 온비짱 탭에 스크립트를 넣어 window.postMessage 로 아래 메시지를 차례로 보낸다.
 *   begin  { type, v, id, files:[{name,mime,size,chunks}], meta }
 *   chunk  { type, id, file, index, data(base64) }   … 파일마다 chunks 개
 *   end    { type, id }
 * 사이트는 다 받으면 ack { type, id, ok, reason? } 로 답한다.
 * 사이트(src/tools/capture/handover.ts)도 이 파일의 상수를 가져다 쓴다.
 */
export const HANDOVER = Object.freeze({
  VERSION: 1,
  BEGIN: 'onbijjang-capture:begin',
  CHUNK: 'onbijjang-capture:chunk',
  END: 'onbijjang-capture:end',
  ACK: 'onbijjang-capture:ack',
  /** 사이트가 받을 준비가 되면 <html data-onbijjang-capture="ready"> 를 단다. */
  READY_ATTR: 'data-onbijjang-capture',
  READY_VALUE: 'ready',
  /** 한 번에 보내는 원본 바이트 수. 3의 배수라 조각마다 따로 base64 로 풀 수 있다. */
  CHUNK_BYTES: 384 * 1024,
  MAX_FILES: 12,
  MAX_FILE_BYTES: 200 * 1024 * 1024,
  MIMES: Object.freeze(['image/png', 'image/jpeg']),
  /** 사이트에서 캡처 도구가 있는 경로 */
  TOOL_PATH: '/tools/capture',
})

export function chunkCount(size, chunkBytes = HANDOVER.CHUNK_BYTES) {
  return Math.max(1, Math.ceil(size / chunkBytes))
}

/** index 번째 조각의 [시작, 끝) 바이트 위치 */
export function chunkRange(index, size, chunkBytes = HANDOVER.CHUNK_BYTES) {
  const start = index * chunkBytes
  return [Math.min(start, size), Math.min(start + chunkBytes, size)]
}

export function bytesToBase64(bytes) {
  let binary = ''
  const STEP = 0x8000
  for (let i = 0; i < bytes.length; i += STEP) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP))
  return btoa(binary)
}

export function base64ToBytes(b64) {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** captureVisibleTab 이 주는 data URL 을 네트워크 요청 없이 Blob 으로 바꾼다. */
export function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+)(;base64)?,/.exec(dataUrl)
  if (!m || !m[2]) throw new Error('캡처 데이터를 읽지 못했습니다.')
  return new Blob([base64ToBytes(dataUrl.slice(m[0].length))], { type: m[1] })
}
