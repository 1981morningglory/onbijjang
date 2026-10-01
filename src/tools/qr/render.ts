import QRCodeStyling from 'qr-code-styling'
import { buildOptions, type QrFormat, type QrStyle } from './logic'

export interface RenderedQr {
  blob: Blob
  /** QR 한 변의 칸 수 */
  modules: number
}

/** 설정대로 QR 한 장을 만든다. 내용이 한도를 넘으면 설명이 담긴 오류를 던진다. */
export async function renderQr(data: string, style: QrStyle, size: number, logo: string | null, format: QrFormat): Promise<RenderedQr> {
  let qr: QRCodeStyling
  try {
    qr = new QRCodeStyling(buildOptions(data, style, size, logo, format))
  } catch {
    throw new Error('내용이 너무 길어 QR 로 만들 수 없습니다. 글을 줄이거나, 긴 내용은 웹페이지에 올리고 그 주소를 QR 로 만드세요.')
  }
  let raw: unknown
  try {
    raw = await qr.getRawData(format)
  } catch {
    throw new Error(logo ? 'QR 을 그리지 못했습니다. 로고 이미지를 다른 파일로 바꿔 보세요.' : 'QR 을 그리지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  }
  if (!(raw instanceof Blob)) throw new Error('QR 을 그리지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  return { blob: raw, modules: qr._qr?.getModuleCount() ?? 0 }
}
