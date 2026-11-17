// 설문폼 — 화면 계산(질문 종류·템플릿·응답 요약). 서버 검사 규칙은 server/lib/forms.mjs

export type QType = 'short' | 'long' | 'radio' | 'checkbox' | 'select' | 'rank' | 'scale' | 'date' | 'time' | 'section'
/** 보기가 있는 종류 */
export const OPTION_TYPES: QType[] = ['radio', 'checkbox', 'select', 'rank']
export interface Question {
  id: string
  type: QType
  title: string
  desc: string
  required: boolean
  options?: string[]
  /** 보기마다 사진(서버 주소, 없으면 '') */
  optionImages?: string[]
  /** 질문 사진 */
  image?: string
  /** 순위: 몇 위까지 매길지(없으면 보기 전부) */
  rankLimit?: number
  /** 객관식·체크박스의 ‘기타(직접 입력)’ */
  other?: boolean
  scale?: { min: number; max: number; minLabel: string; maxLabel: string }
  /** 단답형 입력 형식 */
  format?: 'text' | 'email' | 'phone' | 'number'
}
export interface Settings {
  open: boolean
  closeAt: string | null
  oneResponse: boolean
  thanks: string
  linkType: 'short' | 'full'
  /** 중복 응답 막기: IP, 고른 질문 값 — 각각(any: 하나라도 같으면) / 조합(all: 모두 같으면) */
  dedupe?: { ip: boolean; fields: string[]; mode: 'any' | 'all' }
}
export interface Form {
  id: string
  title: string
  description: string
  /** 설문 맨 위 사진 */
  headerImage?: string
  questions: Question[]
  settings: Settings
  owner?: string
  ownerName?: string
  responseCount?: number
  createdAt?: string
  updatedAt?: string
  links?: { full: string; short: string }
}
export interface FormSummary {
  id: string
  title: string
  description: string
  ownerName: string
  questions: number
  responses: number
  lastResponseAt: string | null
  open: boolean
  settings: Settings
  createdAt: string
  updatedAt: string
  links: { full: string; short: string }
}
export type Answer = string | string[] | number
export interface Response {
  id: string
  at: string
  answers: Record<string, Answer>
}

export const TYPE_LABEL: Record<QType, string> = {
  short: '단답형',
  long: '장문형',
  radio: '객관식(하나 고르기)',
  checkbox: '체크박스(여러 개)',
  select: '드롭다운',
  rank: '순위 매기기',
  scale: '점수(선형 배율)',
  date: '날짜',
  time: '시간',
  section: '안내 문구(제목·설명)',
}
export const FORMAT_LABEL = { text: '글자', email: '이메일', phone: '전화번호', number: '숫자' } as const

export const qid = () => Math.random().toString(36).slice(2, 10)

/** 새 질문(종류별 기본값) */
export function newQuestion(type: QType = 'radio'): Question {
  const q: Question = { id: qid(), type, title: '', desc: '', required: false }
  if (type === 'radio' || type === 'checkbox' || type === 'select') q.options = ['옵션 1']
  if (type === 'rank') {
    q.options = ['옵션 1', '옵션 2', '옵션 3']
    q.rankLimit = 3
  }
  if (type === 'scale') q.scale = { min: 1, max: 5, minLabel: '전혀 아니다', maxLabel: '매우 그렇다' }
  if (type === 'short') q.format = 'text'
  return q
}

/** 종류를 바꿀 때: 보기는 살릴 수 있으면 살린다 */
export function changeType(q: Question, type: QType): Question {
  const base = newQuestion(type)
  // 순위는 보기가 2개 이상이어야 의미가 있다 → 1개뿐이면 기본 보기 3개로
  const keep = Boolean(base.options && q.options?.length && !(type === 'rank' && (q.options?.length ?? 0) < 2))
  const options = keep ? q.options : base.options
  return {
    ...base,
    id: q.id,
    title: q.title,
    desc: q.desc,
    image: q.image,
    required: type === 'section' ? false : q.required,
    options,
    optionImages: keep && base.options ? q.optionImages : undefined,
    rankLimit: type === 'rank' ? Math.min(options?.length ?? 3, q.rankLimit ?? 3) : undefined,
  }
}

export const DEFAULT_SETTINGS: Settings = { open: true, closeAt: null, oneResponse: false, thanks: '응답해 주셔서 감사합니다.', linkType: 'short', dedupe: { ip: false, fields: [], mode: 'any' } }

