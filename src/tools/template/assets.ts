import { readAsDataURL } from '@/lib/files'
import { canvasToBlob, ctx2d, fitWithin, loadBitmap, loadImageElement, makeCanvas, resizeCanvas } from '@/lib/image'
import { newId } from './model'

/** 캔버스에 올린 사진 한 장. 문서(JSON)에는 id 만 남고 실제 그림은 여기 Blob 으로 둔다. */
export interface Asset {
  id: string
  blob: Blob
  /** 화면 표시용 object URL */
  url: string
  width: number
  height: number
}

/** 사진 한 장의 한도 */
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024
/** 이보다 큰 사진은 가져올 때 줄인다(필터·내보내기가 안정적으로 되는 크기). */
export const MAX_IMAGE_SIDE = 4096

/** 1×1 투명 PNG — 그림을 찾을 수 없을 때 대신 쓴다. */
export const BLANK_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export class AssetStore {
  private map = new Map<string, Asset>()

  add(blob: Blob, width: number, height: number, id: string = newId()): Asset {
    const prev = this.map.get(id)
    if (prev) return prev
    const asset: Asset = { id, blob, url: URL.createObjectURL(blob), width, height }
    this.map.set(id, asset)
    return asset
  }

  get(id: string): Asset | undefined {
    return this.map.get(id)
  }

  /** 화면에 쓸 주소. 없는 자산이면 투명 점으로 대신한다. */
  url(id: string): string {
    return this.map.get(id)?.url ?? BLANK_PIXEL
  }

  has(id: string): boolean {
    return this.map.has(id)
  }

  ids(): string[] {
    return [...this.map.keys()]
  }

  dispose() {
    for (const a of this.map.values()) URL.revokeObjectURL(a.url)
    this.map.clear()
  }
}

/**
 * 파일을 캔버스에 올릴 수 있는 그림으로 만든다.
 * 캔버스에서 새로 그려 저장하므로 촬영 위치 같은 부가 정보는 남지 않는다.
 */
export async function importImage(file: Blob): Promise<{ blob: Blob; width: number; height: number; resized: boolean }> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('사진 한 장은 40MB 이하만 올릴 수 있습니다.')
  let source: ImageBitmap | HTMLImageElement
  let release = () => {}
  try {
    source = await loadBitmap(file)
    const bmp = source
    release = () => bmp.close()
  } catch (err) {
    // SVG 등 createImageBitmap 이 못 읽는 형식은 <img> 로 한 번 더 시도한다.
    const url = URL.createObjectURL(file)
    try {
      source = await loadImageElement(url)
    } catch {
      URL.revokeObjectURL(url)
      throw err
    }
    release = () => URL.revokeObjectURL(url)
  }
  try {
    const sw = 'naturalWidth' in source ? source.naturalWidth || 1024 : source.width
    const sh = 'naturalHeight' in source ? source.naturalHeight || 1024 : source.height
    const fit = fitWithin(sw, sh, MAX_IMAGE_SIDE)
    const full = makeCanvas(sw, sh)
    ctx2d(full).drawImage(source, 0, 0, sw, sh)
    const canvas = fit.scale < 1 ? resizeCanvas(full, fit.width, fit.height) : full
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : file.type === 'image/webp' ? 'image/webp' : 'image/png'
    const blob = await canvasToBlob(canvas, type, 0.93)
    return { blob, width: canvas.width, height: canvas.height, resized: fit.scale < 1 }
  } finally {
    release()
  }
}

/** 자산을 data URL 로. maxSide 를 주면 그 크기 이하로 줄여 다시 압축한다(투명은 WebP 로 유지). */
export async function assetToDataUrl(asset: Asset, shrink?: { maxSide: number; quality: number }): Promise<{ dataUrl: string; width: number; height: number }> {
  if (!shrink) return { dataUrl: await readAsDataURL(asset.blob), width: asset.width, height: asset.height }
  const bmp = await loadBitmap(asset.blob)
  try {
    const fit = fitWithin(bmp.width, bmp.height, shrink.maxSide)
    const canvas = resizeCanvas(bmp, fit.width, fit.height)
    let blob = await canvasToBlob(canvas, 'image/webp', shrink.quality)
    // WebP 로 저장하지 못하는 브라우저는 PNG 를 돌려준다. 그때는 JPEG 로 다시 줄인다.
    if (blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', shrink.quality)
    return { dataUrl: await readAsDataURL(blob), width: canvas.width, height: canvas.height }
  } finally {
    bmp.close()
  }
}
