/**
 * 주문서만들기(온비팀전용)
 * 사방넷 주문서 → 센터주문서 · CJ택배 · 구글드라이브용 엑셀. 올린 주문서는 날짜·차수별로 서버에 쌓아 조회한다.
 */
import clsx from 'clsx'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cloud,
  ExternalLink,
  FileSpreadsheet,
  FileUp,
  History,
  LogIn,
  PackageCheck,
  Pencil,
  RotateCcw,
  Save,
  Search,
  Trash2,
  TriangleAlert,
  Truck,
  Warehouse,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react'
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useLoginDialog } from '@/app/LoginDialog'
import { api, ApiError } from '@/lib/api'
import { downloadBlob, makeZip } from '@/lib/files'
import { Badge, Button, Callout, Dialog, Dropzone, EmptyState, Field, Panel, Segmented, Select, Spinner, Switch, Tabs, Textarea, TextInput, toast } from '@/ui'
import { readAnyTable, readSabangnet, writeOutput, writeTable } from './excel'
import {
  batchStamp,
  centerOrder,
  COL,
  dateFromName,
  dateTimeKst,
  DEFAULT_WAREHOUSE,
  CENTER_WAREHOUSES,
  isCenterRow,
  isJeju,
  needsProduct,
  OUTPUTS,
  outputFileName,
  pickPhone,
  productKey,
  resolveCenter,
  SEARCH_FIELDS,
  layoutCenter,
  timeKst,
  todayKst,
  type CenterOrder,
  type OrderRow,
  type OutputKind,
  type SearchField,
  type SourceSheet,
} from './logic'

interface BatchBrief {
  id: string
  date: string
  seq: number
  fileName: string
  sheetName: string
  uploadedAt: string
  uploadedBy: string
  editedAt: string | null
  count: number
  orders: number
  qty: number
  amount: number | null
  /** 송장이 붙은 주문 수 · 송장(운송장) 수 */
  invoiceOrders: number
  /** 미출고 갯수: 송장이 없는 주문 수(취소요청·취소완료 줄은 빼고) */
  unshipped?: number
  waybills: number
  /** 검색어에 맞는 줄 번호(검색할 때만) */
  lines?: number[]
}
/** 일마감한 날 */
interface DayClose {
  at: string
  by: string
}
interface Waybill {
  invoice: string
  /** 담당자가 고친 송장 */
  manual?: boolean
  date?: string
  pickupDate?: string
  status?: string
  box?: string
  fare?: number
  receiver?: string
}
interface CjDay {
  date: string
  uploads: number
  lastUploadAt: string | null
  lastBy: string
  fileNames: string[]
  /** 운송장(상자) 수 · 상품 줄 수 */
  waybills: number
  lines: number
  orders: number
  matched: number
  fare: number
}
interface CjWaybill extends Waybill {
  orderNo: string
  sabangNo: string
  mall: string
  name: string
  option: string
  qty: number
  home: { batchId: string; date: string; seq: number; buyer: string; mall: string } | null
}
/** CJ대한통운 배송조회 */
const trackUrl = (invoice: string) => `https://trace.cjlogistics.com/next/tracking.html?wblNo=${invoice.replace(/\D/g, '')}`

/** 운송장 번호 칩(누르면 CJ 배송조회) */
function WaybillChips({ list, compact }: { list: Waybill[]; compact?: boolean }) {
  if (!list.length) return <span className="text-xs text-faint">-</span>
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((w) => (
        <a
          key={w.invoice}
          href={trackUrl(w.invoice)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={[w.pickupDate && `집화 ${w.pickupDate}`, w.status, w.box && `박스 ${w.box}`].filter(Boolean).join(' · ') || 'CJ대한통운 배송조회'}
          className={clsx(
            'num inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface py-0.5 text-xs text-ink-2 transition-colors duration-150 hover:border-brand/50 hover:bg-brand-soft hover:text-brand-ink',
            compact ? 'px-1.5' : 'px-2',
          )}
        >
          {!compact && <Truck className="size-3" aria-hidden />}
          {w.invoice}
        </a>
      ))}
    </div>
  )
}

interface Mapping {
  code: string
  name: string
  option: string
  warehouse?: string
}
type Tab = 'make' | 'search'
type FileSet = Array<{ kind: OutputKind; name: string; blob: Blob }>

const str = (v: unknown) => (v == null ? '' : String(v).trim())
const fmt = (n: number) => n.toLocaleString('ko-KR')
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const weekday = (date: string) => WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()]
/** 화면 쪽 센터주문서 양식 판(서버 쪽 CENTER_FORM 과 같이 올린다) */
const CENTER_FORM_UI = '센터주문서 v10'
const AMOUNT_RE = /결제\s*금액|주문\s*금액|총\s*금액|판매\s*금액|결제액/

/** 지금 보고 있는 사람: CS 내용 고치기·지우기는 적은 사람 본인과 전체마스터만 */
interface Me {
  id: string | null
  name: string | null
  master: boolean
}
const MeContext = createContext<Me>({ id: null, name: null, master: false })
const canEditCs = (me: Me, e: CsEntry) => me.master || (me.id != null && (e.uid ? e.uid === me.id : Boolean(me.name) && e.by === me.name))

export default function OrdersTool() {
  const [me, setMe] = useState<{ allowed: boolean; admin: boolean; me?: Me; version?: string; form?: string } | null>(null)
  const [offline, setOffline] = useState(false)
  const load = useCallback(async () => {
    try {
      setMe(await api<{ allowed: boolean; admin: boolean; me?: Me; version?: string; form?: string }>('/orders/status'))
      setOffline(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) setOffline(true)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const [tab, setTab] = useState<Tab>('make')

  if (offline)
    return (
      <Callout tone="warn" title="서버에 연결되지 않습니다">
        주문서는 온비짱 서버에 날짜·차수별로 저장하므로 서버가 켜져 있어야 씁니다.
        <div className="mt-2">
          <Button size="sm" icon={WifiOff} onClick={() => void load()}>
            다시 연결
          </Button>
        </div>
      </Callout>
    )
  if (!me)
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted">
        <Spinner /> 불러오는 중
      </div>
    )
  if (!me.allowed) return <Gate onIn={load} />
  return (
    <div className="flex flex-col gap-5">
      <Tabs<Tab>
        label="주문서"
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'make', label: '주문서 만들기', icon: FileSpreadsheet },
          { value: 'search', label: '주문 조회', icon: History },
        ]}
      />
      <MeContext.Provider value={me.me ?? { id: null, name: null, master: false }}>{tab === 'make' ? <Make onGoList={() => setTab('search')} /> : <OrdersList admin={me.admin} />}</MeContext.Provider>
      <p className="text-right text-2xs text-faint">
        화면 {CENTER_FORM_UI} · 서버 {me.form ?? '이전 버전'} · 배포 {me.version ?? '?'}
      </p>
    </div>
  )
}

// ── 입장 ──────────────────────────────────────────────────
function Gate({ onIn }: { onIn: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const showLogin = useLoginDialog((s) => s.show)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    api('/quote/login', { method: 'POST', body: { code: code.trim() } })
      .then(onIn)
      .catch((err) => toast.error(err instanceof Error ? err.message : '들어가지 못했습니다.'))
      .finally(() => setBusy(false))
  }
  return (
    <Panel className="mx-auto mt-6 w-full max-w-xl p-6">
      <h2 className="text-xl font-bold text-ink">온비팀 전용입니다</h2>
      <p className="mt-1 text-sm text-ink-2">고객 이름·연락처·주소가 담긴 주문서를 다루므로 직원 계정으로 로그인하거나 온비팀 팀 코드로 들어와 주세요.</p>
      <Button className="mt-4" variant="primary" icon={LogIn} onClick={showLogin}>
        직원 계정으로 로그인
      </Button>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        <Field label="온비팀 팀 코드">{(id) => <TextInput id={id} type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} maxLength={60} />}</Field>
        <Button type="submit" icon={LogIn} loading={busy} disabled={!code.trim()}>
          팀 코드로 들어가기
        </Button>
        <p className="text-xs text-muted">
          관리자는 <Link to="/admin" className="underline">관리자 화면</Link>에서 로그인하면 바로 쓸 수 있습니다.
        </p>
      </form>
    </Panel>
  )
}

// ── 첨부파일 버튼: [센터주문서] [CJ택배] [구글드라이브용] [전체합본] ──
const FILE_ICON: Record<OutputKind, LucideIcon> = { warehouse: Warehouse, cj: Truck, drive: Cloud }

async function makeFiles(rows: OrderRow[], sheetName: string, date: string, seq: number, center?: CenterOrder | null): Promise<FileSet> {
  return Promise.all(OUTPUTS.map(async (spec) => ({ kind: spec.kind, name: outputFileName(spec, date, seq), blob: await writeOutput(spec, rows, sheetName, { date, seq, center }) })))
}

function Chip({ icon: Icon, label, onClick, busy, accent }: { icon: LucideIcon; label: string; onClick: () => void; busy?: boolean; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      disabled={busy}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60',
        accent ? 'border-brand/40 bg-brand-soft text-brand-ink hover:bg-brand hover:text-on-brand' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-panel hover:text-ink',
      )}
    >
      {busy ? <Spinner /> : <Icon className="size-3.5" aria-hidden />}
      {label}
    </button>
  )
}

