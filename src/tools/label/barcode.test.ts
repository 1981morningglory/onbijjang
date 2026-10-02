import bwipjs from 'bwip-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { SYMBOLOGIES, explainBwipError, gs1CheckDigit, makeBarcode, setBarcodeLib, svgToGeometry, validateBarcode } from './barcode'
import { parsePath } from './model'

describe('값 검사', () => {
  it('GS1 검사 숫자', () => {
    expect(gs1CheckDigit('880123456789')).toBe(3)
    expect(gs1CheckDigit('1234567')).toBe(0)
    expect(gs1CheckDigit('01234567890')).toBe(5)
    expect(gs1CheckDigit('0880123456789')).toBe(3)
  })

  it('EAN-13: 12자리는 검사 숫자를 붙이고, 틀린 13자리는 바른 숫자를 알려준다', () => {
    expect(validateBarcode('ean13', '880123456789')).toEqual({ ok: true, text: '8801234567893', display: '8801234567893' })
    expect(validateBarcode('ean13', ' 8801234567893 ')).toMatchObject({ ok: true, text: '8801234567893' })
    const bad = validateBarcode('ean13', '8801234567890')
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.message).toContain('3 이어야')
    const short = validateBarcode('ean13', '12345')
    expect(!short.ok && short.message).toContain('5자리')
    const alpha = validateBarcode('ean13', '88012345678AB')
    expect(!alpha.ok && alpha.message).toContain('숫자만')
  })

  it('EAN-8·UPC-A·ITF', () => {
    expect(validateBarcode('ean8', '1234567')).toMatchObject({ ok: true, text: '12345670' })
    expect(validateBarcode('ean8', '12345671').ok).toBe(false)
    expect(validateBarcode('upca', '01234567890')).toMatchObject({ ok: true, text: '012345678905' })
    expect(validateBarcode('upca', '012345678901').ok).toBe(false)
    expect(validateBarcode('itf', '123')).toMatchObject({ ok: true, text: '0123' })
    expect(validateBarcode('itf', '12A').ok).toBe(false)
  })

  it('글자 제한이 있는 종류', () => {
    expect(validateBarcode('code39', 'ABC-123').ok).toBe(true)
    const lower = validateBarcode('code39', 'abc')
    expect(!lower.ok && lower.message).toContain('소문자')
    expect(validateBarcode('code93', '한글').ok).toBe(false)
    expect(validateBarcode('code128', 'abc-123 XYZ').ok).toBe(true)
    const kor = validateBarcode('code128', '한글')
    expect(!kor.ok && kor.message).toContain('QR')
    expect(validateBarcode('codabar', '12345')).toMatchObject({ ok: true, text: 'A12345A', display: '12345' })
    expect(validateBarcode('codabar', 'b123-45d')).toMatchObject({ ok: true, text: 'B123-45D', display: '123-45' })
    expect(validateBarcode('codabar', '12X45').ok).toBe(false)
    expect(validateBarcode('gs1-128', '(01)08801234567893(10)A1').ok).toBe(true)
    expect(validateBarcode('gs1-128', '0108801234567893').ok).toBe(false)
    expect(validateBarcode('gs1datamatrix', '(01)').ok).toBe(false)
  })

  it('빈 값·너무 긴 값', () => {
    for (const s of SYMBOLOGIES) expect(validateBarcode(s.id, '   ').ok).toBe(false)
    expect(validateBarcode('qrcode', '가'.repeat(1501)).ok).toBe(false)
    expect(validateBarcode('qrcode', '한글도 됩니다').ok).toBe(true)
  })

  it('bwip-js 오류를 사용자 말로', () => {
    expect(explainBwipError(new Error('bwipp.ean13badCheckDigit#6915: Incorrect EAN-13 check digit provided'))).toContain('검사 숫자')
    expect(explainBwipError(new Error("bwipp.GS1aiMissingOpenParen#2949: AIs must start with '('"))).toContain('GS1')
    expect(explainBwipError(new Error('bwipp.upcAbadLength#7461: UPC-A must be 11 or 12 digits'))).toContain('자릿수')
    expect(explainBwipError('???')).toContain('만들 수 없습니다')
  })
})

