import { sanitizeFilename } from '@/lib/files'
import { canvasToBlob, ctx2d, isCanvasSizeSafe, makeCanvas, type RasterFormat } from '@/lib/image'
import type { AssetStore } from './assets'
import { buildFrames, entranceTotalMs, outputSize, pageEffects, pageFileName, type AnimFrame, type CanvasDoc, type PageDoc } from './model'
import { PageStage, renderPage } from './render'

export interface OutFile {
  name: string
  blob: Blob
}

export interface ExportJob {
  doc: CanvasDoc
  /** 내보낼 페이지(문서 순서대로) */
  pages: PageDoc[]
  name: string
  assets: AssetStore
  signal: AbortSignal
  onProgress: (percent: number) => void
}

export type StillFormat = 'png' | 'jpg' | 'webp' | 'pdf'

export interface StillOptions {
  format: StillFormat
  scale: 1 | 2
  /** PNG·WebP 에서 배경을 비운다 */
  transparent: boolean
  /** JPG·WebP·PDF 화질 0–1 */
  quality: number
  /** 여러 페이지를 세로로 이어 한 장으로 만든다 */
  long: boolean
}

const MIME: Record<Exclude<StillFormat, 'pdf'>, RasterFormat> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }
/** PDF 한 쪽의 최대 길이(pt). 이보다 길면 일부 뷰어가 열지 못한다. */
const PDF_MAX_PT = 14400
const PX_TO_PT = 0.75

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('취소했습니다.', 'AbortError')
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function baseName(name: string): string {
  return sanitizeFilename(name, '디자인')
}

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** 여러 페이지를 세로로 이어 붙인 캔버스 */
async function renderLong(job: ExportJob, scale: number, transparent: boolean): Promise<HTMLCanvasElement> {
  const w = job.doc.width * scale
  const h = job.doc.height * scale * job.pages.length
  if (!isCanvasSizeSafe(w, h)) {
    throw new Error(`긴 한 장으로 만들기에는 너무 큽니다(${w}×${h}px). 배율을 1×로 낮추거나 페이지별로 저장해 주세요.`)
  }
  const out = makeCanvas(w, h)
  const ctx = ctx2d(out)
  for (let i = 0; i < job.pages.length; i++) {
    checkAbort(job.signal)
    const page = await renderPage(job.pages[i], job.doc, job.assets, { multiplier: scale, transparent })
    ctx.drawImage(page, 0, i * job.doc.height * scale)
    job.onProgress(((i + 1) / job.pages.length) * 90)
    await breathe()
  }
  return out
}

/** PNG·JPG·WebP·PDF 로 내보낸다. 결과 파일 목록을 돌려준다(저장은 부르는 쪽에서). */
export async function exportStills(job: ExportJob, opt: StillOptions): Promise<OutFile[]> {
  const { doc, pages } = job
  const base = baseName(job.name)
  if (!isCanvasSizeSafe(doc.width * opt.scale, doc.height * opt.scale)) {
    throw new Error(`${opt.scale}× 크기(${doc.width * opt.scale}×${doc.height * opt.scale}px)는 브라우저가 만들 수 없습니다. 배율을 낮춰 주세요.`)
  }
  const transparent = opt.transparent && (opt.format === 'png' || opt.format === 'webp')

  if (opt.format === 'pdf') {
    const { PDFDocument } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    pdf.setTitle(job.name)
    pdf.setCreator('온비짱 템플릿 캔버스')
    const canvases: HTMLCanvasElement[] = []
    if (opt.long && pages.length > 1) {
      if (doc.height * pages.length * PX_TO_PT > PDF_MAX_PT) {
        throw new Error('긴 한 장 PDF 로 만들기에는 페이지가 너무 깁니다. 페이지별 PDF 로 저장해 주세요.')
      }
      canvases.push(await renderLong(job, opt.scale, false))
    } else {
      for (let i = 0; i < pages.length; i++) {
        checkAbort(job.signal)
        canvases.push(await renderPage(pages[i], doc, job.assets, { multiplier: opt.scale }))
        job.onProgress(((i + 1) / pages.length) * 70)
        await breathe()
      }
    }
    for (let i = 0; i < canvases.length; i++) {
      checkAbort(job.signal)
      const c = canvases[i]
      const bytes = await (await canvasToBlob(c, 'image/jpeg', opt.quality)).arrayBuffer()
      const img = await pdf.embedJpg(bytes)
      const w = (c.width / opt.scale) * PX_TO_PT
      const h = (c.height / opt.scale) * PX_TO_PT
      pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h })
      job.onProgress(70 + ((i + 1) / canvases.length) * 28)
      await breathe()
    }
    const data = await pdf.save()
    job.onProgress(100)
    return [{ name: `${base}.pdf`, blob: new Blob([data as BlobPart], { type: 'application/pdf' }) }]
  }

  const mime = MIME[opt.format]
  if (opt.long && pages.length > 1) {
    const canvas = await renderLong(job, opt.scale, transparent)
    const blob = await canvasToBlob(canvas, mime, opt.quality)
    job.onProgress(100)
    return [{ name: `${base}_전체.${opt.format}`, blob }]
  }
  const out: OutFile[] = []
  for (let i = 0; i < pages.length; i++) {
    checkAbort(job.signal)
    const canvas = await renderPage(pages[i], doc, job.assets, { multiplier: opt.scale, transparent })
    const index = doc.pages.indexOf(pages[i])
    const name = pages.length === 1 && doc.pages.length > 1 ? `${base}_${String(index + 1).padStart(2, '0')}.${opt.format}` : pageFileName(base, i, pages.length, opt.format)
    out.push({ name, blob: await canvasToBlob(canvas, mime, opt.quality) })
    job.onProgress(((i + 1) / pages.length) * 100)
    await breathe()
  }
  return out
}

