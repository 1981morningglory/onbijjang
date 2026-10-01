import clsx from 'clsx'
import { Download, FileSpreadsheet, ListPlus, Table2, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { downloadBlob, formatBytes, todayStamp } from '@/lib/files'
import { fmt, usePersistentState, won } from '@/lib/hooks'
import { Button, Callout, Checkbox, EmptyState, Field, Panel, Section, Segmented, Select, Textarea, toast } from '@/ui'
import {
  BULK_FIELDS, BULK_FIELD_LABEL, BULK_MAX_ROWS, buildRows, calcBulk, guessMapping, parseTable, toCsv, toExportTable,
  type BulkField, type BulkMapping,
} from '../shared/bulk'
import { MARKETS, MARKET_LABEL, type AllSettings } from '../shared/settings'
import { pct } from '../shared/ui'

const MAX_FILE = 5 * 1024 * 1024
const PREVIEW_ROWS = 200
const EXAMPLE = ['상품명\t판매가\t원가\t배송비\t카테고리', '스테인리스 텀블러 500ml\t19,800\t8,500\t3,000\t주방용품', '27인치 모니터\t189,000\t150,000\t0\t모니터', '여성 니트 가디건\t32,000\t14,000\t3,000\t여성의류'].join('\n')
const NO_MAPPING: BulkMapping = { name: -1, price: -1, cost: -1, shipping: -1, category: -1 }

const colName = (i: number) => {
  let s = ''
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s
  return s
}
const signed = (n: number) => (n < 0 ? `-${won(-n)}` : won(n))

export function Bulk({ all, onOpenSettings }: { all: AllSettings; onOpenSettings: () => void }) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null)
  const [mapping, setMapping] = useState<BulkMapping>(NO_MAPPING)
  const [hasHeader, setHasHeader] = useState(true)
  const [shipMode, setShipMode] = usePersistentState<'paid' | 'free'>('onbijjang:fee-compare:bulk-ship', 'paid')
  const [busy, setBusy] = useState<'file' | 'xlsx' | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const rows = useMemo(() => file?.rows ?? parseTable(text), [file, text])
  const width = useMemo(() => Math.max(0, ...rows.slice(0, 50).map((r) => r.length)), [rows])
  const tooMany = rows.length - (hasHeader ? 1 : 0) > BULK_MAX_ROWS
  const built = useMemo(() => buildRows(rows, mapping, hasHeader, shipMode).slice(0, BULK_MAX_ROWS), [rows, mapping, hasHeader, shipMode])
  const results = useMemo(() => calcBulk(built, all), [built, all])
  const errors = results.filter((r) => r.row.error).length
  const ok = results.length - errors
  const missingMarkets = useMemo(() => {
    const first = results.find((r) => r.markets.length)
    return first ? first.markets.filter((m) => m.result.missing.length).map((m) => m.label) : []
  }, [results])

  const apply = (next: string[][]) => {
    const g = guessMapping(next)
    setMapping(g.mapping)
    setHasHeader(g.hasHeader)
  }
  const loadText = (value: string) => {
    setFile(null)
    setText(value)
    apply(parseTable(value))
  }
  const clear = () => {
    setFile(null)
    setText('')
    setMapping(NO_MAPPING)
  }

  const openFile = async (f: File) => {
    if (f.size > MAX_FILE) return toast.error(`파일이 너무 큽니다(${formatBytes(f.size)}). 5MB 이하 파일만 열 수 있습니다.`)
    setBusy('file')
    try {
      if (/\.(csv|tsv|txt)$/i.test(f.name)) {
        loadText(await f.text())
        return
      }
      const XLSX = await import('xlsx')
      const book = XLSX.read(await f.arrayBuffer(), { type: 'array' })
      const sheet = book.Sheets[book.SheetNames[0]]
      if (!sheet) throw new Error('empty')
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
      const next = aoa.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some((c) => c !== ''))
      if (!next.length) throw new Error('empty')
      setText('')
      setFile({ name: f.name, rows: next })
      apply(next)
    } catch {
      toast.error('파일을 읽지 못했습니다. 엑셀(.xlsx) 또는 CSV 파일인지 확인하거나, 엑셀에서 표를 복사해 붙여넣어 주세요.')
    } finally {
      setBusy(null)
    }
  }

  const saveXlsx = async () => {
    setBusy('xlsx')
    try {
      const XLSX = await import('xlsx')
      const sheet = XLSX.utils.aoa_to_sheet(toExportTable(results))
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, '마켓별 이익')
      const data = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
      downloadBlob(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `마켓별이익_${todayStamp()}.xlsx`)
    } catch {
      toast.error('엑셀 파일을 만들지 못했습니다. CSV 로 저장해 보세요.')
    } finally {
      setBusy(null)
    }
  }
  const saveCsv = () => downloadBlob(new Blob([toCsv(toExportTable(results))], { type: 'text/csv;charset=utf-8' }), `마켓별이익_${todayStamp()}.csv`)

  const columnOptions = (field: BulkField) => [
    ...(field === 'price' || field === 'cost' ? [] : [{ value: '-1', label: '쓰지 않음' }]),
    ...Array.from({ length: width }, (_, i) => {
      const sample = rows[0]?.[i] ?? ''
      return { value: String(i), label: `${colName(i)}열${sample ? ` · ${sample.slice(0, 14)}` : ''}` }
    }),
  ]

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <Section
          title="표 넣기"
          hint="엑셀에서 상품명·판매가·원가·배송비(·카테고리) 열을 골라 복사한 뒤 아래 칸에 붙여넣으세요. 파일은 이 브라우저 안에서만 읽습니다."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={input}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.txt"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void openFile(f)
                }}
              />
              <Button size="sm" icon={ListPlus} onClick={() => loadText(EXAMPLE)}>
                예시 표 넣기
              </Button>
              <Button size="sm" icon={Upload} loading={busy === 'file'} onClick={() => input.current?.click()}>
                엑셀 파일 열기
              </Button>
              <Button size="sm" variant="ghost" icon={Trash2} disabled={!rows.length} onClick={clear}>
                지우기
              </Button>
            </div>
          }
        >
          {file ? (
            <div className="flex items-center gap-2.5 rounded-md border border-line bg-sunken px-3 py-2.5 text-sm">
              <FileSpreadsheet className="size-4 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{file.name}</span>
              <span className="num shrink-0 text-muted">{fmt.format(file.rows.length)}행 · 첫 번째 시트</span>
            </div>
          ) : (
            <Textarea
              value={text}
              onChange={(e) => loadText(e.target.value)}
              placeholder={'상품명\t판매가\t원가\t배송비\t카테고리\n텀블러\t19,800\t8,500\t3,000\t주방용품'}
              aria-label="엑셀에서 복사한 표"
              spellCheck={false}
              className="num min-h-36 whitespace-pre font-mono text-sm"
            />
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Segmented
              label="배송 방식"
              size="sm"
              value={shipMode}
              onValue={setShipMode}
              options={[
                { value: 'paid', label: '유료배송' },
                { value: 'free', label: '무료배송' },
              ]}
            />
            <p className="min-w-0 flex-1 text-sm text-muted">
              {shipMode === 'paid' ? '배송비 열의 금액을 고객이 내고, 같은 금액을 택배비로 씁니다.' : '배송비 열의 금액을 내가 내는 택배비로만 씁니다.'}
            </p>
          </div>
        </Section>

        {rows.length > 0 && (
          <Section title="열 맞추기" action={<Checkbox checked={hasHeader} onChange={setHasHeader} label="첫 행은 머리글" />}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {BULK_FIELDS.map((field) => (
                <Field key={field} label={BULK_FIELD_LABEL[field] + (field === 'category' || field === 'name' || field === 'shipping' ? ' (선택)' : '')}>
                  {(id) => <Select id={id} value={String(mapping[field])} onValue={(v) => setMapping({ ...mapping, [field]: Number(v) })} options={columnOptions(field)} />}
                </Field>
              ))}
            </div>
            <p className="text-sm text-muted">카테고리 열이 있으면 행마다 쿠팡·로켓그로스·G마켓·옥션 표에서 가장 가까운 분류의 요율을 씁니다. 없거나 못 찾으면 ‘한 상품 비교’의 세부 설정을 씁니다.</p>
          </Section>
        )}
      </Panel>

      {rows.length === 0 ? (
        <Panel>
          <EmptyState icon={Table2} title="표를 넣으면 상품별·마켓별 이익표가 만들어집니다">
            엑셀에서 복사한 칸을 위에 붙여넣거나 엑셀 파일을 여세요. 처음이라면 ‘예시 표 넣기’로 모양을 확인할 수 있습니다.
          </EmptyState>
        </Panel>
      ) : (
        <Panel>
          <Section
            title={`상품별·마켓별 이익 — ${fmt.format(ok)}개 상품`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" icon={Download} loading={busy === 'xlsx'} disabled={!ok} onClick={saveXlsx}>
                  엑셀로 저장
                </Button>
                <Button size="sm" icon={Download} disabled={!ok} onClick={saveCsv}>
                  CSV 로 저장
                </Button>
              </div>
            }
          >
            {tooMany && <Callout tone="warn">한 번에 {fmt.format(BULK_MAX_ROWS)}개 상품까지만 계산합니다. 나머지 행은 나눠서 넣어 주세요.</Callout>}
            {errors > 0 && (
              <Callout tone="warn" title={`${fmt.format(errors)}개 행은 계산하지 못했습니다`}>
                판매가·원가·배송비가 숫자가 아닌 행입니다. 표에서 빨간 글씨로 표시했습니다. ‘열 맞추기’가 맞는지도 확인하세요.
              </Callout>
            )}
            {missingMarkets.length > 0 && (
              <Callout tone="info" title="요율을 넣지 않은 마켓이 있습니다">
                {missingMarkets.join(', ')} — 이 마켓 칸은 비워 두었습니다.{' '}
                <button type="button" onClick={onOpenSettings} className="rounded-xs font-semibold text-brand-ink underline hover:text-brand">
                  ‘한 상품 비교’에서 요율 입력하기
                </button>
              </Callout>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <caption className="sr-only">상품별 마켓 이익</caption>
                <thead>
                  <tr className="border-b border-line-strong text-2xs font-bold text-muted">
                    <th scope="col" className="py-2 pr-3 text-left">상품명</th>
                    <th scope="col" className="py-2 pr-3 text-right">판매가</th>
                    <th scope="col" className="py-2 pr-3 text-right">원가</th>
                    <th scope="col" className="py-2 pr-3 text-right">배송비</th>
                    {MARKETS.map((m) => (
                      <th key={m} scope="col" className="py-2 pr-3 text-right">
                        {MARKET_LABEL[m]}
                      </th>
                    ))}
                    <th scope="col" className="py-2 text-left">가장 남는 곳</th>
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, PREVIEW_ROWS).map((r) => (
                    <tr key={r.row.line} className="border-b border-line last:border-b-0">
                      <th scope="row" className="max-w-56 py-1.5 pr-3 text-left font-semibold text-ink">
                        <span className="block truncate" title={r.row.product.name}>
                          {r.row.product.name}
                        </span>
                        {r.row.category && <span className="block truncate text-2xs font-normal text-muted">{r.row.category}</span>}
                      </th>
                      {r.row.error ? (
                        <td colSpan={MARKETS.length + 4} className="py-1.5 text-danger">
                          {r.row.line}번째 줄: {r.row.error}
                        </td>
                      ) : (
                        <>
                          <td className="num py-1.5 pr-3 text-right text-ink-2">{fmt.format(r.row.product.price)}</td>
                          <td className="num py-1.5 pr-3 text-right text-ink-2">{fmt.format(r.row.product.cost)}</td>
                          <td className="num py-1.5 pr-3 text-right text-ink-2">{fmt.format(r.row.product.shippingCost)}</td>
                          {r.markets.map((m) => (
                            <td key={m.market} className={clsx('num whitespace-nowrap py-1.5 pr-3 text-right align-top', m.market === r.best && 'bg-brand-soft')}>
                              {m.result.missing.length ? (
                                <span className="text-muted">-</span>
                              ) : (
                                <>
                                  <span className={clsx('block', m.result.profit < 0 ? 'text-danger' : 'text-ink', m.market === r.best && 'font-bold')}>{signed(m.result.profit)}</span>
                                  <span className={clsx('block text-2xs', m.result.profit < 0 ? 'text-danger' : 'text-muted')}>{pct(m.result.marginPct)}</span>
                                </>
                              )}
                            </td>
                          ))}
                          <td className="py-1.5 font-semibold text-brand-ink">{r.best ? MARKET_LABEL[r.best] : <span className="font-normal text-muted">-</span>}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {results.length > PREVIEW_ROWS && (
              <p className="text-sm text-muted">
                화면에는 {fmt.format(PREVIEW_ROWS)}행까지만 보여 줍니다. 저장하면 {fmt.format(results.length)}행이 모두 들어갑니다.
              </p>
            )}
          </Section>
        </Panel>
      )}
    </div>
  )
}
