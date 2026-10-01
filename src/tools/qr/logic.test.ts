import qrcode from 'qrcode-generator'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STYLE, EMPTY_CONTENT, MAX_BATCH, batchFileNames, buildOptions, buildPayload, colorWarnings, contrastRatio, densityWarnings, effectiveEcc, emailPayload, lengthProblem,
  normalizePhone, normalizeUrl, parseBatch, rowsToBatchText, smsPayload, toByteString, utf8Length, vcardPayload, wifiPayload,
  type QrContent,
} from './logic'

const content = (patch: Partial<QrContent>): QrContent => ({ ...EMPTY_CONTENT, ...patch })

describe('주소·전화번호 다듬기', () => {
  it('앞부분이 없으면 https:// 를 붙인다', () => {
    expect(normalizeUrl(' naver.com/abc ')).toBe('https://naver.com/abc')
    expect(normalizeUrl('http://a.kr')).toBe('http://a.kr')
    expect(normalizeUrl('HTTPS://a.kr')).toBe('HTTPS://a.kr')
    expect(normalizeUrl('mailto:a@b.kr')).toBe('mailto:a@b.kr')
    expect(normalizeUrl('  ')).toBe('')
  })
  it('전화번호는 숫자와 맨 앞 + 만', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678')
    expect(normalizePhone('+82 10 1234 5678')).toBe('+821012345678')
    expect(normalizePhone('(02) 123.4567')).toBe('021234567')
    expect(normalizePhone('+')).toBe('')
  })
})

describe('Wi-Fi', () => {
  it('기본 형식', () => {
    expect(wifiPayload({ ssid: 'office', password: 'pass1234', security: 'WPA', hidden: false })).toBe('WIFI:T:WPA;S:office;P:pass1234;;')
  })
  it('특수문자는 역슬래시로 감싼다', () => {
    expect(wifiPayload({ ssid: '우리;매장', password: 'a:b,c"d\\e', security: 'WPA', hidden: true })).toBe('WIFI:T:WPA;S:우리\\;매장;P:a\\:b\\,c\\"d\\\\e;H:true;;')
  })
  it('비밀번호 없는 와이파이는 P 를 넣지 않는다', () => {
    expect(wifiPayload({ ssid: 'guest', password: '남은값', security: 'nopass', hidden: false })).toBe('WIFI:T:nopass;S:guest;;')
  })
})

describe('연락처(vCard)', () => {
  it('채운 항목만 넣는다', () => {
    expect(vcardPayload({ ...EMPTY_CONTENT.vcard, name: '홍길동', phone: '010-1234-5678' })).toBe(['BEGIN:VCARD', 'VERSION:3.0', 'N:홍길동;;;;', 'FN:홍길동', 'TEL;TYPE=CELL:01012345678', 'END:VCARD'].join('\n'))
  })
  it('모든 항목과 특수문자', () => {
    const v = vcardPayload({ name: '홍길동', org: '온비, 주식회사', title: '팀장;MD', phone: '+82 10-1234-5678', email: ' hong@onbi.kr ', url: 'onbi.kr', address: '서울시 중구\n세종대로 1', note: '역\\슬래시' })
    expect(v.split('\n')).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:홍길동;;;;',
      'FN:홍길동',
      'ORG:온비\\, 주식회사',
      'TITLE:팀장\\;MD',
      'TEL;TYPE=CELL:+821012345678',
      'EMAIL:hong@onbi.kr',
      'URL:https://onbi.kr',
      'ADR:;;서울시 중구\\n세종대로 1;;;;',
      'NOTE:역\\\\슬래시',
      'END:VCARD',
    ])
  })
})

describe('문자·이메일', () => {
  it('문자', () => {
    expect(smsPayload({ phone: '010-1234-5678', message: '주문 문의드립니다' })).toBe('SMSTO:01012345678:주문 문의드립니다')
  })
  it('이메일은 제목·본문을 주소 형식으로 바꾼다', () => {
    expect(emailPayload({ to: ' a@b.kr ', subject: '', body: '' })).toBe('mailto:a@b.kr')
    expect(emailPayload({ to: 'a@b.kr', subject: '견적 문의', body: 'A&B 1줄\n2줄' })).toBe(`mailto:a@b.kr?subject=${encodeURIComponent('견적 문의')}&body=${encodeURIComponent('A&B 1줄\n2줄')}`)
  })
})