/** 파일은 처음 누를 때 한 번 만들어 두고 다시 쓴다 */
function FileChips({ load, date, seq }: { load: () => Promise<FileSet>; date: string; seq: number }) {
  const cache = useRef<Promise<FileSet> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const get = () => (cache.current ??= load().catch((err) => {
    cache.current = null
    throw err
  }))
  const run = async (key: string, fn: (files: FileSet) => Promise<void> | void) => {
    setBusy(key)
    try {
      await fn(await get())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일을 만들지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {OUTPUTS.map((spec) => (
        <Chip
          key={spec.kind}
          icon={FILE_ICON[spec.kind]}
          label={spec.label}
          busy={busy === spec.kind}
          onClick={() =>
            void run(spec.kind, (files) => {
              const f = files.find((x) => x.kind === spec.kind)!
              downloadBlob(f.blob, f.name)
            })
          }
        />
      ))}
      <Chip
        icon={Archive}
        label="전체합본"
        accent
        busy={busy === 'zip'}
        onClick={() => void run('zip', async (files) => downloadBlob(await makeZip(files.map((f) => ({ name: f.name, data: f.blob }))), `${batchStamp(date, seq)}_전체합본.zip`))}
      />
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="min-w-24 rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-2xs font-semibold text-muted">{label}</div>
      <div className={clsx('num mt-0.5 text-lg font-bold', tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</div>
    </div>
  )
}

// ── 주문서 만들기 ─────────────────────────────────────────
function Make({ onGoList }: { onGoList: () => void }) {
  const [src, setSrc] = useState<(SourceSheet & { fileName: string }) | null>(null)
  /** 다른 물류처라서 받지 않은 줄(화면에 알리기만) */
  const [excluded, setExcluded] = useState<OrderRow[]>([])
  const [rows, setRows] = useState<OrderRow[]>([])
  const [date, setDate] = useState(todayKst())
  const [seq, setSeq] = useState<number | null>(null)
  const [known, setKnown] = useState<{ products: Record<string, Mapping>; catalog: Record<string, { name: string; option: string }> }>({ products: {}, catalog: {} })
  const [busy, setBusy] = useState(false)
  const [skip, setSkip] = useState(false)
  const [saved, setSaved] = useState<{ batch: BatchBrief; rows: OrderRow[]; sheetName: string; center: CenterOrder } | null>(null)
  const [showRows, setShowRows] = useState(false)

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setSeq(null)
    let alive = true
    api<{ seq: number }>(`/orders/next-seq?date=${date}`)
      .then((r) => alive && setSeq(r.seq))
      .catch(() => alive && setSeq(null))
    return () => {
      alive = false
    }
  }, [date, saved])

  const loadFile = async (file: File) => {
    setSaved(null)
    setSkip(false)
    try {
      const [s, k] = await Promise.all([readSabangnet(file), api<typeof known>('/orders/products').catch(() => known)])
      setKnown(k)
      // 물류처명이 일산센터·파주센터이거나 비어 있는 주문만 받는다. 다른 물류처 주문은 저장·파일 어디에도 넣지 않는다
      const mine = s.rows.filter(isCenterRow)
      const others = s.rows.filter((r) => !isCenterRow(r))
      if (!mine.length) throw new Error(`이 파일에는 ${CENTER_WAREHOUSES.join('·')}(또는 물류처명 빈칸) 주문이 없습니다. 다른 물류처 주문 ${others.length}줄은 받지 않습니다.`)
      // 전에 맞춰 둔 상품은 자동으로 채운다
      const filled = mine.map((r) => {
        if (!needsProduct(r)) return { ...r, [COL.warehouse]: r[COL.warehouse] ?? DEFAULT_WAREHOUSE }
        const m = k.products[productKey(r)]
        return m ? { ...r, [COL.code]: m.code, [COL.name]: m.name, [COL.option]: m.option || '단품', [COL.warehouse]: r[COL.warehouse] ?? DEFAULT_WAREHOUSE, _auto: m.code } : { ...r, _fix: 1 }
      })
      setSrc({ ...s, fileName: file.name })
      setRows(filled)
      setExcluded(others)
      if (others.length) toast.info(`다른 물류처 주문 ${others.length}줄은 빼고 일산·파주센터 주문 ${mine.length}줄만 불러왔습니다.`)
      setDate(dateFromName(s.sheetName, file.name) ?? todayKst())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일을 읽지 못했습니다.')
    }
  }

  const fixRows = rows.map((r, i) => [r, i] as const).filter(([r]) => r._fix || r._auto)
  const missing = rows.filter((r) => needsProduct(r)).length
  const amountCol = src?.cols.find((c) => AMOUNT_RE.test(c))
  const stats = useMemo(() => {
    const malls = new Map<string, number>()
    for (const r of rows) malls.set(str(r[COL.mall]) || '(없음)', (malls.get(str(r[COL.mall]) || '(없음)') ?? 0) + 1)
    return {
      orders: new Set(rows.map((r) => `${str(r[COL.mall])}|${str(r[COL.orderNo])}`)).size,
      qty: rows.reduce((s, r) => s + (Number(r[COL.qty]) || 0), 0),
      amount: amountCol ? rows.reduce((s, r) => s + (Number(String(r[amountCol] ?? '').replace(/[^\d.-]/g, '')) || 0), 0) : null,
      jeju: rows.filter(isJeju).length,
      malls: [...malls].sort((a, b) => b[1] - a[1]),
    }
  }, [rows, amountCol])

  const setRow = (i: number, patch: OrderRow) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const onCode = (i: number, code: string) => {
    const c = known.catalog[code.trim()]
    setRow(i, { [COL.code]: code, ...(c ? { [COL.name]: c.name, [COL.option]: c.option || '단품' } : {}) })
  }

  const save = async () => {
    if (!src || (missing && !skip)) return
    setBusy(true)
    try {
      const clean = rows.map(({ _fix, _auto, ...r }) => {
        void _fix
        void _auto
        const base = { ...r, [COL.warehouse]: str(r[COL.warehouse]) || DEFAULT_WAREHOUSE }
        // 상품을 못 맞춘 채로 만들면 창고가 알아볼 수 있게 쇼핑몰 상품명·옵션을 그대로 넣는다
        if (needsProduct(r)) return { ...base, [COL.name]: str(r[COL.name]) || r[COL.rawName] || null, [COL.option]: str(r[COL.option]) || r[COL.rawOption] || null }
        // 사람이 상품코드를 넣었는데 옵션을 비워 두면 ‘단품’
        return { ...base, [COL.option]: str(r[COL.option]) || '단품' }
      })
      // 센터주문서 NO 순서를 같이 저장한다(주문 조회 NO 가 센터주문서 NO 와 같게, 나중에 고쳐도 그대로)
      const center = centerOrder(clean)
      const mappings = rows
        .filter((r) => r._fix && str(r[COL.code]))
        .map((r) => ({ key: productKey(r), code: str(r[COL.code]), name: str(r[COL.name]), option: str(r[COL.option]), warehouse: str(r[COL.warehouse]) }))
      const { batch } = await api<{ batch: BatchBrief }>('/orders/batches', {
        method: 'POST',
        body: { date, fileName: src.fileName, sheetName: src.sheetName, cols: src.cols, rows: clean, mappings, center },
      })
      setSaved({ batch, rows: clean, sheetName: src.sheetName, center })
      toast.success(`${batch.date} ${batch.seq}차로 저장했습니다.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Dropzone
        compact={Boolean(src)}
        accept=".xlsx"
        multiple={false}
        icon={FileUp}
        title={src ? '다른 사방넷 파일 올리기' : '사방넷 파일 업로드'}
        hint={src ? undefined : '사방넷에서 내려받은 주문서(발주서) 엑셀을 끌어다 놓으세요. 센터주문서 · CJ택배 · 구글드라이브용 파일을 만들고, 주문 내역은 날짜·차수별로 저장됩니다.'}
        onFiles={(f) => f[0] && void loadFile(f[0])}
      />

      {src && (
        <Panel className="flex flex-col gap-5 p-5">
          {/* 파일과 주문서 날짜 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">
              <FileSpreadsheet className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-ink">{src.fileName}</div>
              <div className="text-xs text-muted">{src.sheetName}</div>
            </div>
            <Field label="주문서 날짜" className="w-44">
              {(id) => <TextInput id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={Boolean(saved)} />}
            </Field>
            {!saved && (
              <div className="flex flex-col items-start gap-0.5">
                <span className="text-2xs font-semibold text-muted">저장하면</span>
                <Badge tone="brand">{seq ? `${seq}차` : '…'}</Badge>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Stat label="주문건수" value={fmt(stats.orders)} />
            <Stat label="주문줄수" value={fmt(rows.length)} />
            <Stat label="수량" value={fmt(stats.qty)} />
            {stats.amount != null && <Stat label="주문총액" value={`${fmt(stats.amount)}원`} />}
            {stats.jeju > 0 && <Stat label="제주(제주도출고O)" value={`${stats.jeju}줄`} />}
            {fixRows.length > 0 && <Stat label="상품 못 맞춤" value={`${missing}줄`} tone={missing ? 'warn' : undefined} />}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {stats.malls.map(([m, n]) => (
              <span key={m} className="rounded-full bg-sunken px-2.5 py-0.5 text-xs text-ink-2">
                {m} <b className="num text-ink">{n}</b>
              </span>
            ))}
          </div>

          {excluded.length > 0 && (
            <details className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              <summary className="cursor-pointer font-semibold text-ink-2">
                다른 물류처 주문 {excluded.length}줄은 받지 않았습니다 <span className="font-normal text-muted">(물류처명이 {CENTER_WAREHOUSES.join('·')}이거나 빈칸인 주문만 받습니다)</span>
              </summary>
              <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
                {excluded.map((r, i) => (
                  <li key={i}>
                    {str(r[COL.warehouse])} · {str(r[COL.mall])} · {str(r[COL.orderNo])} · {str(r[COL.receiver])} · {str(r[COL.name]) || str(r[COL.rawName])} × {str(r[COL.qty])}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {fixRows.length > 0 && !saved && (
            <div className={clsx('flex flex-col gap-3 rounded-lg border p-3', missing ? 'border-warn/40 bg-warn-soft/40' : 'border-line bg-surface')}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className={clsx('flex items-center gap-1.5 text-sm font-bold', missing ? 'text-warn' : 'text-ink')}>
                  <TriangleAlert className="size-4" aria-hidden />
                  사방넷이 상품을 못 맞춘 줄 {fixRows.length}개{missing ? ` · 남은 ${missing}줄` : ' · 모두 채움'}
                </p>
                {missing > 0 && <Switch className="ml-auto" checked={skip} onChange={setSkip} label="입력하지 않고 그대로 만들기" hint="빈 상품코드는 비워 두고, 상품명·옵션은 쇼핑몰 것을 넣습니다." />}
              </div>
              <div className="overflow-x-auto rounded-md border border-line bg-panel">
                <table className="w-full min-w-[760px] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                  <thead className="bg-surface text-left text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2">쇼핑몰 상품명 · 옵션</th>
                      <th className="px-3 py-2">수취인 · 수량</th>
                      <th className="px-3 py-2">상품코드</th>
                      <th className="px-3 py-2">상품명</th>
                      <th className="px-3 py-2">옵션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fixRows.map(([r, i]) => (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="px-3 py-2">
                          <div className="text-ink">{str(r[COL.rawName]) || '(없음)'}</div>
                          <div className="text-xs text-muted">{str(r[COL.rawOption])}</div>
                          {r._auto && str(r[COL.code]) === str(r._auto) ? (
                            <Badge tone="brand" className="mt-1">
                              지난번 맞춘 대로 채움
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-ink-2">
                          {str(r[COL.receiver])} · <span className="num">{str(r[COL.qty])}</span>
                        </td>
                        <td className="px-3 py-2">
                          <TextInput aria-label="상품코드" list="orders-codes" value={str(r[COL.code])} onChange={(e) => onCode(i, e.target.value)} placeholder="예: 24300-89338" className="w-36" />
                        </td>
                        <td className="px-3 py-2">
                          <TextInput aria-label="상품명" value={str(r[COL.name])} onChange={(e) => setRow(i, { [COL.name]: e.target.value })} className="min-w-48" />
                        </td>
                        <td className="px-3 py-2">
                          <TextInput aria-label="옵션" value={str(r[COL.option])} onChange={(e) => setRow(i, { [COL.option]: e.target.value })} placeholder="단품" className="w-24" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id="orders-codes">
                  {Object.entries(known.catalog).map(([code, c]) => (
                    <option key={code} value={code}>
                      {c.name}
                    </option>
                  ))}
                </datalist>
              </div>
              <p className="text-xs text-muted">상품코드를 넣으면 지난 주문서에 있던 상품명이 자동으로 채워지고, 맞춘 상품은 기억해 다음부터 알아서 채웁니다. 물류처명이 비어 있으면 ‘{DEFAULT_WAREHOUSE}’로 넣습니다.</p>
            </div>
          )}

          <div>
            <button type="button" className="flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink" onClick={() => setShowRows((v) => !v)}>
              {showRows ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
              센터주문서 순서로 미리 보기 <span className="font-normal text-muted">(A4 {layoutCenter(rows).pageEnds.length}쪽 · 한 사람 주문은 한 쪽 안에)</span>
            </button>
            {showRows && <RowsTable rows={layoutCenter(rows).rows} />}
          </div>

          {saved ? (
            <div className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand-soft/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <PackageCheck className="size-5 text-brand-ink" aria-hidden />
                <span className="font-bold text-ink">
                  {saved.batch.date} {saved.batch.seq}차
                </span>
                <span className="text-sm text-muted">· {timeKst(saved.batch.uploadedAt)} 업로드 · 저장했습니다</span>
                <Button size="sm" variant="ghost" icon={History} className="ml-auto" onClick={onGoList}>
                  주문 조회에서 보기
                </Button>
              </div>
              <FileChips load={() => makeFiles(saved.rows, saved.sheetName, saved.batch.date, saved.batch.seq, saved.center)} date={saved.batch.date} seq={saved.batch.seq} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" icon={PackageCheck} loading={busy} disabled={Boolean(missing) && !skip} onClick={() => void save()}>
                {seq ? `${seq}차로 저장하고 파일 만들기` : '저장하고 파일 만들기'}
              </Button>
              {missing > 0 && !skip && <span className="text-sm text-warn">상품코드를 채우거나 ‘입력하지 않고 그대로 만들기’를 켜 주세요.</span>}
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

function RowsTable({ rows }: { rows: OrderRow[] }) {
  return (
    <div className="mt-2 max-h-96 overflow-auto rounded-md border border-line">
      <table className="w-full min-w-[900px] text-xs [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead className="sticky top-0 bg-surface text-left text-muted">
          <tr>
            {['NO', COL.mall, COL.orderNo, COL.receiver, COL.code, COL.name, COL.option, COL.qty].map((h) => (
              <th key={h} className="px-2 py-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              <td className="num px-2 py-1">{i + 1}</td>
              <td className="px-2 py-1">{str(r[COL.mall])}</td>
              <td className="num px-2 py-1">{str(r[COL.orderNo])}</td>
              <td className="px-2 py-1">{str(r[COL.receiver])}</td>
              <td className="num px-2 py-1">{str(r[COL.code]) || <span className="text-warn">비어 있음</span>}</td>
              <td className="px-2 py-1">{str(r[COL.name]) || str(r[COL.rawName])}</td>
              <td className="px-2 py-1">{str(r[COL.option])}</td>
              <td className="num px-2 py-1 text-right">{str(r[COL.qty])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 주문 조회: 날짜·차수 목록 → 펼치면 그 차수의 주문 ───────────
function OrdersList({ admin }: { admin: boolean }) {
  const [q, setQ] = useState('')
  const [field, setField] = useState<SearchField>('all')
  const [mall, setMall] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<{ batches: BatchBrief[]; malls: string[]; hasAmount: boolean; closed?: Record<string, DayClose> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<BatchBrief | null>(null)
  const [applied, setApplied] = useState({ q: '', field: 'all' as SearchField })
  const invoiceRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(
    async (opts?: { q: string; field: SearchField }) => {
      const cur = opts ?? applied
      setBusy(true)
      try {
        const p = new URLSearchParams({ from, to, mall, q: cur.q, field: cur.field })
        setData(await api(`/orders/batches?${p}`))
        if (opts) {
          setApplied(opts)
          setOpen(null)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '불러오지 못했습니다.')
      } finally {
        setBusy(false)
      }
    },
    [from, to, mall, applied],
  )
  useEffect(() => {
    void refresh()
  }, [from, to, mall]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const m = new Map<string, BatchBrief[]>()
    for (const b of data?.batches ?? []) m.set(b.date, [...(m.get(b.date) ?? []), b])
    return [...m]
  }, [data])

  const remove = async (b: BatchBrief) => {
    if (!confirm(`${b.date} ${b.seq}차(주문 ${b.count}줄)를 지울까요?\n지우면 조회에서도 사라지고 되돌릴 수 없습니다.`)) return
    try {
      await api(`/orders/batches/${b.id}`, { method: 'DELETE' })
      toast.success('지웠습니다.')
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '지우지 못했습니다.')
    }
  }

  // ── 일마감 ──
  const closed = data?.closed ?? {}
  /** 일마감한 날짜에서 차수 버튼으로 다시 펼친 차수 */
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())
  const toggleReveal = (id: string) =>
    setRevealed((cur) => {
      const next = new Set(cur)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const [dayBusy, setDayBusy] = useState<string | null>(null)
  const closeDay = async (date: string, list: BatchBrief[]) => {
    const seqs = [...list].sort((a, b) => a.seq - b.seq).map((b) => `${b.seq}차`).join('·')
    if (!confirm(`${date} ${seqs}를 일마감할까요?\n차수들은 하루 전체 목록 아래로 접히고, 차수 버튼을 누르면 다시 펼쳐집니다.`)) return
    setDayBusy(date)
    try {
      const r = await api<{ closed: Record<string, DayClose> }>(`/orders/days/${date}/close`, { method: 'POST' })
      setData((d) => d && { ...d, closed: r.closed })
      setOpen(null)
      toast.success(`${date} 일마감했습니다.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일마감하지 못했습니다.')
    } finally {
      setDayBusy(null)
    }
  }
  const reopenDay = async (date: string) => {
    if (!confirm(`${date} 일마감을 풀까요?\n차수들이 다시 따로 보입니다(주문 내용은 그대로).`)) return
    try {
      const r = await api<{ closed: Record<string, DayClose> }>(`/orders/days/${date}/close`, { method: 'DELETE' })
      setData((d) => d && { ...d, closed: r.closed })
      toast.success(`${date} 일마감을 풀었습니다.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일마감을 풀지 못했습니다.')
    }
  }
  const dayExcel = async (date: string) => {
    setDayBusy(`x:${date}`)
    try {
      const r = await api<{ batches: BatchFull[] }>(`/orders/days/${date}`)
      await downloadDay(date, r.batches)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일마감 엑셀을 만들지 못했습니다.')
    } finally {
      setDayBusy(null)
    }
  }

  const [view, setView] = useState<'orders' | 'cj'>('orders')
  const [cjTick, setCjTick] = useState(0)
  const importCj = async (file: File) => {
    try {
      const t = await readAnyTable(file)
      if (!t.cols.some((c) => /운송장번호|송장번호/.test(c))) throw new Error('‘운송장번호’ 칸을 찾지 못했습니다. CJ대한통운에서 받은 송장 파일인지 확인해 주세요.')
      if (!t.cols.some((c) => /고객주문번호|^주문번호$/.test(c))) throw new Error('‘고객주문번호’ 칸이 있어야 주문과 맞출 수 있습니다.')
      const r = await api<{ day: CjDay; given: number; lines: number; added: number; unmatched: string[] }>('/orders/cj', { method: 'POST', body: { fileName: file.name, rows: t.rows } })
      toast.success(
        `${r.day.date} 송장 ${fmt(r.given)}개(${fmt(r.lines)}줄)를 넣었습니다${r.added < r.lines ? `(이미 있던 ${fmt(r.lines - r.added)}줄은 새 내용으로)` : ''}. 그날 주문 ${fmt(r.day.matched)}건에 연결${r.unmatched.length ? ` · 주문서에 없는 주문 ${r.unmatched.length}건` : ''}.`,
      )
      setCjTick((n) => n + 1)
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '송장 파일을 넣지 못했습니다.')
    }
  }

  const showAmount = Boolean(data?.hasAmount)
  const colCount = 8 + (showAmount ? 1 : 0) + (admin ? 1 : 0)
  const searching = Boolean(applied.q.trim()) || Boolean(mall)

  return (
    <div className="flex flex-col gap-4">
      <Panel className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void refresh({ q, field })
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <Field label="고객·상품·주문 찾기" className="min-w-56 flex-1">
            {(id) => <TextInput id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름, 전화번호(숫자만), 주소, 상품, 주문번호, 송장번호" />}
          </Field>
          <Field label="찾을 곳" className="w-36">
            {(id) => <Select id={id} value={field} onValue={setField} options={SEARCH_FIELDS} />}
          </Field>
          <Field label="쇼핑몰" className="w-36">
            {(id) => <Select id={id} value={mall} onValue={setMall} options={[{ value: '', label: '전체' }, ...(data?.malls ?? []).map((m) => ({ value: m, label: m }))]} />}
          </Field>
          <Field label="주문서 날짜" className="w-40">
            {(id) => <TextInput id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="부터" />}
          </Field>
          <Field label="까지" className="w-40">
            {(id) => <TextInput id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" icon={Search} loading={busy}>
            찾기
          </Button>
          {searching && (
            <Button
              variant="ghost"
              onClick={() => {
                setQ('')
                setMall('')
                void refresh({ q: '', field: 'all' })
              }}
            >
              검색 지우기
            </Button>
          )}
        </form>
      </Panel>

      <Panel className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<'orders' | 'cj'>
            label="보기"
            size="sm"
            value={view}
            onValue={setView}
            options={[
              { value: 'orders', label: '주문서' },
              { value: 'cj', label: 'CJ 송장' },
            ]}
          />
          {view === 'orders' ? (
            <>
              <h3 className="text-sm font-bold text-ink">{searching ? `‘${applied.q || mall}’ 주문이 있는 주문서` : '날짜·차수별 주문서'}</h3>
              {data && <span className="text-xs text-muted">{fmt(data.batches.length)}개 차수</span>}
            </>
          ) : (
            <h3 className="text-sm font-bold text-ink">집화 날짜별 CJ 송장</h3>
          )}
          <Button size="sm" variant="secondary" icon={Truck} className="ml-auto" onClick={() => invoiceRef.current?.click()}>
            CJ 송장 파일 올리기
          </Button>
          <input
            ref={invoiceRef}
            type="file"
            accept=".xlsx"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importCj(f)
            }}
          />
        </div>
        {view === 'cj' ? (
          <CjList admin={admin} from={from} to={to} tick={cjTick} />
        ) : !data ? (
          <div className="flex items-center gap-2 py-10 text-muted">
            <Spinner /> 불러오는 중
          </div>
        ) : data.batches.length === 0 ? (
          <EmptyState icon={ClipboardList} title={searching ? '찾은 주문이 없습니다' : '저장된 주문서가 없습니다'}>
            {searching ? '검색어나 기간을 바꿔 보세요.' : '‘주문서 만들기’에서 사방넷 파일을 올리면 날짜·차수별로 쌓입니다.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[980px] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <thead className="bg-surface text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2.5">주문서 날짜(차수)</th>
                  <th className="px-3 py-2.5">수집시각</th>
                  <th className="px-3 py-2.5 text-right">주문건수</th>
                  <th className="px-3 py-2.5 text-right">주문줄수</th>
                  {showAmount && <th className="px-3 py-2.5 text-right">주문총액</th>}
                  <th className="px-3 py-2.5 text-right">송장</th>
                  <th className="px-3 py-2.5 text-right">미출고 갯수</th>
                  <th className="px-3 py-2.5">첨부파일</th>
                  {admin && <th className="px-3 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {groups.map(([date, list]) => {
                  const done = closed[date]
                  const dayKey = `day:${date}`
                  const sum = (f: (b: BatchBrief) => number) => list.reduce((s, b) => s + f(b), 0)
                  const dayLines = searching ? Object.fromEntries(list.filter((b) => b.lines).map((b) => [b.id, b.lines!])) : undefined
                  return (
                  <Fragment key={date}>
                    <tr className="border-t border-line bg-sunken">
                      <td colSpan={colCount} className="px-3 py-1.5 text-xs font-semibold text-ink-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            {date} ({weekday(date)}) · {list.length}개 차수 · 주문 {fmt(sum((b) => b.orders))}건
                            {done && <span className="font-normal text-muted"> · {done.by} {dateTimeKst(done.at)} 일마감</span>}
                          </span>
                          {!done && (
                            <button
                              type="button"
                              className="ml-auto inline-flex h-6 items-center gap-1 rounded-full border border-brand/40 bg-brand-soft px-2.5 text-2xs font-bold text-brand-ink transition-colors duration-150 hover:bg-brand hover:text-on-brand disabled:opacity-60"
                              disabled={dayBusy === date}
                              onClick={() => void closeDay(date, list)}
                              title="그날 1차·2차·3차…를 하루 전체 목록으로 묶습니다"
                            >
                              <CalendarCheck className="size-3.5" aria-hidden /> 일마감
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {done && (
                      <>
                        <tr className={clsx('cursor-pointer border-t border-line transition-colors duration-150 hover:bg-surface', open === dayKey && 'bg-surface')} onClick={() => setOpen(open === dayKey ? null : dayKey)}>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <span className="inline-flex flex-wrap items-center gap-1.5 font-semibold text-ink">
                              {open === dayKey ? <ChevronDown className="size-4 text-muted" aria-hidden /> : <ChevronRight className="size-4 text-muted" aria-hidden />}
                              <span className="num">{date}</span>
                              <Badge tone="accent">하루 전체</Badge>
                              {[...list]
                                .sort((x, y) => x.seq - y.seq)
                                .map((b) => (
                                  <button
                                    key={b.id}
                                    type="button"
                                    aria-pressed={revealed.has(b.id)}
                                    title={revealed.has(b.id) ? `${b.seq}차 접기` : `${b.seq}차 펼치기`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleReveal(b.id)
                                    }}
                                    className={clsx(
                                      'num inline-flex h-6 items-center rounded-full border px-2 text-2xs font-bold transition-colors duration-150',
                                      revealed.has(b.id) ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/50 hover:bg-brand-soft hover:text-brand-ink',
                                    )}
                                  >
                                    {b.seq}차
                                  </button>
                                ))}
                            </span>
                            {dayLines && <span className="ml-2 text-xs text-accent">맞는 주문 {sum((b) => b.lines?.length ?? 0)}줄</span>}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2.5 text-ink-2" title={`${done.by} 일마감`}>
                            {dateTimeKst(done.at)} 마감
                          </td>
                          <td className="num px-3 py-2.5 text-right font-semibold text-ink">{fmt(sum((b) => b.orders))}</td>
                          <td className="num px-3 py-2.5 text-right text-ink-2">{fmt(sum((b) => b.count))}</td>
                          {showAmount && <td className="num px-3 py-2.5 text-right text-ink-2">{list.some((b) => b.amount != null) ? `${fmt(sum((b) => b.amount ?? 0))}원` : '-'}</td>}
                          <td className="num whitespace-nowrap px-3 py-2.5 text-right">
                            {sum((b) => b.waybills) ? (
                              <span className={clsx('font-semibold', sum((b) => b.invoiceOrders) >= sum((b) => b.orders) ? 'text-brand-ink' : 'text-warn')}>
                                {fmt(sum((b) => b.invoiceOrders))}/{fmt(sum((b) => b.orders))}건
                              </span>
                            ) : (
                              <span className="text-faint">-</span>
                            )}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2.5 text-right">
                            {sum((b) => b.unshipped ?? 0) ? <span className="font-bold text-danger">{fmt(sum((b) => b.unshipped ?? 0))}건</span> : <span className="text-faint">0</span>}
                          </td>
                          <td className="px-3 py-2">
                            <Chip icon={FileSpreadsheet} label="일마감 엑셀리스트" accent busy={dayBusy === `x:${date}`} onClick={() => void dayExcel(date)} />
                          </td>
                          {admin && (
                            <td className="whitespace-nowrap px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                              <Button size="sm" variant="ghost" icon={RotateCcw} aria-label="일마감 풀기" title="일마감 풀기(차수를 다시 따로 보이게)" onClick={() => void reopenDay(date)} />
                            </td>
                          )}
                        </tr>
                        {open === dayKey && (
                          <tr className="border-t border-line">
                            <td colSpan={colCount} className="bg-paper px-3 py-3">
                              <div className="w-0 min-w-full">
                                <BatchDetail day={date} lines={dayLines} admin={admin} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                    {/* 일마감한 날은 1차가 맨 위로(1차 → 2차 → 3차…) */}
                    {(done ? [...list].sort((x, y) => x.seq - y.seq) : list).filter((b) => !done || revealed.has(b.id)).map((b) => (
                      <Fragment key={b.id}>
                        <tr className={clsx('cursor-pointer border-t border-line transition-colors duration-150 hover:bg-surface', open === b.id && 'bg-surface')} onClick={() => setOpen(open === b.id ? null : b.id)}>
                          <td className={clsx('whitespace-nowrap py-2.5 pr-3', done ? 'pl-9' : 'pl-3')}>
                            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                              {open === b.id ? <ChevronDown className="size-4 text-muted" aria-hidden /> : <ChevronRight className="size-4 text-muted" aria-hidden />}
                              <span className="num">{b.date}</span>
                              <Badge tone="brand">{b.seq}차</Badge>
                            </span>
                            {b.lines && <span className="ml-2 text-xs text-accent">맞는 주문 {b.lines.length}줄</span>}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2.5 text-ink-2" title={`${b.uploadedBy} · ${b.fileName}`}>
                            {dateTimeKst(b.uploadedAt)}
                          </td>
                          <td className="num px-3 py-2.5 text-right font-semibold text-ink">{fmt(b.orders)}</td>
                          <td className="num px-3 py-2.5 text-right text-ink-2">{fmt(b.count)}</td>
                          {showAmount && <td className="num px-3 py-2.5 text-right text-ink-2">{b.amount != null ? `${fmt(b.amount)}원` : '-'}</td>}
                          <td className="num whitespace-nowrap px-3 py-2.5 text-right" title={`송장 ${fmt(b.waybills)}개 · 송장이 붙은 주문 ${fmt(b.invoiceOrders)} / ${fmt(b.orders)}건`}>
                            {b.waybills ? (
                              <span className={clsx('font-semibold', b.invoiceOrders >= b.orders ? 'text-brand-ink' : 'text-warn')}>
                                {fmt(b.invoiceOrders)}/{fmt(b.orders)}건
                              </span>
                            ) : (
                              <span className="text-faint">-</span>
                            )}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2.5 text-right" title="송장번호가 아직 없는 주문 수(취소요청·취소완료는 빼고)">
                            {b.unshipped ? <span className="font-bold text-danger">{fmt(b.unshipped)}건</span> : <span className="text-faint">0</span>}
                          </td>
                          <td className="px-3 py-2">
                            <FileChips
                              load={async () => {
                                const { batch } = await api<{ batch: BatchBrief & { rows: OrderRow[]; center?: CenterOrder | null } }>(`/orders/batches/${b.id}`)
                                return makeFiles(batch.rows, batch.sheetName, batch.date, batch.seq, batch.center)
                              }}
                              date={b.date}
                              seq={b.seq}
                            />
                          </td>
                          {admin && (
                            <td className="whitespace-nowrap px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                              <Button size="sm" variant="ghost" icon={Pencil} aria-label="주문서 날짜·차수 고치기" title="날짜·차수 고치기" onClick={() => setEditing(b)} />
                              <Button size="sm" variant="ghost" icon={Trash2} aria-label="주문서 지우기" title="지우기" onClick={() => void remove(b)} />
                            </td>
                          )}
                        </tr>
                        {open === b.id && (
                          <tr className="border-t border-line">
                            <td colSpan={colCount} className="bg-paper px-3 py-3">
                              {/* 펼친 내용이 목록 폭을 넓히지 않게(안에서 가로로 넘김) */}
                              <div className="w-0 min-w-full">
                                  <BatchDetail id={b.id} lines={b.lines ? { [b.id]: b.lines } : undefined} admin={admin} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">
          CJ 송장 파일은 하루 중간이든 마감 때든 올리면 고객주문번호로 주문에 붙습니다(같은 날 여러 번 올려도 겹치지 않게 합칩니다). 한 주문에 송장이 여러 개면 모두 보입니다.
          {admin && ' 고치기·지우기는 스탭·전체마스터에게만 보입니다.'}
        </p>
      </Panel>
      {editing && (
        <EditBatch
          batch={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            void refresh()
          }}
        />
      )}
    </div>
  )
}

function EditBatch({ batch, onClose, onDone }: { batch: BatchBrief; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(batch.date)
  const [seq, setSeq] = useState(String(batch.seq))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api(`/orders/batches/${batch.id}`, { method: 'PATCH', body: { date, seq: Number(seq) } })
      toast.success('고쳤습니다.')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '고치지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="주문서 날짜·차수 고치기"
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            저장
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="주문서 날짜">{(id) => <TextInput id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="차수" hint="같은 날짜에 이미 있는 차수로는 바꿀 수 없습니다.">
          {(id) => <TextInput id={id} inputMode="numeric" value={seq} onChange={(e) => setSeq(e.target.value.replace(/\D/g, ''))} />}
        </Field>
      </div>
    </Dialog>
  )
}

// ── 한 차수의 주문(펼쳤을 때) · 일마감한 하루 전체 ─────────────────
const DETAIL_COLS: Array<[string, string]> = [
  [COL.buyer, '주문자'],
  [COL.receiver, '수취인'],
  [COL.phone1, '전화번호'],
  [COL.mall, '쇼핑몰'],
  [COL.orderNo, '주문번호'],
  [COL.code, '상품코드'],
  [COL.name, '상품명'],
  [COL.option, '옵션'],
  [COL.qty, '수량'],
]
/** 담당자가 적는 비고(CS내용) 칸(서버 CS_COL 과 같게) */
const CS_COL = '비고(CS내용)'
/** 정렬 열쇠: 'NO' · 칸 이름 · 'waybill' */
type SortKey = string
const NUM_SORT = new Set<string>(['NO', COL.qty])

interface CsEntry {
  text: string
  by: string
  /** 적은 사람 계정(예전 기록에는 없음 — 그때는 이름으로 본다) */
  uid?: string | null
  at: string
  editedAt?: string
  editedBy?: string
}
type BatchFull = Omit<BatchBrief, 'waybills'> & { cols: string[]; rows: OrderRow[]; waybills: Record<string, Waybill[]>; csLog: Record<string, CsEntry[]>; center?: CenterOrder | null }
/** CS 수정 시각 '26.10.16 16:33'(한국 시각) */
const csTime = (iso: string) => (iso ? dateTimeKst(iso).slice(2).replace(/-/g, '.') : '')
const CS_BY = 'CS수정자'
const CS_AT = 'CS수정시각'
const CANCEL_COL = '취소내용'
const csWho = (r: OrderRow) => (str(r[CS_BY]) ? `${str(r[CS_BY])} ${csTime(str(r[CS_AT]))}` : null)

/** 한 차수의 전체 표(엑셀·웹 보기용): 원본 칸 + 송장번호(CJ) + 취소내용 + 비고(CS내용) + CS 수정자·시각. NO·순서는 센터주문서와 같게 */
function fullTable(batch: BatchFull) {
  const extra = ['송장번호(CJ)', CANCEL_COL, CS_COL, 'CS 수정자·시각']
  const internal = new Set(['NO', COL.invoice, CANCEL_COL, CS_COL, CS_BY, CS_AT, '취소처리'])
  const cols = ['NO', ...batch.cols.filter((c) => !internal.has(c)), ...extra]
  const rows = resolveCenter(batch.rows, batch.center).order.map((n, i) => {
    const r = batch.rows[n - 1]
    return cols.map((c) => {
      if (c === 'NO') return i + 1
      if (c === '송장번호(CJ)') return (batch.waybills[str(r[COL.orderNo])] ?? []).map((w) => w.invoice).join(', ') || null
      if (c === 'CS 수정자·시각') return csWho(r)
      return r[c] ?? null
    })
  })
  return { cols, rows }
}

/** 일마감 엑셀리스트: 1차·2차·3차…를 차수 순서(차수 안에서는 센터주문서 NO 순서)로 이어 붙인 하루 전체. NO 는 하루 전체에서 1부터 */
const DAY_COLS = ['NO.', '주문번호', '수취인명', '상품코드', '상품명', '옵션', '수량', '쇼핑몰', '물류처명', '취소내용', '비고(CS내용)', 'CS 수정자·시각']
const DAY_WIDTHS = [6, 18, 11, 14, 40, 12, 6, 12, 18, 10, 30, 18]
function dayTable(list: BatchFull[]) {
  const rows: Array<Array<string | number | null>> = []
  for (const b of [...list].sort((x, y) => x.seq - y.seq))
    for (const n of resolveCenter(b.rows, b.center).order) {
      const r = b.rows[n - 1]
      const qty = r[COL.qty]
      rows.push([
        rows.length + 1,
        str(r[COL.orderNo]) || null,
        str(r[COL.receiver]) || null,
        str(r[COL.code]) || null,
        str(r[COL.name]) || null,
        str(r[COL.option]) || null,
        qty == null || qty === '' ? null : Number.isFinite(Number(qty)) ? Number(qty) : qty,
        str(r[COL.mall]) || null,
        str(r[COL.warehouse]) || null,
        str(r[CANCEL_COL]) || null,
        str(r[CS_COL]) || null,
        csWho(r),
      ])
    }
  return { cols: DAY_COLS, rows }
}
const dayFileName = (date: string) => `${date.replace(/-/g, '')}_일마감.xlsx`
async function downloadDay(date: string, list: BatchFull[]) {
  const t = dayTable(list)
  downloadBlob(await writeTable(`${date} 일마감`, t.cols, t.rows, DAY_WIDTHS), dayFileName(date))
}
const esc = (v: unknown) => str(v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

/** 표 한 줄: 어느 차수의 몇째 줄(서버 줄 번호)인지와 화면 NO */
interface Item {
  key: string
  b: BatchFull
  /** 서버에 저장된 줄 번호(1부터) — 고치기·CS·취소에 쓴다 */
  n: number
  /** 센터주문서 NO */
  no: number
  /** 일마감 하루 전체에서의 NO */
  dayNo: number
  r: OrderRow
}

/** 한 차수(id) 또는 일마감한 하루 전체(day)의 주문 */
function BatchDetail({ id, day, lines, admin }: { id?: string; day?: string; lines?: Record<string, number[]>; admin: boolean }) {
  const [batches, setBatches] = useState<BatchFull[] | null>(null)
  const [all, setAll] = useState(!lines)
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<string | null>(null)
  const [editWaybill, setEditWaybill] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null)
  const load = useCallback(() => {
    ;(day ? api<{ batches: BatchFull[] }>(`/orders/days/${day}`).then((r) => r.batches) : api<{ batch: BatchFull }>(`/orders/batches/${id}`).then((r) => [r.batch]))
      .then(setBatches)
      .catch((err) => toast.error(err instanceof Error ? err.message : '불러오지 못했습니다.'))
  }, [id, day])
  useEffect(load, [load])
  if (!batches)
    return (
      <div className="flex items-center gap-2 py-4 text-muted">
        <Spinner /> 주문 불러오는 중
      </div>
    )
  // 화면 순서·NO 는 센터주문서와 같게(하루 전체는 차수 순서로 이어서)
  let d = 0
  const items: Item[] = [...batches]
    .sort((x, y) => x.seq - y.seq)
    .flatMap((b) => resolveCenter(b.rows, b.center).order.map((n, i) => ({ key: `${b.id}:${n}`, b, n, no: i + 1, dayNo: ++d, r: b.rows[n - 1] })))
  const shownNo = (it: Item) => (day ? it.dayNo : it.no)
  const matched = (it: Item) => Boolean(lines?.[it.b.id]?.includes(it.n))
  const matchCount = items.filter(matched).length
  const value = (it: Item, key: SortKey): string | number => {
    const r = it.r
    if (key === 'NO') return shownNo(it)
    if (key === 'waybill') return (it.b.waybills[str(r[COL.orderNo])] ?? []).map((w) => w.invoice).join(',')
    if (NUM_SORT.has(key)) return Number(r[key]) || 0
    return key === COL.phone1 ? pickPhone(r[COL.phone1], r[COL.phone2]) : str(r[key])
  }
  const shown = items.filter((it) => all || matched(it))
  if (sort)
    shown.sort((a, b) => {
      const x = value(a, sort.key)
      const y = value(b, sort.key)
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko', { numeric: true })
      return c * sort.dir || a.dayNo - b.dayNo
    })
  const toggleSort = (key: SortKey) => setSort((cur) => (cur?.key !== key ? { key, dir: 1 } : cur.dir === 1 ? { key, dir: -1 } : null))
  const head = (key: SortKey, label: string, cls?: string) => (
    <th className={clsx('px-2 py-1.5', cls)} aria-sort={sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-0.5 font-semibold hover:text-ink" onClick={() => toggleSort(key)} title="눌러서 오름차순·내림차순 정렬">
        {label}
        {sort?.key === key ? sort.dir === 1 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-40" aria-hidden />}
      </button>
    </th>
  )

  const first = batches[0]
  const title = day ? `${day} 일마감 주문내역` : first ? `${first.date} ${first.seq}차 주문내역` : '주문내역'
  const table = () => (day ? dayTable(batches) : fullTable(first))
  const exportExcel = async () => {
    if (day) return downloadDay(day, batches)
    const t = table()
    downloadBlob(await writeTable(`${first.date} ${first.seq}차`, t.cols, t.rows), `${batchStamp(first.date, first.seq)}_주문내역.xlsx`)
  }
  const totalQty = batches.reduce((s, b) => s + b.qty, 0)
  const openWeb = () => {
    const t = table()
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:'Malgun Gothic',sans-serif;margin:16px;color:#222}h1{font-size:18px}table{border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:4px 6px;white-space:nowrap}th{background:#993300;color:#fff;position:sticky;top:0}tr:nth-child(even) td{background:#faf7f2}</style></head>
<body><h1>${esc(title)} <small style="font-weight:normal;color:#777">${items.length}줄 · 수량 ${fmt(totalQty)}</small></h1>
<table><thead><tr>${t.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const colSpan = DETAIL_COLS.length + 5 + (day ? 1 : 0)
  /** 한 줄 고친 결과를 화면에 바로 반영 */
  const patchRow = (bid: string, n: number, row: OrderRow, log?: CsEntry[]) =>
    setBatches((list) => list && list.map((b) => (b.id !== bid ? b : { ...b, rows: b.rows.map((x, i) => (i === n - 1 ? row : x)), csLog: log ? { ...b.csLog, [n]: log } : b.csLog })))
  const editing = edit ? items.find((it) => it.key === edit) : undefined
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {day ? (
          <span>
            {[...batches].sort((x, y) => x.seq - y.seq).map((b) => `${b.seq}차`).join('·')} 합계 <b className="num text-ink-2">{fmt(items.length)}</b>줄 · NO 는 하루 전체 번호, ‘차수·NO’ 는 그 차수 센터주문서 번호
          </span>
        ) : (
          first && (
            <>
              <span>
                원본 <b className="text-ink-2">{first.fileName}</b>
              </span>
              <span>
                {first.uploadedBy} · {dateTimeKst(first.uploadedAt)} 업로드{first.editedAt && ` · ${dateTimeKst(first.editedAt)} 고침`}
              </span>
            </>
          )
        )}
        <span className="inline-flex items-center gap-1.5">
          수량 합계 <b className="num text-ink-2">{fmt(totalQty)}</b>
          <button type="button" className="inline-flex items-center gap-0.5 rounded-sm border border-line bg-surface px-1.5 py-0.5 text-2xs font-semibold text-ink-2 hover:bg-panel hover:text-ink" onClick={() => void exportExcel()}>
            <FileSpreadsheet className="size-3" aria-hidden /> {day ? '일마감 엑셀리스트' : '엑셀로 받기'}
          </button>
          <button type="button" className="inline-flex items-center gap-0.5 rounded-sm border border-line bg-surface px-1.5 py-0.5 text-2xs font-semibold text-ink-2 hover:bg-panel hover:text-ink" onClick={openWeb}>
            <ExternalLink className="size-3" aria-hidden /> 웹에서 보기
          </button>
        </span>
        {lines && (
          <button type="button" className="ml-auto font-semibold text-brand-ink underline" onClick={() => setAll((v) => !v)}>
            {all ? `맞는 주문 ${matchCount}줄만 보기` : `${day ? '하루' : '이 주문서'} 전체 ${items.length}줄 보기`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        {/* 칸은 내용만큼(상품명·옵션이 벌어지지 않게). 남는 폭은 오른쪽에 둔다 */}
        <table className="w-max text-sm [&_td]:px-1.5 [&_td]:whitespace-nowrap [&_th]:px-1.5 [&_th]:whitespace-nowrap">
          <thead className="bg-surface text-left text-xs text-muted">
            <tr>
              {head('NO', 'NO')}
              {day && <th className="px-2 py-1.5 font-semibold">차수·NO</th>}
              {DETAIL_COLS.map(([c, l]) => (
                <Fragment key={l}>
                  {head(c, l, c === COL.qty ? 'text-right' : undefined)}
                  {c === COL.orderNo && head('waybill', '송장번호(CJ)')}
                </Fragment>
              ))}
              {head(CANCEL_COL, '취소내용')}
              {head(CS_COL, '비고(CS내용)')}
              {head(CS_AT, '수정자·시각')}
            </tr>
          </thead>
          <tbody>
            {shown.map((it) => {
              const { r, b, n, key } = it
              const orderNo = str(r[COL.orderNo])
              const wbs = b.waybills[orderNo] ?? []
              const toggle = () => setOpen(open === key ? null : key)
              return (
                <Fragment key={key}>
                  <tr className={clsx('cursor-pointer border-t border-line hover:bg-surface', open === key && 'bg-surface', all && lines && matched(it) && 'bg-mark-soft')} onClick={toggle}>
                    <td className="num px-2 py-1.5 text-muted">{shownNo(it)}</td>
                    {day && (
                      <td className="num px-2 py-1.5 text-xs text-muted">
                        {b.seq}차 {it.no}
                      </td>
                    )}
                    {DETAIL_COLS.map(([c]) => (
                      <Fragment key={c}>
                        <td
                          className={clsx(
                            'px-2 py-1.5',
                            [COL.qty, COL.orderNo, COL.code, COL.phone1].includes(c as never) && 'num',
                            // 번호 칸은 한 단계 작은 글자로(표가 한 화면에 들어가게)
                            [COL.orderNo, COL.code, COL.phone1].includes(c as never) && 'text-xs',
                            c === COL.qty && 'text-right',
                            // 상품명·옵션은 길면 줄을 바꿔 표가 화면 폭을 넘지 않게
                            c === COL.name && 'whitespace-normal! break-keep',
                            // 주문자·수취인은 길면 말줄임(마우스를 올리면 전체)
                            (c === COL.buyer || c === COL.receiver) && 'max-w-24 truncate',
                            c === COL.option && 'max-w-16 truncate',
                          )}
                        >
                          {c === COL.name ? (
                            // 상품명은 약 13글자 폭에서 줄을 바꿔 표가 화면 폭을 넘지 않게
                            <div className="w-40">{str(r[c])}</div>
                          ) : (
                            <span title={c === COL.buyer || c === COL.receiver || c === COL.option ? str(r[c]) : undefined}>{c === COL.phone1 ? pickPhone(r[COL.phone1], r[COL.phone2]) : str(r[c])}</span>
                          )}
                        </td>
                        {c === COL.orderNo && (
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <WaybillChips list={wbs} compact />
                              <button
                                type="button"
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-panel hover:text-ink"
                                aria-label={`주문번호 ${orderNo} 송장번호 수정`}
                                title={wbs.some((w) => w.manual) ? '송장번호 수정(담당자가 고친 값)' : '송장번호 수정'}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditWaybill(orderNo)
                                }}
                              >
                                <Pencil className={clsx('size-3.5', wbs.some((w) => w.manual) && 'text-accent')} aria-hidden />
                              </button>
                            </div>
                          </td>
                        )}
                      </Fragment>
                    ))}
                    <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                      <CancelButton batchId={b.id} line={n} no={shownNo(it)} value={str(r[CANCEL_COL])} onSaved={(row) => patchRow(b.id, n, row)} />
                    </td>
                    <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                      <CsMemo batchId={b.id} line={n} no={shownNo(it)} value={str(r[CS_COL])} open={open === key} onToggle={toggle} onSaved={(row, log) => patchRow(b.id, n, row, log)} />
                    </td>
                    <td className="num px-2 py-1 text-2xs leading-tight text-muted" title={csWho(r) ?? undefined}>
                      {str(r[CS_BY]) && (
                        <>
                          <div className="max-w-24 truncate font-semibold text-ink-2">{str(r[CS_BY])}</div>
                          <div>{csTime(str(r[CS_AT]))}</div>
                        </>
                      )}
                    </td>
                  </tr>
                  {open === key && (
                    <tr className="border-t border-line bg-sunken">
                      {/* 펼친 세부내역은 표 폭 안에서 줄을 바꿔 표를 넓히지 않게 */}
                      <td colSpan={colSpan} className="w-0 whitespace-normal! px-3 py-2">
                        {wbs.length > 0 && (
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold text-ink-2">주문번호 {orderNo}의 송장 {wbs.length}개</span>
                            <WaybillChips list={wbs} />
                            {wbs.some((w) => w.manual) && <span className="text-accent">담당자가 고침</span>}
                          </div>
                        )}
                        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                          {Object.entries(r)
                            .filter(([k]) => !['NO', CS_BY, CS_AT, '취소처리'].includes(k))
                            .map(([k, v]) => (
                              <div key={k} className="flex gap-2">
                                <dt className="w-28 shrink-0 text-muted">{k}</dt>
                                <dd className="min-w-0 break-all text-ink">{str(v) || '-'}</dd>
                              </div>
                            ))}
                        </dl>
                        <Button size="sm" variant="secondary" icon={Pencil} className="mt-2" onClick={() => setEdit(key)}>
                          세부내역 조회 및 CS내용
                        </Button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {editing && (
        <EditRow
          batchId={editing.b.id}
          line={editing.n}
          no={shownNo(editing)}
          row={editing.r}
          cols={editing.b.cols}
          log={editing.b.csLog[editing.n] ?? []}
          admin={admin}
          onCs={(row, log) => patchRow(editing.b.id, editing.n, row, log)}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null)
            load()
          }}
        />
      )}
      {editWaybill != null && (
        <EditWaybills
          orderNo={editWaybill}
          current={batches.find((b) => b.waybills[editWaybill])?.waybills[editWaybill] ?? []}
          onClose={() => setEditWaybill(null)}
          onDone={(list) => {
            const k = editWaybill
            setEditWaybill(null)
            setBatches((bs) => bs && bs.map((b) => (b.rows.some((r) => str(r[COL.orderNo]) === k) ? { ...b, waybills: { ...b.waybills, [k]: list } } : b)))
          }}
        />
      )}
    </div>
  )
}

/** 비고(CS내용): 칸을 벗어나거나 Enter 를 누르면 저장(누가·언제 적었는지 기록). ▶ 를 누르면 그 주문의 세부내역이 펼쳐진다 */
function CsMemo({ batchId, line, no, value, open, onToggle, onSaved }: { batchId: string; line: number; no: number; value: string; open: boolean; onToggle: () => void; onSaved: (row: OrderRow, log: CsEntry[]) => void }) {
  const [text, setText] = useState(value)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  useEffect(() => setText(value), [value])
  const save = async () => {
    const memo = text.trim()
    if (memo === value) return
    setState('saving')
    try {
      const r = await api<{ row: OrderRow; log: CsEntry[] }>(`/orders/batches/${batchId}/rows/${line}/memo`, { method: 'PATCH', body: { memo } })
      onSaved(r.row, r.log)
      setState('saved')
      setTimeout(() => setState('idle'), 1500)
    } catch (err) {
      setState('idle')
      toast.error(err instanceof Error ? err.message : '비고를 저장하지 못했습니다.')
    }
  }
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? '세부내역 닫기' : '세부내역 열기'}
        title={open ? '세부내역 닫기' : '세부내역 열기'}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted transition-colors duration-150 hover:bg-panel hover:text-ink"
      >
        {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
      </button>
      <input
        aria-label={`NO ${no} 비고(CS내용)`}
        value={text}
        maxLength={500}
        placeholder="CS 내용 입력"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setText(value)
        }}
        title={state === 'saving' ? '저장 중' : state === 'saved' ? '저장했습니다' : undefined}
        className={clsx(
          'h-7 w-[20em] rounded-sm border bg-panel px-1.5 text-xs text-ink transition-colors duration-200 placeholder:text-faint focus:border-brand focus:outline-none',
          state === 'saved' ? 'border-success bg-success-soft' : state === 'saving' ? 'border-warn' : 'border-line',
        )}
      />
    </div>
  )
}

/** 취소내용: 누를 때마다 빈칸 → [취소요청](분홍) → [취소완료](초록) → 빈칸 */
const CANCEL_NEXT: Record<string, string> = { '': '취소요청', 취소요청: '취소완료', 취소완료: '' }
function CancelButton({ batchId, line, no, value, onSaved }: { batchId: string; line: number; no: number; value: string; onSaved: (row: OrderRow) => void }) {
  const [busy, setBusy] = useState(false)
  const click = async () => {
    setBusy(true)
    try {
      const r = await api<{ row: OrderRow }>(`/orders/batches/${batchId}/rows/${line}/cancel`, { method: 'PATCH', body: { status: CANCEL_NEXT[value] ?? '' } })
      onSaved(r.row)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '취소내용을 바꾸지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void click()}
      disabled={busy}
      aria-label={`NO ${no} 취소내용: ${value || '없음'} (누르면 ${CANCEL_NEXT[value] || '빈칸'})`}
      title={value ? `누르면 ${CANCEL_NEXT[value] || '빈칸'}으로` : '누르면 취소요청'}
      className={clsx(
        'inline-flex h-7 min-w-18 items-center justify-center rounded-sm border px-2 text-xs font-bold transition-colors duration-150 disabled:opacity-60',
        value === '취소요청' && 'border-pink/40 bg-pink-soft text-pink hover:border-pink/70',
        value === '취소완료' && 'border-brand/50 bg-brand-soft text-brand-ink hover:bg-brand hover:text-on-brand',
        !value && 'border-transparent bg-transparent hover:border-line',
      )}
    >
      {value ? `[${value}]` : ''}
    </button>
  )
}

/** 송장번호 고치기: 한 줄에 하나씩. 저장하면 이 주문번호의 송장은 이 목록이 된다 */
function EditWaybills({ orderNo, current, onClose, onDone }: { orderNo: string; current: Waybill[]; onClose: () => void; onDone: (list: Waybill[]) => void }) {
  const [text, setText] = useState(current.map((w) => w.invoice).join('\n'))
  const [busy, setBusy] = useState(false)
  const manual = current.some((w) => w.manual)
  const send = async (body: { orderNo: string; invoices?: string[]; reset?: boolean }) => {
    setBusy(true)
    try {
      const r = await api<{ waybills: Waybill[] }>('/orders/waybills', { method: 'PUT', body })
      toast.success(body.reset ? 'CJ 파일 값으로 되돌렸습니다.' : '송장번호를 고쳤습니다.')
      onDone(r.waybills)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '송장번호를 고치지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  const invoices = text
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean)
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`송장번호 수정 · 주문번호 ${orderNo}`}
      footer={
        <>
          {manual && (
            <Button variant="ghost" className="mr-auto" loading={busy} onClick={() => void send({ orderNo, reset: true })}>
              CJ 파일 값으로 되돌리기
            </Button>
          )}
          <Button onClick={onClose}>닫기</Button>
          <Button variant="primary" loading={busy} onClick={() => void send({ orderNo, invoices })}>
            저장
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        <Field label="송장번호(한 줄에 하나씩)" hint="빠진 송장은 줄을 더해 넣고, 잘못된 번호는 고치거나 지우세요. 이 주문번호의 모든 줄에 같이 적용됩니다.">
          {(id) => <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} className="num min-h-32! font-mono" placeholder="6009-0769-6075" />}
        </Field>
        <p className="text-xs text-muted">송장 {invoices.length}개로 저장됩니다.{manual && ' 지금 값은 담당자가 고친 것입니다.'}</p>
      </div>
    </Dialog>
  )
}

function EditRow({
  batchId,
  line,
  no,
  row,
  cols,
  log,
  admin,
  onCs,
  onClose,
  onDone,
}: {
  batchId: string
  line: number
  /** 화면 NO(센터주문서 NO) */
  no: number
  row: OrderRow
  cols: string[]
  log: CsEntry[]
  admin: boolean
  onCs: (row: OrderRow, log: CsEntry[]) => void
  onClose: () => void
  onDone: () => void
}) {
  const hidden = new Set(['NO', CS_COL, CS_BY, CS_AT, CANCEL_COL, '취소처리'])
  const keys = [...new Set([...cols, ...Object.keys(row)])].filter((k) => !hidden.has(k))
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, str(row[k])])))
  const [busy, setBusy] = useState(false)
  // CS 내용: 지난 기록 + 새로 적는 줄들
  const [entries, setEntries] = useState<CsEntry[]>(log)
  const [drafts, setDrafts] = useState<string[]>([''])
  const [csBusy, setCsBusy] = useState(false)
  const me = useContext(MeContext)
  /** 고치는 중인 기록(번호)과 고친 글 */
  const [fixing, setFixing] = useState<{ i: number; text: string } | null>(null)
  const [fixBusy, setFixBusy] = useState(false)
  const changeCs = async (i: number, text: string | null) => {
    const e = entries[i]
    if (text === null && !confirm(`이 CS 내용을 지울까요?\n“${e.text}”`)) return
    setFixBusy(true)
    try {
      const url = `/orders/batches/${batchId}/rows/${line}/cs/${i}`
      const r = await api<{ row: OrderRow; log: CsEntry[] }>(url, text === null ? { method: 'DELETE', body: { at: e.at } } : { method: 'PATCH', body: { at: e.at, text } })
      setEntries(r.log)
      onCs(r.row, r.log)
      setFixing(null)
      toast.success(text === null ? 'CS 내용을 지웠습니다.' : 'CS 내용을 고쳤습니다.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'CS 내용을 바꾸지 못했습니다.')
    } finally {
      setFixBusy(false)
    }
  }
  const saveCs = async () => {
    const texts = drafts.map((d) => d.trim()).filter(Boolean)
    if (!texts.length) return
    setCsBusy(true)
    try {
      let last: { row: OrderRow; log: CsEntry[] } | null = null
      for (const memo of texts) last = await api<{ row: OrderRow; log: CsEntry[] }>(`/orders/batches/${batchId}/rows/${line}/memo`, { method: 'PATCH', body: { memo } })
      if (last) {
        setEntries(last.log)
        onCs(last.row, last.log)
      }
      setDrafts([''])
      toast.success('CS 내용을 저장했습니다.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'CS 내용을 저장하지 못했습니다.')
    } finally {
      setCsBusy(false)
    }
  }
  const save = async () => {
    setBusy(true)
    try {
      const out: OrderRow = {}
      for (const k of keys) {
        const v = vals[k].trim()
        out[k] = !v ? null : (k === COL.qty || k === COL.sabangNo) && Number.isFinite(Number(v)) ? Number(v) : v
      }
      await api(`/orders/batches/${batchId}/rows/${line}`, { method: 'PATCH', body: { row: out } })
      toast.success('고쳤습니다.')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '고치지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`세부내역 조회 및 CS내용 (NO ${no})`}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          {admin && (
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              주문 내용 저장
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* CS 내용(한 줄 구조, 적은 사람·시각 기록) */}
        <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <h3 className="text-sm font-bold text-ink">CS 내용</h3>
          {entries.length ? (
            <ol className="flex flex-col gap-1.5">
              {entries.map((e, i) => (
                <li key={`${i}:${e.at}`} className="flex items-start gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5">
                  {fixing?.i === i ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Textarea
                        aria-label="CS 내용 고치기"
                        value={fixing.text}
                        maxLength={500}
                        autoFocus
                        onChange={(ev) => setFixing({ i, text: ev.target.value })}
                        className="min-h-16!"
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" icon={X} onClick={() => setFixing(null)}>
                          취소
                        </Button>
                        <Button size="sm" variant="primary" icon={Save} loading={fixBusy} disabled={!fixing.text.trim() || fixing.text.trim() === e.text} onClick={() => void changeCs(i, fixing.text.trim())}>
                          고친 내용 저장
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="whitespace-pre-wrap break-all text-sm text-ink">{e.text || <span className="text-faint">(내용 지움)</span>}</div>
                      <div className="num mt-0.5 text-2xs text-muted">
                        {e.by} · {csTime(e.at)}
                        {e.editedAt && ` · ${e.editedBy && e.editedBy !== e.by ? `${e.editedBy} ` : ''}${csTime(e.editedAt)} 고침`}
                      </div>
                    </div>
                  )}
                  {/* 고치기·지우기: 적은 사람 본인과 전체마스터에게만 보인다 */}
                  {canEditCs(me, e) && fixing?.i !== i && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label="CS 내용 고치기" title="고치기" disabled={fixBusy} onClick={() => setFixing({ i, text: e.text })} />
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label="CS 내용 지우기" title="지우기" disabled={fixBusy} onClick={() => void changeCs(i, null)} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted">아직 적은 CS 내용이 없습니다.</p>
          )}
          {drafts.map((d, i) => (
            <Textarea
              key={i}
              aria-label={`새 CS 내용 ${i + 1}`}
              value={d}
              maxLength={500}
              onChange={(e) => setDrafts((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder="바뀐 CS 내용을 적으세요(저장하면 적은 사람·시각이 남습니다)"
              className="min-h-16!"
            />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDrafts((list) => [...list, ''])}>
              CS 추가
            </Button>
            <Button size="sm" variant="primary" loading={csBusy} disabled={!drafts.some((d) => d.trim())} onClick={() => void saveCs()} className="ml-auto">
              CS 내용 저장
            </Button>
          </div>
        </section>

        {/* 주문 세부내역(스탭 이상만 고칠 수 있음) */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-ink">주문 세부내역{!admin && <span className="ml-1 text-xs font-normal text-muted">(고치기는 스탭 이상만)</span>}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {keys.map((k) => (
              <Field key={k} label={k}>
                {(id) => <TextInput id={id} value={vals[k]} readOnly={!admin} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} />}
              </Field>
            ))}
          </div>
        </section>
      </div>
    </Dialog>
  )
}

// ── CJ 송장: 집화 날짜별 목록 → 펼치면 그날 운송장 ──────────────
function CjList({ admin, from, to, tick }: { admin: boolean; from: string; to: string; tick: number }) {
  const [days, setDays] = useState<CjDay[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      setDays((await api<{ days: CjDay[] }>(`/orders/cj?${new URLSearchParams({ from, to })}`)).days)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '송장 목록을 불러오지 못했습니다.')
    }
  }, [from, to])
  useEffect(() => {
    void load()
  }, [load, tick])
  const remove = async (d: CjDay) => {
    if (!confirm(`${d.date} CJ 송장 ${d.waybills}개를 지울까요? 주문 조회에서 이 날 송장번호가 사라집니다.`)) return
    try {
      await api(`/orders/cj/${d.date}`, { method: 'DELETE' })
      toast.success('지웠습니다.')
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '지우지 못했습니다.')
    }
  }
  if (!days)
    return (
      <div className="flex items-center gap-2 py-10 text-muted">
        <Spinner /> 불러오는 중
      </div>
    )
  if (!days.length)
    return (
      <EmptyState icon={Truck} title="올린 CJ 송장 파일이 없습니다">
        ‘CJ 송장 파일 올리기’로 CJ대한통운에서 받은 송장 엑셀을 올리면 집화 날짜별로 쌓이고, 주문 조회에 송장번호가 붙습니다.
      </EmptyState>
    )
  const cols = 6 + (admin ? 1 : 0)
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[860px] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead className="bg-surface text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-2.5">집화 날짜</th>
            <th className="px-3 py-2.5">마지막 업로드</th>
            <th className="px-3 py-2.5 text-right">송장</th>
            <th className="px-3 py-2.5 text-right">주문</th>
            <th className="px-3 py-2.5 text-right">주문서와 연결</th>
            <th className="px-3 py-2.5 text-right">운임 합계</th>
            {admin && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <Fragment key={d.date}>
              <tr className={clsx('cursor-pointer border-t border-line transition-colors duration-150 hover:bg-surface', open === d.date && 'bg-surface')} onClick={() => setOpen(open === d.date ? null : d.date)}>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                    {open === d.date ? <ChevronDown className="size-4 text-muted" aria-hidden /> : <ChevronRight className="size-4 text-muted" aria-hidden />}
                    <span className="num">{d.date}</span>
                    <span className="text-xs font-normal text-muted">({weekday(d.date)})</span>
                  </span>
                </td>
                <td className="num whitespace-nowrap px-3 py-2.5 text-ink-2" title={d.fileNames.join(', ')}>
                  {d.lastUploadAt ? dateTimeKst(d.lastUploadAt) : '-'}
                  {d.uploads > 1 && <span className="ml-1 text-xs text-muted">({d.uploads}번 올림)</span>}
                </td>
                <td className="num px-3 py-2.5 text-right" title={`상품 ${fmt(d.lines)}줄`}>
                  <span className="font-semibold text-ink">{fmt(d.waybills)}개</span> <span className="text-xs text-muted">({fmt(d.lines)}줄)</span>
                </td>
                <td className="num px-3 py-2.5 text-right text-ink-2">{fmt(d.orders)}</td>
                <td className={clsx('num px-3 py-2.5 text-right font-semibold', d.matched >= d.orders ? 'text-brand-ink' : 'text-warn')}>
                  {fmt(d.matched)}/{fmt(d.orders)}건
                </td>
                <td className="num px-3 py-2.5 text-right text-ink-2">{fmt(d.fare)}원</td>
                {admin && (
                  <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label="이 날 송장 지우기" title="지우기" onClick={() => void remove(d)} />
                  </td>
                )}
              </tr>
              {open === d.date && (
                <tr className="border-t border-line">
                  <td colSpan={cols} className="bg-paper px-3 py-3">
                    <div className="w-0 min-w-full">
                      <CjDayDetail date={d.date} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CjDayDetail({ date }: { date: string }) {
  const [list, setList] = useState<CjWaybill[] | null>(null)
  useEffect(() => {
    api<{ waybills: CjWaybill[] }>(`/orders/cj/${date}`)
      .then((r) => setList(r.waybills))
      .catch((err) => toast.error(err instanceof Error ? err.message : '불러오지 못했습니다.'))
  }, [date])
  if (!list)
    return (
      <div className="flex items-center gap-2 py-4 text-muted">
        <Spinner /> 송장 불러오는 중
      </div>
    )
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <table className="w-full min-w-[1000px] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead className="bg-surface text-left text-xs text-muted">
          <tr>
            {['운송장번호', '고객주문번호', '쇼핑몰', '받는분', '상품명', '단품', '내품수량', '상태', '주문서'].map((h) => (
              <th key={h} className="px-2 py-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((w) => (
            <tr key={`${w.invoice}|${w.name}|${w.option}`} className="border-t border-line">
              <td className="px-2 py-1.5">
                <WaybillChips list={[w]} />
              </td>
              <td className="num px-2 py-1.5">{w.orderNo}</td>
              <td className="px-2 py-1.5 text-ink-2">{w.mall || w.home?.mall}</td>
              <td className="px-2 py-1.5">{w.receiver}</td>
              <td className="px-2 py-1.5">{w.name}</td>
              <td className="px-2 py-1.5 text-ink-2">{w.option}</td>
              <td className="num px-2 py-1.5 text-right">{w.qty ? fmt(w.qty) : ''}</td>
              <td className="px-2 py-1.5 text-ink-2">{w.status}</td>
              <td className="whitespace-nowrap px-2 py-1.5">
                {w.home ? (
                  <span className="num text-ink-2">
                    {w.home.date} <Badge tone="brand">{w.home.seq}차</Badge>
                  </span>
                ) : (
                  <span className="text-xs text-warn">주문서 없음</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
