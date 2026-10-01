/**
 * 수수료 계산기들이 같이 쓰는 화면 부품.
 * 왼쪽에 입력, 오른쪽에 붙어 다니는 결과 요약(큰 이익 숫자 → 이익률 → 항목별 내역) 구조를 여기서 맞춘다.
 */
import clsx from 'clsx'
import { ChevronDown, Copy, ExternalLink, ListPlus, RotateCcw, Search, Target as TargetIcon, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fmt, usePersistentState, won } from '@/lib/hooks'
import { Button, Callout, EmptyState, Field, Panel, Popover, Section, Segmented, TextInput, ToolLayout, toast } from '@/ui'
import { ceilTo, solvePrice, trimPct, type CalcResult, type Line, type Product, type ShipMode, type Target } from './calc'
import type { CategoryRate, RateDef, RateMeta } from './rates/types'
import { searchCategories } from './settings'

// ── 숫자 입력 ─────────────────────────────────────────────
export interface MoneyInputProps {
  id?: string
  value: number | null
  onValue: (value: number | null) => void
  unit?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  max?: number
  'aria-label'?: string
}

/** 금액 입력. 치는 동안 천 단위 쉼표를 넣고, 커서 위치를 지킨다. 비어 있으면 null. */
export function MoneyInput({ id, value, onValue, unit = '원', placeholder = '0', disabled, invalid, max = 9_999_999_999, ...rest }: MoneyInputProps) {
  const el = useRef<HTMLInputElement | null>(null)
  const digitsRight = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (digitsRight.current == null || !el.current) return
    const v = el.current.value
    let pos = v.length
    let seen = 0
    while (pos > 0 && seen < digitsRight.current) {
      pos--
      if (/\d/.test(v[pos])) seen++
    }
    el.current.setSelectionRange(pos, pos)
    digitsRight.current = null
  })
  return (
    <div className="relative">
      <TextInput
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={value == null ? '' : fmt.format(value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          el.current = e.target
          const raw = e.target.value
          const sel = e.target.selectionStart ?? raw.length
          digitsRight.current = raw.slice(sel).replace(/\D/g, '').length
          const digits = raw.replace(/\D/g, '')
          onValue(digits === '' ? null : Math.min(Number(digits), max))
        }}
        className={clsx('num text-right', unit && 'pr-9')}
        {...rest}
      />
      {unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{unit}</span>}
    </div>
  )
}

/** 0 을 빈칸으로 보여 주는 금액 칸에 쓴다. */
export const orNull = (n: number) => (n ? n : null)

export interface PercentInputProps {
  id?: string
  value: number | null
  onValue: (value: number | null) => void
  placeholder?: string
  disabled?: boolean
  'aria-label'?: string
}

/** 요율(%) 입력. 소수 셋째 자리까지. 비어 있으면 null. */
export function PercentInput({ id, value, onValue, placeholder = '직접 입력', disabled, ...rest }: PercentInputProps) {
  const [text, setText] = useState(value == null ? '' : trimPct(value))
  useEffect(() => {
    setText((prev) => {
      const current = prev === '' || prev === '.' ? null : Number(prev)
      return current === value ? prev : value == null ? '' : trimPct(value)
    })
  }, [value])
  return (
    <div className="relative">
      <TextInput
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.]/g, '')
          if (!/^\d{0,3}(\.\d{0,3})?$/.test(raw)) return
          if (raw !== '' && raw !== '.' && Number(raw) > 100) return
          setText(raw)
          onValue(raw === '' || raw === '.' ? null : Number(raw))
        }}
        className="num pr-8 text-right"
        {...rest}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">%</span>
    </div>
  )
}

// ── 요율 상태 표시 ────────────────────────────────────────
/** 공식 자료로 확인하지 못한 값 옆에 붙인다. */
export function NeedCheck({ note }: { note?: string }) {
  return (
    <span title={note ?? '공식 안내에서 확인하지 못한 값입니다'} className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2 text-2xs font-bold text-warn">
      <TriangleAlert className="size-3" aria-hidden />
      확인 필요
    </span>
  )
}