describe('buildPayload', () => {
  it('종류별로 내용을 만든다', () => {
    expect(buildPayload(content({ kind: 'url', url: 'onbi.kr' }))).toEqual({ data: 'https://onbi.kr', problem: null })
    expect(buildPayload(content({ kind: 'text', text: ' 안녕 ' }))).toEqual({ data: ' 안녕 ', problem: null })
    expect(buildPayload(content({ kind: 'tel', tel: '02-123-4567' }))).toEqual({ data: 'tel:021234567', problem: null })
    expect(buildPayload(content({ kind: 'wifi', wifi: { ssid: 'a', password: '', security: 'nopass', hidden: false } })).data).toBe('WIFI:T:nopass;S:a;;')
  })
  it('모자란 입력은 무엇을 채워야 하는지 알려 준다', () => {
    expect(buildPayload(content({ kind: 'url' })).problem).toMatch(/주소/)
    expect(buildPayload(content({ kind: 'wifi' })).problem).toMatch(/와이파이 이름/)
    expect(buildPayload(content({ kind: 'wifi', wifi: { ssid: 'a', password: '', security: 'WPA', hidden: false } })).problem).toMatch(/비밀번호/)
    expect(buildPayload(content({ kind: 'vcard' })).problem).toMatch(/이름/)
    expect(buildPayload(content({ kind: 'vcard', vcard: { ...EMPTY_CONTENT.vcard, name: '홍', email: '틀린메일' } })).problem).toMatch(/이메일/)
    expect(buildPayload(content({ kind: 'tel', tel: '전화' })).problem).toMatch(/전화번호/)
    expect(buildPayload(content({ kind: 'sms' })).problem).toMatch(/전화번호/)
    expect(buildPayload(content({ kind: 'email', email: { to: 'a@b', subject: '', body: '' } })).problem).toMatch(/형식/)
  })
})

describe('한글 바이트 변환', () => {
  it('UTF-8 바이트 하나가 글자 하나가 된다', () => {
    expect(utf8Length('한A')).toBe(4)
    expect([...toByteString('한A')].map((c) => c.charCodeAt(0))).toEqual([237, 149, 156, 65])
    expect(toByteString('https://onbi.kr/?a=1')).toBe('https://onbi.kr/?a=1')
  })
  it('QR 라이브러리의 기본 변환을 거쳐도 올바른 UTF-8 QR 과 칸이 똑같다', () => {
    const text = 'WIFI:T:WPA;S:우리 매장;P:비번1234;;'
    const viaByteString = qrcode(0, 'M')
    viaByteString.addData(toByteString(text), 'Byte')
    viaByteString.make()

    const original = qrcode.stringToBytes
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']
    const reference = qrcode(0, 'M')
    try {
      reference.addData(text, 'Byte')
      reference.make()
    } finally {
      qrcode.stringToBytes = original
    }

    const matrix = (q: ReturnType<typeof qrcode>) => {
      const n = q.getModuleCount()
      let bits = ''
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) bits += q.isDark(r, c) ? '1' : '0'
      return bits
    }
    expect(viaByteString.getModuleCount()).toBe(reference.getModuleCount())
    expect(matrix(viaByteString)).toBe(matrix(reference))

    // 변환 없이 넘기면 다른(깨진) QR 이 된다 — 변환이 꼭 필요하다는 확인
    const broken = qrcode(0, 'M')
    broken.addData(text, 'Byte')
    broken.make()
    expect(matrix(broken)).not.toBe(matrix(reference))
  })
})

