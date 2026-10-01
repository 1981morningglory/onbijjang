/**
 * JPEG 이미지를 쪽마다 한 장씩 담는 아주 작은 PDF 작성기.
 * 외부 라이브러리 없이 동작하도록 직접 만든다(확장 프로그램에는 빌드 단계가 없다).
 * 순수 함수라 사이트와 테스트에서도 그대로 쓴다.
 */

const enc = new TextEncoder()

/** PDF 문자열(제목 등)을 UTF-16BE 16진 문자열로 */
function hexString(text) {
  let out = 'FEFF'
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0)
    if (cp > 0xffff) {
      const v = cp - 0x10000
      out += (0xd800 + (v >> 10)).toString(16).padStart(4, '0')
      out += (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')
    } else {
      out += cp.toString(16).padStart(4, '0')
    }
  }
  return `<${out.toUpperCase()}>`
}

const num = (v) => {
  const r = Math.round(v * 100) / 100
  return Number.isInteger(r) ? String(r) : r.toFixed(2)
}

function pdfDate(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`
}

/**
 * @param {Array<{jpeg:Uint8Array, pxW:number, pxH:number, pageW:number, pageH:number, drawW?:number, drawH?:number}>} pages
 *   pageW/pageH 는 종이 크기(pt). 이미지는 왼쪽 위에 drawW×drawH(pt)로 놓인다(생략하면 폭을 종이에 맞춘다).
 * @param {{title?:string, createdAt?:number}} [info]
 * @returns {Uint8Array}
 */
export function buildPdf(pages, info = {}) {
  if (!pages.length) throw new Error('PDF 로 만들 쪽이 없습니다.')
  const parts = []
  const offsets = []
  let length = 0
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk
    parts.push(bytes)
    length += bytes.length
  }
  const beginObj = (id) => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
  }

  // 1: 카탈로그, 2: 쪽 목록, 3: 문서 정보, 그 뒤로 쪽마다 (쪽, 내용, 이미지)
  const pageId = (i) => 4 + i * 3
  push('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  beginObj(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  beginObj(2)
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>\nendobj\n`)
  beginObj(3)
  push(`<< /Producer ${hexString('온비짱 캡처')}${info.title ? ` /Title ${hexString(info.title)}` : ''} /CreationDate ${pdfDate(info.createdAt ?? Date.now())} >>\nendobj\n`)

  pages.forEach((page, i) => {
    const id = pageId(i)
    const drawW = page.drawW ?? page.pageW
    const drawH = page.drawH ?? (page.pxH * drawW) / page.pxW
    const content = enc.encode(`q ${num(drawW)} 0 0 ${num(drawH)} 0 ${num(page.pageH - drawH)} cm /Im0 Do Q\n`)
    beginObj(id)
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.pageW)} ${num(page.pageH)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>\nendobj\n`)
    beginObj(id + 1)
    push(`<< /Length ${content.length} >>\nstream\n`)
    push(content)
    push('endstream\nendobj\n')
    beginObj(id + 2)
    push(`<< /Type /XObject /Subtype /Image /Width ${Math.round(page.pxW)} /Height ${Math.round(page.pxH)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`)
    push(page.jpeg)
    push('\nendstream\nendobj\n')
  })

  const count = 4 + pages.length * 3
  const xrefAt = length
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let id = 1; id < count; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  push(xref)
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