const Q = (type: QType, title: string, extra: Partial<Question> = {}): Question => ({ ...newQuestion(type), title, ...extra })

/** 기본 템플릿(빈 설문 포함 5개) */
export const TEMPLATES: Array<{ key: string; name: string; note: string; make: () => Pick<Form, 'title' | 'description' | 'questions'> }> = [
  { key: 'blank', name: '빈 설문', note: '처음부터 직접 만들기', make: () => ({ title: '제목 없는 설문', description: '', questions: [Q('radio', '')] }) },
  {
    key: 'satisfaction',
    name: '고객 만족도 조사',
    note: '만족도 점수·좋았던 점·개선할 점',
    make: () => ({
      title: '고객 만족도 조사',
      description: '더 나은 서비스를 위해 잠시 시간을 내어 의견을 들려주세요. 약 2분이면 끝납니다.',
      questions: [
        Q('scale', '전반적으로 얼마나 만족하셨나요?', { required: true, scale: { min: 1, max: 5, minLabel: '매우 불만족', maxLabel: '매우 만족' } }),
        Q('checkbox', '좋았던 점을 모두 골라 주세요.', { options: ['품질', '가격', '배송 속도', '포장 상태', '고객 응대'], other: true }),
        Q('radio', '다시 구매하실 의향이 있으신가요?', { required: true, options: ['꼭 다시 구매하겠다', '아마 구매하겠다', '잘 모르겠다', '구매하지 않겠다'] }),
        Q('radio', '주변에 추천하실 의향이 있으신가요?', { options: ['예', '아니요', '잘 모르겠다'] }),
        Q('rank', '제품을 고를 때 중요한 것을 순서대로 골라 주세요.', { options: ['품질', '가격', '디자인', '브랜드', '후기'], rankLimit: 3 }),
        Q('long', '개선했으면 하는 점이 있다면 자유롭게 적어 주세요.'),
      ],
    }),
  },
  {
    key: 'event',
    name: '행사·이벤트 참가 신청',
    note: '이름·연락처·참가 인원·날짜',
    make: () => ({
      title: '행사 참가 신청서',
      description: '아래 내용을 적어 주시면 확인 후 안내 문자를 보내 드립니다.',
      questions: [
        Q('short', '이름', { required: true }),
        Q('short', '연락처', { required: true, format: 'phone', desc: '예) 010-1234-5678' }),
        Q('short', '이메일', { format: 'email' }),
        Q('select', '참가 인원', { required: true, options: ['1명', '2명', '3명', '4명', '5명 이상'] }),
        Q('date', '참석 희망 날짜', { required: true }),
        Q('radio', '행사를 어떻게 알게 되셨나요?', { options: ['인스타그램', '블로그', '지인 소개', '매장 안내'], other: true }),
        Q('long', '궁금한 점이나 요청 사항'),
      ],
    }),
  },
  {
    key: 'feedback',
    name: '의견·건의 수렴',
    note: '분류·내용·답변 받을 연락처',
    make: () => ({
      title: '의견·건의함',
      description: '자유롭게 의견을 남겨 주세요. 남겨 주신 의견은 담당자가 꼼꼼히 확인합니다.',
      questions: [
        Q('select', '의견 분류', { required: true, options: ['칭찬', '불편·개선', '제안', '문의', '기타'] }),
        Q('short', '제목', { required: true }),
        Q('long', '내용', { required: true }),
        Q('radio', '답변을 받으시겠어요?', { options: ['예', '아니요'] }),
        Q('short', '답변 받을 연락처(전화·이메일)'),
      ],
    }),
  },
  {
    key: 'order',
    name: '주문·신청서',
    note: '이름·연락처·주소·상품·수량',
    make: () => ({
      title: '주문 신청서',
      description: '주문하실 상품과 받으실 분 정보를 적어 주세요. 확인 후 입금·배송 안내를 드립니다.',
      questions: [
        Q('short', '주문자 이름', { required: true }),
        Q('short', '연락처', { required: true, format: 'phone' }),
        Q('long', '받으실 주소', { required: true }),
        Q('checkbox', '주문 상품', { required: true, options: ['상품 A', '상품 B', '상품 C'] }),
        Q('select', '수량', { required: true, options: ['1개', '2개', '3개', '4개', '5개 이상'] }),
        Q('date', '희망 배송일'),
        Q('long', '요청 사항'),
      ],
    }),
  },
]

