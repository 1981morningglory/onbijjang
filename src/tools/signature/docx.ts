/**
 * Word(.docx) 열기 — mammoth 로 글·표·그림을 HTML 로 옮긴 뒤 쪽 크기에 맞춰 나누고,
 * 각 쪽을 SVG(foreignObject)로 그려 이미지로 만든다.
 * Word 의 조판을 그대로 재현하지는 못한다(글꼴, 머리글·바닥글, 쪽 나눔 위치가 다를 수 있다).
 */
import { stripExt } from '@/lib/files'
import { ctx2d, loadImageElement, makeCanvas } from '@/lib/image'
import { paginate, parseDefaultFontPt, parsePageSetup, A4_SETUP, type PageSetup, type PageSlice, type Span } from './paginate'
import { MAX_PAGES, type DocSource } from './types'

const XHTML = 'http://www.w3.org/1999/xhtml'

// 화면 글꼴(웹폰트)은 SVG 이미지 안에서 쓸 수 없으므로 PC 에 설치된 글꼴만 지정한다.
const FONT_STACK = `"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans CJK KR","Noto Sans KR","NanumGothic",sans-serif`

function docxCss(fontPt: number, maxImageHeight: number): string {
  return `
.ob-docx{display:flow-root;font-family:${FONT_STACK};font-size:${fontPt}pt;line-height:1.6;color:#000;font-weight:400;font-style:normal;text-align:left;letter-spacing:0;word-break:normal;overflow-wrap:anywhere}
.ob-docx *{box-sizing:border-box}
.ob-docx p,.ob-docx li,.ob-docx h1,.ob-docx h2,.ob-docx h3,.ob-docx h4,.ob-docx h5,.ob-docx h6{white-space:pre-wrap;tab-size:8}
.ob-docx p{margin:0 0 .45em;min-height:1.6em}
.ob-docx h1{font-size:1.7em;font-weight:700;margin:.5em 0 .4em;line-height:1.35}
.ob-docx h2{font-size:1.4em;font-weight:700;margin:.5em 0 .4em;line-height:1.35}
.ob-docx h3{font-size:1.2em;font-weight:700;margin:.5em 0 .35em;line-height:1.35}
.ob-docx h4,.ob-docx h5,.ob-docx h6{font-size:1em;font-weight:700;margin:.5em 0 .3em}
.ob-docx ul,.ob-docx ol{margin:0 0 .45em;padding:0 0 0 1.8em}
.ob-docx ul{list-style:disc}.ob-docx ol{list-style:decimal}
.ob-docx li{margin:0}
.ob-docx table{border-collapse:collapse;width:100%;margin:0 0 .6em;table-layout:auto}
.ob-docx td,.ob-docx th{border:1px solid #000;padding:3px 6px;vertical-align:top;text-align:left;font-weight:400}
.ob-docx td>p:last-child,.ob-docx th>p:last-child{margin-bottom:0}
.ob-docx img{display:inline-block;max-width:100%;max-height:${Math.floor(maxImageHeight)}px;height:auto;vertical-align:bottom}
.ob-docx strong,.ob-docx b{font-weight:700}
.ob-docx em,.ob-docx i{font-style:italic}
.ob-docx a{color:inherit;text-decoration:underline}
.ob-docx sup{font-size:.7em;vertical-align:super}.ob-docx sub{font-size:.7em;vertical-align:sub}
.ob-docx hr.ob-break{display:block;border:0;margin:0;padding:0;height:0;visibility:hidden}
.ob-docx .ob-center{text-align:center}.ob-docx .ob-right{text-align:right}.ob-docx .ob-both{text-align:justify}
`
}

const ALIGN_CLASS: Record<string, string> = { center: 'ob-center', right: 'ob-right', end: 'ob-right', both: 'ob-both', distribute: 'ob-both' }
/** 이 이름의 문단 스타일은 mammoth 기본 규칙이 제목·목록으로 바꾸므로 건드리지 않는다 */
const KEEP_STYLE = /^(heading|title|subtitle|list|toc|footnote|endnote|제목|목록)/i

interface DocNode {
  type: string
  children?: DocNode[]
  styleId?: string | null
  styleName?: string | null
  alignment?: string | null
  fontSize?: number | null
  numbering?: unknown
}

