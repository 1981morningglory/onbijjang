import { describe, expect, it } from 'vitest'
import { cleanAnswers, cleanForm, findDuplicate, isOpen, normKey, shortCode, toCsv } from '../../../server/lib/forms.mjs'
import { DEFAULT_SETTINGS, isNameQuestion, missingRequired, newQuestion, phoneQuestion, responseRows, summarize, TEMPLATES, withPhoneDedupe, type Form } from './logic'

const make = (): Form => ({ id: 'x', ...cleanForm(TEMPLATES.find((t) => t.key === 'event')!.make()) })

describe('설문 정리', () => {
  it('템플릿 5개(빈 설문 포함), 모두 서버 정리를 통과', () => {
    expect(TEMPLATES.length).toBe(5)
    for (const t of TEMPLATES) {
      const f = cleanForm(t.make())
      expect(f.questions.length).toBeGreaterThan(0)
      expect(f.settings.linkType).toBe('short')
    }
  })
  it('모르는 종류·빈 제목·겹친 ID·빈 보기를 정리', () => {
    const f = cleanForm({ title: '  ', questions: [{ id: 'aaaa', type: '이상', title: 'a' }, { id: 'aaaa', type: 'radio', title: 'b', options: ['', ' '] }, { type: 'scale', title: 'c', scale: { min: 1, max: 99 } }] })
    expect(f.title).toBe('제목 없는 설문')
    expect(f.questions[0].type).toBe('short')
    expect(f.questions[1].id).not.toBe('aaaa')
    expect(f.questions[1].options).toEqual(['옵션 1'])
    expect(f.questions[2].scale?.max).toBe(10)
  })
  it('마감 시각이 지나면 응답을 받지 않는다', () => {
    const f = cleanForm({ title: 'a', questions: [], settings: { closeAt: '2026-01-01T00:00:00Z' } })
    expect(isOpen(f, Date.parse('2025-12-31T00:00:00Z'))).toBe(true)
    expect(isOpen(f, Date.parse('2026-01-02T00:00:00Z'))).toBe(false)
    expect(isOpen(cleanForm({ title: 'a', questions: [], settings: { open: false } }))).toBe(false)
  })
})

describe('응답 검사', () => {
  const f = make()
  const id = (title: string) => f.questions.find((q) => q.title === title)!.id
  const ok = { [id('이름')]: '김온비', [id('연락처')]: '010-1234-5678', [id('참가 인원')]: '2명', [id('참석 희망 날짜')]: '2026-12-01' }
  it('정상 응답', () => {
    const r = cleanAnswers(f, { ...ok, [id('행사를 어떻게 알게 되셨나요?')]: '기타: 현수막', 모르는질문: 'x' })
    expect(r.error).toBeUndefined()
    expect(r.answers?.[id('이름')]).toBe('김온비')
    expect(r.answers?.모르는질문).toBeUndefined()
  })
  it('필수 빈칸·형식 틀림·보기에 없는 값은 거절', () => {
    expect(cleanAnswers(f, { ...ok, [id('이름')]: '' }).error).toContain('꼭 답해야')
    expect(cleanAnswers(f, { ...ok, [id('연락처')]: '전화번호아님' }).error).toContain('전화번호')
    expect(cleanAnswers(f, { ...ok, [id('이메일')]: 'abc' }).error).toContain('이메일')
    expect(cleanAnswers(f, { ...ok, [id('참가 인원')]: '100명' }).error).toContain('보기')
    expect(cleanAnswers(f, { ...ok, [id('참석 희망 날짜')]: '내일' }).error).toContain('날짜')
  })
  it('점수 범위', () => {
    const s = cleanForm(TEMPLATES[1].make())
    const q = s.questions[0]
    expect(cleanAnswers(s, { [q.id]: 9, [s.questions[2].id]: '예' }).error).toBeTruthy()
  })
  it('화면에서도 필수 빈칸을 먼저 찾는다', () => {
    expect(missingRequired(f, {})?.title).toBe('이름')
    expect(missingRequired(f, ok)).toBeNull()
  })
})

