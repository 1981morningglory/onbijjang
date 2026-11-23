// 로켓발주입고관리(온비팀전용) — 쿠팡 서플라이어 허브 발주서 CSV 를 열어 요약하고, 정해진 양식의 엑셀(SKU합계 + 상품목록)로 받는다.
// 파일은 브라우저 안에서만 읽는다(서버로 보내지 않음). 마지막으로 연 파일은 이 브라우저에 기억해 두었다가 다시 열 때 복원한다.
import clsx from 'clsx'
import { ClipboardCopy, FileSpreadsheet, FileUp, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { downloadBlob } from '@/lib/files'
import { Button, Callout, Dropzone, EmptyState, IconButton, Segmented, Select, Spinner, TextInput, toast } from '@/ui'
import { buildExcel } from './excel'
import { big, decode, ea, filterRows, pct, readPo, skuGroups, summarize, tsv, won, type PoRow, type SkuSort } from './logic'

const LAST_KEY = 'rocket.po_last'
const LIME = '#c8e89a'
const CORAL = '#ff6f59'

interface Loaded {
  name: string
  rows: PoRow[]
  at: number
  restored: boolean
}

function remember(name: string, text: string) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ name, text, at: Date.now() }))
  } catch {
    // 저장 공간이 모자라거나 막혀 있어도 화면은 그대로 쓴다
  }
}
function restore(): Loaded | null {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null') as { name: string; text: string; at: number } | null
    if (!last?.text) return null
    const r = readPo(last.text)
    return r.error ? null : { name: last.name, rows: r.rows, at: last.at, restored: true }
  } catch {
    return null
  }
}

async function copy(text: string, msg: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(msg)
  } catch {
    toast.error('복사가 막혔어요. 브라우저에서 클립보드 권한을 허용해 주세요.')
  }
}

