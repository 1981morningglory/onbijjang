/**
 * 사주풀이 — 만세력 계산(manseryeok: 한국천문연구원 절기·음력)과 원국표에 쓸 값.
 * 계산은 모두 브라우저에서 한다. AI 풀이에는 이 원국 정보만 보낸다(이름은 보내지 않는다).
 */
import { calculateFourPillars, lunarToSolar, type BirthInfo, type DayBoundary } from 'manseryeok'

export const STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'] as const
export const BRANCHES = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'] as const
const STEM_HANJA = '甲乙丙丁戊己庚辛壬癸'
const BRANCH_HANJA = '子丑寅卯辰巳午未申酉戌亥'
export type Element = '목' | '화' | '토' | '금' | '수'
export const ELEMENTS: Element[] = ['목', '화', '토', '금', '수']
const STEM_ELEMENT: Element[] = ['목', '목', '화', '화', '토', '토', '금', '금', '수', '수']
const BRANCH_ELEMENT: Element[] = ['수', '토', '목', '목', '토', '화', '화', '토', '금', '금', '토', '수']
/** 지지의 음양: 자·인·진·오·신·술 양 / 축·묘·사·미·유·해 음 (체용 구분 없이 위치로) */
const branchYang = (i: number) => i % 2 === 0

export const stemHanja = (s: string) => STEM_HANJA[STEMS.indexOf(s as never)] ?? ''
export const branchHanja = (b: string) => BRANCH_HANJA[BRANCHES.indexOf(b as never)] ?? ''
export const stemElement = (s: string): Element => STEM_ELEMENT[STEMS.indexOf(s as never)]
export const branchElement = (b: string): Element => BRANCH_ELEMENT[BRANCHES.indexOf(b as never)]

/** 지장간(여기·중기·정기) — 한국 만세력 관례(자·묘·유도 여기를 넣는다) */
export const HIDDEN_STEMS: Record<string, string[]> = {
  자: ['임', '계'],
  축: ['계', '신', '기'],
  인: ['무', '병', '갑'],
  묘: ['갑', '을'],
  진: ['을', '계', '무'],
  사: ['무', '경', '병'],
  오: ['병', '기', '정'],
  미: ['정', '을', '기'],
  신: ['무', '임', '경'],
  유: ['경', '신'],
  술: ['신', '정', '무'],
  해: ['무', '갑', '임'],
}

/** 12운성: 일간 기준. 양간은 순행, 음간은 역행 */
const STAGES = ['장생', '목욕', '관대', '건록', '제왕', '쇠', '병', '사', '묘', '절', '태', '양']
const STAGE_START: Record<string, string> = { 갑: '해', 을: '오', 병: '인', 정: '유', 무: '인', 기: '유', 경: '사', 신: '자', 임: '신', 계: '묘' }
export function twelveStage(dayStem: string, branch: string): string {
  const s = BRANCHES.indexOf(STAGE_START[dayStem] as never)
  const b = BRANCHES.indexOf(branch as never)
  const yang = STEMS.indexOf(dayStem as never) % 2 === 0
  return STAGES[(((yang ? b - s : s - b) % 12) + 12) % 12]
}

/** 십신: 일간과 대상 천간의 오행·음양 관계 */
const TEN = { same: ['비견', '겁재'], output: ['식신', '상관'], wealth: ['편재', '정재'], power: ['편관', '정관'], resource: ['편인', '정인'] } as const
export function tenGod(dayStem: string, stem: string): string {
  const d = STEMS.indexOf(dayStem as never)
  const t = STEMS.indexOf(stem as never)
  const de = Math.floor(d / 2)
  const te = Math.floor(t / 2)
  const sameYinYang = d % 2 === t % 2
  // 오행 순환: 목(0)→화(1)→토(2)→금(3)→수(4)
  const rel = (te - de + 5) % 5
  const pair = [TEN.same, TEN.output, TEN.wealth, TEN.power, TEN.resource][rel]
  return sameYinYang ? pair[0] : pair[1]
}
/** 지지 십신: 정기(지장간 마지막) 기준 */
export const branchTenGod = (dayStem: string, branch: string) => tenGod(dayStem, HIDDEN_STEMS[branch].at(-1)!)

/** 연도의 간지(세운) */
export function yearGanji(year: number) {
  const n = (((year - 4) % 60) + 60) % 60
  return { stem: STEMS[n % 10], branch: BRANCHES[n % 12] }
}

