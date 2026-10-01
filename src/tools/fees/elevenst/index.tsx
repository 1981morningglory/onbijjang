import { useCallback, useMemo } from 'react'
import { usePersistentState } from '@/lib/hooks'
import { Field, Section, Select } from '@/ui'
import { calcElevenst, type Product } from '../shared/calc'
import { ElevenstFees } from '../shared/editors'
import { ProductShelf } from '../shared/products'
import { ELEVENST_COUPON_SHARES, type ElevenstCouponKind } from '../shared/rates/elevenst'
import { EMPTY_PRODUCT, EXAMPLE_PRODUCT, MARKET_META, useMarketSettings } from '../shared/settings'
import { CalcPage, MoneyInput, NeedCheck, PercentInput, ProductFields, ResetRates } from '../shared/ui'

interface Extra {
  /** 쿠폰 적용 후 금액. 비어 있으면 쿠폰 없음 */
  couponPrice: number | null
  couponKind: ElevenstCouponKind
}
const NO_COUPON: Extra = { couponPrice: null, couponKind: 'seller' }

export default function ElevenstTool() {
  const [product, setProduct] = usePersistentState<Product>('onbijjang:elevenst:product', EMPTY_PRODUCT)
  const [extra, setExtra] = usePersistentState<Extra>('onbijjang:elevenst:extra', NO_COUPON)
  const { settings, patch, reset } = useMarketSettings('elevenst')

  const couponOver = extra.couponPrice != null && extra.couponPrice > product.price && product.price > 0
  const couponDiscount = extra.couponPrice == null ? 0 : Math.max(0, product.price - extra.couponPrice)
  const result = useMemo(() => calcElevenst(product, settings, { couponDiscount }), [product, settings, couponDiscount])
  // 역산할 때는 쿠폰 할인액을 그대로 두고 판매가만 바꾼다.
  const calcAt = useCallback((price: number) => calcElevenst({ ...product, price }, settings, { couponDiscount }), [product, settings, couponDiscount])
  const change = (next: Partial<Product>) => setProduct((p) => ({ ...p, ...next }))
  const kind = ELEVENST_COUPON_SHARES.find((k) => k.id === extra.couponKind) ?? ELEVENST_COUPON_SHARES[0]

  return (
    <CalcPage
      title="11번가"
      meta={MARKET_META.elevenst}
      product={product}
      result={result}
      calcAt={calcAt}
      onPrice={(price) => {
        // 판매가를 바꿔도 쿠폰 할인액이 유지되도록 쿠폰 적용 후 금액을 같이 옮긴다.
        if (extra.couponPrice != null) setExtra({ ...extra, couponPrice: Math.max(0, price - couponDiscount) })
        change({ price })
      }}
      onExample={() => {
        setProduct(EXAMPLE_PRODUCT)
        setExtra({ couponPrice: EXAMPLE_PRODUCT.price - 1000, couponKind: 'seller' })
        patch({ couponShare: 100 })
      }}
      onReset={() => {
        setProduct(EMPTY_PRODUCT)
        setExtra(NO_COUPON)
        patch({ couponShare: 100 })
      }}
      shelf={<ProductShelf product={product} onLoad={(p) => setProduct({ ...p, shipMode: p.shipMode === 'cod' ? 'paid' : p.shipMode })} />}
      basis={
        <ul>
          <li>서비스 이용료 = 할인 전 판매가 × 카테고리 서비스 이용료율. 11번가 수수료는 부가세 포함입니다.</li>
          <li>선결제 배송비 이용료 = 고객이 낸 배송비 × 배송비 이용료율 (유료배송일 때만)</li>
          <li>제휴마케팅 대행비 = (판매가 + 선결제 배송비) × 2% — 가격비교 사이트를 거친 주문에만 붙습니다.</li>
          <li>쿠폰 부담 = (판매가 − 쿠폰 적용 후 금액) × 판매자 부담 비율. 판매자 쿠폰은 100%, 분담 프로모션은 60%, 11번가가 붙이는 추가할인은 최대 20%입니다.</li>
          <li>각 금액은 원 미만을 버립니다(11번가의 원 미만 처리 방식은 공식 안내에서 확인하지 못했습니다).</li>
          <li>주문 1건 이익 = 판매가 + 선결제 배송비 − 이용료 − 쿠폰 부담 − 원가 − 택배비, 이익률 = 이익 ÷ 판매가</li>
          <li>월 서버 이용료는 주문 1건 이익에 넣지 않고 월 이익으로 따로 보여 줍니다.</li>
        </ul>
      }
    >
      <Section title="상품">
        <ProductFields product={product} onChange={change}>
          <Field
            label="쿠폰 적용 후 금액"
            hint={couponDiscount > 0 ? `할인 ${new Intl.NumberFormat('ko-KR').format(couponDiscount)}원` : '쿠폰이 없으면 비워 둡니다'}
            error={couponOver ? '판매가보다 큰 금액입니다. 쿠폰 없음으로 계산했습니다.' : undefined}
          >
            {(id) => <MoneyInput id={id} value={extra.couponPrice} onValue={(couponPrice) => setExtra({ ...extra, couponPrice })} placeholder="쿠폰 없음" invalid={couponOver} />}
          </Field>
          <Field label="쿠폰 부담" aside={kind.id === 'custom' ? <NeedCheck note="참여한 프로모션의 분담 비율을 확인해 넣으세요" /> : undefined}>
            {(id) => (
              <Select
                id={id}
                value={extra.couponKind}
                onValue={(couponKind) => {
                  setExtra({ ...extra, couponKind })
                  const share = ELEVENST_COUPON_SHARES.find((k) => k.id === couponKind)?.share
                  if (share != null) patch({ couponShare: share })
                }}
                options={ELEVENST_COUPON_SHARES.map((k) => ({ value: k.id, label: k.label }))}
              />
            )}
          </Field>
          {kind.id === 'custom' && (
            <Field label="판매자 부담 비율" className="sm:col-span-2">
              {(id) => <PercentInput id={id} value={settings.couponShare} onValue={(v) => patch({ couponShare: v ?? 0 })} placeholder="100" />}
            </Field>
          )}
        </ProductFields>
      </Section>
      <Section title="이용료" action={<ResetRates onReset={reset} />}>
        <ElevenstFees s={settings} patch={patch} />
      </Section>
    </CalcPage>
  )
}
