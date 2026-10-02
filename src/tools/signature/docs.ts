/** 문서 열기 — 사진·PDF·Word 를 같은 모양(DocSource)으로 다룬다 */
import { extOf, stripExt } from '@/lib/files'
import { ctx2d, fileToCanvas, isCanvasSizeSafe, makeCanvas, resizeCanvas } from '@/lib/image'
import { fmt } from '@/lib/hooks'
import { loadPdfJs, pdfDocumentOptions } from './pdfjs'
import { MAX_FILE_BYTES, MAX_PAGES, type DocKind, type DocSource, type PageInfo } from './types'

/** 사용자가 암호 입력을 그만둔 경우 */
export class OpenCancelled extends Error {
  constructor() {
    super('열기를 취소했습니다.')
  }
}

export function detectKind(file: File): DocKind | 'doc' | null {
  const ext = extOf(file.name)
  if (file.type === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (ext === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (ext === 'doc' || file.type === 'application/msword') return 'doc'
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(ext)) return 'image'
  return null
}

export interface OpenOptions {
  /** PDF 암호를 묻는다. wrong 이면 앞서 넣은 암호가 틀렸다는 뜻. null 을 돌려주면 취소. */
  askPassword: (wrong: boolean) => Promise<string | null>
  signal?: AbortSignal
}

export async function openDocument(file: File, options: OpenOptions): Promise<DocSource> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`파일이 너무 큽니다. ${MAX_FILE_BYTES / 1024 / 1024}MB 이하 파일을 올려 주세요.`)
  const kind = detectKind(file)
  if (kind === 'pdf') return openPdf(file, options)
  if (kind === 'image') return openImage(file)
  if (kind === 'docx') return (await import('./docx')).openDocx(file, options.signal)
  if (kind === 'doc') throw new Error('예전 Word 형식(.doc)은 열 수 없습니다. Word 에서 .docx 나 PDF 로 저장한 뒤 올려 주세요.')
  throw new Error('사진(PNG·JPG·WebP), PDF, Word(.docx) 파일만 열 수 있습니다.')
}

async function openImage(file: File): Promise<DocSource> {
  const base = await fileToCanvas(file)
  if (!isCanvasSizeSafe(base.width, base.height)) {
    throw new Error(`사진이 너무 큽니다(${fmt.format(base.width)}×${fmt.format(base.height)}px). 이미지 도구에서 크기를 줄인 뒤 올려 주세요.`)
  }
  const pages: PageInfo[] = [{ width: base.width, height: base.height }]
  return {
    kind: 'image',
    file,
    baseName: stripExt(file.name),
    pages,
    unitPx: 1,
    notes: [],
    async render(_page, pxPerUnit) {
      const k = Math.min(1, pxPerUnit)
      const w = Math.max(1, Math.round(base.width * k))
      const h = Math.max(1, Math.round(base.height * k))
      if (k < 1) return resizeCanvas(base, w, h)
      const copy = makeCanvas(w, h)
      ctx2d(copy).drawImage(base, 0, 0)
      return copy
    },
    destroy() {
      base.width = 1
      base.height = 1
    },
  }
}

async function openPdf(file: File, options: OpenOptions): Promise<DocSource> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({ ...(await pdfDocumentOptions()), data: bytes.slice() })

  let rejectCancel: (err: Error) => void = () => {}
  const cancelled = new Promise<never>((_, reject) => (rejectCancel = reject))
  cancelled.catch(() => {})
  let usedPassword = false
  task.onPassword = (update: (password: string) => void, reason: number) => {
    usedPassword = true
    options.askPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD).then((password) => {
      if (password == null) {
        rejectCancel(new OpenCancelled())
        void task.destroy().catch(() => {})
      } else update(password)
    })
  }
  const onAbort = () => {
    rejectCancel(new OpenCancelled())
    void task.destroy().catch(() => {})
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  let pdf: Awaited<typeof task.promise>
  try {
    pdf = await Promise.race([task.promise, cancelled])
  } catch (err) {
    if (err instanceof OpenCancelled) throw err
    const name = (err as { name?: string })?.name
    if (name === 'InvalidPDFException') throw new Error('PDF 를 열 수 없습니다. 파일이 손상되었거나 PDF 가 아닙니다.')
    if (name === 'PasswordException') throw new Error('암호가 맞지 않아 PDF 를 열 수 없습니다.')
    throw new Error('PDF 를 열지 못했습니다. 다른 프로그램에서 열리는지 확인해 주세요.')
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
  }

  if (pdf.numPages > MAX_PAGES) {
    const count = pdf.numPages
    void task.destroy().catch(() => {})
    throw new Error(`문서는 ${MAX_PAGES}쪽까지 열 수 있습니다(이 문서는 ${count}쪽). PDF 도구에서 서명할 쪽만 나눈 뒤 올려 주세요.`)
  }

  const pages: PageInfo[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    pages.push({
      width: viewport.width,
      height: viewport.height,
      pdf: { view: page.view as [number, number, number, number], rotate: page.rotate, userUnit: page.userUnit || 1 },
    })
  }

  const restricted = usedPassword || hasEncryptMarker(bytes)

  return {
    kind: 'pdf',
    file,
    baseName: stripExt(file.name),
    pages,
    unitPx: 96 / 72,
    bytes,
    rasterOnly: restricted,
    notes: restricted ? [`${usedPassword ? '암호가' : '편집 제한이'} 걸린 PDF 입니다. 원본을 그대로 고칠 수 없어, PDF 로 저장하면 쪽을 이미지로 바꾼 새 PDF 가 됩니다(글자 선택 불가, 암호·제한 없음).`] : [],
    async render(index, pxPerUnit, signal, forExport) {
      const page = await pdf.getPage(index + 1)
      const viewport = page.getViewport({ scale: pxPerUnit })
      const canvas = makeCanvas(viewport.width, viewport.height)
      const renderTask = page.render({ canvas, viewport, intent: forExport ? 'print' : 'display' })
      const cancel = () => renderTask.cancel()
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        await renderTask.promise
      } finally {
        signal?.removeEventListener('abort', cancel)
      }
      return canvas
    },
    destroy() {
      void task.destroy().catch(() => {})
    },
  }
}

/** 파일 앞뒤의 trailer 에 암호화 표시(/Encrypt)가 있는지. 암호 없이 열리는 '편집 제한' PDF 를 미리 알아낸다. */
export function hasEncryptMarker(bytes: Uint8Array): boolean {
  const decode = (part: Uint8Array) => new TextDecoder('latin1').decode(part)
  const span = 16 * 1024
  if (bytes.length <= span * 2) return decode(bytes).includes('/Encrypt')
  return decode(bytes.subarray(bytes.length - span)).includes('/Encrypt') || decode(bytes.subarray(0, span)).includes('/Encrypt')
}

/** 렌더가 취소되어 난 오류인지 */
export function isCancelError(err: unknown): boolean {
  const name = (err as { name?: string })?.name
  return name === 'RenderingCancelledException' || name === 'AbortError' || err instanceof OpenCancelled
}
