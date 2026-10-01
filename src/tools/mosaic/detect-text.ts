/**
 * 글자 인식 결과에서 개인정보처럼 보이는 부분만 골라낸다(순수 함수).
 * 형식만 보고 고르는 것이라 빠뜨리거나 잘못 고를 수 있다 — 화면에서 사용자가 확인한다.
 */

export type PatternId = 'phone' | 'rrn' | 'email' | 'plate' | 'digits'

export const PATTERN_LABEL: Record<PatternId, string> = {
  phone: '전화번호',
  rrn: '주민등록번호 형식',
  email: '이메일',
  plate: '차량번호',
  digits: '긴 숫자(계좌·카드 등)',
}

export const PATTERN_ORDER: PatternId[] = ['rrn', 'phone', 'plate', 'email', 'digits']

export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}
export interface OcrLine {
  words: OcrWord[]
}

export interface Finding {
  kind: PatternId
  text: string
  x: number
  y: number
  w: number
  h: number
}

const PLATE_HANGUL = '가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호육해공국합'
const PLATE_REGION = '서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주'

const PATTERNS: Record<PatternId, RegExp[]> = {
  rrn: [
    // 생년월일 6자리 - 성별 자리(1–8)로 시작하는 7자리. 뒤가 가려진(*) 표기도 포함
    /(?<!\d)\d{6}\s?[-–—~]?\s?[1-8](?:\d{6}|[\d*●○xX]{6})(?![\d*])/g,
  ],
  phone: [
    /(?<!\d)(?:\+?82[-.\s]?1[016789]|01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g,
    /(?<!\d)(?:\+?82[-.\s]?|0)(?:2|[3-6][1-5]|70|50\d?|80)[-.\s)]{0,2}\d{3,4}[-.\s]?\d{4}(?!\d)/g,
    /(?<!\d)1[5689]\d{2}[-.\s]?\d{4}(?!\d)/g,
  ],
  plate: [new RegExp(`(?<![\\d가-힣])(?:(?:${PLATE_REGION})\\s?)?\\d{2,3}\\s?[${PLATE_HANGUL}]\\s?\\d{4}(?!\\d)`, 'g')],
  email: [/[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9-]+(?:\s?\.\s?[A-Za-z0-9-]+)*\s?\.\s?[A-Za-z]{2,}/g],
  digits: [
    // 숫자 10자리 이상(사이의 - 허용) 또는 4자리씩 띄어 쓴 카드 번호
    /(?<!\d)\d(?:-?\d){9,}(?!\d)/g,
    /(?<!\d)\d{4}\s\d{4}\s\d{4}\s\d{4}(?!\d)/g,
  ],
}

/**
 * 숫자 사이에 낀 O·l 같은 글자를 숫자로 본다(글자 인식이 자주 헷갈리는 것). 길이는 그대로다.
 */
export function normalizeDigits(text: string): string {
  const chars = [...text]
  const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
  const near = (i: number) => {
    // 바로 옆, 또는 구분 기호 하나 건너에 숫자가 있는지
    for (const d of [-1, 1]) {
      const a = chars[i + d]
      if (isDigit(a)) return true
      if ((a === '-' || a === '.') && isDigit(chars[i + 2 * d])) return true
    }
    return false
  }
  return chars
    .map((c, i) => {
      if ('OoQ'.includes(c) && near(i)) return '0'
      if ('lI|'.includes(c) && near(i)) return '1'
      return c
    })
    .join('')
}

/** 주민등록번호 앞 6자리가 날짜로 말이 되는지(13자리 계좌번호와 구분) */
function plausibleBirth(digits: string): boolean {
  const mm = Number(digits.slice(2, 4))
  const dd = Number(digits.slice(4, 6))
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31
}

interface Span {
  start: number
  end: number
}

function lineLayout(line: OcrLine) {
  let text = ''
  const spans: Span[] = []
  line.words.forEach((w, i) => {
    if (i) text += ' '
    spans.push({ start: text.length, end: text.length + w.text.length })
    text += w.text
  })
  return { text, spans }
}

/** 글자의 대략적인 너비 비율. 한글·한자는 넓고 숫자·영문은 좁으며 기호는 더 좁다. */
function charWidth(c: string): number {
  if (c.codePointAt(0)! >= 0x2e80) return 1
  if ("-.,:;!|'()[]/ ".includes(c)) return 0.35
  return 0.6
}

