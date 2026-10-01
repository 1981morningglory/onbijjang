/**
 * 마켓별 요율·옵션 입력 묶음. 개별 계산기와 비교 도구의 "마켓별 세부 설정"이 같은 부품을 쓴다.
 * 모든 요율은 여기서 직접 고칠 수 있고, 기본값과 다르면 "수정됨"으로 표시된다.
 */
import { Callout, Field, NumberInput, Segmented, Select, Switch } from '@/ui'
import { fmt } from '@/lib/hooks'
import type { CoupangSettings, ElevenstSettings, EsmSettings, RocketSettings, SmartstoreSettings } from './calc'
import { COUPANG_CATEGORIES, COUPANG_MONTHLY_FEE, COUPANG_SHIPPING_FEE, COUPANG_VAT_ON_FEE } from './rates/coupang'
import { ELEVENST_AFFILIATE_FEE, ELEVENST_CATEGORY_FEE, ELEVENST_SERVER_FEE, ELEVENST_SHIPPING_FEE } from './rates/elevenst'
import { ESM_AFFILIATE_FEE, ESM_PROMO_FEE, ESM_SERVER_FEE, ESM_SHIPPING_FEE } from './rates/esm'
import { ROCKET_DELIVERY_FEE, ROCKET_FREE_STORAGE_DAYS, ROCKET_FULFILL_FEE, ROCKET_SAVER_MONTHLY, ROCKET_SIZES } from './rates/rocket'
import { SMARTSTORE_CONNECT_FEE, SMARTSTORE_INFLOWS, SMARTSTORE_ORDER_FEE, SMARTSTORE_SALES_FEE, SMARTSTORE_TIERS } from './rates/smartstore'
import type { CategoryRate } from './rates/types'
import { findCategory } from './settings'
import { AmountField, CategoryField, Disclosure, MoneyInput, NeedCheck, RateField, orNull } from './ui'

type Editor<S> = { s: S; patch: (next: Partial<S>) => void }

const GRID = 'grid gap-3 sm:grid-cols-2'

/** 카테고리 + 그 카테고리의 요율(직접 고치기 가능) */
function CategoryRateFields({
  categories, categoryId, rateOverride, onChange, rateLabel,
}: {
  categories: CategoryRate[]
  categoryId: string
  rateOverride: number | null
  onChange: (next: { categoryId?: string; rateOverride?: number | null }) => void
  rateLabel: string
}) {
  const category = findCategory(categories, categoryId)
  return (
    <div className={GRID}>
      <CategoryField categories={categories} value={category} onValue={(c) => onChange({ categoryId: c.id, rateOverride: null })} hint="이름으로 검색해 고르면 요율이 따라옵니다" />
      <RateField
        label={rateLabel}
        value={rateOverride ?? category.rate}
        onValue={(v) => onChange({ rateOverride: v == null || v === category.rate ? null : v })}
        def={{ value: category.rate, verified: true }}
      />
    </div>
  )
}

function MonthlyOrders({ value, onValue, label = '월 예상 판매 건수' }: { value: number; onValue: (v: number) => void; label?: string }) {
  return <Field label={label}>{(id) => <NumberInput id={id} min={0} step={1} value={value} onValue={(v) => onValue(Math.max(0, Math.round(v ?? 0)))} unit="건" />}</Field>
}

