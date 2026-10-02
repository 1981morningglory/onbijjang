import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { fixedFontkit } from './fontkit-fix'

const require = createRequire(import.meta.url)
const fontBytes = new Uint8Array(readFileSync(require.resolve('pretendard/dist/public/static/alternative/Pretendard-Regular.ttf')))
const TEXT = 'Landscape Plain English OCR 12345 대외비 한글 워터마크 쪽 - 3 / 12 Page'

interface Glyph {
  id: number
  path: { commands: unknown[] }
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
}
interface Font {
  layout: (text: string) => { glyphs: Glyph[] }
  getGlyph: (id: number) => Glyph
  createSubset: () => { includeGlyph: (g: Glyph) => number; encodeStream: () => { on: (event: string, cb: (chunk?: Uint8Array) => void) => unknown } }
}
type Kit = { create: (bytes: Uint8Array) => Font }

async function subsetCheck(kit: Kit): Promise<{ broken: string[]; total: number }> {
  const font = kit.create(fontBytes)
  const run = font.layout(TEXT)
  const subset = font.createSubset()
  const ids = run.glyphs.map((g) => subset.includeGlyph(g))
  const chunks: Uint8Array[] = []
  await new Promise<void>((resolve) => {
    const stream = subset.encodeStream()
    stream.on('data', (c) => chunks.push(c!))
    stream.on('end', () => resolve())
  })
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    merged.set(c, at)
    at += c.length
  }
  const reread = kit.create(merged)
  const broken: string[] = []
  run.glyphs.forEach((g, i) => {
    let same = false
    try {
      const s = reread.getGlyph(ids[i])
      same = s.path.commands.length === g.path.commands.length && JSON.stringify(s.bbox) === JSON.stringify(g.bbox)
    } catch {
      same = false
    }
    if (!same && TEXT[i] !== ' ') broken.push(TEXT[i])
  })
  return { broken: [...new Set(broken)], total: run.glyphs.length }
}

describe('fixedFontkit', () => {
  it('고치기 전: Pretendard 를 줄이면 글자가 깨진다(이 오류가 사라지면 고침 코드를 지워도 된다)', async () => {
    const { broken } = await subsetCheck(fontkit as unknown as Kit)
    expect(broken.length).toBeGreaterThan(0)
  })

  it('고친 뒤: 줄인 글꼴의 모든 글자 모양이 원본과 같다', async () => {
    const fixed = fixedFontkit(fontkit, fontBytes)
    expect(fixed.safe).toBe(true)
    const { broken, total } = await subsetCheck(fixed.fontkit as unknown as Kit)
    expect(total).toBeGreaterThan(40)
    expect(broken).toEqual([])
  })

  it('pdf-lib 에 넣어도 작은 파일로 저장된다', async () => {
    const fixed = fixedFontkit(fontkit, fontBytes)
    const doc = await PDFDocument.create()
    doc.registerFontkit(fixed.fontkit)
    const font = await doc.embedFont(fontBytes, { subset: fixed.safe })
    doc.addPage([400, 200]).drawText(TEXT, { x: 10, y: 100, size: 12, font })
    const bytes = await doc.save()
    expect(bytes.length).toBeLessThan(60_000)
  })

  it('구조가 다른 fontkit 은 건드리지 않고 safe=false', () => {
    const odd = { create: () => ({ createSubset: () => ({}) }) }
    const r = fixedFontkit(odd, fontBytes)
    expect(r.safe).toBe(false)
    expect(r.fontkit).toBe(odd)
  })
})
