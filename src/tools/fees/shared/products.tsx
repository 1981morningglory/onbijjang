/**
 * 자주 계산하는 상품 목록 — 이 브라우저에 저장하고, 팀 보관함(fee-products)으로 주고받는다.
 * 모든 수수료 계산기와 비교 도구가 같은 목록을 쓴다.
 */
import { Bookmark, Save, Trash2 } from 'lucide-react'
import { usePersistentState, won } from '@/lib/hooks'
import { Button, EmptyState, IconButton, LibraryMenu, Popover, toast } from '@/ui'
import type { Product } from './calc'

export interface SavedProduct extends Product {
  id: string
  savedAt: string
}

const KEY = 'onbijjang:fees:products'
const MAX = 300

const isProduct = (v: unknown): v is Product => {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return typeof p.name === 'string' && typeof p.price === 'number' && typeof p.cost === 'number'
}

const clean = (p: Product): Product => ({
  name: String(p.name).slice(0, 80),
  price: Math.max(0, Math.round(p.price) || 0),
  cost: Math.max(0, Math.round(p.cost) || 0),
  shipMode: p.shipMode === 'free' || p.shipMode === 'cod' ? p.shipMode : 'paid',
  buyerShipping: Math.max(0, Math.round(p.buyerShipping) || 0),
  shippingCost: Math.max(0, Math.round(p.shippingCost) || 0),
})

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/** 이름이 같은 상품은 새 값으로 바꾸고, 나머지는 앞에 붙인다. */
export function mergeProducts(current: SavedProduct[], incoming: Product[]): SavedProduct[] {
  const now = new Date().toISOString()
  const fresh = incoming.filter(isProduct).map((p) => ({ ...clean(p), id: newId(), savedAt: now }))
  const names = new Set(fresh.map((p) => p.name))
  return [...fresh, ...current.filter((p) => !names.has(p.name))].slice(0, MAX)
}

export function ProductShelf({ product, onLoad }: { product: Product; onLoad: (p: Product) => void }) {
  const [list, setList] = usePersistentState<SavedProduct[]>(KEY, [])

  const save = () => {
    if (!product.name.trim()) return toast.info('상품명을 입력한 뒤 저장하세요.')
    if (product.price <= 0) return toast.info('판매가를 입력한 뒤 저장하세요.')
    const replaced = list.some((p) => p.name === product.name.trim())
    setList((prev) => mergeProducts(prev, [{ ...product, name: product.name.trim() }]))
    toast.success(replaced ? '같은 이름의 상품을 새 값으로 바꿨습니다.' : '이 브라우저에 상품을 저장했습니다.')
  }

  return (
    <>
      <Button size="sm" icon={Save} onClick={save}>
        상품 저장
      </Button>
      <Popover
        align="end"
        className="w-80 p-0!"
        trigger={({ ref, ...props }) => (
          <span ref={ref} className="inline-flex">
            <Button size="sm" icon={Bookmark} {...props}>
              저장한 상품 <span className="num text-muted">{list.length}</span>
            </Button>
          </span>
        )}
      >
        {(close) =>
          list.length === 0 ? (
            <EmptyState icon={Bookmark} title="저장한 상품이 없습니다" className="py-6!">
              상품명과 판매가를 넣고 ‘상품 저장’을 누르면 여기에 쌓입니다. 다른 마켓 계산기에서도 불러올 수 있습니다.
            </EmptyState>
          ) : (
            <ul className="max-h-80 overflow-auto p-1.5">
              {list.map((p) => (
                <li key={p.id} className="flex items-center gap-1 rounded-sm px-1.5 py-1 hover:bg-sunken">
                  <button
                    type="button"
                    onClick={() => {
                      const { id: _id, savedAt: _savedAt, ...rest } = p
                      onLoad(rest)
                      close()
                    }}
                    className="min-w-0 flex-1 rounded-xs py-1 text-left"
                  >
                    <span className="block truncate text-sm font-semibold text-ink">{p.name}</span>
                    <span className="num block text-2xs text-muted">
                      판매가 {won(p.price)} · 원가 {won(p.cost)}
                    </span>
                  </button>
                  <IconButton icon={Trash2} label={`${p.name} 삭제`} size="sm" onClick={() => setList((prev) => prev.filter((x) => x.id !== p.id))} />
                </li>
              ))}
            </ul>
          )
        }
      </Popover>
      <LibraryMenu<{ products: Product[] }>
        kind="fee-products"
        noun="상품 목록"
        size="sm"
        getData={() => (list.length ? { data: { products: list.map(clean) } } : null)}
        onLoad={(data, entry) => {
          const incoming = Array.isArray(data?.products) ? data.products.filter(isProduct) : []
          if (!incoming.length) return toast.warn('불러온 목록에 상품이 없습니다.')
          setList((prev) => mergeProducts(prev, incoming))
          toast.success(`‘${entry.name}’에서 상품 ${incoming.length}개를 가져왔습니다. ‘저장한 상품’에서 고르세요.`)
        }}
      />
    </>
  )
}