/** mammoth 가 버리는 문단 정렬과 글자 크기를 스타일 이름에 실어 HTML 까지 가져간다 */
function tagFormatting(node: DocNode): DocNode {
  const next: DocNode = node.children ? { ...node, children: node.children.map(tagFormatting) } : node
  if (next.type === 'paragraph') {
    const cls = next.alignment ? ALIGN_CLASS[next.alignment] : undefined
    if (cls && !next.numbering && !(next.styleName && KEEP_STYLE.test(next.styleName))) return { ...next, styleId: null, styleName: cls }
  } else if (next.type === 'run') {
    if (next.fontSize && !next.styleName && next.fontSize >= 6 && next.fontSize <= 72) {
      return { ...next, styleId: null, styleName: `ob-fs-${Math.round(next.fontSize * 2)}` }
    }
  }
  return next
}

function buildStyleMap(): string[] {
  const map = [
    "br[type='page'] => hr.ob-break:fresh",
    'u => u',
    'strike => s',
    "p[style-name='ob-center'] => p.ob-center:fresh",
    "p[style-name='ob-right'] => p.ob-right:fresh",
    "p[style-name='ob-both'] => p.ob-both:fresh",
  ]
  for (let half = 12; half <= 144; half++) map.push(`r[style-name='ob-fs-${half}'] => span.ob-fs-${half}`)
  return map
}

const ALLOWED_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'br', 'hr', 'img', 'a', 'span'])
const ALLOWED_ATTRS = new Set(['class', 'colspan', 'rowspan', 'alt', 'start'])

/** 스크립트·외부 자원을 없애고 필요한 태그·속성만 남긴다. 글자 크기 표시는 style 로 바꾼다. */
export function sanitizeDocxHtml(html: string): DocumentFragment {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const visit = (parent: ParentNode) => {
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) {
        if (['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'svg', 'math'].includes(tag)) {
          el.remove()
        } else {
          // 모르는 태그는 내용만 남긴다
          visit(el)
          el.replaceWith(...Array.from(el.childNodes))
        }
        continue
      }
      const src = tag === 'img' ? el.getAttribute('src') : null
      for (const attr of Array.from(el.attributes)) if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) el.removeAttribute(attr.name)
      if (tag === 'img') {
        if (src && /^data:image\/(png|jpe?g|gif|bmp|webp);base64,/i.test(src)) el.setAttribute('src', src)
        else {
          el.remove()
          continue
        }
      }
      const size = el.getAttribute('class')?.match(/\bob-fs-(\d+)\b/)
      if (size) {
        el.removeAttribute('class')
        el.setAttribute('style', `font-size:${Number(size[1]) / 2}pt`)
      }
      visit(el)
    }
  }
  visit(tpl.content)
  return tpl.content
}

interface Block {
  el: Element
  top: number
  bottom: number
}

interface Measured {
  blocks: Block[]
  slices: PageSlice[]
}

/** 앱의 스타일이 섞이지 않는 곳(shadow DOM)에서 배치해 줄·그림·표 행의 위치를 잰다 */
async function measure(content: DocumentFragment, css: string, contentWidth: number, contentHeight: number): Promise<Measured> {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout'
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `:host{all:initial}${css}`
  const flow = document.createElement('div')
  flow.className = 'ob-docx'
  flow.style.width = `${contentWidth}px`
  flow.append(content)
  root.append(style, flow)
  document.body.append(host)
  try {
    await Promise.all(Array.from(flow.querySelectorAll('img')).map((img) => img.decode().catch(() => {})))
    const base = flow.getBoundingClientRect().top
    const hard: Span[] = []
    const soft: Span[] = []
    const range = document.createRange()
    const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue
      range.selectNodeContents(node)
      for (const r of range.getClientRects()) if (r.height > 0) hard.push({ top: r.top - base, bottom: r.bottom - base })
    }
    for (const img of flow.querySelectorAll('img')) {
      const r = img.getBoundingClientRect()
      if (r.height > 0) hard.push({ top: r.top - base, bottom: r.bottom - base })
    }
    for (const tr of flow.querySelectorAll('tr')) {
      const r = tr.getBoundingClientRect()
      soft.push({ top: r.top - base, bottom: r.bottom - base })
    }
    const forced = Array.from(flow.querySelectorAll('hr.ob-break')).map((hr) => hr.getBoundingClientRect().top - base)
    const blocks: Block[] = Array.from(flow.children).map((el) => {
      const r = el.getBoundingClientRect()
      return { el, top: r.top - base, bottom: r.bottom - base }
    })
    const total = flow.getBoundingClientRect().height
    return { blocks, slices: paginate(hard, soft, forced, total, contentHeight, MAX_PAGES + 1) }
  } finally {
    host.remove()
  }
}

