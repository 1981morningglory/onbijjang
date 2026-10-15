/**
 * 주문서 만들기(온비팀 전용)
 * 사방넷 주문서 → 창고 전달 · CJ대한통운 업로드 · 구글 드라이브 업로드 파일. 올린 주문서는 날짜·차수별로 서버에 쌓아 조회한다.
 */
import clsx from 'clsx'
import { ChevronDown, ChevronRight, ClipboardList, Download, FileSpreadsheet, FileUp, History, LogIn, PackageCheck, Search, Trash2, TriangleAlert, WifiOff } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useLoginDialog } from '@/app/LoginDialog'
import { api, ApiError } from '@/lib/api'
import { downloadBlob, downloadZip } from '@/lib/files'
import { Badge, Button, Callout, Dropzone, EmptyState, Field, Panel, Select, Spinner, Tabs, TextInput, toast } from '@/ui'
import { readAnyTable, readSabangnet, writeOutput, writeTable } from './excel'
import {
  COL,
  dateFromName,
  DEFAULT_WAREHOUSE,
  findInvoiceCol,
  findKeyCols,
  isJeju,
  needsProduct,
  OUTPUTS,
  outputFileName,
  productKey,
  SEARCH_FIELDS,
  sortRows,
  todayKst,
  type OrderRow,
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
  count: number
  qty: number
  invoices: number
}
interface Mapping {
  code: string
  name: string
  option: string
  warehouse?: string
}
type Tab = 'make' | 'search' | 'list'

const str = (v: unknown) => (v == null ? '' : String(v).trim())
const fmt = (n: number) => n.toLocaleString('ko-KR')

export default function OrdersTool() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [offline, setOffline] = useState(false)
  const load = useCallback(async () => {
    try {
      setAllowed((await api<{ allowed: boolean }>('/orders/status')).allowed)
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
  if (allowed == null)
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted">
        <Spinner /> 불러오는 중
      </div>
    )
  if (!allowed) return <Gate onIn={load} />
  return (
    <div className="flex flex-col gap-4">
      <Tabs<Tab>
        label="주문서"
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'make', label: '주문서 만들기', icon: FileSpreadsheet },
          { value: 'search', label: '주문 조회', icon: Search },
          { value: 'list', label: '주문서 목록·송장', icon: History },
        ]}
      />
      {tab === 'make' && <Make onSaved={() => undefined} />}
      {tab === 'search' && <SearchView />}
      {tab === 'list' && <ListView />}
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

/** 결과 파일 3개 만들기 */
async function makeFiles(rows: OrderRow[], sheetName: string, date: string, seq: number) {
  return Promise.all(OUTPUTS.map(async (spec) => ({ spec, name: outputFileName(spec, date, seq), blob: await writeOutput(spec, rows, sheetName) })))
}
type Made = Awaited<ReturnType<typeof makeFiles>>

function FilesBox({ files, date, seq }: { files: Made; date: string; seq: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {files.map((f) => (
        <Button key={f.spec.kind} icon={Download} onClick={() => downloadBlob(f.blob, f.name)}>
          {f.spec.label}
        </Button>
      ))}
      <Button variant="ghost" icon={Download} onClick={() => void downloadZip(files.map((f) => ({ name: f.name, data: f.blob })), `${date.replace(/-/g, '')}_${seq}차_주문서`)}>
        3개 한 번에(ZIP)
      </Button>
    </div>
  )
}

