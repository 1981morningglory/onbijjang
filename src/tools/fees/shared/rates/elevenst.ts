import { CHECKED_AT, type RateDef, type RateMeta } from './types'

/**
 * 11번가
 *
 * 확인 결과(2026-10-01) — 11번가 판매자 고객센터 FAQ(cs.11st.co.kr)
 * - 서비스 이용료는 할인 전 판매가(+옵션가) 기준(FAQ 1216), 수수료는 부가세 포함(FAQ 1495).
 * - 제휴마케팅 대행비: (판매가 + 선결제 배송비)의 2% — 가격비교 사이트를 통해 팔린 주문(FAQ 1519).
 * - 서버 이용료: 전월 구매확정액 500만 원 이상이면 매월 1일 77,000원(VAT 포함)(FAQ 1440).
 * - 정산 식: 상품가격 − 서비스이용료(+제휴마케팅대행비) − 판매자 할인 − … + 선결제 배송비 − 선결제 배송비의 서비스이용료(FAQ 1900).
 * - 쿠폰 부담: 분담 프로모션은 판매자 60% : 11번가 40%(FAQ 1173), 서비스이용료 정책 동의에 따른 추가할인은 판매자 최대 20%(FAQ 1518).
 * - 확인하지 못한 것: 카테고리별 서비스 이용료 표(셀러오피스 로그인 뒤에만 열림), 선결제 배송비 서비스 이용료율(FAQ 에 요율 없음),
 *   원 미만 처리 방식. → 직접 입력
 */
export const ELEVENST_META: RateMeta = {
  market: '11번가',
  sourceName: '11번가 판매자 고객센터 공식 FAQ',
  source: 'https://cs.11st.co.kr/page/seller/faq',
  sources: [
    { label: '상품의 수수료는 판매가 기준인가요? 할인가 기준인가요?', url: 'https://cs.11st.co.kr/page/seller/faq/contents/1216' },
    { label: '11번가 수수료는 부가세 포함인가요?', url: 'https://cs.11st.co.kr/page/seller/faq/contents/1495' },
    { label: '제휴마케팅 대행 동의시 판매자 부담금액 산출', url: 'https://cs.11st.co.kr/page/seller/faq/contents/1519' },
    { label: '서버이용료가 뭔가요?', url: 'https://cs.11st.co.kr/page/seller/faq/contents/1440' },
    { label: '정산금액이 어떻게 계산됐는지 확인하고 싶어요', url: 'https://cs.11st.co.kr/page/seller/faq/contents/1900' },
    { label: '할인쿠폰 분담 비율이 어떻게 되나요?', url: 'https://cs.11st.co.kr/page/seller/faq/contents/1173' },
    { label: '추가할인 적용시 판매자 부담금액 산출', url: 'https://cs.11st.co.kr/page/seller/faq/contents/1518' },
    {
      label: '카테고리별 서비스 이용료(셀러오피스)',
      url: 'https://cs.11st.co.kr/page/seller/faq/contents/252',
      note: '요율 표는 셀러오피스 로그인 뒤에 열림 — 확인해 직접 입력',
    },
  ],
  checkedAt: CHECKED_AT,
  note: '수수료는 부가세 포함입니다. 카테고리별 서비스 이용료율과 선결제 배송비 이용료율은 셀러오피스 로그인 뒤에만 볼 수 있어 직접 입력입니다.',
}

/** 카테고리 서비스 이용료율(%) — 표를 확인하지 못해 직접 입력 */
export const ELEVENST_CATEGORY_FEE: RateDef = { value: null, verified: false, note: '요율 표는 셀러오피스 로그인 필요' }
/** 선결제 배송비 서비스 이용료율(%) — FAQ 에 항목은 있으나 요율이 없음 */
export const ELEVENST_SHIPPING_FEE: RateDef = { value: null, verified: false, note: '공식 FAQ 에 요율 숫자가 없음' }
/** 제휴마케팅 대행비(%) — (판매가 + 선결제 배송비) 기준 */
export const ELEVENST_AFFILIATE_FEE: RateDef = { value: 2, verified: true, note: '가격비교 사이트를 통해 팔린 주문, (판매가 + 선결제 배송비)의 2%' }
/** 서버 이용료(원/월, VAT 포함) — 전월 구매확정액 500만 원 이상 */
export const ELEVENST_SERVER_FEE: RateDef = { value: 77000, verified: true, note: '전월 구매확정액 500만 원 이상, 매월 1일 부과' }
export const ELEVENST_SERVER_FEE_THRESHOLD = 5_000_000

/** 쿠폰(할인) 금액 중 판매자가 부담하는 비율(%) */
export const ELEVENST_COUPON_SHARES = [
  { id: 'seller', label: '판매자 쿠폰·즉시할인 (100%)', share: 100, verified: true },
  { id: 'split', label: '분담 프로모션 (판매자 60%)', share: 60, verified: true },
  { id: 'auto', label: '11번가 추가할인 (판매자 최대 20%)', share: 20, verified: true },
  { id: 'custom', label: '직접 입력', share: null, verified: false },
] as const
export type ElevenstCouponKind = (typeof ELEVENST_COUPON_SHARES)[number]['id']