function RateState({ modified, hasDefault, verified, note, onReset }: { modified: boolean; hasDefault: boolean; verified: boolean; note?: string; onReset: () => void }) {
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {!verified && <NeedCheck note={note} />}
      {modified ? (
        <>
          <span className="text-2xs font-bold text-accent">수정됨</span>
          <button type="button" onClick={onReset} className="rounded-xs text-2xs font-semibold text-ink-2 underline underline-offset-2 hover:text-ink">
            기본값으로
          </button>
        </>
      ) : hasDefault ? (
        <span className="text-2xs font-semibold text-muted">기본 요율 적용 중</span>
      ) : null}
    </span>
  )
}

/** 요율 한 칸: 기본 요율 적용 중 / 수정됨 표시와 되돌리기, 확인 필요 배지 */
export function RateField({ label, value, onValue, def, hint, className }: { label: ReactNode; value: number | null; onValue: (v: number | null) => void; def: RateDef; hint?: ReactNode; className?: string }) {
  return (
    <Field
      label={label}
      className={className}
      hint={hint}
      aside={<RateState modified={value !== def.value} hasDefault={def.value != null} verified={def.verified} note={def.note} onReset={() => onValue(def.value)} />}
    >
      {(id) => <PercentInput id={id} value={value} onValue={onValue} placeholder={def.value == null ? '직접 입력' : trimPct(def.value)} />}
    </Field>
  )
}

/** 금액으로 정해진 기본값(월 이용료 등)에 쓰는 칸 */
export function AmountField({ label, value, onValue, def, hint, className }: { label: ReactNode; value: number | null; onValue: (v: number | null) => void; def: RateDef; hint?: ReactNode; className?: string }) {
  return (
    <Field
      label={label}
      className={className}
      hint={hint}
      aside={<RateState modified={value !== def.value} hasDefault={def.value != null} verified={def.verified} note={def.note} onReset={() => onValue(def.value)} />}
    >
      {(id) => <MoneyInput id={id} value={value} onValue={onValue} placeholder={def.value == null ? '직접 입력' : fmt.format(def.value)} />}
    </Field>
  )
}

