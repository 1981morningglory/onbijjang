import clsx from 'clsx'
import { ChevronRight, Copy, FileDown, FileSpreadsheet, Inbox, PencilLine, Search, Trash2, X } from 'lucide-react'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { downloadBlob } from '@/lib/files'
import { Badge, Button, EmptyState, IconButton, Panel, Segmented, Select, Spinner, TextInput, toast } from '@/ui'
import { DOC_NAME, fileBase, todayIso, won, type QuoteDoc } from './model'
import { docToPdf, docToXlsx } from './output'
import { useTeam, type DocEntry, type DocStatus } from './team'

export type BoardFilter = { customer?: string; item?: string }

// ── 진행 상태(견적서) ─────────────────────────────────────
const STATUS: Record<DocStatus, { label: string; cls: string }> = {
  pending: { label: '견적중', cls: 'border-warn/40 bg-mark-soft text-ink' },
  done: { label: '진행완료', cls: 'border-brand bg-brand text-white' },
  canceled: { label: '취소됨', cls: 'border-line-strong bg-sunken text-muted line-through' },
}
const NEXT: Record<DocStatus, DocStatus> = { pending: 'done', done: 'canceled', canceled: 'pending' }
const statusOf = (d: Pick<DocEntry, 'status'>): DocStatus => d.status ?? 'pending'

function StatusChip({ status }: { status: DocStatus }) {
  return <span className={clsx('inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold', STATUS[status].cls)}>{STATUS[status].label}</span>
}

/** 누를 때마다 견적중 → 진행완료 → 취소됨 → 견적중 */
function StatusButton({ entry }: { entry: DocEntry }) {
  const setDocStatus = useTeam((s) => s.setDocStatus)
  const status = statusOf(entry)
  const next = NEXT[status]
  return (
    <button
      type="button"
      onClick={() => setDocStatus(entry.id, next).catch((err) => toast.error(err instanceof Error ? err.message : '바꾸지 못했습니다.'))}
      title={`누르면 ‘${STATUS[next].label}’(으)로 바뀝니다`}
      aria-label={`진행 상태 ${STATUS[status].label}, 누르면 ${STATUS[next].label}`}
      className={clsx('inline-flex h-7 min-w-[4.75rem] items-center justify-center whitespace-nowrap rounded-full border px-3 text-xs font-bold shadow-1 transition-colors duration-150 hover:brightness-95 active:scale-95', STATUS[status].cls)}
    >
      {STATUS[status].label}
    </button>
  )
}

type Period = 'month' | 'lastMonth' | 'quarter' | 'year' | 'all' | 'custom'
const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'month', label: '이번 달' },
  { value: 'lastMonth', label: '지난 달' },
  { value: 'quarter', label: '최근 3개월' },
  { value: 'year', label: '올해' },
  { value: 'all', label: '전체 기간' },
  { value: 'custom', label: '직접 고르기' },
]

