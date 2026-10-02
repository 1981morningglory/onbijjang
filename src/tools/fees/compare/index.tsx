import clsx from 'clsx'
import { ChevronDown, ListPlus, RotateCcw, Scale, Table2, Trophy } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toolPath } from '@/app/registry'
import { usePersistentState, won } from '@/lib/hooks'
import { Badge, Button, Callout, EmptyState, Field, Panel, Section, Segmented, Tabs, TextInput, ToolLayout } from '@/ui'
import { solvePrice, trimPct, type Product } from '../shared/calc'
import { CoupangFees, ElevenstFees, EsmFees, RocketFees, SmartstoreFees } from '../shared/editors'
import { ProductShelf } from '../shared/products'
import { AUCTION_CATEGORIES, GMARKET_CATEGORIES } from '../shared/rates/esm'
import {
  EMPTY_PRODUCT, EXAMPLE_PRODUCT, MARKETS, MARKET_LABEL, MARKET_META, MARKET_TOOL_ID, bestMarket, calcMarket, resolveCategories, useMarketSettings,
  type AllSettings, type MarketId, type MarketResult,
} from '../shared/settings'
import { Breakdown, Disclosure, ProductFields, ResetRates, SourceFooter, TargetInputs, pct, targetOf, useTarget } from '../shared/ui'
import { Bulk } from './Bulk'

type Tab = 'single' | 'bulk'
const signed = (n: number) => (n < 0 ? `-${won(-n)}` : won(n))

/** 여섯 마켓의 요율 설정을 한꺼번에 읽는다(각 계산기와 같은 저장 위치). */
function useAllSettings() {
  const smartstore = useMarketSettings('smartstore')
  const coupang = useMarketSettings('coupang')
  const rocket = useMarketSettings('rocket')
  const gmarket = useMarketSettings('gmarket')
  const auction = useMarketSettings('auction')
  const elevenst = useMarketSettings('elevenst')
  const all: AllSettings = useMemo(
    () => ({ smartstore: smartstore.settings, coupang: coupang.settings, rocket: rocket.settings, gmarket: gmarket.settings, auction: auction.settings, elevenst: elevenst.settings }),
    [smartstore.settings, coupang.settings, rocket.settings, gmarket.settings, auction.settings, elevenst.settings],
  )
  return { all, smartstore, coupang, rocket, gmarket, auction, elevenst }
}