describe('bwip-js 로 그리기', () => {
  beforeAll(() => setBarcodeLib(bwipjs))

  it('14종 모두 견본 값으로 그려진다', () => {
    expect(SYMBOLOGIES).toHaveLength(14)
    for (const s of SYMBOLOGIES) {
      const r = makeBarcode(s.id, s.sample)
      expect(r.ok, `${s.name}: ${!r.ok && r.message}`).toBe(true)
      if (!r.ok) continue
      expect(r.geometry.w).toBeGreaterThan(0)
      expect(r.geometry.h).toBeGreaterThan(0)
      const cmds = parsePath(r.geometry.d)
      expect(cmds.length).toBeGreaterThan(8)
      // 모든 점이 viewBox 안에 있다
      for (const c of cmds) {
        if (c[0] === 'Z') continue
        expect(c[1]).toBeGreaterThanOrEqual(-0.001)
        expect(c[1]).toBeLessThanOrEqual(r.geometry.w + 0.001)
        expect(c[2]).toBeGreaterThanOrEqual(-0.001)
        expect(c[2]).toBeLessThanOrEqual(r.geometry.h + 0.001)
      }
    }
  })

  it('틀린 값은 예외 없이 안내를 돌려준다', () => {
    for (const [sym, value] of [
      ['ean13', '8801234567890'],
      ['code39', 'abc'],
      ['gs1-128', '(01)123'],
      ['gs1datamatrix', '(99999)1'],
      ['upca', '1'],
      ['qrcode', ''],
    ] as const) {
      const r = makeBarcode(sym, value)
      expect(r.ok, `${sym} ${value}`).toBe(false)
      expect(!r.ok && r.message.length).toBeGreaterThan(5)
    }
  })

  it('한글 QR 과 EAN-13 막대 수', () => {
    expect(makeBarcode('qrcode', '안녕하세요 온비짱').ok).toBe(true)
    const ean = makeBarcode('ean13', '880123456789')
    expect(ean.ok && ean.display).toBe('8801234567893')
    // EAN-13 은 막대 30개(가드 6 + 숫자 12×2) — 사각형 하나가 M 하나
    expect(ean.ok && (ean.geometry.d.match(/M/g) ?? []).length).toBe(30)
    expect(ean.ok && ean.geometry.w).toBe(95)
  })

  it('한글은 UTF-8 바이트로 담긴다(문자 코드 아래 8비트만 쓰면 깨진다)', () => {
    const text = '안녕하세요 온비짱'
    const utf8 = Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join('')
    const low8 = Array.from(text, (c) => String.fromCharCode(c.charCodeAt(0) & 255)).join('')
    const shape = (t: string) => svgToGeometry(bwipjs.toSVG({ bcid: 'qrcode', text: t, binarytext: true, scale: 1, includetext: false, padding: 0 })).d
    for (const id of ['qrcode', 'datamatrix', 'azteccode', 'pdf417'] as const) {
      const r = makeBarcode(id, text)
      expect(r.ok, id).toBe(true)
    }
    const qr = makeBarcode('qrcode', text)
    expect(qr.ok && qr.geometry.d).toBe(shape(utf8))
    expect(qr.ok && qr.geometry.d).not.toBe(shape(low8))
  })

  it('선으로 온 막대를 사각형으로 바꾼다', () => {
    const g = svgToGeometry('<svg viewBox="0 0 10 20" xmlns="http://www.w3.org/2000/svg">\n<path stroke="#000000" stroke-width="2" d="M1 20L1 0M5 20L5 0" />\n<path d="M7 0L9 0L9 2L7 2Z" fill-rule="evenodd" />\n</svg>')
    expect(g).toEqual({ w: 9, h: 20, d: 'M0 0L2 0L2 20L0 20ZM4 0L6 0L6 20L4 20ZM7 0L9 0L9 2L7 2Z' })
    expect(() => svgToGeometry('<svg></svg>')).toThrow()
  })
})
