export interface PdfPage {
  jpeg: Uint8Array
  pxW: number
  pxH: number
  /** 종이 크기(pt) */
  pageW: number
  pageH: number
  /** 이미지를 놓는 크기(pt). 생략하면 폭을 종이에 맞춘다. */
  drawW?: number
  drawH?: number
}
export declare function buildPdf(pages: PdfPage[], info?: { title?: string; createdAt?: number }): Uint8Array<ArrayBuffer>