// ── 스마트스토어 ──────────────────────────────────────────
export function SmartstoreFees({ s, patch }: Editor<SmartstoreSettings>) {
  const empty = s.orderFee[s.tier] == null || s.salesFee[s.inflow] == null
  return (
    <div className="flex flex-col gap-3">
      <div className={GRID}>
        <Field label="사업자 등급" hint="네이버페이 주문관리 수수료가 등급마다 다릅니다">
          {(id) => <Select id={id} value={s.tier} onValue={(tier) => patch({ tier })} options={SMARTSTORE_TIERS.map((t) => ({ value: t.id, label: t.label }))} />}
        </Field>
        <RateField
          label="주문관리 수수료율"
          value={s.orderFee[s.tier]}
          onValue={(v) => patch({ orderFee: { ...s.orderFee, [s.tier]: v } })}
          def={SMARTSTORE_ORDER_FEE[s.tier]}
          hint="판매가 + 고객 배송비에 매깁니다"
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-2">유입 경로</span>
          <Segmented label="유입 경로" block value={s.inflow} onValue={(inflow) => patch({ inflow })} options={SMARTSTORE_INFLOWS.map((i) => ({ value: i.id, label: i.label }))} />
        </div>
        <RateField
          label="판매 수수료율"
          value={s.salesFee[s.inflow]}
          onValue={(v) => patch({ salesFee: { ...s.salesFee, [s.inflow]: v } })}
          def={SMARTSTORE_SALES_FEE[s.inflow]}
          hint="판매가에 매깁니다"
        />
      </div>
      {empty && (
        <Callout tone="warn" title="요율을 직접 넣어 주세요">
          스마트스토어 수수료 안내 페이지를 자동으로 확인할 수 없어 기본값을 비워 두었습니다. 스마트스토어센터의 수수료 안내에 나온 요율을 한 번 넣으면 이 브라우저에 저장됩니다.
        </Callout>
      )}
      <Switch checked={s.connect} onChange={(connect) => patch({ connect })} label="쇼핑커넥트로 판매" hint="창작자 링크로 팔린 주문에 붙는 수수료를 더합니다" />
      {s.connect && (
        <div className={GRID}>
          <RateField label="쇼핑커넥트 수수료율" value={s.connectRate} onValue={(connectRate) => patch({ connectRate })} def={SMARTSTORE_CONNECT_FEE} hint="내가 정한 비율(판매가 기준)" />
        </div>
      )}
    </div>
  )
}

// ── 쿠팡 마켓플레이스 ─────────────────────────────────────
function VatSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch
      checked={checked}
      onChange={onChange}
      label={
        <span className="flex flex-wrap items-center gap-1.5">
          수수료에 부가세 10% 더하기 <NeedCheck note={COUPANG_VAT_ON_FEE.note} />
        </span>
      }
      hint="공식 수수료 표에 부가세 표기가 없습니다. WING 정산 내역과 맞춰 보고 끄거나 켜세요."
    />
  )
}

export function CoupangFees({ s, patch }: Editor<CoupangSettings>) {
  return (
    <div className="flex flex-col gap-3">
      <CategoryRateFields categories={COUPANG_CATEGORIES} categoryId={s.categoryId} rateOverride={s.rateOverride} onChange={patch} rateLabel="판매 수수료율" />
      <VatSwitch checked={s.vat} onChange={(vat) => patch({ vat })} />
      <div className={GRID}>
        <RateField label="배송비 수수료율" value={s.shipFeeRate} onValue={(shipFeeRate) => patch({ shipFeeRate })} def={COUPANG_SHIPPING_FEE} hint="고객이 낸 배송비에 매깁니다(유료배송만)" />
      </div>
      <Switch checked={s.monthlyFee} onChange={(monthlyFee) => patch({ monthlyFee })} label="월 서비스 이용료 반영" hint="배송비를 뺀 월 매출이 100만 원 이상이면 월 1회 부과(VAT 포함)" />
      {s.monthlyFee && (
        <div className={GRID}>
          <AmountField label="월 서비스 이용료" value={s.monthlyFeeAmount} onValue={(v) => patch({ monthlyFeeAmount: v ?? 0 })} def={COUPANG_MONTHLY_FEE} />
          <MonthlyOrders value={s.monthlyOrders} onValue={(monthlyOrders) => patch({ monthlyOrders })} />
        </div>
      )}
    </div>
  )
}