export default function RocketTool() {
  const [data, setData] = useState<Loaded | null>(() => restore())
  const [due, setDue] = useState('')
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SkuSort>('camt')
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState<string | null>(null)

  const open = async (f: File) => {
    const text = decode(await f.arrayBuffer())
    const r = readPo(text)
    if (r.error) return toast.error(r.error)
    setData({ name: f.name, rows: r.rows, at: Date.now(), restored: false })
    setDue('')
    setType('')
    setVerified(null)
    remember(f.name, text)
    toast.success(`${f.name} 파일을 불러왔어요.`)
  }
  const forget = () => {
    try {
      localStorage.removeItem(LAST_KEY)
    } catch {
      // 무시
    }
    setData(null)
    toast.info('이 브라우저에 기억해 둔 발주서를 지웠어요.')
  }

  const rows = useMemo(() => data?.rows ?? [], [data])
  const view = useMemo(() => filterRows(rows, due, type), [rows, due, type])
  const sum = useMemo(() => (view.length ? summarize(view) : null), [view])
  const skus = useMemo(() => skuGroups(view, q, sort), [view, q, sort])
  const dueOpts = useMemo(() => [...new Set(rows.map((r) => r.due))].sort(), [rows])
  const typeOpts = useMemo(() => [...new Set(rows.map((r) => r.type))].sort(), [rows])
  useEffect(() => setVerified(null), [due, type, q])

  const download = async () => {
    if (!skus.length) return
    setBusy(true)
    try {
      const x = await buildExcel(view, skus, q.trim() !== '')
      downloadBlob(new Blob([x.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), x.filename)
      setVerified(`${x.verified} · 상품목록 ${ea(x.listRows)}줄 · ${x.pages}페이지`)
      toast.success(`엑셀 파일을 저장했어요. ${x.verified}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '엑셀을 만들지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const copyReport = () => {
    if (!sum) return
    const { T, C, S } = sum
    const lines = [
      `[쿠팡 발주 요약] 입고예정일 ${sum.dues.join(', ')} (금액 VAT 별도)`,
      `- 발주서 ${T.pos.size}건 / SKU ${T.skus.size}개 / 물류센터 ${T.ctrs.size}곳`,
      `- 발주 ${ea(T.q)}개 · ${won(T.amt)}원`,
      `- 확정 ${ea(T.c)}개 · ${won(T.camt)}원 (확정률 ${pct(T.camt, T.amt)})`,
      `- 미확정 ${S.length}개 품목 · ${ea(T.q - T.c)}개 · ${won(T.samt)}원`,
      '',
      '[센터 TOP 5]',
      ...C.slice(0, 5).map((c, i) => `${i + 1}. ${c.k} ${won(c.amt)}원 (확정률 ${pct(c.camt, c.amt)})`),
    ]
    if (S.length) lines.push('', '[미확정 금액 TOP 5]', ...S.slice(0, 5).map((x, i) => `${i + 1}. ${x.name} - ${ea(x.short)}개 · ${won(x.samt)}원`))
    void copy(lines.join('\n'), '보고용 요약을 복사했어요. 메신저나 메일에 붙여 넣으세요.')
  }

  return (
    <div className="flex flex-col gap-5">
      <Dropzone
        compact={Boolean(data)}
        accept=".csv,text/csv"
        multiple={false}
        icon={FileUp}
        title={data ? '다른 발주서 CSV 열기' : '쿠팡 발주서 CSV 열기'}
        hint={data ? undefined : '서플라이어 허브에서 받은 발주서(PO_SKU_LIST…csv)를 끌어다 놓거나 눌러서 고르세요. 파일은 이 브라우저 안에서만 읽고 어디에도 보내지 않아요.'}
        onFiles={(f) => f[0] && void open(f[0])}
      />

      {!data ? (
        <EmptyState icon={FileSpreadsheet} title="아직 연 발주서가 없어요" className="py-12">
          발주서 CSV를 열면 센터별 확정 현황, 미확정 품목, SKU별 합계를 바로 정리하고, 정해진 양식의 엑셀(SKU합계 + 상품목록)로 내려받을 수 있어요.
        </EmptyState>
      ) : (
        <>
          {/* 결론 밴드 */}
          <section className="flex flex-col gap-4 rounded-xl bg-mat p-5 text-on-mat shadow-1 sm:p-6">
            <div className="flex flex-wrap items-center gap-2 text-sm text-on-mat/75">
              <span className="min-w-0 truncate">
                {data.name}
                {sum && ` · 입고예정일 ${sum.dues.length > 1 ? `${sum.dues[0]} ~ ${sum.dues.at(-1)}` : sum.dues[0]} · 발주일 ${sum.days[0]} ~ ${sum.days.at(-1)}`}
                {data.restored && ' · 마지막으로 연 파일'}
              </span>
              <IconButton icon={Trash2} label="기억해 둔 발주서 지우기" size="sm" className="ml-auto text-on-mat/70 hover:text-on-mat" onClick={forget} />
            </div>
            <h2 className="text-xl leading-snug font-bold text-white sm:text-[26px]">
              {sum ? `발주 ${big(sum.T.amt)} 중 ${pct(sum.T.camt, sum.T.amt)} 확정, 미확정 ${new Set(sum.shortRows.map((r) => r.sku)).size}개 품목 ${big(sum.T.samt)}` : '조건에 맞는 발주가 없어요.'}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Select value={due} onValue={setDue} aria-label="입고예정일" options={[{ value: '', label: '입고예정일 전체' }, ...dueOpts.map((d) => ({ value: d, label: d }))]} className="w-48!" />
              <Select value={type} onValue={setType} aria-label="발주유형" options={[{ value: '', label: '발주유형 전체' }, ...typeOpts.map((d) => ({ value: d, label: d }))]} className="w-44!" />
            </div>
            {sum && (
              <>
                <div className="grid grid-cols-2 gap-x-4 border-t border-white/20 md:grid-cols-4">
                  {[
                    [`${sum.T.pos.size}건`, '발주서'],
                    [`${sum.T.skus.size}개`, 'SKU'],
                    [`${sum.T.ctrs.size}곳`, '물류센터'],
                    [ea(sum.T.q), '발주수량'],
                    [ea(sum.T.c), `확정수량 · ${pct(sum.T.c, sum.T.q)}`],
                    [big(sum.T.amt), '발주금액 (VAT 별도)'],
                    [big(sum.T.camt), '확정금액 (VAT 별도)'],
                    [big(sum.T.samt), `미확정금액 (VAT 별도) · ${sum.shortRows.length}행`, true],
                    ...(sum.T.inq ? [[ea(sum.T.inq), `입고수량 · ${pct(sum.T.inq, sum.T.c)}`]] : []),
                  ].map(([b, s, bad]) => (
                    <div key={String(s)} className="pt-3.5 pr-3 pb-1">
                      <b className="num block text-xl whitespace-nowrap sm:text-2xl" style={{ color: bad ? CORAL : '#fff' }}>
                        {b}
                      </b>
                      <span className="text-xs text-on-mat/70">{s}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-1.5">
                  {sum.C.map((c, i) => (
                    <div key={c.k} className="grid grid-cols-[5em_minmax(0,1fr)] items-center gap-x-2.5 text-sm sm:grid-cols-[7.5em_minmax(0,1fr)_10em]">
                      <span className="truncate">{c.k}</span>
                      <div className="animate-grow-x flex h-[18px] overflow-hidden rounded-[4px] bg-white/10" style={{ width: `${Math.max((c.amt / sum.C[0].amt) * 100, 1.5)}%`, animationDelay: `${Math.min(i, 20) * 30}ms` }}>
                        <i className="block h-full" style={{ width: `${(c.camt / c.amt) * 100}%`, background: LIME }} />
                        <i className="block h-full" style={{ width: `${(c.samt / c.amt) * 100}%`, background: CORAL }} />
                      </div>
                      <span className="num col-start-2 text-xs text-on-mat/75 sm:col-start-auto sm:text-right sm:text-sm sm:text-on-mat">
                        {big(c.amt)} · {pct(c.camt, c.amt)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-on-mat/75">
                  <span className="inline-flex items-center gap-1.5">
                    <i className="size-3 rounded-[2px]" style={{ background: LIME }} />
                    확정 금액
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="size-3 rounded-[2px]" style={{ background: CORAL }} />
                    미확정 금액
                  </span>
                  <span>오른쪽 숫자: 발주 금액(VAT 별도) · 확정률</span>
                </div>
              </>
            )}
          </section>

          {sum && (
            <>
              {/* 미확정 */}
              <Section
                title={sum.S.length ? `미확정 품목 ${sum.S.length}개 · ${big(sum.T.samt)}` : '미확정 품목 없음'}
                note="발주수량보다 확정수량이 적은 품목이에요. 미확정 금액이 큰 순서로 정렬했어요."
                actions={
                  <>
                    <Button size="sm" variant="primary" icon={ClipboardCopy} onClick={copyReport}>
                      보고용 요약 복사
                    </Button>
                    <Button
                      size="sm"
                      icon={ClipboardCopy}
                      disabled={!sum.shortRows.length}
                      onClick={() =>
                        void copy(
                          tsv([['발주번호', '발주유형', '물류센터', 'SKU ID', '상품명', '바코드', '발주수량', '확정수량', '미확정수량', '공급가', '미확정금액(VAT별도)'], ...sum.shortRows.map((r) => [r.po, r.type, r.ctr, r.sku, r.name, r.bc, r.q, r.c, r.q - r.c, r.p, r.amt - r.camt])]),
                          `미확정 ${sum.shortRows.length}행을 복사했어요. 엑셀에 붙여 넣으세요.`,
                        )
                      }
                    >
                      미확정 표 복사(엑셀용)
                    </Button>
                  </>
                }
              >
                {sum.S.length ? (
                  <Table head={['SKU ID', '상품명', ['미확정수량', 'r'], ['미확정금액', 'r'], '물류센터']}>
                    {sum.S.map((s) => (
                      <tr key={s.k} className="border-t border-line align-top">
                        <td className="num px-2 py-2">{s.k}</td>
                        <td className="px-2 py-2">{s.name}</td>
                        <td className="num px-2 py-2 text-right font-bold text-danger">{ea(s.short)}</td>
                        <td className="num px-2 py-2 text-right font-bold text-danger">{won(s.samt)}</td>
                        <td className="px-2 py-2 text-xs text-ink-2">{[...s.ctrs].join(', ')}</td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <p className="py-4 text-sm text-muted">모든 발주가 수량대로 확정됐어요.</p>
                )}
              </Section>

              {/* SKU별 합계 */}
              <Section
                title="SKU별 합계"
                note="같은 SKU를 여러 센터·발주서에 걸쳐 합산했어요. 엑셀에는 지금 필터(입고예정일·발주유형)와 검색어가 그대로 적용돼요."
                actions={
                  <>
                    <Button variant="primary" icon={FileSpreadsheet} loading={busy} disabled={!skus.length} onClick={() => void download()}>
                      엑셀 다운로드
                    </Button>
                    <Button
                      icon={ClipboardCopy}
                      disabled={!skus.length}
                      onClick={() => void copy(tsv([['SKU ID', '상품명', '바코드', '센터수', '발주수량', '확정수량', '미확정수량', '발주금액(VAT별도)', '확정금액(VAT별도)'], ...skus.map((g) => [g.k, g.name, g.bc, g.ctrs.size, g.q, g.c, g.short, g.amt, g.camt])]), `SKU ${skus.length}개를 복사했어요. 엑셀에 붙여 넣으세요.`)}
                    >
                      표 복사(엑셀용)
                    </Button>
                  </>
                }
              >
                {verified && (
                  <Callout tone="success" title="엑셀 저장 전 자체 검증 통과">
                    {verified}
                  </Callout>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="relative min-w-0 flex-1 basis-60">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
                    <TextInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="상품명, SKU ID, 바코드 검색" aria-label="SKU 검색" className="pl-9!" />
                  </label>
                  <Segmented
                    label="정렬"
                    value={sort}
                    onValue={setSort}
                    options={[
                      { value: 'camt', label: '확정금액순' },
                      { value: 'q', label: '수량순' },
                      { value: 'short', label: '미확정순' },
                    ]}
                  />
                </div>
                {skus.length ? (
                  <Table head={[['#', 'r'], 'SKU ID', '상품명', ['센터', 'r'], ['발주수량', 'r'], ['확정수량', 'r'], ['확정금액', 'r']]}>
                    {skus.slice(0, 50).map((g, i) => (
                      <tr key={g.k} className="border-t border-line align-top">
                        <td className="num px-2 py-2 text-right text-muted">{i + 1}</td>
                        <td className="num px-2 py-2">{g.k}</td>
                        <td className="px-2 py-2">{g.name}</td>
                        <td className="num px-2 py-2 text-right">{g.ctrs.size}</td>
                        <td className="num px-2 py-2 text-right">{ea(g.q)}</td>
                        <td className={clsx('num px-2 py-2 text-right', g.short && 'font-bold text-danger')}>{ea(g.c)}</td>
                        <td className="num px-2 py-2 text-right">{won(g.camt)}</td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <p className="py-4 text-sm text-muted">검색 결과가 없어요.</p>
                )}
                {skus.length > 50 && <p className="text-xs text-muted">{skus.length}개 중 상위 50개를 보여줘요. 표 복사나 엑셀에는 전체가 들어가요.</p>}
              </Section>

              <div className="grid gap-5 lg:grid-cols-2">
                <SmallTable title="발주유형별" label="발주유형" view={view} by="type" />
                <SmallTable title="발주일별" label="발주일" view={view} by="day" />
              </div>

              {/* 센터별 상세 */}
              <Section
                title="물류센터별 상세"
                actions={
                  <Button
                    size="sm"
                    icon={ClipboardCopy}
                    onClick={() => void copy(tsv([['물류센터', '발주서', 'SKU', '발주수량', '확정수량', '발주금액(VAT별도)', '확정금액(VAT별도)', '확정률'], ...sum.C.map((c) => [c.k, c.pos.size, c.skus.size, c.q, c.c, c.amt, c.camt, pct(c.camt, c.amt)])]), '센터별 표를 복사했어요.')}
                  >
                    표 복사(엑셀용)
                  </Button>
                }
              >
                <Table head={['물류센터', ['발주서', 'r'], ['SKU', 'r'], ['발주수량', 'r'], ['확정수량', 'r'], ['발주금액', 'r'], ['확정금액', 'r'], ['확정률', 'r']]}>
                  {sum.C.map((c) => (
                    <tr key={c.k} className="border-t border-line">
                      <td className="px-2 py-2">{c.k}</td>
                      <td className="num px-2 py-2 text-right">{c.pos.size}</td>
                      <td className="num px-2 py-2 text-right">{c.skus.size}</td>
                      <td className="num px-2 py-2 text-right">{ea(c.q)}</td>
                      <td className="num px-2 py-2 text-right">{ea(c.c)}</td>
                      <td className="num px-2 py-2 text-right">{won(c.amt)}</td>
                      <td className="num px-2 py-2 text-right">{won(c.camt)}</td>
                      <td className={clsx('num px-2 py-2 text-right', c.samt && 'font-bold text-danger')}>{pct(c.camt, c.amt)}</td>
                    </tr>
                  ))}
                </Table>
                <p className="text-xs text-muted">모든 금액은 부가세 별도(공급가) 기준이에요. 발주금액 = 발주수량 × 공급가, 확정금액 = 확정수량 × 공급가. 파일은 브라우저 안에서만 읽고 어디에도 전송하지 않아요.</p>
              </Section>
            </>
          )}
        </>
      )}
      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> 엑셀을 만들고 원본과 대조하는 중
        </div>
      )}
    </div>
  )
}

function Section({ title, note, actions, children }: { title: string; note?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-1 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-60">
          <h3 className="text-lg font-bold text-ink">{title}</h3>
          {note && <p className="text-sm text-muted">{note}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** 머리글: '이름' 또는 ['이름', 'r'](오른쪽 정렬) */
function Table({ head, children }: { head: Array<string | [string, 'r']>; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            {head.map((h) => {
              const [label, align] = Array.isArray(h) ? h : [h, '']
              return (
                <th key={label} className={clsx('px-2 py-2 font-semibold whitespace-nowrap', align === 'r' && 'text-right')}>
                  {label}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function SmallTable({ title, label, view, by }: { title: string; label: string; view: PoRow[]; by: 'type' | 'day' }) {
  const G = useMemo(() => {
    const m = new Map<string, { k: string; pos: Set<string>; amt: number; camt: number }>()
    for (const r of view) {
      const o = m.get(r[by]) ?? { k: r[by], pos: new Set<string>(), amt: 0, camt: 0 }
      o.pos.add(r.po)
      o.amt += r.amt
      o.camt += r.camt
      m.set(r[by], o)
    }
    return [...m.values()].sort((a, b) => a.k.localeCompare(b.k))
  }, [view, by])
  return (
    <Section title={title}>
      <Table head={[label, ['발주서', 'r'], ['발주금액', 'r'], ['확정률', 'r']]}>
        {G.map((g) => (
          <tr key={g.k} className="border-t border-line">
            <td className="px-2 py-2">{g.k}</td>
            <td className="num px-2 py-2 text-right">{g.pos.size}</td>
            <td className="num px-2 py-2 text-right">{won(g.amt)}</td>
            <td className="num px-2 py-2 text-right">{pct(g.camt, g.amt)}</td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}