describe('모양 옵션', () => {
  it('로고가 있으면 오류 복구 수준을 가장 높게 올린다', () => {
    expect(effectiveEcc('M', false)).toBe('M')
    expect(effectiveEcc('L', true)).toBe('H')
  })
  it('옵션을 라이브러리 형식으로 바꾼다', () => {
    const o = buildOptions('한', { ...DEFAULT_STYLE, dots: 'dots', corner: 'extra-rounded', cornerDot: 'dot', fg: '#0b7a53', marginPct: 5 }, 1024, null, 'png')
    expect(o.type).toBe('canvas')
    expect(o.width).toBe(1024)
    expect(o.margin).toBe(51)
    expect(o.data).toBe(toByteString('한'))
    expect(o.image).toBeUndefined()
    expect(o.qrOptions?.errorCorrectionLevel).toBe('M')
    expect(o.dotsOptions).toEqual({ type: 'dots', color: '#0b7a53' })
    expect(o.cornersSquareOptions).toEqual({ type: 'extra-rounded', color: '#0b7a53' })
    expect(o.cornersDotOptions).toEqual({ type: 'dot', color: '#0b7a53' })
    expect(o.backgroundOptions).toEqual({ color: '#ffffff' })
  })
  it('로고 크기·여백은 범위 안으로, SVG 는 svg 로', () => {
    const o = buildOptions('a', { ...DEFAULT_STYLE, logoSizePct: 90, logoMargin: 6 }, 2048, 'data:image/png;base64,AAAA', 'svg')
    expect(o.type).toBe('svg')
    expect(o.image).toBe('data:image/png;base64,AAAA')
    expect(o.qrOptions?.errorCorrectionLevel).toBe('H')
    expect(o.imageOptions?.imageSize).toBe(0.5)
    expect(o.imageOptions?.margin).toBe(24)
    expect(o.imageOptions?.hideBackgroundDots).toBe(true)
  })
})

describe('인식률 경고', () => {
  it('색 대비', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(colorWarnings('#14201a', '#ffffff')).toEqual([])
    expect(colorWarnings('#ffe55c', '#ffffff').map((w) => w.code)).toEqual(['contrast'])
    expect(colorWarnings('#ffffff', '#14201a').map((w) => w.code)).toEqual(['inverted'])
  })
  it('내용 길이 한도', () => {
    expect(lengthProblem('a'.repeat(2331), 'M')).toBeNull()
    expect(lengthProblem('a'.repeat(2332), 'M')).toMatch(/너무 깁니다/)
    expect(lengthProblem('가'.repeat(425), 'H')).toMatch(/1,275바이트/)
    expect(lengthProblem('가'.repeat(424), 'H')).toBeNull()
  })
  it('점이 촘촘하거나 너무 작으면 알린다', () => {
    expect(densityWarnings(25, 512, 4)).toEqual([])
    expect(densityWarnings(57, 1024, 4).map((w) => w.code)).toEqual(['dense'])
    expect(densityWarnings(177, 512, 4).map((w) => w.code)).toEqual(['dense', 'tiny-dots'])
  })
})

describe('일괄 생성 표', () => {
  it('탭·쉼표 구분, 머리글 건너뛰기, 한 칸은 내용으로', () => {
    const t = parseBatch('이름\t내용\n매장A\thttps://a.kr\n매장B,https://b.kr/?x=1,2\n\nhttps://c.kr/?a=1,2\n메모만')
    expect(t.overflow).toBe(0)
    expect(t.rows).toEqual([
      { line: 2, name: '매장A', content: 'https://a.kr', problem: null },
      { line: 3, name: '매장B', content: 'https://b.kr/?x=1,2', problem: null },
      { line: 5, name: 'QR_003', content: 'https://c.kr/?a=1,2', problem: null },
      { line: 6, name: 'QR_004', content: '메모만', problem: null },
    ])
  })
  it('내용이 빈 줄과 이름이 빈 줄', () => {
    const t = parseBatch('매장A\t\n\thttps://b.kr')
    expect(t.rows[0]).toEqual({ line: 1, name: '매장A', content: '', problem: '내용이 비어 있습니다' })
    expect(t.rows[1]).toEqual({ line: 2, name: 'QR_002', content: 'https://b.kr', problem: null })
  })
  it('최대 개수를 넘는 줄은 센다', () => {
    const text = Array.from({ length: MAX_BATCH + 7 }, (_, i) => `이름${i}\thttps://a.kr/${i}`).join('\n')
    const t = parseBatch(text)
    expect(t.rows).toHaveLength(MAX_BATCH)
    expect(t.overflow).toBe(7)
  })
  it('xlsx 행을 글로 바꾼다', () => {
    expect(rowsToBatchText([['매장A', 'https://a.kr', '무시'], [], ['매장B', 123]])).toBe('매장A\thttps://a.kr\n매장B\t123')
  })
  it('파일 이름은 금지 문자를 빼고 겹치지 않게', () => {
    const t = parseBatch('매장/1호\ta\n매장1호\tb\n빈내용\t\n???\tc')
    expect(batchFileNames(t.rows, 'png').map((x) => x.filename)).toEqual(['매장1호.png', '매장1호 (2).png', 'QR.png'])
  })
})
