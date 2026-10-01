import { CHECKED_AT, type RateDef, type RateMeta } from './types'

/**
 * 네이버 스마트스토어
 *
 * 확인 결과(2026-10-01)
 * - 스마트스토어 판매자센터·네이버페이 수수료 안내(sell.smartstore.naver.com, help.sell.smartstore.naver.com,
 *   admin.pay.naver.com)는 자동 조회가 막혀 있어 요율 표를 직접 열어 보지 못했다.
 * - 열어 본 공식 자료는 네이버 보도자료뿐이다: 2025-10-01 부터 Npay 온라인 영세·중소 가맹점 수수료율을
 *   각각 0.03%p·0.02%p 내렸고 "네이버 스마트스토어 및 Npay 주문형 영세·중소 가맹점 수수료율도" 같은 폭으로 내렸다는 내용.
 *   스마트스토어 등급별 요율 숫자 자체는 보도자료에 없다.
 * - 따라서 등급별 주문관리 수수료, 판매 수수료(네이버 쇼핑 유입/마케팅 링크), 쇼핑커넥트 요율은
 *   모두 "직접 입력"(value: null, verified: false)으로 둔다. 블로그·계산기 사이트의 표는 옮기지 않았다.
 */
export const SMARTSTORE_META: RateMeta = {
  market: '스마트스토어',
  sourceName: '네이버 공식 안내(요율 표는 확인하지 못함)',
  source: 'https://navercorp.com/media/pressReleasesDetail?seq=33382',
  sources: [
    {
      label: '네이버 보도자료 — Npay 영세·중소 온라인 결제 수수료 인하(2025-09-30)',
      url: 'https://navercorp.com/media/pressReleasesDetail?seq=33382',
      note: '2025-10-01 부터 스마트스토어 영세 0.03%p, 중소 0.02%p 인하. 등급별 숫자는 없음',
    },
    {
      label: '네이버 보도자료 — 쇼핑 커넥트 정식 출시(2025-07-23)',
      url: 'https://www.navercorp.com/media/pressReleasesDetail?seq=33116',
      note: '수익 공유 비율은 판매자가 정한다는 내용만 있음',
    },
    {
      label: '스마트스토어센터 수수료 안내(로그인 후 확인)',
      url: 'https://sell.smartstore.naver.com/',
      note: '요율은 여기서 확인해 직접 입력',
    },
  ],
  checkedAt: CHECKED_AT,
  note: '요율을 공식 자료로 확인하지 못해 기본값이 없습니다. 판매자센터에 표시된 요율(부가세 포함 기준)을 직접 입력하세요.',
}

export const SMARTSTORE_TIERS = [
  { id: 'micro', label: '영세' },
  { id: 'small1', label: '중소1' },
  { id: 'small2', label: '중소2' },
  { id: 'small3', label: '중소3' },
  { id: 'general', label: '일반' },
] as const
export type SmartstoreTier = (typeof SMARTSTORE_TIERS)[number]['id']

export const SMARTSTORE_INFLOWS = [
  { id: 'naver', label: '네이버 쇼핑 유입' },
  { id: 'marketing', label: '판매자 마케팅 링크' },
] as const
export type SmartstoreInflow = (typeof SMARTSTORE_INFLOWS)[number]['id']

const UNCONFIRMED: RateDef = { value: null, verified: false, note: '공식 요율 표를 확인하지 못함' }

/** 네이버페이 주문관리 수수료(%) — 사업자 등급별 */
export const SMARTSTORE_ORDER_FEE: Record<SmartstoreTier, RateDef> = {
  micro: UNCONFIRMED,
  small1: UNCONFIRMED,
  small2: UNCONFIRMED,
  small3: UNCONFIRMED,
  general: UNCONFIRMED,
}

/** 판매 수수료(%) — 유입 경로별 */
export const SMARTSTORE_SALES_FEE: Record<SmartstoreInflow, RateDef> = {
  naver: UNCONFIRMED,
  marketing: UNCONFIRMED,
}

/** 쇼핑커넥트 수수료(%) — 판매자가 정하는 값이라 기본값이 없다 */
export const SMARTSTORE_CONNECT_FEE: RateDef = { value: null, verified: false, note: '판매자가 정하는 요율' }
