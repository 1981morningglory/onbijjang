import { useCallback, useMemo } from 'react'
import { usePersistentState } from '@/lib/hooks'
import { Field, Section } from '@/ui'
import { calcEsm, type Product } from './calc'
import { EsmFees } from './editors'
import { ProductShelf } from './products'
import { EMPTY_PRODUCT, EXAMPLE_PRODUCT, MARKET_CATEGORIES, MARKET_LABEL, MARKET_META, findCategory, useMarketSettings } from './settings'
import { CalcPage, MoneyInput, ProductFields, ResetRates, orNull } from './ui'

/** G마켓·옥션 공용 계산기. 마켓에 따라 카테고리 표와 저장 위치만 다르다. */
export function EsmCalculator({ market }: { market: 'gmarket' | 'auction' }) {
  const categories = MARKET_CATEGORIES[market]!
  const [product, setProduct] = usePersistentState<Product>(`onbijjang:${market}:product`, EMPTY_PRODUCT)
  const [extra, setExtra] = usePersistentState<{ discount: number }>(`onbijjang:${market}:extra`, { discount: 0 })
  const { settings, patch, reset } = useMarketSettings(market)
  const rate = findCategory(categories, settings.categoryId).rate
  const result = useMemo(() => calcEsm(product, settings, rate, extra), [product, settings, rate, extra])
  const calcAt = useCallback((price: number) => calcEsm({ ...product, price }, settings, rate, extra), [product, settings, rate, extra])
  const change = (next: Partial<Product>) => setProduct((p) => ({ ...p, ...next }))
  const overDiscount = extra.discount > product.price && product.price > 0

  return (
    <CalcPage
      title={MARKET_LABEL[market]}
      meta={MARKET_META[market]}
      product={product}
      result={result}
      calcAt={calcAt}
      onPrice={(price) => change({ price })}
      onExample={() => {
        setProduct(EXAMPLE_PRODUCT)
        setExtra({ discount: 1000 })
        patch({ categoryId: '주방용품 > 전체', rateOverride: null })
      }}
      onReset={() => {
        setProduct(EMPTY_PRODUCT)
        setExtra({ discount: 0 })
      }}
      shelf={<ProductShelf product={product} onLoad={setProduct} />}
      basis={
        <ul>
          <li>서비스 이용료 = 판매가(할인 전) × 카테고리별 서비스 이용료율 + 선결제 배송비 × 3.3%. 무료배송과 착불에는 배송비 이용료가 없습니다.</li>
          <li>판매자 부담 할인은 이용료 기준을 줄이지 않습니다. 할인 전 판매가로 이용료를 매기고, 할인액은 그대로 내 비용이 됩니다.</li>
          <li>제휴채널 프로모션 대행에 동의했다면 판매가의 2%를 더 뺍니다.</li>
          <li>이용료는 공식 판매자 가이드의 ‘원단위 절상’에 따라 원 미만을 올립니다. 정산 내역과 1원씩 다르면 ‘버림’으로 바꿔 보세요.</li>
          <li>주문 1건 이익 = 판매가 − 할인 + 선결제 배송비 − 이용료 − 원가 − 택배비, 이익률 = 이익 ÷ 판매가</li>
          <li>월 서버 이용료는 주문 1건 이익에 넣지 않고, 월 이익(1건 이익 × 월 판매 건수 − 서버 이용료)으로 따로 보여 줍니다.</li>
        </ul>
      }
    >
      <Section title="상품">
        <ProductFields product={product} onChange={change} shipModes={['free', 'paid', 'cod']} shipLabels={{ paid: '선결제' }}>
          <Field
            label="판매자 부담 할인"
            hint="내가 부담하는 즉시할인·쿠폰 금액"
            error={overDiscount ? '할인이 판매가보다 큽니다. 판매가까지만 반영했습니다.' : undefined}
            className="sm:col-span-2"
          >
            {(id) => <MoneyInput id={id} value={orNull(extra.discount)} onValue={(v) => setExtra({ discount: v ?? 0 })} invalid={overDiscount} />}
          </Field>
        </ProductFields>
      </Section>
      <Section title="이용료" action={<ResetRates onReset={reset} />}>
        <EsmFees s={settings} patch={patch} categories={categories} />
      </Section>
    </CalcPage>
  )
}