// ── 로켓그로스 ────────────────────────────────────────────
export function RocketFees({ s, patch, compact }: Editor<RocketSettings> & { compact?: boolean }) {
  const size = ROCKET_SIZES.find((x) => x.id === s.sizeType) ?? ROCKET_SIZES[0]
  const freeDays = s.saver ? s.saverFreeStorageDays : s.freeStorageDays
  return (
    <div className="flex flex-col gap-3">
      <CategoryRateFields categories={COUPANG_CATEGORIES} categoryId={s.categoryId} rateOverride={s.rateOverride} onChange={patch} rateLabel="판매 수수료율" />
      <VatSwitch checked={s.vat} onChange={(vat) => patch({ vat })} />

      <div className={GRID}>
        <Field label="사이즈 유형" hint={`세 변의 합 ${size.maxSumCm}cm 이하 · ${size.maxKg}kg 이하`} className="sm:col-span-2">
          {(id) => <Select id={id} value={s.sizeType} onValue={(sizeType) => patch({ sizeType })} options={ROCKET_SIZES.map((x) => ({ value: x.id, label: x.label }))} />}
        </Field>
        <AmountField label="입출고비 (개당)" value={s.fulfillFee} onValue={(fulfillFee) => patch({ fulfillFee })} def={ROCKET_FULFILL_FEE} />
        <AmountField label="배송비 (개당)" value={s.deliveryFee} onValue={(deliveryFee) => patch({ deliveryFee })} def={ROCKET_DELIVERY_FEE} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-sunken px-3 py-2 text-sm text-ink-2">
        <p className="min-w-0 flex-1">
          {size.label} 공개 최저 요금: 입출고비 <span className="num font-semibold">{fmt.format(size.fulfillFrom)}원</span>부터, 배송비{' '}
          <span className="num font-semibold">{fmt.format(size.deliveryFrom[0])}원</span>부터(다른 공식 페이지에는 <span className="num">{fmt.format(size.deliveryFrom[1])}원</span>부터). 실제 금액은 카테고리·판매가에 따라 더 높을 수 있어
          WING 요금표에서 확인해 넣으세요.
        </p>
        <button
          type="button"
          onClick={() => patch({ fulfillFee: size.fulfillFrom, deliveryFee: size.deliveryFrom[0] })}
          className="shrink-0 rounded-xs text-sm font-semibold text-brand-ink underline underline-offset-2 hover:text-brand"
        >
          최저 요금으로 채우기
        </button>
      </div>
      <Switch
        checked={s.logisticsVat}
        onChange={(logisticsVat) => patch({ logisticsVat })}
        label={
          <span className="flex flex-wrap items-center gap-1.5">
            물류 요금에 부가세 10% 더하기 <NeedCheck note="요금표 금액의 부가세 포함 여부를 확인하지 못함" />
          </span>
        }
        hint="입출고비·배송비·보관비·반품비·부가서비스에 적용합니다"
      />

      {!compact && (
        <div className={GRID}>
          <Field label="쿠팡 창고로 보낸 물류비 (총액)" hint="택배·화물비 전체">
            {(id) => <MoneyInput id={id} value={orNull(s.inboundTotal)} onValue={(v) => patch({ inboundTotal: v ?? 0 })} />}
          </Field>
          <Field label="그때 보낸 수량" hint="총액 ÷ 수량 = 개당 물류비">
            {(id) => <NumberInput id={id} min={0} step={1} value={orNull(s.inboundQty)} onValue={(v) => patch({ inboundQty: Math.max(0, Math.round(v ?? 0)) })} unit="개" placeholder="0" />}
          </Field>
        </div>
      )}

      <Switch checked={s.saver} onChange={(saver) => patch({ saver })} label="로켓그로스 세이버 가입" hint="모든 상품 60일 무료 보관, 반품 회수·재입고비 무료" />
      {s.saver && (
        <div className={GRID}>
          <AmountField label="세이버 월 구독료" value={s.saverMonthly} onValue={(v) => patch({ saverMonthly: v ?? 0 })} def={ROCKET_SAVER_MONTHLY} />
          <Field label="월 판매 수량" hint="구독료를 이 수량으로 나눠 1개 몫을 냅니다">
            {(id) => <NumberInput id={id} min={0} step={1} value={orNull(s.monthlyUnits)} onValue={(v) => patch({ monthlyUnits: Math.max(0, Math.round(v ?? 0)) })} unit="개" placeholder="0" />}
          </Field>
        </div>
      )}

      {!compact && (
        <>
          <div className={GRID}>
            <Field label="예상 보관일" hint={`무료 ${freeDays}일을 넘는 날만 보관비가 붙습니다`}>
              {(id) => <NumberInput id={id} min={0} step={1} value={orNull(s.storageDays)} onValue={(v) => patch({ storageDays: Math.max(0, Math.round(v ?? 0)) })} unit="일" placeholder="0" />}
            </Field>
            <Field label="하루 보관비 (개당)" hint="WING 요금표의 금액을 넣으세요">
              {(id) => <NumberInput id={id} min={0} step={0.1} value={orNull(s.storageDailyFee)} onValue={(v) => patch({ storageDailyFee: Math.max(0, v ?? 0) })} unit="원" placeholder="0" />}
            </Field>
            {!s.saver && (
              <Field label="무료 보관 기간" className="sm:col-span-2">
                {(id) => (
                  <Select
                    id={id}
                    value={String(s.freeStorageDays)}
                    onValue={(v) => patch({ freeStorageDays: Number(v) })}
                    options={[
                      { value: String(ROCKET_FREE_STORAGE_DAYS.base), label: `${ROCKET_FREE_STORAGE_DAYS.base}일 (기본)` },
                      { value: String(ROCKET_FREE_STORAGE_DAYS.apparelPromo), label: `${ROCKET_FREE_STORAGE_DAYS.apparelPromo}일 (의류·신발·악세서리 프로모션)` },
                    ]}
                  />
                )}
              </Field>
            )}
          </div>
          <Disclosure variant="inline" title="반품·부가서비스 비용">
            <div className="flex flex-col gap-3">
              {s.saver ? (
                <p className="text-sm text-muted">세이버 가입 중에는 반품 회수비·재입고비가 무료라 계산에서 뺍니다.</p>
              ) : (
                <p className="text-sm text-muted">세이버가 아니어도 매달 반품 회수 20건·재입고 20개는 무료(프로모션)입니다. 그보다 많이 나올 때의 금액을 넣으세요.</p>
              )}
              <div className={GRID}>
                <Field label="반품률" hint="100개 팔면 몇 개가 돌아오는지">
                  {(id) => <NumberInput id={id} min={0} max={100} step={0.5} value={orNull(s.returnRate)} onValue={(v) => patch({ returnRate: Math.min(100, Math.max(0, v ?? 0)) })} unit="%" placeholder="0" disabled={s.saver} />}
                </Field>
                <Field label="반품 회수비 (1건)">{(id) => <MoneyInput id={id} value={orNull(s.returnPickupFee)} onValue={(v) => patch({ returnPickupFee: v ?? 0 })} disabled={s.saver} />}</Field>
                <Field label="반품 재입고비 (1개)">{(id) => <MoneyInput id={id} value={orNull(s.returnRestockFee)} onValue={(v) => patch({ returnRestockFee: v ?? 0 })} disabled={s.saver} />}</Field>
                <Field label="부가서비스 (개당)" hint="바코드 부착 등">
                  {(id) => <MoneyInput id={id} value={orNull(s.extraFee)} onValue={(v) => patch({ extraFee: v ?? 0 })} />}
                </Field>
              </div>
            </div>
          </Disclosure>
        </>
      )}
    </div>
  )
}