export type PillarKey = 'hour' | 'day' | 'month' | 'year'
export const PILLAR_LABEL: Record<PillarKey, string> = { hour: '시주', day: '일주', month: '월주', year: '연주' }

export interface PillarView {
  key: PillarKey
  stem: string
  branch: string
  stemTenGod: string
  branchTenGod: string
  hidden: Array<{ stem: string; tenGod: string }>
  stage: string
}
export interface LuckView {
  /** 대운 시작 나이(만, 대운수) */
  age: number
  stem: string
  branch: string
  stemTenGod: string
  branchTenGod: string
  /** 이 대운이 시작하는 날(대략, YYYY-MM) */
  from: string
}
export interface ChartInput {
  calendar: 'solar' | 'lunar'
  leap: boolean
  year: number
  month: number
  day: number
  /** 출생 시각을 모르면 null — 시주 없이 세 기둥만 */
  hour: number | null
  minute: number
  gender: 'male' | 'female'
  /** 진태양시 보정에 쓸 출생지 경도(없으면 보정 안 함) */
  longitude: number | null
  dayBoundary: DayBoundary
}
export interface Chart {
  input: ChartInput
  /** 양력 생일(음력 입력이면 바꾼 날) */
  solar: { year: number; month: number; day: number }
  dayMaster: string
  /** 시·일·월·연 순서(원국표 왼쪽부터) */
  pillars: PillarView[]
  /** 천간·지지 여덟(시주 모르면 여섯) 글자의 오행 개수 */
  elements: Record<Element, number>
  yinYang: { yang: number; yin: number }
  voidBranches: string[]
  luck: { forward: boolean; startAge: number; list: LuckView[]; current: number }
  /** 올해·내년 세운 */
  years: Array<{ year: number; stem: string; branch: string; stemTenGod: string; branchTenGod: string }>
  /** 만 나이 */
  age: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 원국 계산. 잘못된 날짜는 RangeError(‘없는 날짜’) */
export function computeChart(input: ChartInput, now = new Date()): Chart {
  const info: BirthInfo = {
    year: input.year,
    month: input.month,
    day: input.day,
    hour: input.hour ?? 12,
    minute: input.hour == null ? 0 : input.minute,
    isLunar: input.calendar === 'lunar',
    isLeapMonth: input.calendar === 'lunar' && input.leap,
    gender: input.gender,
    dayBoundary: input.dayBoundary,
    ...(input.longitude != null && input.hour != null ? { trueSolarTime: { longitude: input.longitude } } : {}),
  }
  const r = calculateFourPillars(info)
  const dm = r.day.heavenlyStem
  const keys: PillarKey[] = input.hour == null ? ['day', 'month', 'year'] : ['hour', 'day', 'month', 'year']
  const pillars: PillarView[] = keys.map((key) => {
    const p = r[key]
    return {
      key,
      stem: p.heavenlyStem,
      branch: p.earthlyBranch,
      stemTenGod: key === 'day' ? '일간' : tenGod(dm, p.heavenlyStem),
      branchTenGod: branchTenGod(dm, p.earthlyBranch),
      hidden: HIDDEN_STEMS[p.earthlyBranch].map((s) => ({ stem: s, tenGod: tenGod(dm, s) })),
      stage: twelveStage(dm, p.earthlyBranch),
    }
  })
  const elements = Object.fromEntries(ELEMENTS.map((e) => [e, 0])) as Record<Element, number>
  let yang = 0
  for (const p of pillars) {
    elements[stemElement(p.stem)]++
    elements[branchElement(p.branch)]++
    if (STEMS.indexOf(p.stem as never) % 2 === 0) yang++
    if (branchYang(BRANCHES.indexOf(p.branch as never))) yang++
  }
  // 양력 생일: 음력 입력이면 manseryeok 이 바꾼 날짜를 연주 계산에 썼다 — 화면 표시용으로 다시 구한다
  const solar = input.calendar === 'lunar' ? lunarToSolarSafe(input) : { year: input.year, month: input.month, day: input.day }
  const birth = new Date(solar.year, solar.month - 1, solar.day)
  let age = now.getFullYear() - solar.year - (now.getMonth() < solar.month - 1 || (now.getMonth() === solar.month - 1 && now.getDate() < solar.day) ? 1 : 0)
  age = Math.max(0, age)
  const lp = r.luckPillars!
  // 첫 대운이 시작하는 날 = 생일 + (startYears 년, startMonths 달, startDays 일)
  const start = new Date(birth.getFullYear() + lp.startYears, birth.getMonth() + lp.startMonths, birth.getDate() + lp.startDays)
  const list: LuckView[] = lp.pillars.slice(0, 10).map((x, i) => {
    const from = new Date(start.getFullYear() + i * 10, start.getMonth(), 1)
    return {
      age: x.age,
      stem: x.pillar.heavenlyStem,
      branch: x.pillar.earthlyBranch,
      stemTenGod: tenGod(dm, x.pillar.heavenlyStem),
      branchTenGod: branchTenGod(dm, x.pillar.earthlyBranch),
      from: `${from.getFullYear()}-${pad(from.getMonth() + 1)}`,
    }
  })
  const elapsed = (now.getTime() - start.getTime()) / (365.2425 * 86400e3)
  const current = elapsed < 0 ? -1 : Math.min(list.length - 1, Math.floor(elapsed / 10))
  const years = [now.getFullYear(), now.getFullYear() + 1].map((y) => {
    const g = yearGanji(y)
    return { year: y, ...g, stemTenGod: tenGod(dm, g.stem), branchTenGod: branchTenGod(dm, g.branch) }
  })
  return {
    input,
    solar,
    dayMaster: dm,
    pillars,
    elements,
    yinYang: { yang, yin: pillars.length * 2 - yang },
    voidBranches: r.voidBranches as string[],
    luck: { forward: lp.forward, startAge: lp.startAge, list, current },
    years,
    age,
  }
}

function lunarToSolarSafe(input: ChartInput) {
  return lunarToSolar(input.year, input.month, input.day, input.leap)
}

/** 일간 설명(한 줄) */
export const DAY_MASTER_NOTE: Record<string, string> = {
  갑: '큰 나무 — 곧게 뻗는 추진력과 리더십',
  을: '풀과 꽃 — 유연함과 적응력, 섬세함',
  병: '태양 — 밝고 적극적이며 드러내는 힘',
  정: '촛불·등불 — 따뜻하고 세심한 집중력',
  무: '큰 산 — 듬직하고 포용하는 안정감',
  기: '논밭의 흙 — 실속 있고 기르는 힘',
  경: '바위·쇠 — 결단력과 의리, 강한 추진',
  신: '보석·칼 — 예리하고 섬세한 완성도',
  임: '큰 바다·강 — 넓은 시야와 지혜, 흐름',
  계: '비·이슬 — 섬세한 감수성과 지혜',
}

/** AI 풀이에 보낼 원국 요약(이름·생일 원문은 넣지 않는다 — 출생 연도와 성별, 원국만) */
export function chartForAi(c: Chart) {
  return {
    gender: c.input.gender,
    birthYear: c.solar.year,
    age: c.age,
    hourKnown: c.input.hour != null,
    dayMaster: c.dayMaster,
    pillars: c.pillars.map((p) => ({ key: p.key, stem: p.stem, branch: p.branch, stemTenGod: p.stemTenGod, branchTenGod: p.branchTenGod, hidden: p.hidden.map((h) => h.stem), stage: p.stage })),
    elements: c.elements,
    yinYang: c.yinYang,
    voidBranches: c.voidBranches,
    luck: { forward: c.luck.forward, startAge: c.luck.startAge, current: c.luck.current, list: c.luck.list.map((l) => ({ age: l.age, stem: l.stem, branch: l.branch })) },
    years: c.years.map((y) => ({ year: y.year, stem: y.stem, branch: y.branch })),
  }
}
export type ChartForAi = ReturnType<typeof chartForAi>

/** 한국 주요 도시 경도(진태양시 보정용) */
export const CITIES: Array<{ name: string; lon: number }> = [
  { name: '서울', lon: 126.98 },
  { name: '인천', lon: 126.7 },
  { name: '수원', lon: 127.03 },
  { name: '춘천', lon: 127.73 },
  { name: '강릉', lon: 128.9 },
  { name: '청주', lon: 127.49 },
  { name: '대전', lon: 127.38 },
  { name: '전주', lon: 127.15 },
  { name: '광주', lon: 126.85 },
  { name: '대구', lon: 128.6 },
  { name: '포항', lon: 129.37 },
  { name: '울산', lon: 129.31 },
  { name: '부산', lon: 129.08 },
  { name: '창원', lon: 128.68 },
  { name: '제주', lon: 126.53 },
]
