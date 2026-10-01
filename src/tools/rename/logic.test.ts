import { describe, expect, it } from 'vitest'
import {
  checkName, computeRenames, createRule, dateStamp, moveItem, naturalCompare, normalizeRules, padNumber, parseMapping, rowsToMappingText, splitName, toChangeCsv,
  type AffixRule, type DateRule, type FileInfo, type MappingRule, type ReplaceRule, type Rule, type SequenceRule,
} from './logic'

const PRESET = { base: '상품', start: 1, digits: 3 }
const NOW = new Date(2026, 9, 1, 12, 0, 0).getTime() // 2026-10-01
const MODIFIED = new Date(2025, 0, 5, 9, 0, 0).getTime() // 2025-01-05

const files = (...names: string[]): FileInfo[] => names.map((name) => ({ name, lastModified: MODIFIED }))
const seq = (patch: Partial<SequenceRule> = {}) => ({ ...createRule('sequence', 's', PRESET), ...patch }) as SequenceRule
const rep = (patch: Partial<ReplaceRule> = {}) => ({ ...createRule('replace', 'r', PRESET), ...patch }) as ReplaceRule
const affix = (patch: Partial<AffixRule> = {}) => ({ ...createRule('affix', 'a', PRESET), ...patch }) as AffixRule
const date = (patch: Partial<DateRule> = {}) => ({ ...createRule('date', 'd', PRESET), ...patch }) as DateRule
const mapping = (text: string) => ({ ...createRule('mapping', 'm', PRESET), text }) as MappingRule
const names = (list: FileInfo[], rules: Rule[]) => computeRenames(list, rules, NOW).rows.map((r) => r.next)

describe('이름 도우미', () => {
  it('확장자를 나눈다', () => {
    expect(splitName('사진.JPG')).toEqual({ stem: '사진', ext: 'JPG' })
    expect(splitName('a.b.tar.gz')).toEqual({ stem: 'a.b.tar', ext: 'gz' })
    expect(splitName('.gitignore')).toEqual({ stem: '.gitignore', ext: '' })
    expect(splitName('이름만')).toEqual({ stem: '이름만', ext: '' })
    expect(splitName('끝점.')).toEqual({ stem: '끝점.', ext: '' })
  })
  it('번호 자릿수와 날짜', () => {
    expect(padNumber(7, 3)).toBe('007')
    expect(padNumber(1234, 3)).toBe('1234')
    expect(padNumber(5, 0)).toBe('5')
    expect(dateStamp(NOW)).toBe('20261001')
    expect(dateStamp(Number.NaN)).toBe('')
  })
  it('숫자를 숫자로 비교해 정렬한다', () => {
    expect(['사진10.jpg', '사진2.jpg', '사진1.jpg'].sort(naturalCompare)).toEqual(['사진1.jpg', '사진2.jpg', '사진10.jpg'])
  })
  it('항목 옮기기', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c'])
  })
})

describe('① 공통 이름 + 순번', () => {
  it('팀 기본값으로 이름을 만든다(확장자는 그대로)', () => {
    expect(names(files('IMG_1.JPG', 'IMG_2.png', '메모'), [seq()])).toEqual(['상품_001.JPG', '상품_002.png', '상품_003'])
  })
  it('시작 번호·자릿수·구분자', () => {
    expect(names(files('a.jpg', 'b.jpg'), [seq({ base: '신상', start: 9, digits: 2, separator: '-' })])).toEqual(['신상-09.jpg', '신상-10.jpg'])
    expect(names(files('a.jpg'), [seq({ base: '', start: 5, digits: 4 })])).toEqual(['0005.jpg'])
  })
  it('지금 이름 앞·뒤에 번호만 붙인다', () => {
    expect(names(files('가.jpg', '나.jpg'), [seq({ placement: 'suffix' })])).toEqual(['가_001.jpg', '나_002.jpg'])
    expect(names(files('가.jpg', '나.jpg'), [seq({ placement: 'prefix', separator: ' ' })])).toEqual(['001 가.jpg', '002 나.jpg'])
  })
})