// ── G마켓 · 옥션 ──────────────────────────────────────────
export function EsmFees({ s, patch, categories }: Editor<EsmSettings> & { categories: CategoryRate[] }) {
  return (
    <div className="flex flex-col gap-3">
      <CategoryRateFields categories={categories} categoryId={s.categoryId} rateOverride={s.rateOverride} onChange={patch} rateLabel="카테고리 서비스 이용료율" />
      <div className={GRID}>
        <RateField label="선결제 배송비 이용료율" value={s.shipFeeRate} onValue={(shipFeeRate) => patch({ shipFeeRate })} def={ESM_SHIPPING_FEE} hint="무료배송·착불에는 붙지 않습니다" />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-2">원 미만 처리</span>
          <Segmented
            label="원 미만 처리"
            block
            value={s.rounding}
            onValue={(rounding) => patch({ rounding })}
            options={[
              { value: 'ceil', label: '올림 (공식 가이드)' },
              { value: 'floor', label: '버림' },
            ]}
          />
        </div>
      </div>
      <Switch checked={s.affiliate} onChange={(affiliate) => patch({ affiliate })} label="제휴채널 프로모션 대행 동의" hint="동의한 판매자는 판매가의 2%를 공제합니다" />
      {s.affiliate && (
        <div className={GRID}>
          <RateField label="제휴채널 이용료율" value={s.affiliateRate} onValue={(affiliateRate) => patch({ affiliateRate })} def={ESM_AFFILIATE_FEE} />
        </div>
      )}
      <Switch checked={s.promo} onChange={(promo) => patch({ promo })} label="프로모션 참여" hint="참여한 프로모션의 이용료율을 넣습니다(판매가 기준)" />
      {s.promo && (
        <div className={GRID}>
          <RateField label="프로모션 참여 이용료율" value={s.promoRate} onValue={(promoRate) => patch({ promoRate })} def={ESM_PROMO_FEE} />
        </div>
      )}
      <Switch checked={s.serverFee} onChange={(serverFee) => patch({ serverFee })} label="월 서버 이용료 반영" hint="전월 상품 판매대금이 500만 원 이상인 판매아이디에 부과" />
      {s.serverFee && (
        <div className={GRID}>
          <AmountField label="월 서버 이용료" value={s.serverFeeAmount} onValue={(v) => patch({ serverFeeAmount: v ?? 0 })} def={ESM_SERVER_FEE} />
          <MonthlyOrders value={s.monthlyOrders} onValue={(monthlyOrders) => patch({ monthlyOrders })} />
        </div>
      )}
    </div>
  )
}