describe('결과', () => {
  const f = make()
  const name = f.questions[0].id
  const how = f.questions.find((q) => q.title === '행사를 어떻게 알게 되셨나요?')!.id
  const responses = [
    { id: 'a', at: '2026-11-17T01:00:00Z', answers: { [name]: '김, "온비"', [how]: '인스타그램' } },
    { id: 'b', at: '2026-11-17T02:00:00Z', answers: { [name]: '박', [how]: '기타: 현수막' } },
  ]
  it('CSV: BOM·한국 시간·쉼표·따옴표 처리', () => {
    const csv = toCsv(f, responses)
    expect(csv.startsWith('﻿번호,제출 시각,이름')).toBe(true)
    expect(csv).toContain('2026-11-17 10:00:00')
    expect(csv).toContain('"김, ""온비"""')
  })
  it('요약: 보기별 개수와 기타 글', () => {
    const s = summarize(f, responses).find((x) => x.q.id === how)!
    expect(s.counts?.find((c) => c.label === '인스타그램')?.n).toBe(1)
    expect(s.counts?.find((c) => c.label === '기타')?.n).toBe(1)
    expect(s.texts).toEqual(['현수막'])
  })
  it('표: 머리글·줄', () => {
    const { head, rows } = responseRows(f, responses)
    expect(head.slice(0, 3)).toEqual(['번호', '제출 시각', '이름'])
    expect(rows[1][2]).toBe('박')
  })
  it('짧은 주소 코드는 6글자', () => {
    expect(shortCode()).toMatch(/^[a-z0-9]{6}$/)
    expect(newQuestion('scale').scale?.max).toBe(5)
  })
})

describe('사진·순위', () => {
  it('서버에 올린 사진 주소만 남긴다', () => {
    const f = cleanForm({ title: 'a', headerImage: 'https://evil/x.png', questions: [{ type: 'radio', title: 'q', image: '/api/forms/img/0123456789abcdef0123.jpg', options: ['A', 'B'], optionImages: ['/api/forms/img/aaaaaaaaaaaaaaaa.png', 'javascript:x'] }] })
    expect(f.headerImage).toBe('')
    expect(f.questions[0].image).toBe('/api/forms/img/0123456789abcdef0123.jpg')
    expect(f.questions[0].optionImages).toEqual(['/api/forms/img/aaaaaaaaaaaaaaaa.png', ''])
  })
  const f = cleanForm({ title: 'a', questions: [{ type: 'rank', title: '좋아하는 순서', required: true, options: ['A', 'B', 'C', 'D'], rankLimit: 2 }] })
  const q = f.questions[0]
  it('순위: 정한 개수까지, 서로 다른 보기만', () => {
    expect(q.rankLimit).toBe(2)
    expect(cleanAnswers(f, { [q.id]: ['C', 'A'] }).answers?.[q.id]).toEqual(['C', 'A'])
    expect(cleanAnswers(f, { [q.id]: ['A', 'A'] }).error).toContain('순위')
    expect(cleanAnswers(f, { [q.id]: ['A', 'B', 'C'] }).error).toContain('순위')
    expect(cleanAnswers(f, { [q.id]: ['A'] }).error).toContain('2위까지')
    expect(missingRequired(f, { [q.id]: ['A'] })?.id).toBe(q.id)
  })
  it('순위 요약: 점수(1위=2점, 2위=1점)·1위 수·평균 순위, CSV 는 ‘1. C / 2. A’', () => {
    const responses = [
      { id: '1', at: '2026-11-17T00:00:00Z', answers: { [q.id]: ['C', 'A'] } },
      { id: '2', at: '2026-11-17T00:01:00Z', answers: { [q.id]: ['C', 'B'] } },
      { id: '3', at: '2026-11-17T00:02:00Z', answers: { [q.id]: ['A', 'C'] } },
    ]
    const r = summarize({ id: 'x', ...f }, responses).find((x) => x.q.id === q.id)!.ranks!
    expect(r[0]).toMatchObject({ label: 'C', points: 5, first: 2, avg: 1.33, n: 3 })
    expect(r.find((x) => x.label === 'D')).toMatchObject({ points: 0, n: 0, avg: null })
    expect(toCsv(f, responses)).toContain('1. C / 2. A')
  })
})