// ── 움직이는 파일 ─────────────────────────────────────────
export interface MotionOptions {
  format: 'gif' | 'mp4'
  /** 페이지마다 따로 정하지 않았을 때의 표시 시간(초) */
  pageSeconds: number
  /** 페이지가 바뀔 때 겹쳐 넘어가는 시간(초). 0 이면 바로 바뀐다 */
  fadeSeconds: number
  /** 긴 변 최대 크기(px). null 이면 문서 크기 그대로 */
  maxSide: number | null
  /** GIF 를 계속 반복할지 */
  loop: boolean
}

export function canEncodeMp4(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
}

interface GifStream {
  writeFrame(index: Uint8Array, width: number, height: number, opts: { palette?: number[][]; delay?: number; repeat?: number }): void
  finish(): void
  bytes(): Uint8Array
}
interface GifApi {
  GIFEncoder(): GifStream
  quantize(rgba: Uint8ClampedArray, maxColors: number, opts?: { format?: string }): number[][]
  applyPalette(rgba: Uint8ClampedArray, palette: number[][], format?: string): Uint8Array
}

async function loadGifenc(): Promise<GifApi> {
  // @ts-ignore -- gifenc 에는 타입 선언이 없다
  const raw = (await import('gifenc')) as Partial<GifApi> & { default?: Partial<GifApi> }
  return (typeof raw.GIFEncoder === 'function' ? raw : raw.default) as GifApi
}

/** 크기에 맞는 H.264 설정을 고른다. 쓸 수 있는 것이 없으면 null */
async function pickAvcConfig(width: number, height: number, fps: number, bitrate: number): Promise<VideoEncoderConfig | null> {
  const pixels = width * height
  const codecs = pixels <= 921_600 ? ['avc1.42001f', 'avc1.4d0028', 'avc1.640028'] : pixels <= 2_088_960 ? ['avc1.640028', 'avc1.4d0028', 'avc1.640032'] : ['avc1.640033', 'avc1.640034', 'avc1.640032']
  for (const codec of codecs) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } }
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config
    } catch {
      // 다음 후보로
    }
  }
  return null
}