function CompareTable({ results, best }: { results: MarketResult[]; best: MarketId | null }) {
  const [open, setOpen] = useState<MarketId | null>(null)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">마켓별 수수료와 이익</caption>
        <thead>
          <tr className="border-b border-line-strong text-2xs font-bold text-muted">
            <th scope="col" className="py-2 pr-2 text-left">마켓</th>
            <th scope="col" className="py-2 pr-2 text-right">수수료</th>
            <th scope="col" className="py-2 pr-2 text-right">이익</th>
            <th scope="col" className="py-2 text-right">이익률</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const isBest = r.market === best
            const missing = r.result.blocked
            const expanded = open === r.market
            return (
              <Fragment key={r.market}>
                <tr className={clsx('border-b border-line', isBest && 'bg-brand-soft')}>
                  <th scope="row" className="py-2 pl-1.5 pr-2 text-left font-normal">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : r.market)}
                      className="group flex w-full items-start gap-1 rounded-xs text-left"
                      title="항목별 내역 보기"
                    >
                      <ChevronDown className={clsx('mt-0.5 size-3.5 shrink-0 text-muted transition-transform duration-200', expanded && 'rotate-180')} aria-hidden />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5 font-semibold text-ink group-hover:text-brand-ink">
                          {r.label}
                          {isBest && (
                            <Badge tone="brand">
                              <Trophy className="mr-1 size-3" aria-hidden />
                              가장 남음
                            </Badge>
                          )}
                        </span>
                        <span className="block text-2xs text-muted">
                          {r.category ? `${r.category} · ` : ''}
                          {r.rate == null ? '요율 미입력' : `${trimPct(r.rate)}%`}
                        </span>
                      </span>
                    </button>
                  </th>
                  {missing ? (
                    <td colSpan={3} className="py-2 pr-1.5 text-right text-2xs font-semibold text-warn">
                      요율 입력 필요
                      <span className="block font-normal text-muted">{r.result.missing.join(', ')}</span>
                    </td>
                  ) : (
                    <>
                      <td className="num whitespace-nowrap py-2 pr-2 text-right align-top text-ink-2">{won(r.result.feeTotal)}</td>
                      <td className={clsx('num whitespace-nowrap py-2 pr-2 text-right align-top font-bold', r.result.profit < 0 ? 'text-danger' : 'text-ink')}>{signed(r.result.profit)}</td>
                      <td className={clsx('num whitespace-nowrap py-2 pr-1.5 text-right align-top', r.result.profit < 0 ? 'text-danger' : 'text-ink-2')}>
                        {pct(r.result.marginPct)}
                        {r.result.missing.length > 0 && (
                          <span className="block text-2xs font-normal text-warn" title={`${r.result.missing.join(', ')} 요율이 비어 0원으로 계산했습니다`}>
                            {r.result.missing.join(', ')} 0원
                          </span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
                {expanded && (
                  <tr className="border-b border-line bg-sunken">
                    <td colSpan={4} className="px-3 pb-3">
                      <Breakdown result={r.result} />
                      <Link to={toolPath(MARKET_TOOL_ID[r.market])} className="mt-2 inline-block text-sm font-semibold text-brand-ink underline hover:text-brand">
                        {r.label} 계산기에서 자세히 보기
                      </Link>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RequiredPrices({ product, resolved, onApply }: { product: Product; resolved: AllSettings; onApply: (price: number) => void }) {
  const [target, setTarget] = useTarget()
  const t = targetOf(target)
  const rows = useMemo(
    () =>
      MARKETS.map((market) => {
        const calcAt = (price: number) => calcMarket(market, { ...product, price }, resolved).result
        const missing = calcAt(Math.max(1, product.price)).blocked
        return { market, missing, price: !t || missing ? null : solvePrice(calcAt, t) }
      }),
    [product, resolved, t?.type, t?.value], // eslint-disable-line react-hooks/exhaustive-deps
  )
  return (
    <div className="flex flex-col gap-3">
      <TargetInputs target={target} setTarget={setTarget} />
      {product.cost <= 0 ? (
        <p className="text-sm text-muted">원가를 입력하면 마켓마다 필요한 판매가를 계산합니다.</p>
      ) : !t ? (
        <p className="text-sm text-muted">목표 값을 입력하면 마켓마다 필요한 판매가를 계산합니다.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.market} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span className="text-ink-2">{MARKET_LABEL[r.market]}</span>
              {r.missing ? (
                <span className="text-2xs font-semibold text-warn">요율 입력 필요</span>
              ) : r.price == null ? (
                <span className="text-2xs text-muted">이 수수료로는 닿을 수 없음</span>
              ) : (
                <button type="button" onClick={() => onApply(r.price!)} title="이 판매가를 넣어 다시 비교" className="num rounded-xs font-bold text-ink underline decoration-line-strong underline-offset-2 hover:text-brand-ink">
                  {won(r.price)}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-2xs text-muted">금액을 누르면 그 판매가를 넣어 다시 비교합니다.</p>
    </div>
  )
}

function Single({ settings }: { settings: ReturnType<typeof useAllSettings> }) {
  const [product, setProduct] = usePersistentState<Product>('onbijjang:fee-compare:product', EMPTY_PRODUCT)
  const [query, setQuery] = usePersistentState('onbijjang:fee-compare:category', '')
  const [sort, setSort] = usePersistentState<'market' | 'profit'>('onbijjang:fee-compare:sort', 'market')
  const change = (next: Partial<Product>) => setProduct((p) => ({ ...p, ...next }))

  const resolved = useMemo(() => resolveCategories(settings.all, query), [settings.all, query])
  const results = useMemo(() => MARKETS.map((m) => calcMarket(m, product, resolved)), [product, resolved])
  const best = bestMarket(results)
  const shown = useMemo(() => {
    if (sort === 'market') return results
    const rank = (r: MarketResult) => (r.result.blocked ? -Infinity : r.result.profit)
    return [...results].sort((a, b) => rank(b) - rank(a))
  }, [results, sort])
  const ready = product.price > 0
  const byMarket = (m: MarketId) => results.find((r) => r.market === m)!
  const matched = query.trim() ? results.filter((r) => r.category).map((r) => ({ r, hit: resolved[r.market] !== settings.all[r.market] })) : []

  const summary = (m: MarketId) => {
    const r = byMarket(m)
    return r.result.blocked ? (
      <span className="text-2xs font-semibold text-warn">요율 입력 필요</span>
    ) : (
      <span className="num text-2xs font-normal text-muted">{r.rate == null ? '' : `${trimPct(r.rate)}%`}</span>
    )
  }

  return (
    <ToolLayout
      panelWidth={440}
      panel={
        ready ? (
          <>
            <Section
              title="마켓별 이익"
              action={
                <Segmented
                  label="정렬"
                  size="sm"
                  value={sort}
                  onValue={setSort}
                  options={[
                    { value: 'market', label: '마켓 순' },
                    { value: 'profit', label: '이익 순' },
                  ]}
                />
              }
            >
              <CompareTable results={shown} best={best} />
              {best ? (
                <p className="text-sm text-ink-2">
                  지금 조건에서 가장 많이 남는 곳은 <span className="font-bold text-brand-ink">{MARKET_LABEL[best]}</span>입니다. 요율을 넣지 않은 마켓은 순위에서 뺐습니다.
                </p>
              ) : (
                <Callout tone="warn">요율이 모두 채워진 마켓이 없어 순위를 매기지 못했습니다. 아래 ‘마켓별 세부 설정’에서 요율을 입력하세요.</Callout>
              )}
            </Section>
            <Section title="목표 이익에 필요한 판매가">
              <RequiredPrices product={product} resolved={resolved} onApply={(price) => change({ price })} />
            </Section>
          </>
        ) : (
          <EmptyState
            icon={Scale}
            title="판매가를 입력하면 여섯 마켓을 나란히 비교합니다"
            action={
              <Button icon={ListPlus} onClick={() => setProduct(EXAMPLE_PRODUCT)}>
                예시 불러오기
              </Button>
            }
          >
            스마트스토어·쿠팡·로켓그로스·G마켓·옥션·11번가의 수수료와 이익을 한 표로 보여 줍니다.
          </EmptyState>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon={ListPlus}
          onClick={() => {
            setProduct(EXAMPLE_PRODUCT)
            setQuery('주방용품')
          }}
        >
          예시 불러오기
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={RotateCcw}
          onClick={() => {
            setProduct(EMPTY_PRODUCT)
            setQuery('')
          }}
        >
          입력 초기화
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ProductShelf product={product} onLoad={(p) => setProduct({ ...p, shipMode: p.shipMode === 'cod' ? 'paid' : p.shipMode })} />
        </div>
      </div>

      <Panel>
        <Section title="상품">
          <ProductFields product={product} onChange={change} />
        </Section>
        <Section title="카테고리">
          <Field label="카테고리 이름으로 한 번에 맞추기" hint="비워 두면 아래 ‘마켓별 세부 설정’에서 고른 카테고리를 씁니다. 스마트스토어·11번가는 카테고리 표가 없어 해당하지 않습니다.">
            {(id) => <TextInput id={id} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 주방용품, 모니터, 여성의류" maxLength={40} />}
          </Field>
          {matched.length > 0 && (
            <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {matched.map(({ r, hit }) => (
                <li key={r.market} className="flex items-baseline justify-between gap-2">
                  <span className="shrink-0 font-semibold text-ink-2">{r.label}</span>
                  <span className={clsx('min-w-0 truncate text-right', hit ? 'text-ink-2' : 'text-muted')} title={r.category}>
                    {hit ? r.category : `맞는 분류 없음 — ${r.category}`} <span className="num">{r.rate == null ? '' : `${trimPct(r.rate)}%`}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Panel>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-ink">마켓별 세부 설정</h3>
        <p className="-mt-1 text-sm text-muted">여기서 고친 요율은 각 마켓 계산기에도 그대로 적용됩니다. 판매자 할인·쿠폰은 비교에 넣지 않습니다.</p>
        <Disclosure title={MARKET_LABEL.smartstore} aside={summary('smartstore')}>
          <div className="flex flex-col gap-3">
            <SmartstoreFees s={settings.smartstore.settings} patch={settings.smartstore.patch} />
            <div><ResetRates onReset={settings.smartstore.reset} /></div>
          </div>
        </Disclosure>
        <Disclosure title={MARKET_LABEL.coupang} aside={summary('coupang')}>
          <div className="flex flex-col gap-3">
            <CoupangFees s={settings.coupang.settings} patch={settings.coupang.patch} />
            <div><ResetRates onReset={settings.coupang.reset} /></div>
          </div>
        </Disclosure>
        <Disclosure title={MARKET_LABEL.rocket} aside={summary('rocket')}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">로켓그로스는 쿠팡이 배송하므로 위에 넣은 고객 배송비·택배비를 쓰지 않습니다.</p>
            <RocketFees s={settings.rocket.settings} patch={settings.rocket.patch} />
            <div><ResetRates onReset={settings.rocket.reset} /></div>
          </div>
        </Disclosure>
        <Disclosure title={MARKET_LABEL.gmarket} aside={summary('gmarket')}>
          <div className="flex flex-col gap-3">
            <EsmFees s={settings.gmarket.settings} patch={settings.gmarket.patch} categories={GMARKET_CATEGORIES} />
            <div><ResetRates onReset={settings.gmarket.reset} /></div>
          </div>
        </Disclosure>
        <Disclosure title={MARKET_LABEL.auction} aside={summary('auction')}>
          <div className="flex flex-col gap-3">
            <EsmFees s={settings.auction.settings} patch={settings.auction.patch} categories={AUCTION_CATEGORIES} />
            <div><ResetRates onReset={settings.auction.reset} /></div>
          </div>
        </Disclosure>
        <Disclosure title={MARKET_LABEL.elevenst} aside={summary('elevenst')}>
          <div className="flex flex-col gap-3">
            <ElevenstFees s={settings.elevenst.settings} patch={settings.elevenst.patch} />
            <div><ResetRates onReset={settings.elevenst.reset} /></div>
          </div>
        </Disclosure>
      </div>

      <Disclosure title="계산 기준">
        <div className="prose-ob text-sm">
          <ul>
            <li>같은 판매가·원가·배송 조건을 여섯 마켓의 수수료 구조에 각각 넣어 주문 1건(로켓그로스는 상품 1개) 이익을 계산합니다.</li>
            <li>이익률 = 이익 ÷ 판매가. 월 서버 이용료·월 서비스 이용료 같은 월 고정비는 1건 이익에 넣지 않습니다.</li>
            <li>카테고리 이름을 넣으면 쿠팡·로켓그로스·G마켓·옥션의 공식 카테고리 표에서 가장 가까운 분류를 찾아 그 요율을 씁니다. 맞는 분류가 없으면 세부 설정의 카테고리를 씁니다.</li>
            <li>판매 수수료처럼 주요 요율이 빈 마켓은 ‘요율 입력 필요’로 표시하고 ‘가장 남음’ 순위에서 뺍니다. 배송비 수수료처럼 작은 항목만 비면 0원으로 계산하고 그 사실을 표시합니다.</li>
            <li>마켓마다 계산 방식이 다릅니다. 자세한 기준은 각 마켓 계산기의 ‘계산 기준’에 있습니다.</li>
          </ul>
        </div>
      </Disclosure>
      <SourceFooter metas={MARKETS.map((m) => MARKET_META[m])} />
    </ToolLayout>
  )
}

export default function FeeCompareTool() {
  const [tab, setTab] = usePersistentState<Tab>('onbijjang:fee-compare:tab', 'single')
  const settings = useAllSettings()
  return (
    <div className="flex flex-col gap-4">
      <Tabs
        label="비교 방식"
        className="overflow-y-hidden"
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'single', label: '한 상품 비교', icon: Scale },
          { value: 'bulk', label: '엑셀 일괄 계산', icon: Table2 },
        ]}
      />
      {tab === 'single' ? <Single settings={settings} /> : <Bulk all={settings.all} onOpenSettings={() => setTab('single')} />}
    </div>
  )
}
