import JSZip from 'jszip'

export interface RenamedEntry {
  name: string
  file: File
}

/**
 * 새 이름으로 ZIP 을 만든다(압축 없이 묶기만 해서 빠르다). 파일의 수정일은 그대로 둔다.
 * signal 이 취소되면 만들기를 멈추고 AbortError 로 끝난다.
 */
export function zipRenamed(entries: RenamedEntry[], signal: AbortSignal, onProgress: (percent: number) => void): Promise<Blob> {
  const zip = new JSZip()
  for (const e of entries) zip.file(e.name, e.file, { date: new Date(e.file.lastModified || Date.now()) })
  return new Promise<Blob>((resolve, reject) => {
    const stream = zip.generateInternalStream({ type: 'blob', compression: 'STORE' })
    const onAbort = () => {
      stream.pause()
      reject(new DOMException('ZIP 만들기를 취소했습니다.', 'AbortError'))
    }
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    stream
      .accumulate((meta) => onProgress(meta.percent))
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}
