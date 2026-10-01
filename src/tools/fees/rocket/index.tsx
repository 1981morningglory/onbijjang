import { useCallback, useMemo } from 'react'
import { usePersistentState } from '@/lib/hooks'
import { Section } from '@/ui'
import { calcRocket, type Product } from '../shared/calc'
import { RocketFees } from '../shared/editors'
import { ProductShelf } from '../shared/products'
import { COUPANG_CATEGORIES } from '../shared/rates/coupang'
import { EMPTY_PRODUCT, EXAMPLE_PRODUCT, MARKET_META, findCategory, useMarketSettings } from '../shared/settings'
import { CalcPage, ProductFields, ResetRates } from '../shared/ui'

export default function RocketMarginTool() {
  const [product, setProduct] = usePersistentState<Product>('onbijjang:rocket-margin:product', EMPTY_PRODUCT)
  const { settings, patch, reset } = useMarketSettings('rocket')
  const rate = findCategory(COUPANG_CATEGORIES, settings.categoryId).rate
  const result = useMemo(() => calcRocket(product, settings, rate), [product, settings, rate])
  const calcAt = useCallback((price: number) => calcRocket({ ...product, price }, settings, rate), [product, settings, rate])
  const change = (next: Partial<Product>) => setProduct((p) => ({ ...p, ...next }))

  return (
    <CalcPage
      title="로켓그로스"
      meta={MARKET_META.rocket}
      unit="상품 1개"
      product={product}
      result={result}
      calcAt={calcAt}
      onPrice={(price) => change({ price })}
      onExample={() => {
        setProduct(EXAMPLE_PRODUCT)
        patch({ categoryId: '주방용품 > 기본 수수료', rateOverride: null, sizeType: 's', inboundTotal: 30000, inboundQty: 100 })
      }}
      onReset={() => setProduct(EMPTY_PRODUCT)}
      shelf={<ProductShelf product={product} onLoad={setProduct} />}
      basis={
        <ul>
          <li>판매 수수료는 판매자배송(마켓플레이스)과 같은 카테고리 요율을 씁니다.</li>
          <li>입출고비·배송비는 카테고리·사이즈 유형·판매가에 따라 정해집니다. 공개된 안내에는 사이즈별 최저 요금만 있어, WING 요금표에서 확인한 금액을 직접 넣습니다.</li>
          <li>창고 입고 물류비(개당) = 쿠팡 창고로 보낸 물류비 총액 ÷ 그때 보낸 수량</li>
          <li>보관비 = (예상 보관일 − 무료 보관일) × 하루 보관비. 무료 보관은 기본 30일, 세이버 60일입니다.</li>
          <li>세이버를 켜면 월 구독료를 월 판매 수량으로 나눈 1개 몫을 더하고, 반품 회수·재입고비는 0원으로 봅니다.</li>
          <li>반품 비용(예상) = (회수비 + 재입고비) × 반품률</li>
          <li>이익 = 판매가 − 판매 수수료 − 물류 요금 − 원가 − 창고 입고 물류비, 이익률 = 이익 ÷ 판매가. 로켓그로스는 쿠팡이 배송하므로 고객 배송비와 택배비가 없습니다.</li>
        </ul>
      }
    >
      <Section title="상품">
        <ProductFields product={product} onChange={change} shipping={false} />
      </Section>
      <Section title="수수료와 물류 요금" action={<ResetRates onReset={reset} />}>
        <RocketFees s={settings} patch={patch} />
      </Section>
    </CalcPage>
  )
}