/** 줄 안의 글자 범위 [start, end) 를 덮는 상자. 낱말의 일부만 걸치면 글자 너비 비율로 가로 범위를 좁힌다. */
function spanBox(line: OcrLine, spans: Span[], start: number, end: number) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  line.words.forEach((w, i) => {
    const s = spans[i]
    if (s.end <= start || s.start >= end) return
    const chars = [...w.text]
    let total = 0
    let before = 0
    let upto = 0
    chars.forEach((c, n) => {
      const cw = charWidth(c)
      if (s.start + n < start) before += cw
      if (s.start + n < end) upto += cw
      total += cw
    })
    const width = w.x1 - w.x0
    x0 = Math.min(x0, w.x0 + (width * before) / total)
    x1 = Math.max(x1, w.x0 + (width * upto) / total)
    y0 = Math.min(y0, w.y0)
    y1 = Math.max(y1, w.y1)
  })
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function findSensitive(lines: OcrLine[], enabled: Record<PatternId, boolean>): Finding[] {
  const out: Finding[] = []
  for (const line of lines) {
    if (!line.words.length) continue
    const { text, spans } = lineLayout(line)
    const numeric = normalizeDigits(text)
    const taken: Span[] = []
    for (const kind of PATTERN_ORDER) {
      if (!enabled[kind]) continue
      const subject = kind === 'email' ? text : numeric
      for (const re of PATTERNS[kind]) {
        re.lastIndex = 0
        for (let m = re.exec(subject); m; m = re.exec(subject)) {
          let start = m.index
          let end = m.index + m[0].length
          // 앞뒤 공백은 뺀다.
          while (start < end && subject[start] === ' ') start++
          while (end > start && subject[end - 1] === ' ') end--
          if (kind === 'rrn' && !plausibleBirth(m[0].replace(/\D/g, ''))) continue
          if (taken.some((t) => t.start < end && start < t.end)) continue
          taken.push({ start, end })
          const box = spanBox(line, spans, start, end)
          if (!(box.w > 0 && box.h > 0)) continue
          out.push({ kind, text: text.slice(start, end), ...box })
        }
      }
    }
  }
  return out
}

/** 목록에 보여 줄 때 가운데를 가린 표기(화면에 개인정보를 그대로 다시 쓰지 않는다) */
export function maskPreview(text: string): string {
  const t = text.trim()
  if (t.length <= 4) return t
  const head = t.slice(0, 3)
  const tail = t.slice(-2)
  return `${head}${'•'.repeat(Math.min(8, t.length - 5))}${tail}`
}

/**
 * 글자 인식이 알려 주는 낱말 상자는 몇 px 씩 어긋나곤 해서, 찾은 범위의 양 끝을 실제 글자(잉크)에 맞춘다.
 * lum 은 찾은 줄을 잘라 낸 띠의 밝기(0–255, bw×bh). x0·x1 은 띠 안에서의 가로 범위.
 * 끝에서 바깥으로 글자가 이어져 있으면(빈 틈이 gap 열보다 좁으면) 그 글자까지 넓힌다. 최대 reach 열까지만.
 */
export function snapToInk(lum: Uint8Array | Uint8ClampedArray, bw: number, bh: number, x0: number, x1: number, gap: number, reach: number): { x0: number; x1: number } {
  // 바탕 밝기: 띠에서 가장 흔한 밝기 구간
  const hist = new Uint32Array(16)
  for (let i = 0; i < lum.length; i++) hist[lum[i] >> 4]++
  let mode = 0
  for (let b = 1; b < 16; b++) if (hist[b] > hist[mode]) mode = b
  const bg = mode * 16 + 8
  const ink = new Uint8Array(bw)
  for (let x = 0; x < bw; x++) {
    for (let y = 0; y < bh; y++) {
      if (Math.abs(lum[y * bw + x] - bg) > 56) {
        ink[x] = 1
        break
      }
    }
  }
  let left = Math.max(0, Math.min(bw - 1, Math.round(x0)))
  let right = Math.max(0, Math.min(bw - 1, Math.round(x1) - 1))
  let empty = 0
  for (let x = left - 1; x >= Math.max(0, Math.round(x0) - reach); x--) {
    if (ink[x]) {
      left = x
      empty = 0
    } else if (++empty > gap) break
  }
  empty = 0
  for (let x = right + 1; x < Math.min(bw, Math.round(x1) + reach); x++) {
    if (ink[x]) {
      right = x
      empty = 0
    } else if (++empty > gap) break
  }
  return { x0: Math.min(left, x0), x1: Math.max(right + 1, x1) }
}