// ── 11번가 ────────────────────────────────────────────────
export function ElevenstFees({ s, patch }: Editor<ElevenstSettings>) {
  return (
    <div className="flex flex-col gap-3">
      <div className={GRID}>
        <RateField label="카테고리 서비스 이용료율" value={s.rate} onValue={(rate) => patch({ rate })} def={ELEVENST_CATEGORY_FEE} hint="할인 전 판매가에 매깁니다(부가세 포함)" />
        <RateField label="선결제 배송비 이용료율" value={s.shipFeeRate} onValue={(shipFeeRate) => patch({ shipFeeRate })} def={ELEVENST_SHIPPING_FEE} hint="고객이 낸 배송비에 매깁니다" />
      </div>
      {s.rate == null && (
        <Callout tone="warn" title="카테고리 요율을 직접 넣어 주세요">
          11번가 카테고리별 서비스 이용료 표는 셀러오피스에 로그인해야 열려 기본값을 넣지 못했습니다. 상품 등록 화면의 ‘카테고리별 서비스이용료’에서 확인한 요율을 넣으세요.
        </Callout>
      )}
      <Switch checked={s.affiliate} onChange={(affiliate) => patch({ affiliate })} label="제휴마케팅(가격비교) 주문" hint="가격비교 사이트를 거친 주문은 (판매가 + 선결제 배송비)의 2%" />
      {s.affiliate && (
        <div className={GRID}>
          <RateField label="제휴마케팅 대행비율" value={s.affiliateRate} onValue={(affiliateRate) => patch({ affiliateRate })} def={ELEVENST_AFFILIATE_FEE} />
        </div>
      )}
      <Switch checked={s.serverFee} onChange={(serverFee) => patch({ serverFee })} label="월 서버 이용료 반영" hint="전월 구매확정액이 500만 원 이상이면 매월 1일 부과(VAT 포함)" />
      {s.serverFee && (
        <div className={GRID}>
          <AmountField label="월 서버 이용료" value={s.serverFeeAmount} onValue={(v) => patch({ serverFeeAmount: v ?? 0 })} def={ELEVENST_SERVER_FEE} />
          <MonthlyOrders value={s.monthlyOrders} onValue={(monthlyOrders) => patch({ monthlyOrders })} />
        </div>
      )}
    </div>
  )
}
