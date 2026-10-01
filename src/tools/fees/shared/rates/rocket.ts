import { CHECKED_AT, type RateDef, type RateMeta } from './types'

/**
 * 쿠팡 로켓그로스
 *
 * 확인 결과(2026-10-01)
 * - 판매 수수료: "판매자배송과 동일"(공식 페이지) → 쿠팡 마켓플레이스 카테고리 표를 그대로 쓴다.
 * - 사이즈 유형 기준(세 변의 합·무게): WING 사이즈 가이드(로그인 없이 열림)에서 확인.
 * - 입출고비·배송비: 실제 금액은 "카테고리·사이즈 유형·판매가에 따라" 정해지고 상세 요금표는 WING 로그인 뒤에만 열린다.
 *   공개 페이지에는 사이즈별 "~원부터" 값만 있다. 입출고비 최저값은 두 공식 페이지가 같고,
 *   배송비 최저값은 두 공식 페이지가 서로 다르다(아래 주석). → 입력 칸은 "직접 입력"으로 두고 최저값은 참고로만 보여 준다.
 * - 보관비 단가, 반품 회수비·재입고비 단가, 부가서비스 단가: 공개 페이지에 금액이 없다 → 직접 입력.
 * - 세이버: 월 99,000원, 모든 상품 60일 무료 보관, 반품 회수·재입고비 무제한 무료(공식 세이버 페이지).
 */
export const ROCKET_META: RateMeta = {
  market: '로켓그로스',
  sourceName: '쿠팡 로켓그로스 공식 안내',
  source: 'https://marketplace.coupang.com/rocket-growth',
  sources: [
    { label: '쿠팡 로켓그로스 — 비용 구성', url: 'https://marketplace.coupang.com/rocket-growth' },
    { label: '로켓그로스 비용/수수료', url: 'https://marketplace.coupang.com/rocketgrowth-fee-after-zerocostpromotion' },
    { label: '로켓그로스 세이버', url: 'https://marketplace.coupang.com/rg-promotion/saverpack-benefit' },
    { label: '로켓그로스 사이즈 유형 기준(WING)', url: 'https://wing.coupang.com/tenants/rfm/settlements/size-guide' },
    {
      label: '입출고·배송 요금표(WING)',
      url: 'https://wing.coupang.com/tenants/rfm/settlements/fee-details',
      note: 'WING 로그인 필요 — 실제 요금은 여기서 확인해 입력',
    },
    { label: '쿠팡 마켓플레이스 카테고리별 판매 수수료', url: 'https://cloud.mkt.coupang.com/Fee-Table' },
  ],
  checkedAt: CHECKED_AT,
  note: '입출고비·배송비는 카테고리·사이즈·판매가에 따라 달라 공개 페이지에는 최저 요금만 있습니다. WING 요금표의 금액을 직접 입력하세요. 물류 요금의 부가세 포함 여부는 확인하지 못했습니다.',
}

export interface RocketSize {
  id: 'xs' | 's' | 'm' | 'l1' | 'l2' | 'xl'
  label: string
  /** 세 변의 합(cm) 상한 */
  maxSumCm: number
  /** 무게(kg) 상한 */
  maxKg: number
  /** 공개 페이지의 입출고비 "~원부터" 값. 두 공식 페이지가 같다 */
  fulfillFrom: number
  /** 공개 페이지의 배송비 "~원부터" 값 — 페이지마다 다르다 [rocket-growth, rocketgrowth-fee-after-zerocostpromotion] */
  deliveryFrom: [number, number]
}

/** 사이즈 기준: WING 사이즈 가이드. 최저 요금: 공개 페이지 두 곳 */
export const ROCKET_SIZES: RocketSize[] = [
  { id: 'xs', label: '극소형', maxSumCm: 80, maxKg: 2, fulfillFrom: 600, deliveryFrom: [1125, 1350] },
  { id: 's', label: '소형', maxSumCm: 100, maxKg: 5, fulfillFrom: 650, deliveryFrom: [1250, 1550] },
  { id: 'm', label: '중형', maxSumCm: 120, maxKg: 10, fulfillFrom: 1250, deliveryFrom: [1500, 2100] },
  { id: 'l1', label: '대형1', maxSumCm: 140, maxKg: 15, fulfillFrom: 1375, deliveryFrom: [1700, 2200] },
  { id: 'l2', label: '대형2', maxSumCm: 160, maxKg: 20, fulfillFrom: 1375, deliveryFrom: [2900, 4100] },
  { id: 'xl', label: '특대형', maxSumCm: 250, maxKg: 30, fulfillFrom: 1375, deliveryFrom: [3500, 5600] },
]
export type RocketSizeId = RocketSize['id']

/** 입출고비(개당, 원) — 실제 요금표는 로그인 뒤에만 볼 수 있어 직접 입력 */
export const ROCKET_FULFILL_FEE: RateDef = { value: null, verified: false, note: '카테고리·사이즈·판매가별 요금표는 WING 로그인 필요' }
/** 배송비(개당, 원) — 위와 같음. 공개된 최저값도 페이지마다 다름 */
export const ROCKET_DELIVERY_FEE: RateDef = { value: null, verified: false, note: '공개 페이지 두 곳의 최저 요금이 서로 다름' }

/** 세이버 월 구독료(원) */
export const ROCKET_SAVER_MONTHLY: RateDef = { value: 99000, verified: true, note: '공식 세이버 페이지 "월 99,000원"' }
/** 무료 보관일: 기본 30일(의류·신발·악세서리 45일 프로모션), 세이버 60일 */
export const ROCKET_FREE_STORAGE_DAYS = { base: 30, apparelPromo: 45, saver: 60, verified: true }
/** 세이버 없이도 매달 무료인 건수(프로모션 중): 반품 회수 20건, 반품 재입고 20개, 반출 20개 */
export const ROCKET_FREE_MONTHLY = { returnPickup: 20, returnRestock: 20, removal: 20, verified: true }
