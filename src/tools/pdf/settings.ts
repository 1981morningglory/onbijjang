/** 탭마다의 설정. 새로고침 뒤에도 남는다(암호는 저장하지 않는다). */
import type { PaperSize } from './geometry'
import type { OcrLang } from './ocr'
import type { ImageQuality, MarkOptions, NumberOptions } from './ops'

export interface Settings {
  // 사진 → PDF
  paper: PaperSize
  marginMm: number
  imageQuality: ImageQuality
  // PDF → 이미지
  imgFormat: 'image/png' | 'image/jpeg'
  imgDpi: number
  imgQuality: number
  // Word · PPT
  wordMode: 'text' | 'image'
  wordDpi: number
  pptDpi: number
  // Excel
  excelOneSheet: boolean
  excelNumeric: boolean
  // 분할
  splitMode: 'ranges' | 'every' | 'single'
  splitRanges: string
  splitEvery: number
  // 압축
  compressMode: 'raster' | 'structure'
  compressDpi: number
  compressQuality: number
  // 번호 · 워터마크
  numbers: NumberOptions
  mark: MarkOptions
  // 암호
  allowPrint: boolean
  allowCopy: boolean
  algorithm: 'AES-256' | 'AES-128'
  // 글자 인식
  ocrLang: OcrLang
  ocrOutput: 'pdf' | 'txt' | 'docx'
  ocrDpi: number
  // Word·Excel → PDF
  officeMethod: 'browser' | 'server'
}

export const DEFAULT_SETTINGS: Settings = {
  paper: 'a4-auto',
  marginMm: 10,
  imageQuality: 'high',
  imgFormat: 'image/png',
  imgDpi: 150,
  imgQuality: 90,
  wordMode: 'text',
  wordDpi: 150,
  pptDpi: 150,
  excelOneSheet: false,
  excelNumeric: true,
  splitMode: 'ranges',
  splitRanges: '',
  splitEvery: 2,
  compressMode: 'raster',
  compressDpi: 120,
  compressQuality: 70,
  numbers: { enabled: true, vertical: 'bottom', horizontal: 'center', start: 1, format: 'n', size: 10, marginMm: 10, skipFirst: false },
  mark: { enabled: false, text: '', opacity: 20, color: '#c22f1c', diagonal: true, widthPct: 60 },
  allowPrint: true,
  allowCopy: true,
  algorithm: 'AES-256',
  ocrLang: 'kor+eng',
  ocrOutput: 'pdf',
  ocrDpi: 200,
  officeMethod: 'browser',
}

export const clamp = (value: number | null | undefined, min: number, max: number, fallback: number): number => {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, v))
}
