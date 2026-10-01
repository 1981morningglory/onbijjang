export declare const HANDOVER: Readonly<{
  VERSION: number
  BEGIN: 'onbijjang-capture:begin'
  CHUNK: 'onbijjang-capture:chunk'
  END: 'onbijjang-capture:end'
  ACK: 'onbijjang-capture:ack'
  READY_ATTR: 'data-onbijjang-capture'
  READY_VALUE: 'ready'
  CHUNK_BYTES: number
  MAX_FILES: number
  MAX_FILE_BYTES: number
  MIMES: readonly string[]
  TOOL_PATH: string
}>
export declare function chunkCount(size: number, chunkBytes?: number): number
export declare function chunkRange(index: number, size: number, chunkBytes?: number): [number, number]
export declare function bytesToBase64(bytes: Uint8Array): string
export declare function base64ToBytes(b64: string): Uint8Array<ArrayBuffer>
export declare function dataUrlToBlob(dataUrl: string): Blob
