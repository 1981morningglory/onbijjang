import { describe, expect, it } from 'vitest'
import * as S from '../../../server/lib/mail.mjs'
import { defaultBody, defaultSubject, labelOf, resolveRecipient, splitTokens, type BookEntry } from './mail'
import { emptyKit, newDoc } from './model'

const book: BookEntry[] = [
  { id: 'a1', name: '홍길동', email: 'hong@onbi.kr', org: '영업팀' },
  { id: 'a2', name: '김철수', email: 'kim@onbi.kr', org: '물류팀' },
  { id: 'a3', name: '김철수', email: 'kim2@partner.co.kr', org: '협력사' },
]

describe('받는 사람·참조: 이름 → 주소', () => {
  it('주소록 이름은 주소로, 주소는 그대로, ‘이름 <주소>’ 는 주소만', () => {
    expect(resolveRecipient('홍길동', book)).toEqual({ email: 'hong@onbi.kr' })
    expect(resolveRecipient(' 홍 길동 ', book)).toEqual({ email: 'hong@onbi.kr' })
    expect(resolveRecipient('buyer@client.com', book)).toEqual({ email: 'buyer@client.com' })
    expect(resolveRecipient('홍길동(영업팀) <hong@onbi.kr>', book)).toEqual({ email: 'hong@onbi.kr' })
  })
  it('같은 이름이 여럿이면 소속으로 고른다', () => {
    expect(resolveRecipient('김철수', book)).toHaveProperty('error')
    expect(resolveRecipient('김철수(협력사)', book)).toEqual({ email: 'kim2@partner.co.kr' })
  })
  it('없는 이름·잘못된 주소는 알려 준다', () => {
    expect(resolveRecipient('이영희', book)).toHaveProperty('error')
    expect(resolveRecipient('abc@', book)).toHaveProperty('error')
  })
  it('쉼표·세미콜론·줄바꿈으로 여러 명', () => {
    expect(splitTokens('홍길동, a@b.kr; 김철수(물류팀)\n')).toEqual(['홍길동', 'a@b.kr', '김철수(물류팀)'])
    expect(labelOf('hong@onbi.kr', book)).toBe('홍길동(영업팀) <hong@onbi.kr>')
    expect(labelOf('x@y.kr', book)).toBe('x@y.kr')
  })
})

describe('기본 제목·본문', () => {
  it('회사·거래처·번호가 들어간다', () => {
    const kit = emptyKit()
    kit.company.name = '모닝글로리'
    const doc = { ...newDoc('quote'), customer: '가나상사', docNo: 'Q-20261023-01', title: '노트 납품' }
    const c = { id: 'c1', name: '장현국', title: '과장', phone: '02-000-0000', email: 'jang@onbi.kr', extras: [] }
    expect(defaultSubject(doc, kit)).toBe('[모닝글로리] 견적서 송부 - 가나상사 (Q-20261023-01)')
    const body = defaultBody(doc, kit, c, 110000)
    expect(body).toContain('가나상사 담당자님')
    expect(body).toContain('모닝글로리 장현국 과장입니다.')
    expect(body).toContain('합계 금액: 110,000원')
    expect(body).toContain('메일 jang@onbi.kr')
    expect(body).not.toMatch(/\n{3,}/)
  })
})

describe('서버: 메일 도우미', () => {
  it('도메인으로 메일 서비스를 고른다', () => {
    expect(S.providerFor('a@gmail.com')?.host).toBe('smtp.gmail.com')
    expect(S.providerFor('a@naver.com')?.host).toBe('smtp.naver.com')
    expect(S.providerFor('a@hanmail.net')?.host).toBe('smtp.daum.net')
    expect(S.providerFor('a@company.co.kr')).toBeNull()
  })
  it('받는 사람 정리: 중복 빼고, 잘못된 주소는 따로', () => {
    const r = S.cleanRecipients(['a@b.kr', 'A@B.kr', ' c@d.com ', 'bad', ''])
    expect(r.list).toEqual(['a@b.kr', 'c@d.com'])
    expect(r.bad).toEqual(['bad'])
    expect(S.cleanRecipients(Array.from({ length: 21 }, (_, i) => `u${i}@x.kr`)).over).toBe(true)
  })
  it('SMTP 설정: 465 는 SSL, 아이디가 비면 메일 주소', () => {
    expect(S.cleanAccount({ host: 'smtp.gmail.com', port: 465 }, 'a@gmail.com')).toEqual({ account: { host: 'smtp.gmail.com', port: 465, secure: true, user: 'a@gmail.com' } })
    expect(S.cleanAccount({ host: 'smtp.office365.com', port: '587', user: 'x@y.kr' }).account?.secure).toBe(false)
    expect(S.cleanAccount({ host: 'nohost', port: 465 }).error).toBeTruthy()
    expect(S.cleanAccount({ host: 'smtp.a.kr', port: 0 }).error).toBeTruthy()
  })
  it('비밀번호 암호화: 같은 키로만 풀린다', () => {
    const sealed = S.sealSecret('abcd efgh ijkl', 'k1')
    expect(sealed).not.toContain('abcd')
    expect(S.openSecret(sealed, 'k1')).toBe('abcd efgh ijkl')
    expect(S.openSecret(sealed, 'k2')).toBeNull()
  })
  it('보내는 주소는 로그인 계정(아이디만이면 서비스 도메인)', () => {
    expect(S.senderAddress({ user: 'abc@naver.com', host: 'smtp.naver.com' }, 'jhk@morningglory.co.kr')).toBe('abc@naver.com')
    expect(S.senderAddress({ user: 'abc', host: 'smtp.naver.com' }, 'jhk@morningglory.co.kr')).toBe('abc@naver.com')
    expect(S.senderAddress({ user: 'abc', host: 'mail.company.kr' }, 'jhk@company.kr')).toBe('jhk@company.kr')
  })
  it('보내는 주소 거절(네이버 553)은 비밀번호 오류로 안내하지 않는다', () => {
    const t = S.mailErrorText({ code: 'EENVELOPE', command: 'MAIL FROM', response: '553 5.7.1 Sender address rejected: not owned by auth user.' }, { from: 'jhk@morningglory.co.kr' })
    expect(t).toContain('보내는 주소(jhk@morningglory.co.kr)')
    expect(t).not.toContain('앱 비밀번호')
    expect(t).toContain('553 5.7.1')
    expect(S.mailErrorText({ code: 'EENVELOPE', command: 'RCPT TO', response: '550 5.1.1 no such user' })).toContain('받는 사람 주소')
  })
  it('로그인 실패는 앱 비밀번호 안내로', () => {
    expect(S.mailErrorText({ code: 'EAUTH', response: '535 auth failed' })).toContain('앱 비밀번호')
  })
})

describe('문서 담당자', () => {
  it('고른 담당자만 넣고, 안 골랐으면 비워 둔다(첫 담당자로 대신 채우지 않음)', async () => {
    const { docContact } = await import('./model')
    const kit = { contacts: [{ id: 'c1', name: '장현국', title: '팀장', phone: '', email: '', extras: [] }] }
    expect(docContact({ showContact: true, contactId: null }, kit)).toBeUndefined()
    expect(docContact({ showContact: true, contactId: 'c1' }, kit)?.name).toBe('장현국')
    expect(docContact({ showContact: false, contactId: 'c1' }, kit)).toBeUndefined()
    expect(docContact({ showContact: true, contactId: 'gone' }, kit)).toBeUndefined()
  })
})