/** 페이지를 순서대로 넘기는 GIF·MP4 를 만든다. */
export async function exportMotion(job: ExportJob, opt: MotionOptions): Promise<OutFile> {
  const { doc, pages } = job
  const fps = opt.format === 'gif' ? 12 : 30
  const size = outputSize(doc.width, doc.height, opt.maxSide, opt.format === 'mp4')
  const multiplier = size.width / doc.width
  const frames = buildFrames({
    pageMs: pages.map((p) => Math.max(200, (p.seconds ?? opt.pageSeconds) * 1000)),
    entranceMs: pages.map((p) => entranceTotalMs(pageEffects(p))),
    fadeMs: Math.max(0, opt.fadeSeconds * 1000),
    fps,
  })
  if (!frames.length) throw new Error('내보낼 페이지가 없습니다.')

  // 무대는 지금 그리는 페이지와 다음 페이지, 두 개까지만 들고 있는다.
  const stages = new Map<number, PageStage>()
  const stageFor = async (index: number): Promise<PageStage> => {
    let s = stages.get(index)
    if (!s) {
      for (const [key, old] of stages) {
        if (key < index - 1) {
          old.dispose()
          stages.delete(key)
        }
      }
      s = await PageStage.create(pages[index], doc, job.assets)
      stages.set(index, s)
    }
    return s
  }

  const out = makeCanvas(size.width, size.height)
  const ctx = ctx2d(out, opt.format === 'gif')
  const paint = async (frame: AnimFrame) => {
    const base = (await stageFor(frame.page)).draw({ multiplier, localMs: frame.localMs })
    ctx.globalAlpha = 1
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(base, 0, 0, out.width, out.height)
    if (frame.blend) {
      const next = (await stageFor(frame.blend.page)).draw({ multiplier, localMs: 0 })
      ctx.globalAlpha = frame.blend.alpha
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.drawImage(next, 0, 0, out.width, out.height)
      ctx.globalAlpha = 1
    }
  }

  const base = baseName(job.name)
  try {
    if (opt.format === 'gif') {
      const gifenc = await loadGifenc()
      const gif = gifenc.GIFEncoder()
      for (let i = 0; i < frames.length; i++) {
        checkAbort(job.signal)
        await paint(frames[i])
        const { data } = ctx.getImageData(0, 0, out.width, out.height)
        const palette = gifenc.quantize(data, 256, { format: 'rgb565' })
        const index = gifenc.applyPalette(data, palette, 'rgb565')
        gif.writeFrame(index, out.width, out.height, { palette, delay: Math.round(frames[i].durationMs), ...(i === 0 ? { repeat: opt.loop ? 0 : -1 } : {}) })
        job.onProgress(((i + 1) / frames.length) * 100)
        await breathe()
      }
      gif.finish()
      return { name: `${base}.gif`, blob: new Blob([gif.bytes() as BlobPart], { type: 'image/gif' }) }
    }

    if (!canEncodeMp4()) throw new Error('이 브라우저는 MP4 만들기를 지원하지 않습니다. 크롬이나 엣지 최신 버전에서 다시 시도하거나 GIF 로 저장해 주세요.')
    const bitrate = Math.round(Math.max(1_500_000, Math.min(16_000_000, size.width * size.height * 4)))
    const config = await pickAvcConfig(size.width, size.height, fps, bitrate)
    if (!config) throw new Error(`이 크기(${size.width}×${size.height}px)로는 MP4 를 만들 수 없습니다. 크기를 더 작게 골라 주세요.`)
    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer')
    const target = new ArrayBufferTarget()
    const muxer = new Muxer({ target, video: { codec: 'avc', width: size.width, height: size.height, frameRate: fps }, fastStart: 'in-memory' })
    let failure: Error | null = null
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        failure = e
      },
    })
    encoder.configure(config)
    const frameUs = 1_000_000 / fps
    let n = 0
    try {
      for (let i = 0; i < frames.length; i++) {
        checkAbort(job.signal)
        await paint(frames[i])
        const repeat = Math.max(1, Math.round(frames[i].durationMs / (1000 / fps)))
        for (let r = 0; r < repeat; r++) {
          if (failure) throw failure
          const vf = new VideoFrame(out, { timestamp: Math.round(n * frameUs), duration: Math.round(frameUs) })
          encoder.encode(vf, { keyFrame: n % (fps * 2) === 0 })
          vf.close()
          n++
          if (encoder.encodeQueueSize > 6) {
            await breathe()
            checkAbort(job.signal)
          }
        }
        job.onProgress(((i + 1) / frames.length) * 96)
        await breathe()
      }
      await encoder.flush()
      if (failure) throw failure
      muxer.finalize()
    } finally {
      if (encoder.state !== 'closed') encoder.close()
    }
    job.onProgress(100)
    return { name: `${base}.mp4`, blob: new Blob([target.buffer], { type: 'video/mp4' }) }
  } finally {
    for (const s of stages.values()) s.dispose()
  }
}
