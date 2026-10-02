import clsx from 'clsx'
import { ArrowDown, ArrowUp, Building2, CalendarDays, Copy, Download, FileSpreadsheet, FileText, History, Image as ImageIcon, KeyRound, Plus, ShieldCheck, Printer, RotateCcw, Settings2, Trash2, UserRound } from 'lucide-react'
import { del, get, set } from 'idb-keyval'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { downloadBlob, downloadZip } from '@/lib/files'
import { usePersistentState } from '@/lib/hooks'
import { Badge, Button, Callout, Field, IconButton, MenuItem, NumberInput, Panel, Popover, Section, Segmented, Select, Switch, Textarea, TextInput, toast } from '@/ui'
import { hasOwnData, useKit } from './kit'
import { KitDialog } from './KitDialog'
import { buildPages, canvasMeasure, type Page } from './layout'
import { calcTotals, contactLine, DOC_NAME, emptyItem, fileBase, makeDocNo, newDoc, todayIso, uid, won, type DocType, type LineItem, type QuoteDoc, type VatMode } from './model'
import { PagePreview } from './Preview'

const HISTORY_KEY = 'onbijjang:quote:history'
const SEQ_KEY = 'onbijjang:quote:seq'

interface HistoryEntry {
  id: string
  savedAt: string
  doc: QuoteDoc
}

/** 그날 몇 번째 문서인지 세어 번호를 매긴다(이 브라우저 기준). */
function nextDocNo(type: DocType, date: string): string {
  let map: Record<string, number> = {}
  try {
    map = JSON.parse(localStorage.getItem(SEQ_KEY) ?? '{}')
  } catch {
    map = {}
  }
  const key = `${type}:${date}`
  const seq = (map[key] ?? 0) + 1
  map[key] = seq
  try {
    localStorage.setItem(SEQ_KEY, JSON.stringify(map))
  } catch {
    // 저장 못 해도 번호는 쓴다
  }
  return makeDocNo(type, date, seq)
}

const isAutoNo = (no: string) => /^[QT]-\d{8}-\d{2,}$/.test(no)

function moneyInput(value: number | null, onValue: (v: number | null) => void, label: string) {
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={value == null ? '' : won(value)}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^\d.-]/g, '')
        onValue(digits === '' || digits === '-' ? null : Number(digits))
      }}
      className="num h-9 w-full min-w-0 rounded-sm border border-line-strong bg-surface px-2 text-right text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
    />
  )
}