/** 답 하나를 글자로(순위는 ‘1. A / 2. B’) */
export const answerText = (a: Answer | undefined, q?: Pick<Question, 'type'>) =>
  a === undefined || a === null ? '' : Array.isArray(a) ? (q?.type === 'rank' ? a.map((x, i) => `${i + 1}. ${x}`).join(' / ') : a.join(', ')) : String(a)

/** 질문별 요약: 고르는 질문은 보기별 개수, 글 질문은 답 목록 */
export interface QSummary {
  q: Question
  answered: number
  counts?: Array<{ label: string; n: number }>
  texts?: string[]
  average?: number
  /** 순위: 보기별 점수(1위일수록 큼)·1위 수·평균 순위·고른 사람 수 — 점수 큰 순 */
  ranks?: Array<{ label: string; points: number; first: number; avg: number | null; n: number }>
}
export function summarize(form: Form, responses: Response[]): QSummary[] {
  return form.questions
    .filter((q) => q.type !== 'section')
    .map((q) => {
      const vals = responses.map((r) => r.answers?.[q.id]).filter((v) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length))
      if (q.type === 'radio' || q.type === 'checkbox' || q.type === 'select') {
        const m = new Map<string, number>((q.options ?? []).map((o) => [o, 0]))
        let other = 0
        for (const v of vals) for (const x of Array.isArray(v) ? v : [String(v)]) {
          if (m.has(x)) m.set(x, (m.get(x) ?? 0) + 1)
          else other++
        }
        const counts = [...m.entries()].map(([label, n]) => ({ label, n }))
        if (other || q.other) counts.push({ label: '기타', n: other })
        const texts = vals.flatMap((v) => (Array.isArray(v) ? v : [String(v)])).filter((x) => x.startsWith('기타: ')).map((x) => x.slice(4))
        return { q, answered: vals.length, counts, texts: texts.length ? texts : undefined }
      }
      if (q.type === 'rank') {
        const limit = q.rankLimit ?? q.options?.length ?? 0
        const ranks = (q.options ?? []).map((label) => {
          const pos = vals.map((v) => (Array.isArray(v) ? v.indexOf(label) : -1)).filter((i) => i >= 0)
          return { label, points: pos.reduce((s, i) => s + (limit - i), 0), first: pos.filter((i) => i === 0).length, avg: pos.length ? Math.round((pos.reduce((s, i) => s + i + 1, 0) / pos.length) * 100) / 100 : null, n: pos.length }
        })
        return { q, answered: vals.length, ranks: ranks.sort((a, b) => b.points - a.points || b.first - a.first) }
      }
      if (q.type === 'scale') {
        const s = q.scale ?? { min: 1, max: 5, minLabel: '', maxLabel: '' }
        const counts = Array.from({ length: s.max - s.min + 1 }, (_, i) => ({ label: String(s.min + i), n: vals.filter((v) => Number(v) === s.min + i).length }))
        const nums = vals.map(Number).filter(Number.isFinite)
        return { q, answered: vals.length, counts, average: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : undefined }
      }
      return { q, answered: vals.length, texts: vals.map((v) => answerText(v as Answer)) }
    })
}

/** 응답 표(엑셀·화면 공통) */
export function responseRows(form: Form, responses: Response[]) {
  const qs = form.questions.filter((q) => q.type !== 'section')
  const head = ['번호', '제출 시각', ...qs.map((q) => q.title || '이름 없는 질문')]
  const rows = responses.map((r, i) => [i + 1, formatAt(r.at), ...qs.map((q) => answerText(r.answers?.[q.id], q))])
  return { head, rows }
}

/** 한국 시간 ‘2026-11-17 14:03’ */
export const formatAt = (iso: string) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')

/** 꼭 답해야 하는데 빈 질문(화면에서 먼저 확인) */
export function missingRequired(form: Pick<Form, 'questions'>, answers: Record<string, Answer | undefined>): Question | null {
  for (const q of form.questions) {
    if (!q.required || q.type === 'section') continue
    const a = answers[q.id]
    if (a === undefined || a === null || a === '' || (Array.isArray(a) && !a.length)) return q
    if (q.type === 'rank' && Array.isArray(a) && a.length < (q.rankLimit ?? q.options?.length ?? 0)) return q
  }
  return null
}

/** 파일 이름에 못 쓰는 글자 빼기 */
export const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) || '설문'