function periodRange(p: Period, from: string, to: string): [string, string] {
  const now = new Date()
  const iso = (d: Date) => todayIso(d)
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (p) {
    case 'month':
      return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))]
    case 'lastMonth':
      return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
    case 'quarter':
      return [iso(new Date(y, m - 2, 1)), iso(new Date(y, m + 1, 0))]
    case 'year':
      return [`${y}-01-01`, `${y}-12-31`]
    case 'custom':
      return [from || '0000-01-01', to || '9999-12-31']
    default:
      return ['0000-01-01', '9999-12-31']
  }
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
function dayLabel(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso || '날짜 없음'
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일 (${WEEK[d.getDay()]})`
}
const itemSummary = (e: DocEntry) => {
  const named = e.items.filter((i) => i.name)
  return named.length ? `${named[0].name}${e.items.length > 1 ? ` 외 ${e.items.length - 1}건` : ''}` : ''
}
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

function useDownloads() {
  const kit = useTeam((s) => s.kit)
  const getDoc = useTeam((s) => s.getDoc)
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, entry: DocEntry, kind: 'pdf' | 'xlsx') => {
    setBusy(key)
    try {
      const doc = await getDoc(entry.id)
      const blob = kind === 'pdf' ? await docToPdf(doc, kit) : await docToXlsx(doc, kit)
      downloadBlob(blob, `${fileBase(doc)}_${entry.docNo || entry.id}.${kind}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '만들지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

// ── 문서함 ────────────────────────────────────────────────
export function DocsBoard({ filter, setFilter, onOpen, onCopy }: { filter: BoardFilter; setFilter: (f: BoardFilter) => void; onOpen: (doc: QuoteDoc, id: string) => void; onCopy: (doc: QuoteDoc) => void }) {
  const docs = useTeam((s) => s.docs)
  const getDoc = useTeam((s) => s.getDoc)
  const deleteDoc = useTeam((s) => s.deleteDoc)
  const [type, setType] = useState<'all' | 'quote' | 'statement'>('all')
  const [stat, setStat] = useState<'all' | DocStatus>('all')
  const [period, setPeriod] = useState<Period>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(100)
  const { busy, run } = useDownloads()

  const rows = useMemo(() => {
    if (!docs) return []
    const [a, b] = periodRange(period, from, to)
    const query = norm(q)
    return docs
      .filter((d) => (type === 'all' || d.type === type) && d.date >= a && d.date <= b)
      .filter((d) => stat === 'all' || (d.type === 'quote' && statusOf(d) === stat))
      .filter((d) => !filter.customer || d.customer === filter.customer)
      .filter((d) => !filter.item || d.items.some((i) => i.name === filter.item))
      .filter((d) => !query || norm([d.customer, d.docNo, d.title, d.author, ...d.items.map((i) => `${i.name} ${i.spec}`)].join(' ')).includes(query))
      .sort((x, y) => (x.date === y.date ? y.updatedAt.localeCompare(x.updatedAt) : y.date.localeCompare(x.date)))
  }, [docs, type, stat, period, from, to, q, filter])

  const shown = rows.slice(0, limit)
  const groups = useMemo(() => {
    const out: Array<{ date: string; items: DocEntry[] }> = []
    for (const r of shown) {
      const last = out[out.length - 1]
      if (last && last.date === r.date) last.items.push(r)
      else out.push({ date: r.date, items: [r] })
    }
    return out
  }, [shown])
  const sum = rows.reduce((s, r) => s + r.total, 0)

  const act = async (key: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '처리하지 못했습니다.')
    }
    void key
  }

  if (docs === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted">
        <Spinner /> 문서함을 불러오는 중
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <Panel className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="문서 구분"
            size="sm"
            value={type}
            onValue={setType}
            options={[
              { value: 'all', label: '전체' },
              { value: 'quote', label: '견적서' },
              { value: 'statement', label: '거래명세서' },
            ]}
          />
          <Segmented
            label="진행 상태"
            size="sm"
            value={stat}
            onValue={setStat}
            options={[
              { value: 'all', label: '진행 전체' },
              { value: 'pending', label: '견적중' },
              { value: 'done', label: '진행완료' },
              { value: 'canceled', label: '취소됨' },
            ]}
          />
          <Select<Period> aria-label="기간" value={period} onValue={setPeriod} options={PERIODS} className="h-9! w-36!" />
          {period === 'custom' && (
            <div className="flex items-center gap-1.5">
              <TextInput type="date" aria-label="시작일" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9! w-40!" />
              <span className="text-muted">~</span>
              <TextInput type="date" aria-label="끝일" value={to} onChange={(e) => setTo(e.target.value)} className="h-9! w-40!" />
            </div>
          )}
          <label className="ml-auto flex h-9 min-w-56 flex-1 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 focus-within:border-brand sm:max-w-80">
            <Search className="size-4 text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="거래처·품목·번호·작성자 찾기" aria-label="문서 찾기" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
          </label>
        </div>
        {(filter.customer || filter.item) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">걸러 보는 중:</span>
            {filter.customer && (
              <button type="button" onClick={() => setFilter({ ...filter, customer: undefined })} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 font-semibold text-brand-ink">
                거래처 {filter.customer} <X className="size-3.5" aria-label="빼기" />
              </button>
            )}
            {filter.item && (
              <button type="button" onClick={() => setFilter({ ...filter, item: undefined })} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 font-semibold text-brand-ink">
                품목 {filter.item} <X className="size-3.5" aria-label="빼기" />
              </button>
            )}
          </div>
        )}
        <p className="num text-sm text-ink-2">
          문서 <b>{rows.length}</b>건 · 합계 <b>{won(sum)}</b>원
        </p>
      </Panel>

      {rows.length === 0 ? (
        <EmptyState icon={Inbox} title={docs.length ? '조건에 맞는 문서가 없습니다' : '아직 저장한 문서가 없습니다'}>
          {docs.length ? '기간이나 검색어를 바꿔 보세요.' : '문서 작성에서 ‘문서함에 저장’하거나 PDF·엑셀로 내려받으면 여기에 날짜별로 쌓입니다.'}
        </EmptyState>
      ) : (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line bg-paper text-left text-xs text-muted">
                  <th className="px-3 py-2 font-semibold">구분</th>
                  <th className="px-3 py-2 font-semibold">진행</th>
                  <th className="px-3 py-2 font-semibold">번호</th>
                  <th className="px-3 py-2 font-semibold">거래처</th>
                  <th className="px-3 py-2 font-semibold">품명·품목</th>
                  <th className="px-3 py-2 text-right font-semibold">합계</th>
                  <th className="px-3 py-2 font-semibold">작성자</th>
                  <th className="px-3 py-2 text-right font-semibold">완성본·관리</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.date}>
                  <tr className="bg-sunken">
                    <th colSpan={8} className="px-3 py-1.5 text-left text-xs font-bold text-ink-2">
                      {dayLabel(g.date)} <span className="font-medium text-muted">· {g.items.length}건 · {won(g.items.reduce((s, r) => s + r.total, 0))}원</span>
                    </th>
                  </tr>
                  {g.items.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-paper">
                      <td className="px-3 py-2">
                        <Badge tone={r.type === 'quote' ? 'brand' : 'neutral'}>{DOC_NAME[r.type]}</Badge>
                      </td>
                      <td className="px-3 py-2">{r.type === 'quote' ? <StatusButton entry={r} /> : <span className="text-xs text-faint">-</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{r.docNo}</td>
                      <td className="max-w-48 px-3 py-2">
                        <button type="button" className="truncate text-left font-semibold text-ink hover:underline" onClick={() => setFilter({ ...filter, customer: r.customer })} title="이 거래처 문서만 보기">
                          {r.customer || '(거래처 없음)'}
                        </button>
                      </td>
                      <td className="max-w-64 truncate px-3 py-2 text-ink-2" title={r.items.map((i) => i.name).filter(Boolean).join(', ')}>
                        {[r.title, itemSummary(r)].filter(Boolean).join(' · ')}
                      </td>
                      <td className={clsx('whitespace-nowrap px-3 py-2 text-right font-bold text-ink', r.type === 'quote' && statusOf(r) === 'canceled' && 'text-faint line-through')}>{won(r.total)}</td>
                      <td className="max-w-28 truncate px-3 py-2 text-ink-2">{r.author}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex justify-end">
                          <Button size="sm" variant="ghost" icon={FileDown} loading={busy === `${r.id}:pdf`} onClick={() => run(`${r.id}:pdf`, r, 'pdf')}>
                            PDF
                          </Button>
                          <Button size="sm" variant="ghost" icon={FileSpreadsheet} loading={busy === `${r.id}:xlsx`} onClick={() => run(`${r.id}:xlsx`, r, 'xlsx')}>
                            엑셀
                          </Button>
                          <IconButton icon={PencilLine} label="열어서 고치기" size="sm" onClick={() => act('open', async () => onOpen(await getDoc(r.id), r.id))} />
                          <IconButton icon={Copy} label="복사해서 새 문서" size="sm" onClick={() => act('copy', async () => onCopy(await getDoc(r.id)))} />
                          <IconButton
                            icon={Trash2}
                            label="지우기"
                            size="sm"
                            onClick={() =>
                              act('del', async () => {
                                if (!confirm(`${DOC_NAME[r.type]} ${r.docNo} (${r.customer || '거래처 없음'})를 지울까요? 팀원 모두의 문서함에서 사라집니다.`)) return
                                await deleteDoc(r.id)
                                toast.success('지웠습니다.')
                              })
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          {rows.length > limit && (
            <div className="border-t border-line p-2 text-center">
              <Button size="sm" onClick={() => setLimit((l) => l + 100)}>
                {rows.length - limit}건 더 보기
              </Button>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

// ── 거래처 ────────────────────────────────────────────────
interface CustomerRow {
  name: string
  bizNo: string
  quotes: number
  statements: number
  total: number
  last: string
}

export function CustomersBoard({ onShow }: { onShow: (customer: string) => void }) {
  const docs = useTeam((s) => s.docs)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'recent' | 'total' | 'name'>('recent')
  const rows = useMemo(() => {
    const map = new Map<string, CustomerRow>()
    for (const d of docs ?? []) {
      const name = d.customer.trim() || '(거래처 없음)'
      const r = map.get(name) ?? { name, bizNo: '', quotes: 0, statements: 0, total: 0, last: '' }
      if (d.type === 'quote') r.quotes++
      else r.statements++
      r.total += d.total
      if (d.customerBizNo && !r.bizNo) r.bizNo = d.customerBizNo
      if (d.date > r.last) r.last = d.date
      map.set(name, r)
    }
    const query = norm(q)
    const list = [...map.values()].filter((r) => !query || norm(`${r.name} ${r.bizNo}`).includes(query))
    return list.sort((a, b) => (sort === 'total' ? b.total - a.total : sort === 'name' ? a.name.localeCompare(b.name, 'ko') : b.last.localeCompare(a.last)))
  }, [docs, q, sort])

  return (
    <BoardShell
      q={q}
      setQ={setQ}
      placeholder="거래처 이름·등록번호 찾기"
      sort={sort}
      setSort={setSort}
      sorts={[
        { value: 'recent', label: '최근 거래순' },
        { value: 'total', label: '금액 큰 순' },
        { value: 'name', label: '이름순' },
      ]}
      count={rows.length}
      unit="곳"
      empty={!docs?.length}
    >
      <table className="num w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line bg-paper text-left text-xs text-muted">
            <th className="px-3 py-2 font-semibold">거래처</th>
            <th className="px-3 py-2 font-semibold">등록번호</th>
            <th className="px-3 py-2 text-right font-semibold">견적서</th>
            <th className="px-3 py-2 text-right font-semibold">거래명세서</th>
            <th className="px-3 py-2 text-right font-semibold">합계 금액</th>
            <th className="px-3 py-2 font-semibold">최근 거래</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-line last:border-b-0 hover:bg-paper">
              <td className="px-3 py-2 font-semibold text-ink">{r.name}</td>
              <td className="px-3 py-2 text-ink-2">{r.bizNo}</td>
              <td className="px-3 py-2 text-right">{r.quotes}</td>
              <td className="px-3 py-2 text-right">{r.statements}</td>
              <td className="px-3 py-2 text-right font-bold">{won(r.total)}</td>
              <td className="px-3 py-2 text-ink-2">{r.last}</td>
              <td className="px-2 py-1.5 text-right">
                <Button size="sm" variant="ghost" onClick={() => onShow(r.name === '(거래처 없음)' ? '' : r.name)}>
                  문서 보기
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </BoardShell>
  )
}

// ── 품목 ──────────────────────────────────────────────────
/** 문서 한 장에 쓰인 품목 한 줄 */
interface ItemUse {
  docId: string
  docNo: string
  type: DocEntry['type']
  status: DocStatus
  date: string
  customer: string
  title: string
  name: string
  spec: string
  qty: number
  unitPrice: number
  total: number
}
interface ItemRow {
  key: string
  name: string
  spec: string
  count: number
  qty: number
  lastPrice: number
  min: number
  max: number
  lastCustomer: string
  last: string
  uses: ItemUse[]
}

/** 문서들의 품목 줄을 모두 펼친다. 품목 이름이 비었으면 문서의 품명(건명)으로 대신한다 */
function itemUses(docs: DocEntry[]): ItemUse[] {
  const out: ItemUse[] = []
  for (const d of docs) {
    for (const it of d.items) {
      const name = it.name || d.title || '(이름 없는 품목)'
      out.push({ docId: d.id, docNo: d.docNo, type: d.type, status: statusOf(d), date: d.date, customer: d.customer, title: d.title, name, spec: it.spec, qty: it.qty || 0, unitPrice: it.unitPrice || 0, total: it.total || 0 })
    }
  }
  return out
}

export function ItemsBoard({ onShow, onOpen }: { onShow: (item: string) => void; onOpen: (doc: QuoteDoc, id: string) => void }) {
  const docs = useTeam((s) => s.docs)
  const getDoc = useTeam((s) => s.getDoc)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'recent' | 'count' | 'name'>('recent')
  const [view, setView] = useState<'sum' | 'lines'>('sum')
  const [open, setOpen] = useState<string | null>(null)
  const query = norm(q)
  const uses = useMemo(() => itemUses(docs ?? []).filter((u) => !query || norm(`${u.name} ${u.spec} ${u.customer} ${u.docNo}`).includes(query)), [docs, query])
  const rows = useMemo(() => {
    const map = new Map<string, ItemRow>()
    // 오래된 문서부터 보아 '최근 단가'가 마지막 값이 되게 한다
    const ordered = [...uses].sort((a, b) => a.date.localeCompare(b.date))
    for (const u of ordered) {
      const key = `${u.name}\u0000${u.spec}`
      const r = map.get(key) ?? { key, name: u.name, spec: u.spec, count: 0, qty: 0, lastPrice: 0, min: Infinity, max: 0, lastCustomer: '', last: '', uses: [] }
      r.count++
      r.qty += u.qty
      if (u.unitPrice) {
        r.lastPrice = u.unitPrice
        r.min = Math.min(r.min, u.unitPrice)
        r.max = Math.max(r.max, u.unitPrice)
      }
      r.lastCustomer = u.customer
      r.last = u.date
      r.uses.unshift(u)
      map.set(key, r)
    }
    const list = [...map.values()]
    return list.sort((a, b) => (sort === 'count' ? b.count - a.count : sort === 'name' ? a.name.localeCompare(b.name, 'ko') : b.last.localeCompare(a.last)))
  }, [uses, sort])
  const lines = useMemo(() => [...uses].sort((a, b) => b.date.localeCompare(a.date) || b.docNo.localeCompare(a.docNo)), [uses])
  const openDoc = async (id: string) => {
    try {
      onOpen(await getDoc(id), id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '열지 못했습니다.')
    }
  }

  const usesTable = (list: ItemUse[], withName: boolean) => (
    <table className="num w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs text-muted">
          <th className="px-3 py-1.5 font-semibold">날짜</th>
          <th className="px-3 py-1.5 font-semibold">문서</th>
          <th className="px-3 py-1.5 font-semibold">진행</th>
          <th className="px-3 py-1.5 font-semibold">거래처</th>
          {withName && <th className="px-3 py-1.5 font-semibold">품목</th>}
          {withName && <th className="px-3 py-1.5 font-semibold">규격</th>}
          <th className="px-3 py-1.5 text-right font-semibold">수량</th>
          <th className="px-3 py-1.5 text-right font-semibold">단가</th>
          <th className="px-3 py-1.5 text-right font-semibold">금액</th>
        </tr>
      </thead>
      <tbody>
        {list.map((u, i) => (
          <tr key={`${u.docId}-${i}`} className={clsx('border-b border-line last:border-b-0', u.status === 'canceled' && 'text-faint')}>
            <td className="whitespace-nowrap px-3 py-1.5">{u.date}</td>
            <td className="whitespace-nowrap px-3 py-1.5">
              <button type="button" className="text-brand-ink hover:underline" onClick={() => void openDoc(u.docId)} title="이 문서 열기">
                {DOC_NAME[u.type]} {u.docNo}
              </button>
            </td>
            <td className="px-3 py-1.5">{u.type === 'quote' ? <StatusChip status={u.status} /> : <span className="text-xs text-faint">-</span>}</td>
            <td className="max-w-40 truncate px-3 py-1.5">{u.customer}</td>
            {withName && <td className="max-w-56 truncate px-3 py-1.5 font-semibold text-ink">{u.name}</td>}
            {withName && <td className="px-3 py-1.5 text-ink-2">{u.spec}</td>}
            <td className="px-3 py-1.5 text-right">{won(u.qty)}</td>
            <td className="px-3 py-1.5 text-right">{u.unitPrice ? won(u.unitPrice) : ''}</td>
            <td className={clsx('px-3 py-1.5 text-right font-semibold', u.status === 'canceled' && 'line-through')}>{won(u.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <BoardShell
      q={q}
      setQ={setQ}
      placeholder="품목·규격·거래처·번호 찾기"
      sort={sort}
      setSort={setSort}
      sorts={[
        { value: 'recent', label: '최근 거래순' },
        { value: 'count', label: '많이 쓴 순' },
        { value: 'name', label: '이름순' },
      ]}
      count={view === 'sum' ? rows.length : lines.length}
      unit={view === 'sum' ? '개' : '줄'}
      empty={!docs?.length}
      extra={
        <Segmented
          label="보기"
          size="sm"
          value={view}
          onValue={setView}
          options={[
            { value: 'sum', label: '품목별 모아보기' },
            { value: 'lines', label: '문서별 품목 전체' },
          ]}
        />
      }
    >
      {view === 'lines' ? (
        <div className="min-w-[880px]">{usesTable(lines, true)}</div>
      ) : (
        <table className="num w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line bg-paper text-left text-xs text-muted">
              <th className="px-3 py-2 font-semibold">품목</th>
              <th className="px-3 py-2 font-semibold">규격</th>
              <th className="px-3 py-2 text-right font-semibold">거래 횟수</th>
              <th className="px-3 py-2 text-right font-semibold">총 수량</th>
              <th className="px-3 py-2 text-right font-semibold">최근 단가</th>
              <th className="px-3 py-2 text-right font-semibold">단가 범위</th>
              <th className="px-3 py-2 font-semibold">최근 거래처</th>
              <th className="px-3 py-2 font-semibold">최근 거래</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.key}>
                <tr className={clsx('border-b border-line last:border-b-0 hover:bg-paper', open === r.key && 'bg-paper')}>
                  <td className="max-w-56 px-3 py-2">
                    <button type="button" className="flex items-center gap-1 truncate text-left font-semibold text-ink hover:underline" aria-expanded={open === r.key} onClick={() => setOpen(open === r.key ? null : r.key)} title="이 품목이 쓰인 문서 보기">
                      <ChevronRight className={clsx('size-3.5 shrink-0 transition-transform', open === r.key && 'rotate-90')} aria-hidden />
                      {r.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{r.spec}</td>
                  <td className="px-3 py-2 text-right">{r.count}</td>
                  <td className="px-3 py-2 text-right">{won(r.qty)}</td>
                  <td className="px-3 py-2 text-right font-bold">{r.lastPrice ? won(r.lastPrice) : ''}</td>
                  <td className={clsx('whitespace-nowrap px-3 py-2 text-right text-xs', r.min !== r.max ? 'text-warn' : 'text-muted')}>{r.max ? (r.min === r.max ? '같음' : `${won(r.min)} ~ ${won(r.max)}`) : ''}</td>
                  <td className="max-w-40 truncate px-3 py-2 text-ink-2">{r.lastCustomer}</td>
                  <td className="px-3 py-2 text-ink-2">{r.last}</td>
                  <td className="px-2 py-1.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => onShow(r.name)}>
                      문서 보기
                    </Button>
                  </td>
                </tr>
                {open === r.key && (
                  <tr className="border-b border-line bg-paper">
                    <td colSpan={9} className="px-6 pb-3 pt-1">
                      <div className="rounded-md border border-line bg-surface">{usesTable(r.uses, false)}</div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </BoardShell>
  )
}

function BoardShell<S extends string>({
  q,
  setQ,
  placeholder,
  sort,
  setSort,
  sorts,
  count,
  unit,
  empty,
  extra,
  children,
}: {
  q: string
  setQ: (v: string) => void
  placeholder: string
  sort: S
  setSort: (v: S) => void
  sorts: Array<{ value: S; label: string }>
  count: number
  unit: string
  empty: boolean
  extra?: ReactNode
  children: ReactNode
}) {
  if (empty) return <EmptyState icon={Inbox} title="아직 저장한 문서가 없습니다">문서함에 문서가 쌓이면 여기서 모아 볼 수 있습니다.</EmptyState>
  return (
    <div className="flex flex-col gap-3">
      <Panel className="flex flex-wrap items-center gap-2 p-3">
        {extra}
        <Select<S> aria-label="정렬" value={sort} onValue={setSort} options={sorts} className="h-9! w-36!" />
        <span className="num text-sm text-ink-2">
          {count}
          {unit}
        </span>
        <label className="ml-auto flex h-9 min-w-56 flex-1 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 focus-within:border-brand sm:max-w-80">
          <Search className="size-4 text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
        </label>
      </Panel>
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">{children}</div>
      </Panel>
    </div>
  )
}
