/**
 * 요율 데이터 공통 형식.
 * 모든 값은 각 마켓의 공식 안내 페이지를 직접 열어 확인한 것만 `verified: true` 로 둔다.
 * 확인하지 못한 값은 `value: null, verified: false` — 화면에서 "확인 필요" 배지와 함께 직접 입력으로 남는다.
 */
export interface RateSource {
  /** 화면에 보이는 출처 이름 */
  label: string
  url: string
  /** 로그인해야 열리는 등 참고 사항 */
  note?: string
}

export interface RateMeta {
  /** 마켓 이름 */
  market: string
  /** 출처 요약(하단 "요율 기준" 문구에 쓰인다) */
  sourceName: string
  /** 대표 출처 주소 */
  source: string
  sources: RateSource[]
  /** 공식 안내를 확인한 날짜 */
  checkedAt: string
  /** VAT 포함 여부, 올림/버림 규칙 등 */
  note: string
}

export interface RateDef {
  /** 요율(%) 또는 금액(원). 확인하지 못했으면 null */
  value: number | null
  verified: boolean
  note?: string
}

export interface CategoryRate {
  /** path 를 ' > ' 로 이은 값 */
  id: string
  /** 대분류부터 차례로 */
  path: string[]
  /** 요율(%) */
  rate: number
}

/** [대분류, 기본 요율, [하위 분류 이름, 요율][]] 을 CategoryRate 목록으로 편다. */
export type CategoryGroup = [top: string, baseRate: number, subs?: Array<[name: string, rate: number]>]

export function expandCategories(groups: CategoryGroup[], baseLabel = '전체'): CategoryRate[] {
  const out: CategoryRate[] = []
  for (const [top, base, subs] of groups) {
    out.push({ id: `${top} > ${baseLabel}`, path: [top, baseLabel], rate: base })
    for (const [name, rate] of subs ?? []) {
      const path = [top, ...name.split(' > ')]
      out.push({ id: path.join(' > '), path, rate })
    }
  }
  return out
}

export const CHECKED_AT = '2026-10-01'