// ── 카테고리 고르기 ───────────────────────────────────────
function CategoryList({ categories, value, onPick }: { categories: CategoryRate[]; value: string; onPick: (c: CategoryRate) => void }) {
  const [query, setQuery] = useState('')
  const found = useMemo(() => searchCategories(categories, query, 80), [categories, query])
  const box = useRef<HTMLDivElement>(null)
  // 팝오버는 자리를 잡기 전까지 숨겨져 있어 autoFocus 가 먹지 않는다. 보인 뒤에 검색칸으로 옮긴다.
  useEffect(() => {
    const t = setTimeout(() => box.current?.querySelector('input')?.focus(), 30)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex flex-col">
      <div ref={box} className="relative border-b border-line p-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="카테고리 이름으로 찾기" aria-label="카테고리 검색" className="pl-9" />
      </div>
      <ul className="max-h-72 overflow-auto p-1.5">
        {found.length === 0 && <li className="px-2.5 py-4 text-center text-sm text-muted">맞는 카테고리가 없습니다. 가까운 분류를 고른 뒤 요율을 직접 고쳐 주세요.</li>}
        {found.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c)}
              className={clsx(
                'flex w-full items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-left text-sm transition-colors duration-100 hover:bg-sunken',
                c.id === value ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-ink-2',
              )}
            >
              <span className="min-w-0">{c.path.join(' > ')}</span>
              <span className="num shrink-0 text-muted">{trimPct(c.rate)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 카테고리를 검색해 고르면 요율이 따라온다. */
export function CategoryField({ label = '카테고리', categories, value, onValue, hint }: { label?: ReactNode; categories: CategoryRate[]; value: CategoryRate; onValue: (c: CategoryRate) => void; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <Popover
          className="w-[min(calc(100vw-1rem),26rem)] p-0!"
          trigger={({ ref, ...props }) => (
            <button
              id={id}
              ref={ref}
              type="button"
              {...props}
              className="flex h-10 w-full items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-left text-base text-ink transition-[border-color,box-shadow] duration-150 hover:border-faint focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20"
            >
              <span className="min-w-0 flex-1 truncate">{value.path.join(' > ')}</span>
              <span className="num shrink-0 text-sm text-muted">{trimPct(value.rate)}%</span>
              <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
            </button>
          )}
        >
          {(close) => (
            <CategoryList
              categories={categories}
              value={value.id}
              onPick={(c) => {
                onValue(c)
                close()
              }}
            />
          )}
        </Popover>
      )}
    </Field>
  )
}

// ── 접기 ──────────────────────────────────────────────────
/** card: 독립된 종이 한 장 · inline: 패널 안에서 쓰는 접는 줄 */
export function Disclosure({ title, aside, children, defaultOpen = false, variant = 'card' }: { title: ReactNode; aside?: ReactNode; children: ReactNode; defaultOpen?: boolean; variant?: 'card' | 'inline' }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className={clsx(variant === 'card' && 'rounded-lg border border-line bg-surface shadow-1')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex w-full items-center gap-2 text-left text-sm font-bold text-ink transition-colors duration-150',
          variant === 'card' ? 'rounded-lg px-4 py-3 hover:bg-sunken' : 'rounded-sm py-1 hover:text-brand-ink',
        )}
      >
        <span className="min-w-0 flex-1">{title}</span>
        {aside}
        <ChevronDown className={clsx('size-4 shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={id} className={clsx(variant === 'card' ? 'border-t border-line px-4 py-4' : 'pt-3')}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── 상품 입력 ─────────────────────────────────────────────
const SHIP_LABEL: Record<ShipMode, string> = { paid: '유료배송', free: '무료배송', cod: '착불' }

export function ProductFields({
  product, onChange, shipModes = ['paid', 'free'], shipLabels, shipping = true, children,
}: {
  product: Product
  onChange: (patch: Partial<Product>) => void
  shipModes?: ShipMode[]
  shipLabels?: Partial<Record<ShipMode, string>>
  /** false 면 배송 관련 칸을 숨긴다(로켓그로스) */
  shipping?: boolean
  /** 판매가·원가 아래에 끼워 넣는 마켓별 칸 */
  children?: ReactNode
}) {
  const labels = { ...SHIP_LABEL, ...shipLabels }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="상품명 (선택)" className="sm:col-span-2">
        {(id) => <TextInput id={id} value={product.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="저장하거나 비교할 때 알아볼 이름" maxLength={80} />}
      </Field>
      <Field label="판매가">{(id) => <MoneyInput id={id} value={orNull(product.price)} onValue={(v) => onChange({ price: v ?? 0 })} />}</Field>
      <Field label="원가">{(id) => <MoneyInput id={id} value={orNull(product.cost)} onValue={(v) => onChange({ cost: v ?? 0 })} />}</Field>
      {children}
      {shipping && (
        <>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-semibold text-ink-2">배송 방식</span>
            <Segmented
              label="배송 방식"
              block
              value={product.shipMode}
              onValue={(shipMode) => onChange({ shipMode })}
              options={shipModes.map((m) => ({ value: m, label: labels[m] }))}
            />
          </div>
          <Field
            label="고객이 내는 배송비"
            hint={product.shipMode === 'free' ? '무료배송이라 받지 않습니다' : product.shipMode === 'cod' ? '착불은 마켓을 거치지 않아 계산에서 뺍니다' : '주문할 때 함께 결제하는 금액'}
          >
            {(id) => <MoneyInput id={id} value={product.shipMode === 'paid' ? orNull(product.buyerShipping) : null} onValue={(v) => onChange({ buyerShipping: v ?? 0 })} disabled={product.shipMode !== 'paid'} />}
          </Field>
          <Field label="택배비 (내가 내는 돈)" hint={product.shipMode === 'cod' ? '착불이면 보통 0원' : '택배사에 실제로 내는 금액'}>
            {(id) => <MoneyInput id={id} value={orNull(product.shippingCost)} onValue={(v) => onChange({ shippingCost: v ?? 0 })} />}
          </Field>
        </>
      )}
    </div>
  )
}

// ── 결과 ──────────────────────────────────────────────────
const signed = (n: number) => (n < 0 ? `-${won(-n)}` : won(n))
export const pct = (n: number | null) => (n == null ? '-' : `${(Math.round(n * 10) / 10).toFixed(1)}%`)

function Row({ line }: { line: Line }) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-3 align-top">
        <span className="text-ink-2">{line.label}</span>
        {line.basis && <span className="block text-2xs text-muted">{line.basis}</span>}
      </td>
      <td className="num whitespace-nowrap py-1.5 text-right align-top text-ink">{line.kind === 'income' ? won(line.amount) : `-${won(line.amount)}`}</td>
    </tr>
  )
}

function GroupHead({ children }: { children: ReactNode }) {
  return (
    <tr>
      <th colSpan={2} scope="colgroup" className="pb-1 pt-3 text-left text-2xs font-bold text-muted">
        {children}
      </th>
    </tr>
  )
}

export function Breakdown({ result }: { result: CalcResult }) {
  const income = result.lines.filter((l) => l.kind === 'income')
  const fees = result.lines.filter((l) => l.kind === 'fee')
  const costs = result.lines.filter((l) => l.kind === 'cost')
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">항목별 내역</caption>
        <tbody>
          <GroupHead>들어오는 돈</GroupHead>
          {income.map((l) => (
            <Row key={l.key} line={l} />
          ))}
          <GroupHead>마켓 수수료</GroupHead>
          {fees.length === 0 && (
            <tr className="border-t border-line">
              <td colSpan={2} className="py-1.5 text-muted">
                계산된 수수료가 없습니다
              </td>
            </tr>
          )}
          {fees.map((l) => (
            <Row key={l.key} line={l} />
          ))}
          <GroupHead>내 비용</GroupHead>
          {costs.map((l) => (
            <Row key={l.key} line={l} />
          ))}
          <tr className="border-t-2 border-line-strong">
            <td className="py-2 pr-3 font-bold text-ink">이익</td>
            <td className={clsx('num whitespace-nowrap py-2 text-right font-bold', result.profit < 0 ? 'text-danger' : 'text-ink')}>{signed(result.profit)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0 rounded-md bg-sunken px-3 py-2">
      <dt className="text-2xs font-semibold text-muted">{label}</dt>
      <dd className={clsx('num truncate text-base font-bold', danger ? 'text-danger' : 'text-ink')}>{value}</dd>
    </div>
  )
}

export function summaryText(title: string, product: Pick<Product, 'name' | 'price'>, result: CalcResult): string {
  const rows = [
    `[${title}] ${product.name || '상품'}`,
    ...result.lines.map((l) => `${l.label}: ${l.kind === 'income' ? '' : '-'}${won(l.amount)}`),
    `총 수수료: ${won(result.feeTotal)}`,
    `이익: ${signed(result.profit)} (이익률 ${pct(result.marginPct)})`,
  ]
  if (result.monthly) rows.push(`월 이익(${fmt.format(result.monthly.orders)}건, ${result.monthly.feeLabel} ${won(result.monthly.fee)} 반영): ${signed(result.monthly.profit)}`)
  return rows.join('\n')
}

// ── 역산 ──────────────────────────────────────────────────
interface TargetState {
  type: 'margin' | 'profit'
  margin: number | null
  profit: number | null
}

export function useTarget() {
  return usePersistentState<TargetState>('onbijjang:fees:target', { type: 'margin', margin: 20, profit: 3000 })
}

export function targetOf(t: TargetState): Target | null {
  if (t.type === 'margin') return t.margin == null ? null : { type: 'margin', value: t.margin }
  return t.profit == null ? null : { type: 'profit', value: t.profit }
}

export function TargetInputs({ target, setTarget }: { target: TargetState; setTarget: (next: TargetState) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Segmented
        label="목표 기준"
        size="sm"
        value={target.type}
        onValue={(type) => setTarget({ ...target, type })}
        options={[
          { value: 'margin', label: '이익률' },
          { value: 'profit', label: '이익액' },
        ]}
      />
      <div className="w-32">
        {target.type === 'margin' ? (
          <PercentInput aria-label="목표 이익률" value={target.margin} onValue={(margin) => setTarget({ ...target, margin })} placeholder="20" />
        ) : (
          <MoneyInput aria-label="목표 이익액" value={target.profit} onValue={(profit) => setTarget({ ...target, profit })} />
        )}
      </div>
    </div>
  )
}

/** 목표 이익률·이익액을 넣으면 필요한 판매가를 알려 준다. */
export function ReverseCalc({ calcAt, onApply }: { calcAt: (price: number) => CalcResult; onApply: (price: number) => void }) {
  const [target, setTarget] = useTarget()
  const t = targetOf(target)
  // 원가·택배비가 하나도 없으면 "1원"이 답이 되어 의미가 없다.
  const hasCost = useMemo(() => calcAt(1).costTotal > 0, [calcAt])
  const price = useMemo(() => (t && hasCost ? solvePrice(calcAt, t) : null), [calcAt, hasCost, t?.type, t?.value]) // eslint-disable-line react-hooks/exhaustive-deps
  const rounded = price == null ? null : ceilTo(price, 100)
  const at = rounded == null ? null : calcAt(rounded)
  return (
    <div className="flex flex-col gap-3">
      <TargetInputs target={target} setTarget={setTarget} />
      {!hasCost ? (
        <p className="text-sm text-muted">원가를 입력하면 목표에 필요한 판매가를 계산합니다.</p>
      ) : !t ? (
        <p className="text-sm text-muted">목표 값을 입력하면 필요한 판매가를 계산합니다.</p>
      ) : price == null ? (
        <Callout tone="warn">이 수수료 구조에서는 닿을 수 없는 목표입니다. 목표를 낮추거나 원가·수수료를 확인하세요.</Callout>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-sunken px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-ink-2">필요한 판매가</span>
            <span className="num text-lg font-bold text-ink">{won(price)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted">
              100원 단위로 올리면 <span className="num font-semibold text-ink-2">{won(rounded!)}</span>
              {at && (
                <>
                  {' '}
                  · 이익 <span className="num">{signed(at.profit)}</span> ({pct(at.marginPct)})
                </>
              )}
            </span>
            <Button size="sm" onClick={() => onApply(rounded!)}>
              이 판매가 넣기
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 출처 ──────────────────────────────────────────────────
export function SourceFooter({ metas }: { metas: RateMeta[] }) {
  return (
    <footer className="flex flex-col gap-2 text-sm text-muted">
      {metas.map((meta) => (
        <div key={meta.market} className="flex flex-col gap-1">
          <p>
            요율 기준: {meta.sourceName}, {meta.checkedAt} 확인 · 실제 정산과 다를 수 있음
          </p>
          <Disclosure variant="inline" title={<span className="text-sm font-semibold text-ink-2">{meta.market} 출처와 주의할 점</span>}>
            <div className="flex flex-col gap-2">
              <p className="text-ink-2">{meta.note}</p>
              <ul className="flex flex-col gap-1.5">
                {meta.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-start gap-1.5 font-semibold text-brand-ink underline hover:text-brand">
                      <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {s.label}
                    </a>
                    {s.note && <span className="block pl-5 text-muted">{s.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </Disclosure>
        </div>
      ))}
    </footer>
  )
}

// ── 계산기 한 화면 ────────────────────────────────────────
export interface CalcPageProps {
  /** 결과 복사에 쓰는 마켓 이름 */
  title: string
  meta: RateMeta
  product: Pick<Product, 'name' | 'price'>
  result: CalcResult
  /** 다른 입력은 그대로 두고 판매가만 바꿔 계산 */
  calcAt: (price: number) => CalcResult
  onPrice: (price: number) => void
  onExample: () => void
  onReset: () => void
  /** 도구 모음 오른쪽(저장한 상품 등) */
  shelf?: ReactNode
  /** 결과 요약 머리의 단위: "주문 1건", "상품 1개" */
  unit?: string
  /** 계산 기준 설명(접기) */
  basis: ReactNode
  /** 입력 패널 안의 Section 들 */
  children: ReactNode
}

export function CalcPage({ title, meta, product, result, calcAt, onPrice, onExample, onReset, shelf, unit = '주문 1건', basis, children }: CalcPageProps) {
  const ready = product.price > 0
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText(title, product, result))
      toast.success('계산 결과를 복사했습니다.')
    } catch {
      toast.error('복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하세요.')
    }
  }
  return (
    <ToolLayout
      panelWidth={400}
      panel={
        ready ? (
          <>
            <Section
              title={`예상 결과 · ${unit}`}
              action={
                <Button size="sm" variant="ghost" icon={Copy} onClick={copy}>
                  결과 복사
                </Button>
              }
            >
              <div>
                <p className="text-sm text-muted">예상 이익</p>
                <p className={clsx('num text-2xl font-bold leading-tight', result.profit < 0 ? 'text-danger' : 'text-ink')}>{signed(result.profit)}</p>
                <p className="mt-0.5 text-sm text-ink-2">
                  이익률 <span className={clsx('num text-base font-bold', result.profit < 0 ? 'text-danger' : 'text-brand-ink')}>{pct(result.marginPct)}</span>
                  <span className="text-muted"> · 판매가 대비</span>
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-2">
                <Stat label="총 수수료" value={won(result.feeTotal)} />
                <Stat label="정산 예상액" value={signed(result.settlement)} danger={result.settlement < 0} />
              </dl>
              {result.missing.length > 0 && (
                <Callout tone="warn" title="요율을 넣지 않은 항목이 있습니다">
                  {result.missing.join(', ')} — 0원으로 계산했습니다. 왼쪽에서 요율을 입력하세요.
                </Callout>
              )}
            </Section>
            {result.monthly && (
              <Section title="월 기준">
                <dl className="grid grid-cols-2 gap-2">
                  <Stat label={`월 이익 · ${fmt.format(result.monthly.orders)}건`} value={signed(result.monthly.profit)} danger={result.monthly.profit < 0} />
                  <Stat label={result.monthly.feeLabel} value={`-${won(result.monthly.fee)}`} />
                </dl>
                <p className="text-sm text-muted">주문 1건 이익 × 월 판매 건수에서 월 이용료를 뺀 값입니다.</p>
              </Section>
            )}
            <Section title="항목별 내역">
              <Breakdown result={result} />
            </Section>
            <Section title="목표 이익으로 판매가 찾기" action={<TargetIcon className="size-4 text-muted" aria-hidden />}>
              <ReverseCalc calcAt={calcAt} onApply={onPrice} />
            </Section>
          </>
        ) : (
          <>
            <EmptyState
              title="판매가를 입력하면 이익이 계산됩니다"
              action={
                <Button icon={ListPlus} onClick={onExample}>
                  예시 불러오기
                </Button>
              }
            >
              판매가·원가·배송 조건을 넣으면 수수료와 이익, 이익률이 바로 나옵니다.
            </EmptyState>
            <Section title="목표 이익으로 판매가 찾기" className="border-t border-line">
              <ReverseCalc calcAt={calcAt} onApply={onPrice} />
            </Section>
          </>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={ListPlus} onClick={onExample}>
          예시 불러오기
        </Button>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onReset}>
          입력 초기화
        </Button>
        {shelf && <div className="ml-auto flex flex-wrap items-center gap-2">{shelf}</div>}
      </div>
      <Panel>{children}</Panel>
      <Disclosure title="계산 기준">
        <div className="prose-ob text-sm">{basis}</div>
      </Disclosure>
      <SourceFooter metas={[meta]} />
    </ToolLayout>
  )
}

/** 요율 구획 제목 옆의 "요율 기본값으로" 버튼 */
export function ResetRates({ onReset }: { onReset: () => void }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={RotateCcw}
      onClick={() => {
        onReset()
        toast.info('요율을 기본값으로 되돌렸습니다.')
      }}
    >
      요율 기본값으로
    </Button>
  )
}
