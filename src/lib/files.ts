import JSZip from 'jszip'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

/** Windows 에서 쓸 수 없는 문자를 제거한 파일명 */
export function sanitizeFilename(name: string, fallback = '파일'): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return cleaned || fallback
}

/** 같은 이름이 있으면 "이름 (2).ext" 식으로 겹치지 않게 만든다. used 에 결과가 추가된다. */
export function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase())
    return name
  }
  const base = stripExt(name)
  const ext = extOf(name)
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext ? `.${ext}` : ''}`
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase())
      return candidate
    }
  }
}

export function fileKind(file: File | { type: string; name: string }): 'image' | 'video' | 'pdf' | 'other' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type === 'application/pdf' || extOf(file.name) === 'pdf') return 'pdf'
  return 'other'
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export interface ZipEntry {
  name: string
  data: Blob | Uint8Array | ArrayBuffer | string
}

export async function makeZip(entries: ZipEntry[], onProgress?: (percent: number) => void): Promise<Blob> {
  const zip = new JSZip()
  const used = new Set<string>()
  for (const e of entries) zip.file(uniqueName(e.name, used), e.data)
  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => onProgress?.(m.percent))
}

export async function downloadZip(entries: ZipEntry[], zipName: string, onProgress?: (percent: number) => void) {
  downloadBlob(await makeZip(entries, onProgress), zipName.endsWith('.zip') ? zipName : `${zipName}.zip`)
}

export function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error('파일을 읽지 못했습니다.'))
    r.readAsDataURL(blob)
  })
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob()
}

/** Blob 을 다음 도구로 넘기거나 목록에 넣을 때 쓰는 File 변환 */
export function blobToFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type, lastModified: Date.now() })
}

/** 오늘 날짜 YYYYMMDD */
export function todayStamp(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** accept 문자열(image/*, .pdf …)에 맞는 파일만 남긴다. */
export function filterAccepted(files: File[], accept?: string): File[] {
  if (!accept) return files
  const rules = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return files.filter((f) => {
    const type = f.type.toLowerCase()
    const ext = `.${extOf(f.name)}`
    return rules.some((r) => (r.endsWith('/*') ? type.startsWith(r.slice(0, -1)) : r.startsWith('.') ? ext === r : type === r))
  })
}