describe('중복 응답 막기', () => {
  const base = cleanForm({
    title: 'a',
    questions: [
      { id: 'name1', type: 'short', title: '성명' },
      { id: 'phone1', type: 'short', title: '핸드폰번호', format: 'phone' },
      { id: 'memo1', type: 'long', title: '메모' },
    ],
  })
  const prev = [{ answers: { name1: '김 온비', phone1: '010-1234-5678' }, ip: 'iphash1' }]
  const withD = (dedupe: object) => ({ ...base, settings: { ...base.settings, dedupe: cleanForm({ ...base, settings: { dedupe } }).settings.dedupe } })
  it('전화번호·이름 비교용 정리', () => {
    expect(normKey('+82 10-1234-5678')).toBe('01012345678')
    expect(normKey(' 김 온비 ')).toBe('김온비')
  })
  it('IP: 같은 IP 면 막는다', () => {
    const f = withD({ ip: true })
    expect(findDuplicate(f, prev, { name1: '박' }, 'iphash1')).toContain('IP')
    expect(findDuplicate(f, prev, { name1: '박' }, 'iphash2')).toBeNull()
  })
  it('하나라도 같으면: 번호 표기가 달라도 같은 번호', () => {
    const f = withD({ fields: ['name1', 'phone1'], mode: 'any' })
    expect(findDuplicate(f, prev, { name1: '박응답', phone1: '01012345678' })).toContain('핸드폰번호')
    expect(findDuplicate(f, prev, { name1: '김온비', phone1: '010-0000-0000' })).toContain('성명')
    expect(findDuplicate(f, prev, { name1: '박응답', phone1: '010-0000-0000' })).toBeNull()
  })
  it('모두 같으면(조합): 이름+번호가 둘 다 같을 때만', () => {
    const f = withD({ fields: ['name1', 'phone1'], mode: 'all' })
    expect(findDuplicate(f, prev, { name1: '김온비', phone1: '+82 10 1234 5678' })).toContain('성명·핸드폰번호')
    expect(findDuplicate(f, prev, { name1: '김온비', phone1: '010-0000-0000' })).toBeNull()
  })
  it('장문형·없는 질문은 기준으로 고를 수 없다', () => {
    expect(withD({ fields: ['memo1', 'ghost'] }).settings.dedupe?.fields).toEqual([])
  })
})

describe('기본값: 한 사람 한 번만·핸드폰번호 중복 막기', () => {
  it('한 사람 한 번만은 기본으로 켜짐(끈 값을 저장한 설문만 끔)', () => {
    expect(DEFAULT_SETTINGS.oneResponse).toBe(true)
    expect(cleanForm({ title: 'a', questions: [] }).settings.oneResponse).toBe(true)
    expect(cleanForm({ title: 'a', questions: [], settings: { oneResponse: false } }).settings.oneResponse).toBe(false)
  })
  it('핸드폰번호 질문이 있으면 그 질문으로 막기(성명은 넣지 않음)', () => {
    const ev = TEMPLATES.find((t) => t.key === 'event')!.make()
    const s = withPhoneDedupe({ ...DEFAULT_SETTINGS }, ev.questions)
    const phone = phoneQuestion(ev.questions)!
    expect(phone.title).toBe('연락처')
    expect(s.dedupe).toEqual({ ip: false, fields: [phone.id], mode: 'any' })
    expect(isNameQuestion({ title: '이름' })).toBe(true)
  })
  it('핸드폰 질문이 없거나 이미 고른 기준이 있으면 그대로', () => {
    const sat = TEMPLATES.find((t) => t.key === 'satisfaction')!.make()
    expect(withPhoneDedupe({ ...DEFAULT_SETTINGS }, sat.questions).dedupe?.fields).toEqual([])
    const ev = TEMPLATES.find((t) => t.key === 'event')!.make()
    const mine = { ...DEFAULT_SETTINGS, dedupe: { ip: true, fields: [ev.questions[0].id], mode: 'all' as const } }
    expect(withPhoneDedupe(mine, ev.questions)).toBe(mine)
  })
})
