import { useCallback, useMemo } from 'react'
import { usePersistentState } from '@/lib/hooks'
import { Section } from '@/ui'
import { calcCoupang, type Product } from '../shared/calc'
import { CoupangFees } from '../shared/editors'
import { ProductShelf } from '../shared/products'
import { COUPANG_CATEGORIES } from '../shared/rates/coupang'
import { EMPTY_PRODUCT, EXAMPLE_PRODUCT, MARKET_META, findCategory, useMarketSettings } from '../shared/settings'
import { CalcPage, ProductFields, ResetRates } from '../shared/ui'

export default function CoupangTool() {
  const [product, setProduct] = usePersistentState<Product>('onbijjang:coupang:product', EMPTY_PRODUCT)
  const { settings, patch, reset } = useMarketSettings('coupang')
  const rate = findCategory(COUPANG_CATEGORIES, settings.categoryId).rate
  const result = useMemo(() => calcCoupang(product, settings, rate), [product, settings, rate])
  const calcAt = useCallback((price: number) => calcCoupang({ ...product, price }, settings, rate), [product, settings, rate])
  const change = (next: Partial<Product>) => setProduct((p) => ({ ...p, ...next }))

  return (
    <CalcPage
      title="쿠팡 마켓플레이스"
      meta={MARKET_META.coupang}
      product={product}
      result={result}
      calcAt={calcAt}
      onPrice={(price) => change({ price })}
      onExample={() => {
        setProduct(EXAMPLE_PRODUCT)
        patch({ categoryId: '주방용품 > 기본 수수료', rateOverride: null })
      }}
      onReset={() => setProduct(EMPTY_PRODUCT)}
      shelf={<ProductShelf product={product} onLoad={(p) => setProduct({ ...p, shipMode: p.shipMode === 'cod' ? 'paid' : p.shipMode })} />}
      basis={
        <ul>
          <li>판매 수수료 = 판매가 × 카테고리 수수료율. 쿠팡은 고객이 결제한 최종 가격(할인 뒤 가격)에 수수료를 매기므로, 할인 중이면 할인된 가격을 판매가에 넣으세요.</li>
          <li>‘부가세 10% 더하기’를 켜면 요율에 1.1을 곱해 계산합니다(10.8% → 11.88%).</li>
          <li>배송비 수수료 = 고객이 낸 배송비 × 배송비 수수료율 (유료배송일 때만)</li>
          <li>각 수수료는 원 미만을 버립니다.</li>
          <li>이익 = 판매가 + 고객이 낸 배송비 − 수수료 − 원가 − 택배비, 이익률 = 이익 ÷ 판매가</li>
          <li>월 서비스 이용료를 켜면 주문 1건 이익과 따로 월 이익(1건 이익 × 판매 건수 − 이용료)을 보여 줍니다.</li>
        </ul>
      }
    >
      <Section title="상품">
        <ProductFields product={product} onChange={change} />
      </Section>
      <Section title="수수료" action={<ResetRates onReset={reset} />}>
        <CoupangFees s={settings} patch={patch} />
      </Section>
    </CalcPage>
  )
}