describe('② 찾아 바꾸기', () => {
  it('일반 문자는 대소문자를 가리지 않는 것이 기본', () => {
    expect(names(files('IMG_001.jpg', 'img_002.jpg'), [rep({ find: 'img', replace: '사진' })])).toEqual(['사진_001.jpg', '사진_002.jpg'])
  })
  it('대소문자 구분', () => {
    expect(names(files('IMG_001.jpg', 'img_002.jpg'), [rep({ find: 'img', replace: '사진', caseSensitive: true })])).toEqual(['IMG_001.jpg', '사진_002.jpg'])
  })
  it('일반 문자 모드에서는 특수문자와 $ 를 글자 그대로 다룬다', () => {
    expect(names(files('a(1).jpg'), [rep({ find: '(1)', replace: '$&$1' })])).toEqual(['a$&$1.jpg'])
    expect(names(files('a.b.jpg'), [rep({ find: '.', replace: '_' })])).toEqual(['a_b.jpg'])
  })
  it('정규식과 묶음 참조', () => {
    expect(names(files('2024-03-15 회의.txt'), [rep({ find: '(\\d{4})-(\\d{2})-(\\d{2})', replace: '$1$2$3', regex: true })])).toEqual(['20240315 회의.txt'])
    expect(names(files('사진   여러  공백.png'), [rep({ find: '\\s+', replace: '_', regex: true })])).toEqual(['사진_여러_공백.png'])
  })
  it('잘못된 정규식은 오류를 알리고 건너뛴다', () => {
    const out = computeRenames(files('a.jpg'), [rep({ find: '(', replace: 'x', regex: true })], NOW)
    expect(out.rows[0].next).toBe('a.jpg')
    expect(out.ruleErrors.r).toMatch(/정규식/)
  })
  it('찾을 말이 비어 있으면 아무것도 하지 않는다', () => {
    expect(names(files('a.jpg'), [rep({ find: '', replace: 'x' })])).toEqual(['a.jpg'])
  })
  it('확장자는 바꾸지 않는다', () => {
    expect(names(files('jpg모음.jpg'), [rep({ find: 'jpg', replace: 'png' })])).toEqual(['png모음.jpg'])
  })
})

describe('③ 앞·뒤에 붙이기 / ④ 날짜 넣기', () => {
  it('앞·뒤', () => {
    expect(names(files('상세.png'), [affix({ prefix: '[신상] ', suffix: '_최종' })])).toEqual(['[신상] 상세_최종.png'])
  })
  it('오늘 날짜와 파일 수정일', () => {
    expect(names(files('상세.png'), [date()])).toEqual(['20261001_상세.png'])
    expect(names(files('상세.png'), [date({ source: 'modified', position: 'suffix', separator: '-' })])).toEqual(['상세-20250105.png'])
  })
})

describe('⑤ 엑셀 매핑', () => {
  it('탭·쉼표 구분을 읽고 빈 줄과 모자란 줄을 센다', () => {
    expect(parseMapping('a.jpg\t사과\n\nb.jpg,바나나\n한칸만\n\t빈앞칸')).toEqual({ pairs: [['a.jpg', '사과'], ['b.jpg', '바나나']], skipped: 2 })
  })
  it('xlsx 행을 매핑 글로 바꾼다', () => {
    expect(rowsToMappingText([['a.jpg', '사과', '무시'], [], [null, null], ['b', 12]])).toBe('a.jpg\t사과\nb\t12')
  })
  it('확장자가 있든 없든, 대소문자가 달라도 맞춘다', () => {
    const out = computeRenames(files('IMG_1.JPG', 'img_2.jpg', '남는파일.png'), [mapping('img_1.jpg\t사과\nIMG_2\t바나나.jpg\n없는파일\t포도')], NOW)
    expect(out.rows.map((r) => r.next)).toEqual(['사과.JPG', '바나나.jpg', '남는파일.png'])
    expect(out.rows[2].issues).toEqual([{ code: 'unmatched', level: 'warn', message: '매핑 목록에 없는 파일입니다' }])
    expect(out.mapping.m).toEqual({ total: 3, skipped: 0, unused: ['없는파일'], unmatchedFiles: 1 })
    expect(out.warnCount).toBe(1)
    expect(out.errorCount).toBe(0)
  })
  it('매핑은 앞 규칙이 바꾼 이름이 아니라 원래 이름으로 찾는다', () => {
    expect(names(files('a.jpg'), [affix({ prefix: 'x_' }), mapping('a.jpg\t사과')])).toEqual(['사과.jpg'])
  })
})

