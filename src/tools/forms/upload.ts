// 설문 사진 올리기: 큰 사진은 긴 변 1600px 로 줄여 JPG 로(움직이는 GIF·작은 PNG 는 그대로)
import { api } from '@/lib/api'
import { canvasToBlob, fileToCanvas, fitWithin, resizeCanvas } from '@/lib/image'

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('사진을 읽지 못했습니다.'))
    r.readAsDataURL(blob)
  })

export async function uploadFormImage(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('JPG·PNG·WEBP·GIF 사진만 넣을 수 있습니다.')
  let blob: Blob = file
  const keep = (file.type === 'image/gif' && file.size <= 4 * 1024 * 1024) || (file.type === 'image/png' && file.size <= 600 * 1024)
  if (!keep) {
    const c = await fileToCanvas(file)
    const { width, height } = fitWithin(c.width, c.height, 1600)
    blob = await canvasToBlob(width === c.width && height === c.height ? c : resizeCanvas(c, width, height), 'image/jpeg', 0.88)
  }
  const r = await api<{ url: string }>('/forms/images', { method: 'POST', body: { data: await toDataUrl(blob) } })
  return r.url
}

/** 파일 고르기 창을 열어 사진 하나 받기 */
export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp,image/gif'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}
