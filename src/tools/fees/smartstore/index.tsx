import { useCallback, useMemo } from 'react'
import { usePersistentState } from '@/lib/hooks'
import { Section } from '@/ui'
import { calcSmartstore, type Product } from '../shared/calc'
import { SmartstoreFees } from '../shared/editors'
import { ProductShelf } from '../shared/products'
import { EMPTY_PRODUCT, EXAMPLE_PRODUCT, MARKET_META, useMarketSettings } from '../shared/settings'
import { CalcPage, ProductFields, ResetRates } from '../shared/ui'

export default function SmartstoreTool() {
  const [product, setProduct] = usePersistentState<Product>('onbijjang:smartstore:product', EMPTY_PRODUCT)
  const { settings, patch, reset } = useMarketSettings('smartstore')
  const result = useMemo(() => calcSmartstore(product, settings), [product, settings])
  const calcAt = useCallback((price: number) => calcSmartstore({ ...product, price }, settings), [product, settings])
  const change = (next: Partial<Product>) => setProduct((p) => ({ ...p, ...next }))

  return (
    <CalcPage
      title="스마트스토어"
      meta={MARKET_META.smartstore}
      product={product}
      result={result}
      calcAt={calcAt}
      onPrice={(price) => change({ price })}
      onExample={() => setProduct(EXAMPLE_PRODUCT)}
      onReset={() => setProduct(EMPTY_PRODUCT)}
      shelf={<ProductShelf product={product} onLoad={(p) => setProduct({ ...p, shipMode: p.shipMode === 'cod' ? 'paid' : p.shipMode })} />}
      basis={
        <ul>
          <li>네이버페이 주문관리 수수료 = (판매가 + 고객이 낸 배송비) × 등급별 요율</li>
          <li>판매 수수료 = 판매가 × 유입 경로별 요율 (네이버 쇼핑 유입 / 판매자 마케팅 링크)</li>
          <li>쇼핑커넥트 수수료 = 판매가 × 내가 정한 요율 (켰을 때만)</li>
          <li>각 수수료는 원 미만을 버립니다.</li>
          <li>이익 = 판매가 + 고객이 낸 배송비 − 수수료 − 원가 − 택배비, 이익률 = 이익 ÷ 판매가</li>
          <li>요율은 판매자센터에 표시된 값(부가세 포함 기준)을 그대로 넣습니다. 이 구조와 요율은 공식 안내를 직접 확인하지 못했으니 실제 정산 내역과 한 번 맞춰 보세요.</li>
        </ul>
      }
    >
      <Section title="상품">
        <ProductFields product={product} onChange={change} />
      </Section>
      <Section title="수수료" action={<ResetRates onReset={reset} />}>
        <SmartstoreFees s={settings} patch={patch} />
      </Section>
    </CalcPage>
  )
}