function pageSvg(blocks: Block[], slice: PageSlice, setup: PageSetup, css: string, scale: number): string {
  const contentWidth = setup.width - setup.margin.left - setup.margin.right
  const visible = blocks.filter((b) => b.bottom > slice.start && b.top < slice.end && b.bottom > b.top)
  const page = document.createElementNS(XHTML, 'div')
  page.setAttribute('style', `position:relative;width:${setup.width}px;height:${setup.height}px;background:#fff;overflow:hidden`)
  const styleEl = document.createElementNS(XHTML, 'style')
  styleEl.textContent = css
  const clip = document.createElementNS(XHTML, 'div')
  clip.setAttribute('style', `position:absolute;left:${setup.margin.left}px;top:${setup.margin.top}px;width:${contentWidth}px;height:${Math.max(0, slice.end - slice.start)}px;overflow:hidden`)
  const flow = document.createElementNS(XHTML, 'div')
  flow.setAttribute('class', 'ob-docx')
  const shift = visible.length ? slice.start - visible[0].top : 0
  flow.setAttribute('style', `width:${contentWidth}px;margin-top:${-shift}px`)
  visible.forEach((b, i) => {
    const clone = b.el.cloneNode(true) as HTMLElement
    // 원래 흐름에서의 위쪽 여백은 이미 위치(top)에 반영되어 있다
    if (i === 0) clone.style.marginTop = '0'
    flow.append(clone)
  })
  clip.append(flow)
  page.append(styleEl, clip)
  const xhtml = new XMLSerializer().serializeToString(page)
  const w = setup.width
  const h = setup.height
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${xhtml}</foreignObject></svg>`
}

async function readXml(buffer: ArrayBuffer): Promise<{ documentXml: string; stylesXml: string }> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
  const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? ''
  if (!documentXml) throw new Error('Word 문서가 아닙니다.')
  return { documentXml, stylesXml }
}

export async function openDocx(file: File, signal?: AbortSignal): Promise<DocSource> {
  const buffer = await file.arrayBuffer()
  let setup = A4_SETUP
  let fontPt = 10
  let html: string
  try {
    const xml = await readXml(buffer)
    setup = parsePageSetup(xml.documentXml)
    fontPt = parseDefaultFontPt(xml.stylesXml)
    const mod = await import('mammoth')
    const mammoth = mod.default ?? mod
    const result = await mammoth.convertToHtml(
      { arrayBuffer: buffer },
      { styleMap: buildStyleMap(), ignoreEmptyParagraphs: false, transformDocument: (doc: DocNode) => tagFormatting(doc) },
    )
    html = result.value
  } catch {
    throw new Error('Word 문서를 읽지 못했습니다. 암호가 걸렸거나 손상된 파일일 수 있습니다. Word 에서 PDF 로 저장해 올려 주세요.')
  }
  if (signal?.aborted) throw new DOMException('취소됨', 'AbortError')
  if (!html.trim()) throw new Error('Word 문서에서 옮길 내용을 찾지 못했습니다. Word 에서 PDF 로 저장해 올려 주세요.')

  const contentWidth = setup.width - setup.margin.left - setup.margin.right
  const contentHeight = setup.height - setup.margin.top - setup.margin.bottom
  const css = docxCss(fontPt, contentHeight)
  const { blocks, slices } = await measure(sanitizeDocxHtml(html), css, contentWidth, contentHeight)
  if (slices.length > MAX_PAGES) {
    throw new Error(`문서는 ${MAX_PAGES}쪽까지 열 수 있습니다. Word 에서 필요한 부분만 남기거나 PDF 로 저장해 올려 주세요.`)
  }

  const render = async (index: number, pxPerUnit: number): Promise<HTMLCanvasElement> => {
    const scale = Math.min(4, Math.max(0.1, pxPerUnit))
    const svg = pageSvg(blocks, slices[index], setup, css, scale)
    const img = await loadImageElement(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    const canvas = makeCanvas(setup.width * scale, setup.height * scale)
    const ctx = ctx2d(canvas)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  // 일부 브라우저는 이렇게 그린 캔버스를 읽지 못하게 막는다. 저장이 안 될 바에는 처음부터 알린다.
  try {
    const probe = await render(0, 0.2)
    ctx2d(probe).getImageData(0, 0, 1, 1)
  } catch {
    throw new Error('이 브라우저에서는 Word 문서를 그릴 수 없습니다. Chrome·Edge 에서 열거나, Word 에서 PDF 로 저장해 올려 주세요.')
  }

  return {
    kind: 'docx',
    file,
    baseName: stripExt(file.name),
    pages: slices.map(() => ({ width: setup.width, height: setup.height })),
    unitPx: 1,
    notes: [],
    render,
    destroy() {
      blocks.length = 0
    },
  }
}