// ── 주문서 만들기 ─────────────────────────────────────────
function Make({ onSaved }: { onSaved: () => void }) {
  const [src, setSrc] = useState<(SourceSheet & { fileName: string }) | null>(null)
  const [rows, setRows] = useState<OrderRow[]>([])
  const [date, setDate] = useState(todayKst())
  const [seq, setSeq] = useState<number | null>(null)
  const [known, setKnown] = useState<{ products: Record<string, Mapping>; catalog: Record<string, { name: string; option: string }> }>({ products: {}, catalog: {} })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<{ date: string; seq: number; files: Made } | null>(null)
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
    try {
      const [s, k] = await Promise.all([readSabangnet(file), api<typeof known>('/orders/products').catch(() => known)])
      setKnown(k)
      // 전에 맞춰 둔 상품은 자동으로 채운다
      const filled = s.rows.map((r) => {
        if (!needsProduct(r)) return { ...r, [COL.warehouse]: r[COL.warehouse] ?? DEFAULT_WAREHOUSE }
        const m = k.products[productKey(r)]
        return m ? { ...r, [COL.code]: m.code, [COL.name]: m.name, [COL.option]: m.option || '단품', [COL.warehouse]: r[COL.warehouse] ?? m.warehouse ?? DEFAULT_WAREHOUSE, _auto: 1 } : { ...r, _fix: 1 }
      })
      setSrc({ ...s, fileName: file.name })
      setRows(filled)
      setDate(dateFromName(s.sheetName, file.name) ?? todayKst())
      toast.success(`주문 ${s.rows.length}줄을 읽었습니다.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일을 읽지 못했습니다.')
    }
  }

  const fixRows = rows.map((r, i) => [r, i] as const).filter(([r]) => r._fix || r._auto)
  const missing = rows.filter((r) => needsProduct(r)).length
  const stats = useMemo(() => {
    const malls = new Map<string, number>()
    for (const r of rows) malls.set(str(r[COL.mall]) || '(없음)', (malls.get(str(r[COL.mall]) || '(없음)') ?? 0) + 1)
    return {
      orders: new Set(rows.map((r) => str(r[COL.orderNo]))).size,
      qty: rows.reduce((s, r) => s + (Number(r[COL.qty]) || 0), 0),
      jeju: rows.filter(isJeju).length,
      malls: [...malls].sort((a, b) => b[1] - a[1]),
    }
  }, [rows])

  const setRow = (i: number, patch: OrderRow) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const onCode = (i: number, code: string) => {
    const c = known.catalog[code.trim()]
    setRow(i, { [COL.code]: code, ...(c ? { [COL.name]: c.name, [COL.option]: c.option || '단품' } : {}) })
  }

  const save = async () => {
    if (!src || missing) return
    setBusy(true)
    try {
      const clean = rows.map(({ _fix, _auto, ...r }) => r) // eslint-disable-line @typescript-eslint/no-unused-vars
      const mappings = rows
        .filter((r) => r._fix && str(r[COL.code]))
        .map((r) => ({ key: productKey(r), code: str(r[COL.code]), name: str(r[COL.name]), option: str(r[COL.option]), warehouse: str(r[COL.warehouse]) }))
      const { batch } = await api<{ batch: BatchBrief }>('/orders/batches', {
        method: 'POST',
        body: { date, fileName: src.fileName, sheetName: src.sheetName, cols: src.cols, rows: clean, mappings },
      })
      const files = await makeFiles(clean, src.sheetName, batch.date, batch.seq)
      setSaved({ date: batch.date, seq: batch.seq, files })
      toast.success(`${batch.date} ${batch.seq}차로 저장했습니다. 파일 3개를 받으세요.`)
      onSaved()
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
        title={src ? `${src.fileName} · 주문 ${rows.length}줄` : '사방넷 파일 업로드 — 사방넷에서 내려받은 주문서(발주서) 엑셀을 끌어다 놓으세요'}
        hint="창고 전달 · CJ대한통운 업로드 · 구글 드라이브 업로드 파일 3개를 만들고, 주문 내역은 날짜·차수별로 저장해 나중에 조회할 수 있습니다."
        onFiles={(f) => f[0] && void loadFile(f[0])}
      />

      {src && (
        <Panel className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="주문서 날짜" className="w-44">
              {(id) => <TextInput id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <div className="pb-2 text-sm text-ink-2">
              저장하면 <b className="text-ink">{seq ? `${date} ${seq}차` : '…'}</b>가 됩니다 <span className="text-muted">(같은 날짜는 올린 순서대로 1차, 2차…)</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
            <span>
              주문 <b className="num text-ink">{fmt(stats.orders)}</b>건 · <b className="num text-ink">{fmt(rows.length)}</b>줄
            </span>
            <span>
              수량 합계 <b className="num text-ink">{fmt(stats.qty)}</b>
            </span>
            {stats.jeju > 0 && (
              <span>
                제주 <b className="num text-ink">{stats.jeju}</b>줄(창고·드라이브 파일에 ‘제주도출고O’)
              </span>
            )}
            <span className="text-muted">{stats.malls.map(([m, n]) => `${m} ${n}`).join(' · ')}</span>
          </div>

          {fixRows.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className={clsx('flex items-center gap-1.5 text-sm font-bold', missing ? 'text-warn' : 'text-ink')}>
                <TriangleAlert className="size-4" aria-hidden />
                사방넷이 상품을 못 맞춘 줄 {fixRows.length}개{missing ? ` — 상품코드를 넣어 주세요(남은 ${missing}줄)` : ' — 모두 채웠습니다'}
              </p>
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-surface text-left text-xs text-muted">
                    <tr>
                      <th className="px-2 py-1.5">쇼핑몰 상품명 · 옵션</th>
                      <th className="px-2 py-1.5">수취인 · 수량</th>
                      <th className="px-2 py-1.5">상품코드</th>
                      <th className="px-2 py-1.5">상품명</th>
                      <th className="px-2 py-1.5">옵션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fixRows.map(([r, i]) => (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="px-2 py-1.5">
                          <div className="text-ink">{str(r[COL.rawName]) || '(없음)'}</div>
                          <div className="text-xs text-muted">{str(r[COL.rawOption])}</div>
                          {r._auto ? <Badge tone="brand">지난번 맞춘 대로 채움</Badge> : null}
                        </td>
                        <td className="px-2 py-1.5 text-ink-2">
                          {str(r[COL.receiver])} · <span className="num">{str(r[COL.qty])}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <TextInput aria-label="상품코드" list="orders-codes" value={str(r[COL.code])} onChange={(e) => onCode(i, e.target.value)} placeholder="예: 24300-89338" className="w-36" />
                        </td>
                        <td className="px-2 py-1.5">
                          <TextInput aria-label="상품명" value={str(r[COL.name])} onChange={(e) => setRow(i, { [COL.name]: e.target.value })} className="min-w-48" />
                        </td>
                        <td className="px-2 py-1.5">
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
              <p className="text-xs text-muted">한 번 맞춘 상품은 기억해 두었다가 다음 주문서부터 자동으로 채웁니다. 물류처명이 비어 있으면 ‘{DEFAULT_WAREHOUSE}’로 넣습니다.</p>
            </div>
          )}

          <div>
            <button type="button" className="flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink" onClick={() => setShowRows((v) => !v)}>
              {showRows ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
              정렬된 주문 보기(쇼핑몰 → 주문번호 → 상품코드)
            </button>
            {showRows && <RowsTable rows={sortRows(rows)} />}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={PackageCheck} loading={busy} disabled={Boolean(missing) || Boolean(saved)} onClick={() => void save()}>
              {seq ? `${seq}차로 저장하고 파일 3개 만들기` : '저장하고 파일 3개 만들기'}
            </Button>
            {missing > 0 && <span className="text-sm text-warn">상품코드가 빈 줄을 먼저 채워 주세요.</span>}
          </div>
          {saved && (
            <Callout tone="info" title={`${saved.date} ${saved.seq}차로 저장했습니다`}>
              <FilesBox files={saved.files} date={saved.date} seq={saved.seq} />
            </Callout>
          )}
        </Panel>
      )}
    </div>
  )
}

function RowsTable({ rows }: { rows: OrderRow[] }) {
  return (
    <div className="mt-2 max-h-96 overflow-auto rounded-md border border-line">
      <table className="w-full min-w-[900px] text-xs">
        <thead className="sticky top-0 bg-surface text-left text-muted">
          <tr>
            {['NO', COL.mall, COL.orderNo, COL.receiver, COL.code, COL.name, COL.option, COL.qty, COL.message].map((h) => (
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
              <td className="px-2 py-1">{str(r[COL.name])}</td>
              <td className="px-2 py-1">{str(r[COL.option])}</td>
              <td className="num px-2 py-1 text-right">{str(r[COL.qty])}</td>
              <td className="px-2 py-1 text-ink-2">{str(r[COL.message])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 주문 조회 ─────────────────────────────────────────────
interface Hit {
  batchId: string
  date: string
  seq: number
  line: number
  row: OrderRow
}
const RESULT_COLS: Array<[string, string]> = [
  [COL.buyer, '주문자'],
  [COL.receiver, '수취인'],
  [COL.phone1, '전화번호'],
  [COL.mall, '쇼핑몰'],
  [COL.orderNo, '주문번호'],
  [COL.code, '상품코드'],
  [COL.name, '상품명'],
  [COL.option, '옵션'],
  [COL.qty, '수량'],
  [COL.invoice, '송장번호'],
]

function SearchView() {
  const [q, setQ] = useState('')
  const [field, setField] = useState<SearchField>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [mall, setMall] = useState('')
  const [res, setRes] = useState<{ total: number; hits: Hit[]; malls: string[]; limited: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const run = async (e?: FormEvent) => {
    e?.preventDefault()
    setBusy(true)
    try {
      const p = new URLSearchParams({ q, field, from, to, mall })
      setRes(await api(`/orders/search?${p}`))
      setOpen(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '찾지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    if (!res) return null
    const hits = res.hits
    return {
      orders: new Set(hits.map((h) => `${str(h.row[COL.mall])}|${str(h.row[COL.orderNo])}`)).size,
      qty: hits.reduce((s, h) => s + (Number(h.row[COL.qty]) || 0), 0),
      people: new Set(hits.map((h) => str(h.row[COL.receiver]))).size,
    }
  }, [res])

  const exportExcel = async () => {
    if (!res?.hits.length) return
    const cols = [...new Set(['주문서 날짜', '차수', ...res.hits.flatMap((h) => Object.keys(h.row))])].filter((c) => c !== 'NO')
    const rows = res.hits.map((h) => cols.map((c) => (c === '주문서 날짜' ? h.date : c === '차수' ? `${h.seq}차` : (h.row[c] ?? null))))
    downloadBlob(await writeTable('주문 조회', cols, rows), `주문조회_${q || '전체'}_${todayKst().replace(/-/g, '')}.xlsx`)
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel className="p-4">
        <form onSubmit={(e) => void run(e)} className="flex flex-wrap items-end gap-3">
          <Field label="검색어" className="min-w-56 flex-1" hint="이름·전화번호(숫자만 맞아도 됨)·주소·상품코드·상품명·주문번호·송장번호. 여러 낱말은 모두 들어간 주문만.">
            {(id) => <TextInput id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 홍길동, 01012345678, 독도 샤프" autoFocus />}
          </Field>
          <Field label="찾을 곳" className="w-40">
            {(id) => <Select id={id} value={field} onValue={setField} options={SEARCH_FIELDS} />}
          </Field>
          <Field label="쇼핑몰" className="w-40">
            {(id) => <Select id={id} value={mall} onValue={setMall} options={[{ value: '', label: '전체' }, ...(res?.malls ?? []).map((m) => ({ value: m, label: m }))]} />}
          </Field>
          <Field label="주문서 날짜(부터)" className="w-40">
            {(id) => <TextInput id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
          </Field>
          <Field label="(까지)" className="w-40">
            {(id) => <TextInput id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" icon={Search} loading={busy}>
            찾기
          </Button>
        </form>
      </Panel>

      {res && (
        <Panel className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-2">
            <span>
              <b className="num text-ink">{fmt(res.total)}</b>줄{res.limited && ` (앞 ${fmt(res.hits.length)}줄만 표시)`}
            </span>
            {summary && (
              <>
                <span>
                  주문 <b className="num text-ink">{fmt(summary.orders)}</b>건
                </span>
                <span>
                  수취인 <b className="num text-ink">{fmt(summary.people)}</b>명
                </span>
                <span>
                  수량 합계 <b className="num text-ink">{fmt(summary.qty)}</b>
                </span>
              </>
            )}
            <Button size="sm" variant="ghost" icon={Download} className="ml-auto" disabled={!res.hits.length} onClick={() => void exportExcel()}>
              엑셀로 받기
            </Button>
          </div>
          {res.hits.length === 0 ? (
            <EmptyState icon={ClipboardList} title="찾은 주문이 없습니다">
              {q ? '검색어나 기간을 바꿔 보세요.' : '‘주문서 만들기’에서 사방넷 주문서를 저장하면 여기서 찾을 수 있습니다.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-surface text-left text-xs text-muted">
                  <tr>
                    <th className="px-2 py-1.5">주문서</th>
                    {RESULT_COLS.map(([, l]) => (
                      <th key={l} className="px-2 py-1.5">
                        {l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {res.hits.map((h) => {
                    const k = `${h.batchId}:${h.line}`
                    return (
                      <Fragment key={k}>
                        <tr className={clsx('cursor-pointer border-t border-line hover:bg-surface', open === k && 'bg-surface')} onClick={() => setOpen(open === k ? null : k)}>
                          <td className="num whitespace-nowrap px-2 py-1.5 text-ink-2">
                            {h.date} {h.seq}차
                          </td>
                          {RESULT_COLS.map(([c]) => (
                            <td key={c} className={clsx('px-2 py-1.5', (c === COL.qty || c === COL.orderNo || c === COL.code || c === COL.invoice || c === COL.phone1) && 'num', c === COL.qty && 'text-right')}>
                              {str(h.row[c])}
                            </td>
                          ))}
                        </tr>
                        {open === k && (
                          <tr className="border-t border-line bg-sunken">
                            <td colSpan={RESULT_COLS.length + 1} className="px-3 py-2">
                              <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                                {Object.entries(h.row)
                                  .filter(([key]) => key !== 'NO')
                                  .map(([key, v]) => (
                                    <div key={key} className="flex gap-2">
                                      <dt className="w-28 shrink-0 text-muted">{key}</dt>
                                      <dd className="min-w-0 break-all text-ink">{str(v) || '-'}</dd>
                                    </div>
                                  ))}
                              </dl>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

// ── 주문서 목록 · 송장번호 ────────────────────────────────
function ListView() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [list, setList] = useState<BatchBrief[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [made, setMade] = useState<{ id: string; files: Made } | null>(null)

  const refresh = useCallback(async () => {
    const p = new URLSearchParams({ from, to })
    try {
      setList((await api<{ batches: BatchBrief[] }>(`/orders/batches?${p}`)).batches)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.')
    }
  }, [from, to])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const remake = async (b: BatchBrief) => {
    setBusyId(b.id)
    try {
      const { batch } = await api<{ batch: BatchBrief & { rows: OrderRow[] } }>(`/orders/batches/${b.id}`)
      setMade({ id: b.id, files: await makeFiles(batch.rows, batch.sheetName, batch.date, batch.seq) })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일을 만들지 못했습니다.')
    } finally {
      setBusyId(null)
    }
  }
  const remove = async (b: BatchBrief) => {
    if (!confirm(`${b.date} ${b.seq}차(주문 ${b.count}줄)를 지울까요? 지우면 조회에서도 사라지고 되돌릴 수 없습니다.\n(차수 번호는 다시 매기지 않습니다)`)) return
    try {
      await api(`/orders/batches/${b.id}`, { method: 'DELETE' })
      toast.success('지웠습니다.')
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '지우지 못했습니다.')
    }
  }

  const importInvoices = async (file: File) => {
    try {
      const t = await readAnyTable(file)
      const inv = findInvoiceCol(t.cols)
      const keys = findKeyCols(t.cols)
      if (!inv) throw new Error('‘송장번호’(또는 ‘운송장번호’) 칸을 찾지 못했습니다.')
      if (!keys.sabangNo && !keys.orderNo) throw new Error('‘사방넷주문번호’ 또는 ‘주문번호’ 칸이 있어야 주문과 맞출 수 있습니다.')
      const items = t.rows.map((r) => ({ invoice: r[inv], sabangNo: keys.sabangNo ? r[keys.sabangNo] : undefined, orderNo: keys.orderNo ? r[keys.orderNo] : undefined })).filter((x) => x.invoice)
      const r = await api<{ matched: number; given: number }>('/orders/invoices', { method: 'POST', body: { items } })
      toast.success(`송장번호 ${fmt(r.given)}개 중 주문 ${fmt(r.matched)}줄에 넣었습니다.`)
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '송장번호를 넣지 못했습니다.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Dropzone
        compact
        accept=".xlsx"
        multiple={false}
        icon={FileUp}
        title="송장번호 넣기 — 송장번호가 들어 있는 엑셀(택배사 결과·사방넷 송장 파일)을 끌어다 놓으세요"
        hint="‘송장번호’(또는 ‘운송장번호’) 칸과 ‘사방넷주문번호’ 또는 ‘주문번호’ 칸이 있으면 저장된 주문에 맞춰 넣습니다. 그 뒤 주문 조회에서 송장번호로도 찾을 수 있습니다."
        onFiles={(f) => f[0] && void importInvoices(f[0])}
      />
      <Panel className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="주문서 날짜(부터)" className="w-40">
            {(id) => <TextInput id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
          </Field>
          <Field label="(까지)" className="w-40">
            {(id) => <TextInput id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
          </Field>
        </div>
        {!list ? (
          <div className="flex items-center gap-2 py-8 text-muted">
            <Spinner /> 불러오는 중
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={History} title="저장된 주문서가 없습니다">
            ‘주문서 만들기’에서 사방넷 주문서를 올리면 날짜·차수별로 쌓입니다.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-surface text-left text-xs text-muted">
                <tr>
                  <th className="px-2 py-1.5">주문서</th>
                  <th className="px-2 py-1.5 text-right">줄</th>
                  <th className="px-2 py-1.5 text-right">수량</th>
                  <th className="px-2 py-1.5 text-right">송장</th>
                  <th className="px-2 py-1.5">원본 파일</th>
                  <th className="px-2 py-1.5">올린 사람 · 때</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <Fragment key={b.id}>
                    <tr className="border-t border-line">
                      <td className="num whitespace-nowrap px-2 py-1.5 font-semibold text-ink">
                        {b.date} {b.seq}차
                      </td>
                      <td className="num px-2 py-1.5 text-right">{fmt(b.count)}</td>
                      <td className="num px-2 py-1.5 text-right">{fmt(b.qty)}</td>
                      <td className="num px-2 py-1.5 text-right">{b.invoices ? fmt(b.invoices) : '-'}</td>
                      <td className="max-w-56 truncate px-2 py-1.5 text-ink-2">{b.fileName}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted">
                        {b.uploadedBy} · {new Date(b.uploadedAt).toLocaleString('ko-KR')}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        <Button size="sm" icon={Download} loading={busyId === b.id} onClick={() => void remake(b)}>
                          파일 3개 다시 만들기
                        </Button>
                        <Button size="sm" variant="ghost" icon={Trash2} aria-label="지우기" onClick={() => void remove(b)} />
                      </td>
                    </tr>
                    {made?.id === b.id && (
                      <tr className="border-t border-line bg-sunken">
                        <td colSpan={7} className="px-3 py-2">
                          <FilesBox files={made.files} date={b.date} seq={b.seq} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
