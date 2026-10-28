/**
 * 쇼핑몰 → 거래처(쇼핑몰) 코드. 일마감 엑셀리스트의 ‘쇼핑몰 코드’ 칸에 쓴다.
 * (2026-10 온비팀 거래처코드 파일 기준. 앞자리 0 이 있으므로 글자로 다룬다)
 */
export const MALL_CODES: Record<string, string> = {
  '11번가': '020188',
  AliExpress: '027236',
  ESM지마켓: '007035',
  'e-제너두': '023752',
  'i-Scream': '029852',
  YES24: '015005',
  'SSG.COM': '020522',
  교보핫트랙스: '003331',
  롯데온: '022274',
  무신사: '014714',
  스마트스토어: '016275',
  오너클랜: '019756',
  오늘의집: '020976',
  쿠팡: '019870',
  텐바이텐: '021860',
  토스쇼핑: '016143',
  티처몰: '018710',
  '현대이지웰(신)': '022661',
}

/** 비교용: 띄어쓰기·대소문자·괄호 표시((신) 등)를 뺀다 */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[\s\-_.]/g, '')
/** 사방넷 쇼핑몰 이름이 조금 달라도 같은 곳으로 보는 이름 */
const ALIASES: Record<string, string> = { g마켓: 'ESM지마켓', 지마켓: 'ESM지마켓', esmg마켓: 'ESM지마켓', 핫트랙스: '교보핫트랙스', 네이버스마트스토어: '스마트스토어', 알리익스프레스: 'AliExpress', ssg: 'SSG.COM', 쓱닷컴: 'SSG.COM', 현대이지웰: '현대이지웰(신)', 예스24: 'YES24', 아이스크림: 'i-Scream' }
const BY_NORM = new Map<string, string>([...Object.entries(MALL_CODES).map(([k, v]) => [norm(k), v] as const), ...Object.entries(ALIASES).map(([a, k]) => [norm(a), MALL_CODES[k]] as const)])

/** 쇼핑몰 이름 → 코드(모르는 곳은 빈칸) */
export function mallCode(name: string | null | undefined): string {
  const n = String(name ?? '').trim()
  if (!n) return ''
  return MALL_CODES[n] ?? BY_NORM.get(norm(n)) ?? ''
}
