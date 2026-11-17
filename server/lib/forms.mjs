// 설문폼 — 설문 정리·응답 검사·CSV 만들기(서버 라우트 server/routes/forms.mjs 와 시험이 함께 쓴다)

export const TYPES = ['short', 'long', 'radio', 'checkbox', 'select', 'rank', 'scale', 'date', 'time', 'section']
/** 보기가 있는 종류 */
export const OPTION_TYPES = ['radio', 'checkbox', 'select', 'rank']
export const CHOICE_TYPES = ['radio', 'checkbox', 'select']
export const LIMITS = { questions: 200, options: 60, title: 200, desc: 2000, option: 200, answer: 5000 }

const str = (v, n) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, n) : '')
const qid = () => Math.random().toString(36).slice(2, 10)
/** 서버에 올린 설문 사진 주소만 받는다 */
export const IMAGE_URL = /^\/api\/forms\/img\/[a-f0-9]{16,64}\.(jpg|png|webp|gif)$/
const img = (v) => (typeof v === 'string' && IMAGE_URL.test(v) ? v : '')

/** 질문 하나 정리(모르는 값은 버리고 길이를 자른다) */
export function cleanQuestion(q) {
  const type = TYPES.includes(q?.type) ? q.type : 'short'
  const out = { id: /^[a-z0-9]{4,16}$/.test(q?.id ?? '') ? q.id : qid(), type, title: str(q?.title, LIMITS.title), desc: str(q?.desc, LIMITS.desc), required: type !== 'section' && Boolean(q?.required) }
  if (img(q?.image)) out.image = img(q.image)
  if (OPTION_TYPES.includes(type)) {
    // 보기와 보기 사진을 함께 정리(빈 보기·겹친 보기는 뺀다)
    const raw = Array.isArray(q?.options) ? q.options : []
    const imgs = Array.isArray(q?.optionImages) ? q.optionImages : []
    const opts = []
    const optImgs = []
    raw.forEach((o, i) => {
      const t = str(o, LIMITS.option)
      if (!t || opts.includes(t) || opts.length >= LIMITS.options) return
      opts.push(t)
      optImgs.push(img(imgs[i]))
    })
    out.options = opts.length ? opts : ['옵션 1']
    if (optImgs.some(Boolean)) out.optionImages = out.options.map((_, i) => optImgs[i] ?? '')
    if (type === 'radio' || type === 'checkbox') out.other = Boolean(q?.other)
    if (type === 'rank') {
      const n = out.options.length
      const lim = Math.round(Number(q?.rankLimit) || 0)
      out.rankLimit = lim >= 1 && lim < n ? lim : n
    }
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
  // 중복 응답 막기: IP, 고른 질문(이름·전화 등)의 값 — 각각(하나라도 같으면) 또는 조합(모두 같으면)
  const keyable = new Set(questions.filter((q) => ['short', 'select', 'radio'].includes(q.type)).map((q) => q.id))
  const d = s.dedupe ?? {}
  const dedupe = { ip: Boolean(d.ip), fields: [...new Set((Array.isArray(d.fields) ? d.fields : []).filter((x) => keyable.has(x)))].slice(0, 5), mode: d.mode === 'all' ? 'all' : 'any' }
  const closeAt = typeof s.closeAt === 'string' && !Number.isNaN(Date.parse(s.closeAt)) ? new Date(s.closeAt).toISOString() : null
  return {
    title: str(f?.title, LIMITS.title) || '제목 없는 설문',
    description: str(f?.description, LIMITS.desc),
    headerImage: img(f?.headerImage),
    questions,
    settings: {
      open: s.open !== false,
      closeAt,
      oneResponse: Boolean(s.oneResponse),
      thanks: str(s.thanks, 500) || '응답해 주셔서 감사합니다.',
      linkType: s.linkType === 'full' ? 'full' : 'short',
      dedupe,
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
    if (q.type === 'rank') {
      // 순위: 1위부터 차례로 보기 이름(서로 다르게, 정한 개수까지)
      const list = (Array.isArray(v) ? v : []).map((x) => str(x, LIMITS.option)).filter(Boolean)
      if (list.some((x) => !q.options.includes(x)) || new Set(list).size !== list.length || list.length > (q.rankLimit ?? q.options.length)) return { error: `‘${label}’의 순위가 올바르지 않습니다.` }
      if (q.required && list.length && list.length < (q.rankLimit ?? q.options.length)) return { error: `‘${label}’은(는) ${q.rankLimit ?? q.options.length}위까지 모두 골라 주세요.` }
      a = list.length ? list : null
    } else if (q.type === 'checkbox') {
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

/** 답 하나를 표·CSV 칸 글자로(순위는 ‘1. A / 2. B’) */
export const answerText = (a, q) => (a === null || a === undefined ? '' : Array.isArray(a) ? (q?.type === 'rank' ? a.map((x, i) => `${i + 1}. ${x}`).join(' / ') : a.join(', ')) : String(a))

// ── 중복 응답 막기 ────────────────────────────────────────
/** 비교용으로 다듬기: 전화번호는 숫자만(+82 → 0), 나머지는 띄어쓰기 빼고 소문자 */
export function normKey(v) {
  const t = Array.isArray(v) ? v.join(',') : String(v ?? '')
  const digits = t.replace(/\D/g, '')
  if (/^[0-9+\-()\s.]+$/.test(t.trim()) && digits.length >= 7) return digits.replace(/^82(?=1)/, '0')
  return t.replace(/\s+/g, '').toLowerCase()
}
/**
 * 이미 같은 사람이 응답했는지. 막을 이유(한국어) 또는 null.
 * ipHash: 이번 응답의 IP 를 비밀 값으로 바꾼 것(IP 자체는 저장하지 않는다)
 */
export function findDuplicate(form, responses, answers, ipHash) {
  const d = form.settings?.dedupe
  if (!d) return null
  if (d.ip && ipHash && responses.some((r) => r.ip === ipHash)) return '이 네트워크(IP)에서는 이미 응답했습니다. 한 번만 응답할 수 있는 설문입니다.'
  const fields = (d.fields ?? []).filter((id) => form.questions.some((q) => q.id === id))
  if (!fields.length) return null
  const names = fields.map((id) => form.questions.find((q) => q.id === id)?.title || '항목')
  const mine = fields.map((id) => (answers[id] === undefined ? '' : normKey(answers[id])))
  for (const r of responses) {
    const theirs = fields.map((id) => (r.answers?.[id] === undefined ? '' : normKey(r.answers[id])))
    if (d.mode === 'all') {
      if (mine.every((v, i) => v && v === theirs[i])) return `같은 ${names.join('·')}(으)로 이미 응답했습니다. 한 번만 응답할 수 있는 설문입니다.`
    } else {
      const i = mine.findIndex((v, k) => v && v === theirs[k])
      if (i >= 0) return `같은 ${names[i]}(으)로 이미 응답했습니다. 한 번만 응답할 수 있는 설문입니다.`
    }
  }
  return null
}

/** 응답 → 표(머리글 + 줄). 날짜는 한국 시간 */
export function responseTable(form, responses) {
  const qs = form.questions.filter((q) => q.type !== 'section')
  const head = ['번호', '제출 시각', ...qs.map((q) => q.title || '이름 없는 질문')]
  const kst = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')
  const rows = responses.map((r, i) => [i + 1, kst(r.at), ...qs.map((q) => answerText(r.answers?.[q.id], q))])
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
