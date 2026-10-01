/** 파일 받기: PDF·사진을 작업대에 올린다. 한도 확인, 암호 묻기, 암호화 문서 풀기. */
import { extOf, formatBytes } from '@/lib/files'
import { loadBitmap } from '@/lib/image'
import { toast } from '@/ui'
import { decryptPdf } from './ops'
import { PasswordCancelled, openPdf } from './pdfjs'
import { addSource, askPassword, newId, useWorkspace } from './store'

export const LIMITS = {
  pdfBytes: 300 * 1024 * 1024,
  imageBytes: 50 * 1024 * 1024,
  images: 200,
  pages: 3000,
}

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'
export const OFFICE_BROWSER_EXT = ['docx', 'xlsx']
export const OFFICE_SERVER_EXT = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp', 'hwpx', 'odt', 'ods', 'odp']
export const MAIN_ACCEPT = `.pdf,application/pdf,${IMAGE_ACCEPT},${OFFICE_SERVER_EXT.map((e) => `.${e}`).join(',')}`

const isPdf = (f: File) => f.type === 'application/pdf' || extOf(f.name) === 'pdf'
const isImage = (f: File) => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || (!f.type && ['jpg', 'jpeg', 'png', 'webp'].includes(extOf(f.name)))
export const isOffice = (f: File) => OFFICE_SERVER_EXT.includes(extOf(f.name))

export interface AddOutcome {
  added: number
  /** 작업대가 받지 않는 문서 파일(Word·Excel 등) — 호출한 쪽이 'PDF 만들기'로 넘긴다 */
  office: File[]
}

/** 여러 파일을 순서대로 올린다. 문제 있는 파일은 건너뛰고 이유를 알려준다. */
export async function addFiles(files: File[]): Promise<AddOutcome> {
  const outcome: AddOutcome = { added: 0, office: [] }
  const problems: string[] = []
  useWorkspace.setState((s) => ({ opening: s.opening + 1 }))
  try {
    for (const file of files) {
      try {
        if (isPdf(file)) {
          await addPdf(file)
          outcome.added++
        } else if (isImage(file)) {
          await addImage(file)
          outcome.added++
        } else if (isOffice(file)) {
          outcome.office.push(file)
        } else {
          problems.push(`${file.name}: PDF·JPG·PNG·WebP 만 올릴 수 있습니다.`)
        }
      } catch (err) {
        if (err instanceof PasswordCancelled) problems.push(`${file.name}: 암호를 입력하지 않아 열지 않았습니다.`)
        else problems.push(`${file.name}: ${err instanceof Error ? err.message : '열지 못했습니다.'}`)
      }
    }
  } finally {
    useWorkspace.setState((s) => ({ opening: Math.max(0, s.opening - 1) }))
  }
  if (problems.length) toast.warn(problems.length === 1 ? problems[0] : `${problems[0]} 외 ${problems.length - 1}개 파일을 건너뛰었습니다.`)
  return outcome
}

async function addPdf(file: File) {
  if (file.size > LIMITS.pdfBytes) throw new Error(`너무 큽니다(${formatBytes(file.size)}). PDF 는 한 개 ${formatBytes(LIMITS.pdfBytes)} 까지 올릴 수 있습니다.`)
  if (file.size === 0) throw new Error('빈 파일입니다.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  // pdfjs 는 넘겨받은 배열을 가져가므로 복사본을 준다.
  const opened = await openPdf(bytes.slice(), (wrong) => askPassword(file.name, wrong))
  const { pdf } = opened
  const current = useWorkspace.getState().pages.length
  if (current + pdf.numPages > LIMITS.pages) {
    void pdf.loadingTask.destroy()
    throw new Error(`쪽 수가 너무 많습니다. 작업대에는 모두 ${LIMITS.pages}쪽까지 올릴 수 있습니다(지금 ${current}쪽 + 이 문서 ${pdf.numPages}쪽).`)
  }
  let editBytes: Uint8Array | null = null
  let editable = true
  if (opened.encrypted) {
    try {
      editBytes = await decryptPdf(bytes, opened.password ?? '')
    } catch {
      editable = false
    }
  }
  addSource({ id: newId('s'), kind: 'pdf', name: file.name, size: file.size, file, pdf, pageCount: pdf.numPages, encrypted: opened.encrypted, editBytes, editable }, pdf.numPages)
  if (opened.encrypted && !editable) {
    toast.info(`${file.name}: 보호 방식 때문에 원본 그대로는 복사할 수 없어, PDF 로 저장할 때 쪽을 그림으로 바꿔 넣습니다.`)
  }
}

async function addImage(file: File) {
  if (file.size > LIMITS.imageBytes) throw new Error(`너무 큽니다(${formatBytes(file.size)}). 사진은 한 장 ${formatBytes(LIMITS.imageBytes)} 까지 올릴 수 있습니다.`)
  const state = useWorkspace.getState()
  const imageCount = Object.values(state.sources).filter((s) => s.kind === 'image').length
  if (imageCount >= LIMITS.images) throw new Error(`사진은 ${LIMITS.images}장까지 올릴 수 있습니다.`)
  if (state.pages.length + 1 > LIMITS.pages) throw new Error(`작업대에는 모두 ${LIMITS.pages}쪽까지 올릴 수 있습니다.`)
  const bmp = await loadBitmap(file)
  const { width, height } = bmp
  bmp.close()
  addSource({ id: newId('s'), kind: 'image', name: file.name, size: file.size, file, width, height }, 1)
}
