import { describe, expect, it } from 'vitest'
import { cleanAnswers, cleanForm, isOpen, shortCode, toCsv } from '../../../server/lib/forms.mjs'
import { missingRequired, newQuestion, responseRows, summarize, TEMPLATES, type Form } from './logic'

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