describe('규칙 조합', () => {
  it('위에서부터 차례로 적용한다', () => {
    const rules: Rule[] = [rep({ find: 'IMG_', replace: '' }), affix({ prefix: '봄_' }), date({ position: 'suffix' }), seq({ placement: 'suffix', digits: 2 })]
    expect(names(files('IMG_a.jpg', 'IMG_b.jpg'), rules)).toEqual(['봄_a_20261001_01.jpg', '봄_b_20261001_02.jpg'])
  })
  it('순서를 바꾸면 결과가 달라진다', () => {
    expect(names(files('a.jpg'), [affix({ suffix: '_끝' }), seq()])).toEqual(['상품_001.jpg'])
    expect(names(files('a.jpg'), [seq(), affix({ suffix: '_끝' })])).toEqual(['상품_001_끝.jpg'])
  })
  it('꺼 둔 규칙은 건너뛴다', () => {
    expect(names(files('a.jpg'), [seq({ enabled: false })])).toEqual(['a.jpg'])
  })
  it('바뀐 개수를 센다', () => {
    const out = computeRenames(files('a.jpg', 'b.jpg'), [rep({ find: 'a', replace: 'z' })], NOW)
    expect(out.changedCount).toBe(1)
    expect(out.rows.map((r) => r.changed)).toEqual([true, false])
  })
})

describe('중복·금지 문자 검사', () => {
  it('금지 문자, 예약 이름, 끝의 점·공백, 빈 이름', () => {
    expect(checkName('보고서.pdf')).toEqual([])
    expect(checkName('a:b?.txt').map((i) => i.code)).toEqual(['illegal'])
    expect(checkName('a:b?.txt')[0].message).toBe('쓸 수 없는 문자 : ?')
    expect(checkName('CON.txt').map((i) => i.code)).toEqual(['reserved'])
    expect(checkName('com1').map((i) => i.code)).toEqual(['reserved'])
    expect(checkName('console.txt')).toEqual([])
    expect(checkName('이름 .txt').map((i) => i.code)).toEqual(['edge'])
    expect(checkName('이름.').map((i) => i.code)).toEqual(['edge'])
    expect(checkName(' 이름.txt').map((i) => i.code)).toEqual(['edge'])
    expect(checkName('.txt2').map((i) => i.code)).toEqual([])
    expect(checkName('   ').map((i) => i.code)).toEqual(['empty'])
    expect(checkName(`${'가'.repeat(260)}.txt`).map((i) => i.code)).toEqual(['long'])
  })
  it('대소문자만 다른 이름도 중복으로 본다', () => {
    const out = computeRenames(files('a.jpg', 'b.jpg', 'c.png'), [rep({ find: '[ab]', replace: 'X', regex: true })], NOW)
    expect(out.rows[0].issues.map((i) => i.code)).toEqual(['duplicate'])
    expect(out.rows[1].issues[0].message).toBe('같은 이름이 2개입니다')
    expect(out.rows[2].issues).toEqual([])
    expect(out.errorCount).toBe(2)
    const mixed = computeRenames(files('A.JPG', 'a.jpg'), [], NOW)
    expect(mixed.errorCount).toBe(2)
  })
  it('규칙이 금지 문자를 만들면 알려 준다', () => {
    const out = computeRenames(files('a.jpg'), [affix({ prefix: '신상/' })], NOW)
    expect(out.rows[0].issues.map((i) => i.code)).toEqual(['illegal'])
    expect(out.errorCount).toBe(1)
  })
})

describe('저장해 둔 규칙 읽기', () => {
  it('알 수 없는 항목은 버리고 빠진 값은 채운다', () => {
    const rules = normalizeRules([{ id: 'x', type: 'sequence', base: '신상' }, { id: 'y', type: '없는규칙' }, null, { type: 'affix' }, { id: 'z', type: 'replace', enabled: false }], PRESET)
    expect(rules).toEqual([
      { id: 'x', enabled: true, type: 'sequence', placement: 'replace', base: '신상', start: 1, digits: 3, separator: '_' },
      { id: 'z', enabled: false, type: 'replace', find: '', replace: '', regex: false, caseSensitive: false },
    ])
    expect(normalizeRules('엉뚱한 값', PRESET)).toBeNull()
  })
})

describe('변경 내역 CSV', () => {
  it('머리글과 상태를 쓰고 쉼표·따옴표를 감싼다', () => {
    const out = computeRenames(files('a,1.jpg', 'b"2.jpg', 'c.jpg'), [rep({ find: 'c', replace: 'd' })], NOW)
    expect(toChangeCsv(out.rows).split('\r\n')).toEqual([
      '번호,원래 이름,새 이름,상태',
      '1,"a,1.jpg","a,1.jpg",그대로',
      '2,"b""2.jpg","b""2.jpg","쓸 수 없는 문자 """',
      '3,c.jpg,d.jpg,변경',
    ])
  })
})
