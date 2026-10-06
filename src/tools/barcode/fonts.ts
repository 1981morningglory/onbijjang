import boldUrl from 'pretendard/dist/public/static/alternative/Pretendard-Bold.ttf?url'
import mediumUrl from 'pretendard/dist/public/static/alternative/Pretendard-Medium.ttf?url'
import type { Cmd, Fonts, GlyphFont } from './layout'

/** 프리텐다드(고딕)를 불러와 글자 윤곽선을 꺼낸다. 처음 한 번만 받아 둔다. */

interface FkPathCommand {
  command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath'
  args: number[]
}
interface FkGlyph {
  id: number
  advanceWidth: number
  path: { commands: FkPathCommand[] }
}
interface FkFont {
  unitsPerEm: number
  capHeight: number
  glyphForCodePoint(cp: number): FkGlyph
}

const TYPE: Record<FkPathCommand['command'], Cmd['t']> = { moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' }

function wrap(font: FkFont): GlyphFont {
  const cache = new Map<string, { adv: number; path: Cmd[]; ok: boolean }>()
  const get = (ch: string) => {
    let g = cache.get(ch)
    if (!g) {
      const glyph = font.glyphForCodePoint(ch.codePointAt(0) ?? 32)
      g = { adv: glyph.advanceWidth, ok: glyph.id !== 0, path: glyph.path.commands.map((c) => ({ t: TYPE[c.command], p: c.args })) }
      cache.set(ch, g)
    }
    return g
  }
  return {
    unitsPerEm: font.unitsPerEm,
    capHeight: font.capHeight,
    has: (ch) => get(ch).ok,
    advance: (ch) => get(ch).adv,
    path: (ch) => get(ch).path,
  }
}

let loading: Promise<Fonts> | null = null

export function loadFonts(): Promise<Fonts> {
  loading ??= (async () => {
    const fontkit = (await import('@pdf-lib/fontkit')).default as unknown as { create(buf: Uint8Array): FkFont }
    const [b, m] = await Promise.all([boldUrl, mediumUrl].map(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer())))
    return { bold: wrap(fontkit.create(b)), medium: wrap(fontkit.create(m)) }
  })().catch((err) => {
    loading = null
    throw err
  })
  return loading
}
