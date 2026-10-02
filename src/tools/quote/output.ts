/** 저장된 문서를 완성본(PDF·엑셀)으로 만든다. 문서함에서 바로 내려받을 때 쓴다. */
import { buildPages, canvasMeasure } from './layout'
import { DOC_NAME, type CompanyKit, type QuoteDoc } from './model'

/** 글자 너비를 재기 전에 글꼴이 준비되어야 줄바꿈·줄임이 화면과 같아진다 */
async function fontsReady() {
  await document.fonts.ready.catch(() => {})
}

export async function docToPdf(doc: QuoteDoc, kit: CompanyKit): Promise<Blob> {
  await fontsReady()
  const pages = buildPages({ doc, kit, measure: canvasMeasure })
  const { pagesToPdf } = await import('./render')
  const bytes = await pagesToPdf(pages, { title: `${DOC_NAME[doc.type]} ${doc.customer}`.trim(), author: kit.company.name || '온비짱' })
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}

export async function docToXlsx(doc: QuoteDoc, kit: CompanyKit): Promise<Blob> {
  const { buildWorkbook } = await import('./excel')
  return buildWorkbook(doc, kit)
}
