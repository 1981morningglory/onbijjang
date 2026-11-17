// 설문폼 — 설문 정리·응답 검사·CSV 만들기(서버 라우트 server/routes/forms.mjs 와 시험이 함께 쓴다)

export const TYPES = ['short', 'long', 'radio', 'checkbox', 'select', 'scale', 'date', 'time', 'section']
export const CHOICE_TYPES = ['radio', 'checkbox', 'select']
export const LIMITS = { questions: 200, options: 60, title: 200, desc: 2000, option: 200, answer: 5000 }

const str = (v, n) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, n) : '')
const qid = () => Math.random().toString(36).slice(2, 10)

/** 질문 하나 정리(모르는 값은 버리고 길이를 자른다) */
export function cleanQuestion(q) {
  const type = TYPES.includes(q?.type) ? q.type : 'short'
  const out = { id: /^[a-z0-9]{4,16}$/.test(q?.id ?? '') ? q.id : qid(), type, title: str(q?.title, LIMITS.title), desc: str(q?.desc, LIMITS.desc), required: type !== 'section' && Boolean(q?.required) }
  if (CHOICE_TYPES.includes(type)) {
    const opts = [...new Set((Array.isArray(q?.options) ? q.options : []).map((o) => str(o, LIMITS.option)).filter(Boolean))].slice(0, LIMITS.options)
    out.options = opts.length ? opts : ['옵션 1']
    if (type !== 'select') out.other = Boolean(q?.other)
  }
  if (type === 'scale') {
    const min = q?.scale?.min === 0 ? 0 : 1
    const max = Math.max(min + 1, Math.min(10, Math.round(Number(q?.scale?.max) || 5)))
    out.scale = { min, max, minLabel: str(q?.scale?.minLabel, 40), maxLabel: str(q?.scale?.maxLabel, 40) }
  }
  if (type === 'short') out.format = ['text', 'email', 'phone', 'number'].includes(q?.format) ? q.format : 'text'
  return out
}

/** 설문 전체 정리 */
export function cleanForm(f) {
  const questions = (Array.isArray(f?.questions) ? f.questions : []).slice(0, LIMITS.questions).map(cleanQuestion)
  // 같은 ID 가 겹치면 새로
  const seen = new Set()
  for (const q of questions) {
    while (seen.has(q.id)) q.id = qid()
    seen.add(q.id)
  }
  const s = f?.settings ?? {}
  const closeAt = typeof s.closeAt === 'string' && !Number.isNaN(Date.parse(s.closeAt)) ? new Date(s.closeAt).toISOString() : null
  return {
    title: str(f?.title, LIMITS.title) || '제목 없는 설문',
    description: str(f?.description, LIMITS.desc),
    questions,
    settings: {
      open: s.open !== false,
      closeAt,
      oneResponse: Boolean(s.oneResponse),
      thanks: str(s.thanks, 500) || '응답해 주셔서 감사합니다.',
      linkType: s.linkType === 'full' ? 'full' : 'short',
    },
  }
}

/** 지금 응답을 받는가 */
export const isOpen = (form, now = Date.now()) => form.settings.open && (!form.settings.closeAt || Date.parse(form.settings.closeAt) > now)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^[0-9+\-()\s]{7,20}$/

/** 응답 검사: { answers } 또는 { error } — 질문에 없는 값·보기에 없는 값은 버리거나 거절 */
export function cleanAnswers(form, raw) {
  const answers = {}
  const src = raw && typeof raw === 'object' ? raw : {}
  for (const q of form.questions) {
    if (q.type === 'section') continue
    const v = src[q.id]
    const label = q.title || '이름 없는 질문'
    let a = null
    if (q.type === 'checkbox') {
      const list = (Array.isArray(v) ? v : []).map((x) => str(x, LIMITS.option)).filter(Boolean)
      const ok = list.filter((x) => q.options.includes(x) || (q.other && x.startsWith('기타: ')))
      if (ok.length !== list.length) return { error: `‘${label}’의 보기가 올바르지 않습니다.` }
      a = ok.length ? [...new Set(ok)] : null
    } else if (CHOICE_TYPES.includes(q.type)) {
      const x = str(v, LIMITS.option)
      if (x && !(q.options.includes(x) || (q.other && x.startsWith('기타: ')))) return { error: `‘${label}’의 보기가 올바르지 않습니다.` }
      a = x || null
    } else if (q.type === 'scale') {
      if (v !== undefined && v !== null && v !== '') {
        const n = Number(v)
        if (!Number.isInteger(n) || n < q.scale.min || n > q.scale.max) return { error: `‘${label}’의 점수가 올바르지 않습니다.` }
        a = n
      }
    } else if (q.type === 'date') {
      const x = str(v, 10)
      if (x && !/^\d{4}-\d{2}-\d{2}$/.test(x)) return { error: `‘${label}’의 날짜가 올바르지 않습니다.` }
      a = x || null
    } else if (q.type === 'time') {
      const x = str(v, 5)
      if (x && !/^\d{2}:\d{2}$/.test(x)) return { error: `‘${label}’의 시간이 올바르지 않습니다.` }
      a = x || null
    } else {
      const x = str(v, q.type === 'long' ? LIMITS.answer : 500)
      if (x && q.format === 'email' && !EMAIL.test(x)) return { error: `‘${label}’에 이메일 주소를 바르게 적어 주세요.` }
      if (x && q.format === 'phone' && !PHONE.test(x)) return { error: `‘${label}’에 전화번호를 바르게 적어 주세요.` }
      if (x && q.format === 'number' && !/^-?\d+(\.\d+)?$/.test(x)) return { error: `‘${label}’에 숫자만 적어 주세요.` }
      a = x || null
    }
    if (q.required && (a === null || (Array.isArray(a) && !a.length))) return { error: `‘${label}’은(는) 꼭 답해야 하는 질문입니다.` }
    if (a !== null) answers[q.id] = a
  }
  return { answers }
}

/** 답 하나를 표·CSV 칸 글자로 */
export const answerText = (a) => (a === null || a === undefined ? '' : Array.isArray(a) ? a.join(', ') : String(a))

/** 응답 → 표(머리글 + 줄). 날짜는 한국 시간 */
export function responseTable(form, responses) {
  const qs = form.questions.filter((q) => q.type !== 'section')
  const head = ['번호', '제출 시각', ...qs.map((q) => q.title || '이름 없는 질문')]
  const kst = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')
  const rows = responses.map((r, i) => [i + 1, kst(r.at), ...qs.map((q) => answerText(r.answers?.[q.id]))])
  return { head, rows }
}

/** CSV(엑셀에서 한글이 깨지지 않게 BOM 포함) */
export function toCsv(form, responses) {
  const { head, rows } = responseTable(form, responses)
  const cell = (v) => {
    const s = String(v ?? '')
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return `﻿${[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`
}

/** 짧은 주소 코드(6글자, 헷갈리는 글자 뺌) */
export function shortCode() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)]
  return s
}