function ItemsEditor({ doc, setItems }: { doc: QuoteDoc; setItems: (items: LineItem[]) => void }) {
  const totals = calcTotals(doc)
  const setItem = (id: string, patch: Partial<LineItem>) => setItems(doc.items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= doc.items.length) return
    const next = [...doc.items]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setItems(next)
  }
  const statement = doc.type === 'statement'
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-x-1 border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="w-6 font-semibold">#</th>
              {statement && <th className="w-16 font-semibold">월/일</th>}
              <th className="min-w-44 font-semibold">{statement ? '품목' : '비용항목'}</th>
              <th className="w-20 font-semibold">규격</th>
              <th className="w-16 text-right font-semibold">수량</th>
              <th className="w-28 text-right font-semibold">단가</th>
              <th className="w-28 text-right font-semibold">합계</th>
              <th className="w-28 font-semibold">비고</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {doc.items.map((it, idx) => (
              <tr key={it.id}>
                <td className="num text-center text-xs text-faint">{idx + 1}</td>
                {statement && (
                  <td>
                    <TextInput aria-label={`${idx + 1}번 월/일`} value={it.day} placeholder={doc.date.slice(5).replace('-', '/')} maxLength={5} onChange={(e) => setItem(it.id, { day: e.target.value })} className="h-9! px-2! text-sm!" />
                  </td>
                )}
                <td>
                  <TextInput aria-label={`${idx + 1}번 항목`} value={it.name} maxLength={80} onChange={(e) => setItem(it.id, { name: e.target.value })} className="h-9! px-2! text-sm!" />
                </td>
                <td>
                  <TextInput aria-label={`${idx + 1}번 규격`} value={it.spec} maxLength={30} onChange={(e) => setItem(it.id, { spec: e.target.value })} className="h-9! px-2! text-sm!" />
                </td>
                <td>{moneyInput(it.qty, (qty) => setItem(it.id, { qty }), `${idx + 1}번 수량`)}</td>
                <td>{moneyInput(it.unitPrice, (unitPrice) => setItem(it.id, { unitPrice }), `${idx + 1}번 단가`)}</td>
                <td className="num whitespace-nowrap px-1 text-right font-semibold text-ink">{totals.lines[idx].filled ? won(totals.lines[idx].total) : ''}</td>
                <td>
                  <TextInput aria-label={`${idx + 1}번 비고`} value={it.note} maxLength={40} onChange={(e) => setItem(it.id, { note: e.target.value })} className="h-9! px-2! text-sm!" />
                </td>
                <td>
                  <div className="flex">
                    <IconButton icon={ArrowUp} label="위로" size="sm" disabled={idx === 0} onClick={() => move(idx, -1)} />
                    <IconButton icon={ArrowDown} label="아래로" size="sm" disabled={idx === doc.items.length - 1} onClick={() => move(idx, 1)} />
                    <IconButton icon={Trash2} label={`${idx + 1}번 줄 지우기`} size="sm" disabled={doc.items.length <= 1} onClick={() => setItems(doc.items.filter((x) => x.id !== it.id))} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" icon={Plus} disabled={doc.items.length >= 80} onClick={() => setItems([...doc.items, emptyItem()])}>
          줄 추가
        </Button>
        <dl className="num flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-muted">공급가액</dt>
            <dd>{won(totals.supply)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted">세액</dt>
            <dd>{won(totals.tax)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-semibold text-ink-2">합계</dt>
            <dd className="font-bold text-ink">{won(totals.total)}원</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

/** 팀 기본 회사 자료가 서버에 있으면 팀 코드를 한 번 받아 바로 쓰게 한다 */
function TeamGate() {
  const status = useKit((s) => s.teamStatus)
  const joinTeam = useKit((s) => s.joinTeam)
  const usingTeam = useKit((s) => Boolean(s.team) && !hasOwnData(s.local))
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!status?.available) return null
  if (status.authorized) {
    return usingTeam ? (
      <p className="flex items-center gap-1.5 text-sm text-brand-ink">
        <ShieldCheck className="size-4" aria-hidden />팀 기본 회사 자료(인감·사업자등록증·통장 사본)를 쓰고 있습니다.
      </p>
    ) : null
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    setError('')
    try {
      await joinTeam(code.trim())
      setCode('')
      toast.success('팀 회사 자료를 불러왔습니다. 이 브라우저에서는 다음부터 바로 씁니다.')
    } catch (err) {
      setError(err instanceof Error ? err.message : '확인하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Callout tone="info" title="팀 코드를 넣으면 회사 인감·사업자등록증·통장 사본이 바로 들어갑니다">
      {status.codeSet ? (
        <form onSubmit={submit} className="mt-2 flex flex-wrap items-start gap-2">
          <TextInput type="password" autoComplete="off" aria-label="팀 코드" placeholder="팀 코드" value={code} onChange={(e) => setCode(e.target.value)} className="w-48!" aria-invalid={Boolean(error) || undefined} />
          <Button type="submit" variant="primary" icon={KeyRound} loading={busy}>
            확인
          </Button>
          {error && <p className="basis-full text-sm text-danger">{error}</p>}
          <p className="basis-full text-xs text-muted">이 브라우저에서 한 번만 넣으면 됩니다. 코드는 관리자에게 물어보세요.</p>
        </form>
      ) : (
        <p>관리자가 아직 팀 코드를 정하지 않았습니다. 관리자 화면의 ‘회사 자료’에서 정할 수 있습니다.</p>
      )}
    </Callout>
  )
}

export default function QuoteTool() {
  const kit = useKit((s) => s.kit)
  const loaded = useKit((s) => s.loaded)
  const loadKit = useKit((s) => s.load)
  const [doc, setDoc] = usePersistentState<QuoteDoc>('onbijjang:quote:draft', newDoc('quote'))
  const [kitOpen, setKitOpen] = useState<false | 'company' | 'contacts'>(false)
  const [pageIndex, setPageIndex] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const patch = (p: Partial<QuoteDoc>) => setDoc((d) => ({ ...d, ...p }))

  useEffect(() => {
    void loadKit()
    get(HISTORY_KEY)
      .then((h) => setHistory(Array.isArray(h) ? (h as HistoryEntry[]) : []))
      .catch(() => {})
  }, [loadKit])

  // 날짜는 열 때마다 오늘로(이미 작성 중이던 문서도). 번호가 자동 번호인데 날짜가 바뀌었으면 새로 매긴다.
  // 번호 매기기는 부작용이 있어 상태 갱신 함수 밖에서 한 번만 한다.
  const numbered = useRef(false)
  useEffect(() => {
    if (numbered.current) return
    numbered.current = true
    const today = todayIso()
    const docNo = !doc.docNo || (isAutoNo(doc.docNo) && doc.date !== today) ? nextDocNo(doc.type, today) : doc.docNo
    setDoc((d) => ({ ...d, date: today, docNo }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [fontsReady, setFontsReady] = useState(false)
  useEffect(() => {
    document.fonts.ready.then(() => setFontsReady(true))
  }, [])
  const pages: Page[] = useMemo(() => buildPages({ doc, kit, measure: canvasMeasure }), [doc, kit, fontsReady])
  useEffect(() => setPageIndex((i) => Math.min(i, pages.length - 1)), [pages.length])

  const contact = kit.contacts.find((c) => c.id === doc.contactId) ?? kit.contacts[0]
  const totals = calcTotals(doc)
  const filledCount = totals.lines.filter((l) => l.filled).length
  const base = fileBase(doc)
  const companyReady = Boolean(kit.company.name)
  const teamStatus = useKit((s) => s.teamStatus)

  const remember = async () => {
    const entry: HistoryEntry = { id: uid(), savedAt: new Date().toISOString(), doc }
    const next = [entry, ...history.filter((h) => !(h.doc.docNo === doc.docNo && h.doc.type === doc.type))].slice(0, 40)
    setHistory(next)
    await set(HISTORY_KEY, next).catch(() => {})
  }
  const guard = () => {
    if (!filledCount) {
      toast.info('품목을 한 줄 이상 입력해 주세요.')
      return false
    }
    if (!doc.customer.trim()) toast.warn('고객사명이 비어 있습니다. 그대로 저장합니다.')
    return true
  }
  const job = async (label: string, fn: () => Promise<void>) => {
    if (!guard()) return
    setBusy(label)
    try {
      await fn()
      await remember()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const makePdf = async () => {
    const { pagesToPdf } = await import('./render')
    const bytes = await pagesToPdf(pages, { title: `${DOC_NAME[doc.type]} ${doc.customer}`.trim(), author: kit.company.name || '온비짱' })
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
  }
  const makeXlsx = async () => (await import('./excel')).buildWorkbook(doc, kit)

  const savePdf = () => job('pdf', async () => downloadBlob(await makePdf(), `${base}.pdf`))
  const saveXlsx = () => job('xlsx', async () => downloadBlob(await makeXlsx(), `${base}.xlsx`))
  const saveImages = (format: 'image/png' | 'image/jpeg') =>
    job('img', async () => {
      const { pagesToImages } = await import('./render')
      const blobs = await pagesToImages(pages, format, 200)
      const ext = format === 'image/png' ? 'png' : 'jpg'
      if (blobs.length === 1) downloadBlob(blobs[0], `${base}.${ext}`)
      else await downloadZip(blobs.map((b, i) => ({ name: `${base}_${i + 1}.${ext}`, data: b })), `${base}_이미지`)
    })
  const saveAll = () =>
    job('all', async () => {
      const [pdf, xlsx] = await Promise.all([makePdf(), makeXlsx()])
      await downloadZip(
        [
          { name: `${base}.pdf`, data: pdf },
          { name: `${base}.xlsx`, data: xlsx },
        ],
        base,
      )
    })
  const printPdf = () =>
    job('print', async () => {
      const url = URL.createObjectURL(await makePdf())
      const w = window.open(url, '_blank')
      if (!w) toast.info('새 창이 막혔습니다. PDF 를 내려받아 인쇄해 주세요.')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    })

  const switchType = (type: DocType) => {
    if (type === doc.type) return
    const docNo = isAutoNo(doc.docNo) || !doc.docNo ? nextDocNo(type, doc.date) : doc.docNo
    setDoc((d) => ({ ...d, type, docNo }))
    setPageIndex(0)
  }
  const reset = () => {
    const fresh = newDoc(doc.type)
    setDoc({ ...fresh, docNo: nextDocNo(doc.type, fresh.date), contactId: doc.contactId, showContact: doc.showContact, sealId: doc.sealId })
    setPageIndex(0)
  }
  const reopen = (h: HistoryEntry, asCopy: boolean) => {
    const today = todayIso()
    setDoc(asCopy ? { ...h.doc, date: today, docNo: nextDocNo(h.doc.type, today), items: h.doc.items.map((i) => ({ ...i, id: uid() })) } : h.doc)
    setPageIndex(0)
  }
  const recentCustomers = useMemo(() => [...new Set(history.map((h) => h.doc.customer).filter(Boolean))].slice(0, 20), [history])

  const statement = doc.type === 'statement'
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="문서 종류"
          value={doc.type}
          onValue={switchType}
          options={[
            { value: 'quote', label: '견적서', icon: FileText },
            { value: 'statement', label: '거래명세표', icon: FileSpreadsheet },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Popover
            align="end"
            className="w-80"
            trigger={({ ref, ...props }) => (
              <span ref={ref} className="inline-flex">
                <Button icon={History} {...props}>
                  최근 문서
                </Button>
              </span>
            )}
          >
            {(close) =>
              history.length ? (
                <div className="flex max-h-80 flex-col">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center gap-1 rounded-sm px-1 hover:bg-sunken">
                      <button
                        type="button"
                        className="min-w-0 flex-1 px-1.5 py-2 text-left"
                        onClick={() => {
                          reopen(h, false)
                          close()
                        }}
                      >
                        <span className="block truncate text-sm font-semibold">
                          {DOC_NAME[h.doc.type]} · {h.doc.customer || '고객사 없음'}
                        </span>
                        <span className="num block text-2xs text-muted">
                          {h.doc.docNo} · {won(calcTotals(h.doc).total)}원
                        </span>
                      </button>
                      <IconButton
                        icon={Copy}
                        label="복사해서 새로 쓰기"
                        size="sm"
                        onClick={() => {
                          reopen(h, true)
                          close()
                        }}
                      />
                    </div>
                  ))}
                  <MenuItem
                    icon={Trash2}
                    danger
                    onClick={async () => {
                      setHistory([])
                      await del(HISTORY_KEY).catch(() => {})
                      close()
                    }}
                  >
                    목록 비우기
                  </MenuItem>
                </div>
              ) : (
                <p className="px-2.5 py-3 text-sm text-muted">아직 저장한 문서가 없습니다. 내려받은 문서가 여기에 쌓입니다.</p>
              )
            }
          </Popover>
          <Button icon={RotateCcw} onClick={reset}>
            새로 작성
          </Button>
          <Button icon={Settings2} onClick={() => setKitOpen('company')}>
            회사 자료
          </Button>
        </div>
      </div>

      <TeamGate />

      {loaded && !companyReady && !(teamStatus?.available && !teamStatus.authorized) && (
        <Callout tone="warn" title="먼저 우리 회사 자료를 넣어 주세요">
          상호·사업자번호·주소와 직인, 사업자등록증, 통장 사본을 한 번 넣어 두면 문서마다 자동으로 들어갑니다. 받은 ‘회사 자료 파일’이 있으면 불러오기만 하면 됩니다.
          <div className="mt-2">
            <Button size="sm" variant="primary" icon={Building2} onClick={() => setKitOpen('company')}>
              회사 자료 넣기
            </Button>
          </div>
        </Callout>
      )}

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel>
            <Section title={statement ? '공급받는자' : '받는 곳'}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="고객사명" hint={statement ? undefined : '문서에 “OOO 귀중”으로 들어갑니다.'}>
                  {(id) => (
                    <>
                      <TextInput id={id} list="quote-customers" value={doc.customer} maxLength={60} onChange={(e) => patch({ customer: e.target.value })} placeholder="예: (주)한빛상사" />
                      <datalist id="quote-customers">
                        {recentCustomers.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </>
                  )}
                </Field>
                <Field label={statement ? '품명 (선택)' : '품명·건명'}>{(id) => <TextInput id={id} value={doc.title} maxLength={60} onChange={(e) => patch({ title: e.target.value })} placeholder="예: 사무용 의자" />}</Field>
                {statement && (
                  <>
                    <Field label="등록번호 (선택)">{(id) => <TextInput id={id} value={doc.customerBizNo} maxLength={20} onChange={(e) => patch({ customerBizNo: e.target.value })} placeholder="000-00-00000" />}</Field>
                    <Field label="대표자 (선택)">{(id) => <TextInput id={id} value={doc.customerCeo} maxLength={20} onChange={(e) => patch({ customerCeo: e.target.value })} />}</Field>
                    <Field label="주소 (선택)" className="sm:col-span-2">
                      {(id) => <TextInput id={id} value={doc.customerAddress} maxLength={100} onChange={(e) => patch({ customerAddress: e.target.value })} />}
                    </Field>
                  </>
                )}
              </div>
            </Section>
            <Section title="날짜·번호">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="작성일" hint="열 때마다 오늘 날짜로 들어갑니다.">
                  {(id) => (
                    <div className="flex gap-1.5">
                      <TextInput id={id} type="date" value={doc.date} onChange={(e) => e.target.value && patch({ date: e.target.value })} />
                      <IconButton icon={CalendarDays} label="오늘로" variant="secondary" onClick={() => patch({ date: todayIso() })} />
                    </div>
                  )}
                </Field>
                <Field label={statement ? '명세표 번호' : '견적 번호'}>{(id) => <TextInput id={id} value={doc.docNo} maxLength={30} onChange={(e) => patch({ docNo: e.target.value })} />}</Field>
                {!statement ? (
                  <Field label="유효기간">{(id) => <NumberInput id={id} value={doc.validDays} unit="일" min={0} max={365} onValue={(v) => patch({ validDays: Math.max(0, Math.min(365, v ?? 0)) })} />}</Field>
                ) : (
                  <Switch className="sm:pt-6" checked={doc.twoCopies} onChange={(twoCopies) => patch({ twoCopies })} label="한 장에 2부" hint="공급받는자·공급자 보관용" />
                )}
              </div>
            </Section>
            <Section title={statement ? '품목' : '비용항목'} action={<Segmented<VatMode> label="단가 부가세" size="sm" value={doc.vatMode} onValue={(vatMode) => patch({ vatMode })} options={[{ value: 'included', label: 'VAT 포함' }, { value: 'excluded', label: 'VAT 별도' }, { value: 'exempt', label: '면세' }]} />}>
              <ItemsEditor doc={doc} setItems={(items) => patch({ items })} />
            </Section>
            <Section title="기타사항">
              <Field label="기타사항" hint="여러 줄로 적을 수 있습니다. 납기·결제 조건 등을 적으세요.">
                {(id) => <Textarea id={id} value={doc.notes} maxLength={1000} onChange={(e) => patch({ notes: e.target.value })} className="min-h-20!" />}
              </Field>
              {!statement && <Field label="안내 문구">{(id) => <Textarea id={id} value={doc.footnote} maxLength={300} onChange={(e) => patch({ footnote: e.target.value })} className="min-h-14!" />}</Field>}
            </Section>
          </Panel>

          <Panel>
            <Section title="담당자" action={<Button size="sm" variant="ghost" icon={UserRound} onClick={() => setKitOpen('contacts')}>담당자 관리</Button>}>
              <Switch checked={doc.showContact} onChange={(showContact) => patch({ showContact })} label="담당자 연락처 넣기" hint={contact ? contactLine(contact) : '등록된 담당자가 없습니다. 담당자 관리에서 추가하세요.'} disabled={!kit.contacts.length} />
              {kit.contacts.length > 1 && doc.showContact && (
                <Select aria-label="담당자 고르기" value={contact?.id ?? ''} onValue={(contactId) => patch({ contactId })} options={kit.contacts.map((c) => ({ value: c.id, label: [c.name, c.title].filter(Boolean).join(' ') || '이름 없음' }))} />
              )}
            </Section>
            <Section title="도장·첨부">
              <Switch checked={doc.showSeal && kit.seals.length > 0} onChange={(showSeal) => patch({ showSeal })} label="직인 찍기" hint={kit.seals.length ? undefined : '회사 자료에서 직인을 먼저 넣어 주세요.'} disabled={!kit.seals.length} />
              {doc.showSeal && kit.seals.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {kit.seals.map((s) => {
                    const on = (doc.sealId ?? kit.seals[0].id) === s.id
                    return (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={on}
                        title={s.name}
                        onClick={() => patch({ sealId: s.id })}
                        className={clsx('checker flex size-14 items-center justify-center rounded-md border-2 transition-colors', on ? 'border-brand' : 'border-line hover:border-line-strong')}
                      >
                        <img src={s.dataUrl} alt={s.name} className="max-h-[90%] max-w-[90%]" />
                      </button>
                    )
                  })}
                </div>
              )}
              <Switch checked={doc.attachRegistration && !!kit.registration} onChange={(attachRegistration) => patch({ attachRegistration })} label="사업자등록증 붙이기" hint={kit.registration ? `${kit.registration.pages.length}쪽이 뒤에 붙습니다.` : '회사 자료에서 먼저 올려 주세요.'} disabled={!kit.registration} />
              <Switch checked={doc.attachBankbook && !!kit.bankbook} onChange={(attachBankbook) => patch({ attachBankbook })} label="통장 사본 붙이기" hint={kit.bankbook ? (kit.bank.account ? '입금 계좌 한 줄도 함께 들어갑니다.' : '뒤에 한 쪽으로 붙습니다.') : '회사 자료에서 먼저 올려 주세요.'} disabled={!kit.bankbook} />
            </Section>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-20">
          <Panel className="p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink-2">저장</span>
              <Badge>{pages.length}쪽</Badge>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" icon={Download} loading={busy === 'pdf'} disabled={!!busy} onClick={savePdf}>
                  PDF
                </Button>
                <Button size="sm" icon={FileSpreadsheet} loading={busy === 'xlsx'} disabled={!!busy} onClick={saveXlsx}>
                  엑셀
                </Button>
                <Popover
                  align="end"
                  trigger={({ ref, ...props }) => (
                    <span ref={ref} className="inline-flex">
                      <Button size="sm" icon={ImageIcon} loading={busy === 'img'} disabled={!!busy} {...props}>
                        이미지
                      </Button>
                    </span>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem
                        onClick={() => {
                          close()
                          saveImages('image/png')
                        }}
                      >
                        PNG (선명하게)
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          close()
                          saveImages('image/jpeg')
                        }}
                      >
                        JPG (가볍게)
                      </MenuItem>
                    </>
                  )}
                </Popover>
                <Button size="sm" icon={Download} loading={busy === 'all'} disabled={!!busy} onClick={saveAll}>
                  PDF+엑셀
                </Button>
                <IconButton icon={Printer} label="인쇄용 PDF 열기" variant="secondary" size="sm" disabled={!!busy} onClick={printPdf} />
              </div>
            </div>
            <div className="mat flex justify-center rounded-md p-3 sm:p-5">
              <div className="w-full max-w-[640px]">{pages[pageIndex] && <PagePreview page={pages[pageIndex]} label={`${DOC_NAME[doc.type]} 미리보기 ${pageIndex + 1}쪽`} />}</div>
            </div>
            {pages.length > 1 && (
              <div className="mt-2 flex flex-wrap justify-center gap-1">
                {pages.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPageIndex(i)}
                    aria-current={i === pageIndex}
                    className={clsx('h-8 min-w-8 rounded-sm border px-2 text-sm font-semibold', i === pageIndex ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-sunken')}
                  >
                    {p.attachment ? (p.attachment.kind === 'registration' ? '등록증' : '통장') : i + 1}
                  </button>
                ))}
              </div>
            )}
          </Panel>
          <p className="text-xs leading-relaxed text-muted">엑셀은 금액 칸이 수식이라 엑셀에서 수량·단가를 고치면 다시 계산됩니다. 직인·첨부 자료는 이 브라우저에만 있고 서버로 보내지 않습니다.</p>
        </div>
      </div>

      <KitDialog open={!!kitOpen} initialTab={kitOpen || 'company'} key={String(kitOpen)} onClose={() => setKitOpen(false)} />
    </div>
  )
}
