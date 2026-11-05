import clsx from 'clsx'
import { ClipboardPaste, Copy, Download, EyeOff, FileSpreadsheet, Gift, History, Plus, RotateCcw, Sparkles, Trash2, Trophy, UserX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { downloadBlob } from '@/lib/files'
import { Badge, Button, Callout, Checkbox, Dropzone, Field, Panel, Segmented, Select, Textarea, TextInput, toast } from '@/ui'
import { writeTable } from '@/tools/orders/excel'
import { dedupe, drawWinners, guessNameCol, guessPhoneCol, maskName, maskPhone, parsePasted, randomInt, withHeader, type Prize, type Roster, type Winner } from './raffle'

const DEFAULT_PRIZES: Prize[] = [
  { name: '1등', count: 1 },
  { name: '2등', count: 2 },
  { name: '3등', count: 3 },
]
const PRIZE_TONE = ['bg-mark-soft border-mark text-ink', 'bg-metal-soft border-metal/40 text-ink', 'bg-earth-soft border-earth/40 text-ink']

export default function RaffleTab() {
  const [mode, setMode] = useState<'paste' | 'file'>('paste')
  const [text, setText] = useState('')
  const [fileRoster, setFileRoster] = useState<{ name: string; roster: Roster } | null>(null)
  const roster = useMemo<Roster | null>(() => (mode === 'paste' ? (text.trim() ? parsePasted(text) : null) : (fileRoster?.roster ?? null)), [mode, text, fileRoster])
  // 핸드폰번호 칸(중복 검사): 자동으로 찾고, 바꿀 수 있다. -1 = 검사 안 함
  const [phoneCol, setPhoneCol] = useState<number | null>(null)
  const autoPhone = roster ? guessPhoneCol(roster) : -1
  const pc = phoneCol ?? autoPhone
  const nameCol = roster ? guessNameCol(roster, pc) : 0
  useEffect(() => setPhoneCol(null), [roster])
  const { entries, removed } = useMemo(() => (roster ? dedupe(roster, pc) : { entries: [], removed: [] }), [roster, pc])

  const [prizes, setPrizes] = useState<Prize[]>(DEFAULT_PRIZES)
  const need = prizes.reduce((s, p) => s + Math.max(0, p.count), 0)
  const [mask, setMask] = useState(true)
  const [winners, setWinners] = useState<Winner[] | null>(null)
  const [drawnAt, setDrawnAt] = useState<string>('')
  const [rolling, setRolling] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory)
  const clearHistory = () => {
    if (!confirm('이 브라우저에 남은 추첨 기록을 모두 지울까요?')) return
    setHistory([])
    saveHistory([])
  }
  const [revealed, setRevealed] = useState(0)
  const timer = useRef<number[]>([])
  useEffect(() => () => timer.current.forEach(clearTimeout), [])

  const readFile = async (file: File) => {
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer())
      const sheet = book.Sheets[book.SheetNames[0]]
      const rows = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '', raw: false }) : []
      const r = withHeader(rows.map((row) => (row as unknown[]).map((c) => String(c ?? '').trim())))
      if (!r.rows.length) throw new Error('empty')
      setFileRoster({ name: file.name, roster: r })
      setWinners(null)
      toast.success(`${file.name}에서 ${r.rows.length}줄을 읽었습니다.`)
    } catch {
      toast.error('엑셀 파일을 읽지 못했습니다. xlsx·xls·csv 파일인지 확인해 주세요.')
    }
  }

  const show = (e: { cells: string[] }) => {
    const name = e.cells[nameCol] ?? ''
    const phone = pc >= 0 ? (e.cells[pc] ?? '') : ''
    return { name: mask ? maskName(name) : name, phone: phone ? (mask ? maskPhone(phone) : phone) : '' }
  }

  const run = () => {
    if (!entries.length) return toast.error('추첨할 명단을 먼저 넣어 주세요.')
    if (!prizes.length || need < 1) return toast.error('당첨자 수를 1명 이상으로 정해 주세요.')
    if (need > entries.length) return toast.error(`당첨자 ${need}명이 추첨 대상 ${entries.length}명보다 많습니다.`)
    if (winners && !confirm('다시 추첨할까요? 지금 결과는 사라집니다.')) return
    timer.current.forEach(clearTimeout)
    let result: Winner[]
    try {
      result = drawWinners(entries, prizes.filter((p) => p.count > 0))
    } catch (err) {
      return toast.error(err instanceof Error ? err.message : '추첨하지 못했습니다.')
    }
    setWinners(null)
    setRevealed(0)
    // 두근두근: 2초 동안 이름이 빠르게 바뀐다
    const t0 = Date.now()
    const tick = () => {
      const e = entries[randomInt(entries.length)]
      setRolling(show(e).name || `${e.line}번`)
      if (Date.now() - t0 < 2000) timer.current.push(window.setTimeout(tick, 60))
      else {
        setRolling(null)
        setWinners(result)
        const at = new Date().toLocaleString('ko-KR')
        setDrawnAt(at)
        // 추첨 기록(이 브라우저에만, 가린 이름으로 최근 20회)
        const item: HistoryItem = {
          at,
          total: entries.length,
          removed: removed.length,
          prizes: [...new Set(result.map((w) => w.prize))].map((p) => ({ name: p, names: result.filter((w) => w.prize === p).map((w) => maskName(w.entry.cells[nameCol] ?? '') || `${w.entry.line}번째 줄`) })),
        }
        setHistory((h) => {
          const next = [item, ...h].slice(0, 20)
          saveHistory(next)
          return next
        })
        // 등수 하나씩 차례로 열기(뒤 등수부터 → 1등이 마지막)
        const groups = [...new Set(result.map((w) => w.prize))]
        groups.forEach((_, i) => timer.current.push(window.setTimeout(() => setRevealed(i + 1), 500 * (i + 1))))
      }
    }
    tick()
  }

  const order = winners ? [...new Set(winners.map((w) => w.prize))] : []
  /** 뒤 등수부터 열고 1등이 마지막에 보이게 */
  const visible = new Set(order.slice(Math.max(0, order.length - revealed)))
  const resultText = () =>
    [
      `추첨 결과 (${drawnAt} · 대상 ${entries.length}명)`,
      ...order.flatMap((p) => [`■ ${p}`, ...winners!.filter((w) => w.prize === p).map((w) => `  ${w.order}. ${show(w.entry).name}${show(w.entry).phone ? ` ${show(w.entry).phone}` : ''}`)]),
    ].join('\n')
  const exportExcel = async () => {
    if (!winners || !roster) return
    const cols = ['등수', '순번', '명단 줄', ...roster.cols]
    const rows = winners.map((w) => [w.prize, w.order, w.entry.line, ...w.entry.cells])
    downloadBlob(await writeTable('추첨 결과', cols, rows), `추첨결과_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ① 명단(왼쪽 반) · ② 등수와 당첨자 수(오른쪽 반)를 한 칸에 */}
      <Panel className="grid gap-6 p-4 sm:p-5 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold text-ink">① 추첨 명단</h2>
          <Segmented
            label="명단 넣는 방법"
            size="sm"
            value={mode}
            onValue={(v) => {
              setMode(v)
              setWinners(null)
            }}
            options={[
              { value: 'paste', label: '붙여 넣기', icon: ClipboardPaste },
              { value: 'file', label: '엑셀 파일', icon: FileSpreadsheet },
            ]}
          />
        </div>
        {mode === 'paste' ? (
          <Field label="한 줄에 한 사람" hint="엑셀에서 칸째로 복사해 붙여 넣어도 됩니다(이름·핸드폰번호 등). 첫 줄이 ‘이름·연락처’ 같은 머리줄이면 칸 이름으로 씁니다.">
            {(id) => (
              <Textarea
                id={id}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setWinners(null)
                }}
                className="min-h-40! font-mono text-sm"
                placeholder={'이름\t핸드폰번호\n홍길동\t010-1234-5678\n김철수\t010-2222-3333'}
              />
            )}
          </Field>
        ) : (
          <Dropzone accept=".xlsx,.xls,.csv" multiple={false} paste={false} compact icon={FileSpreadsheet} title={fileRoster ? `${fileRoster.name} · 다른 파일로 바꾸려면 끌어다 놓기` : '엑셀 파일을 끌어다 놓거나 눌러서 고르기'} hint="xlsx·xls·csv · 첫 시트를 읽습니다" onFiles={(f) => void readFile(f[0])} />
        )}
        {roster && (
          <div className="flex flex-col gap-3 rounded-md border border-line bg-paper p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="중복 검사할 핸드폰번호 칸" className="w-64">
                {(id) => (
                  <Select
                    id={id}
                    value={String(pc)}
                    onValue={(v) => setPhoneCol(Number(v))}
                    options={[{ value: '-1', label: '검사 안 함(모두 추첨 대상)' }, ...roster.cols.map((c, i) => ({ value: String(i), label: c }))]}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2 pb-2 text-sm">
                <Badge tone="brand">추첨 대상 {entries.length.toLocaleString()}명</Badge>
                {removed.length > 0 && <Badge tone="warn">중복 제외 {removed.length.toLocaleString()}명</Badge>}
                <span className="text-muted">명단 {roster.rows.length.toLocaleString()}줄</span>
              </div>
            </div>
            {removed.length > 0 && (
              <details className="text-sm">
                <summary className="flex cursor-pointer items-center gap-1 font-semibold text-warn">
                  <UserX className="size-4" aria-hidden /> 핸드폰번호가 겹쳐 제외된 {removed.length}명(위 줄만 남김) 보기
                </summary>
                <ul className="mt-2 max-h-48 overflow-auto rounded border border-line bg-surface text-xs">
                  {removed.map((e) => (
                    <li key={e.line} className="flex gap-3 border-b border-line px-3 py-1.5 last:border-0">
                      <span className="num w-14 text-muted">{e.line}번째 줄</span>
                      <span className="min-w-0 flex-1 truncate">{e.cells.filter(Boolean).join(' · ')}</span>
                      <span className="text-muted">→ {e.keptLine}번째 줄과 같은 번호</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="max-h-56 overflow-auto rounded border border-line bg-surface">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface text-left text-muted">
                  <tr>
                    <th className="px-2 py-1.5">줄</th>
                    {roster.cols.map((c, i) => (
                      <th key={c + i} className={clsx('px-2 py-1.5', i === pc && 'text-brand')}>
                        {c}
                        {i === pc && ' (중복 검사)'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 200).map((e) => (
                    <tr key={e.line} className="border-t border-line">
                      <td className="num px-2 py-1 text-muted">{e.line}</td>
                      {e.cells.map((c, i) => (
                        <td key={i} className="px-2 py-1">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {entries.length > 200 && <p className="px-2 py-1.5 text-xs text-muted">…외 {entries.length - 200}명</p>}
            </div>
          </div>
        )}
        </div>
        <div className="flex min-w-0 flex-col gap-5 border-t border-line pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-ink">② 등수와 당첨자 수</h2>
          <div className="flex flex-col gap-2">
            {prizes.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Trophy className={clsx('size-5 shrink-0', i === 0 ? 'text-warn' : 'text-faint')} aria-hidden />
                <TextInput aria-label={`${i + 1}번째 등수 이름`} value={p.name} maxLength={20} className="w-36!" onChange={(e) => setPrizes((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <TextInput
                  aria-label={`${p.name} 인원`}
                  type="number"
                  min={0}
                  max={9999}
                  value={String(p.count)}
                  className="w-24!"
                  onChange={(e) => setPrizes((list) => list.map((x, j) => (j === i ? { ...x, count: Math.max(0, Math.min(9999, Math.floor(Number(e.target.value) || 0))) } : x)))}
                />
                <span className="text-sm text-muted">명</span>
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`${p.name} 지우기`} disabled={prizes.length <= 1} onClick={() => setPrizes((list) => list.filter((_, j) => j !== i))} />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" icon={Plus} onClick={() => setPrizes((list) => [...list, { name: `${list.length + 1}등`, count: 1 }])}>
                등수 더하기
              </Button>
              <span className={clsx('text-sm', need > entries.length && entries.length ? 'font-semibold text-danger' : 'text-muted')}>
                당첨자 모두 {need}명 · 추첨 대상 {entries.length}명
              </span>
            </div>
          </div>
          <Checkbox checked={mask} onChange={setMask} label="발표용으로 이름·번호 가리기(홍*동 · 010-****-5678)" />
          <div className="flex flex-col items-start gap-1.5">
            <Button variant="primary" icon={Sparkles} onClick={run} disabled={Boolean(rolling)}>
              {winners ? '다시 추첨하기' : '추첨 시작'}
            </Button>
            <span className="text-xs text-muted">브라우저의 암호용 난수로 공정하게 뽑습니다. 한 사람은 한 등수에만 당첨됩니다.</span>
          </div>
        </div>
        <Helper prizes={prizes} total={entries.length} history={history} onClearHistory={clearHistory} />
        </div>
      </Panel>

      {rolling && (
        <Panel className="flex flex-col items-center gap-2 p-10">
          <Gift className="size-10 animate-bounce text-accent" aria-hidden />
          <p className="text-4xl font-black tracking-wide text-ink">{rolling}</p>
          <p className="text-sm text-muted">추첨하는 중…</p>
        </Panel>
      )}

      {winners && (
        <Panel className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-1.5 text-lg font-bold text-ink">
              <Trophy className="size-5 text-warn" aria-hidden /> 추첨 결과
            </h2>
            <span className="text-sm text-muted">
              {drawnAt} · 대상 {entries.length}명{removed.length ? ` (중복 ${removed.length}명 제외)` : ''}
            </span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <Button size="sm" icon={mask ? EyeOff : Copy} onClick={() => void navigator.clipboard.writeText(resultText()).then(() => toast.success('결과를 복사했습니다.'))}>
                결과 복사{mask ? '(가림)' : ''}
              </Button>
              <Button size="sm" icon={Download} onClick={() => void exportExcel()}>
                엑셀 받기(전체 칸)
              </Button>
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={run}>
                다시 추첨
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {order.map((p, gi) => (
              <section key={p} className={clsx('flex flex-col gap-2 rounded-lg border p-4 transition-opacity duration-500', PRIZE_TONE[gi] ?? 'border-line bg-paper', visible.has(p) ? 'opacity-100' : 'opacity-0')}>
                <h3 className="flex items-center gap-2 text-base font-black">
                  {gi === 0 ? '🥇' : gi === 1 ? '🥈' : gi === 2 ? '🥉' : '🎁'} {p}
                  <span className="text-sm font-semibold text-muted">{winners.filter((w) => w.prize === p).length}명</span>
                </h3>
                <ol className="flex flex-col gap-1">
                  {winners
                    .filter((w) => w.prize === p)
                    .map((w) => {
                      const s = show(w.entry)
                      return (
                        <li key={w.entry.line} className="flex items-center gap-2 rounded-md bg-surface/80 px-3 py-1.5">
                          <span className="num w-6 text-sm font-bold text-muted">{w.order}</span>
                          <span className="text-base font-bold text-ink">{s.name || '(이름 없음)'}</span>
                          {s.phone && <span className="num text-sm text-ink-2">{s.phone}</span>}
                          <span className="ml-auto text-2xs text-faint">{w.entry.line}번째 줄</span>
                        </li>
                      )
                    })}
                </ol>
              </section>
            ))}
          </div>
          {revealed < order.length && <p className="text-center text-sm text-muted">두근두근… 낮은 등수부터 공개합니다</p>}
        </Panel>
      )}

      {!roster && (
        <Callout tone="info" title="이렇게 쓰세요">
          명단을 붙여 넣거나 엑셀을 올리면 → 핸드폰번호가 겹치는 사람은 위 줄만 남기고 → 등수별 인원을 정해 → 추첨 시작. 결과는 복사하거나 엑셀로 받을 수 있습니다.
        </Callout>
      )}
    </div>
  )
}

// ── 등수 아래: 당첨 확률 · 추첨 기록 ─────────────────────
interface HistoryItem {
  at: string
  total: number
  removed: number
  prizes: Array<{ name: string; names: string[] }>
}
const HISTORY_KEY = 'onbijjang.raffle.history'
function loadHistory(): HistoryItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(v) ? v.slice(0, 20) : []
  } catch {
    return []
  }
}
function saveHistory(list: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch {
    // 저장이 안 되는 브라우저는 넘어간다
  }
}

function Helper({ prizes, total, history, onClearHistory }: { prizes: Prize[]; total: number; history: HistoryItem[]; onClearHistory: () => void }) {
  const need = prizes.reduce((s, p) => s + Math.max(0, p.count), 0)
  const pct = (n: number) => (total ? `${((n / total) * 100).toFixed(n / total < 0.01 ? 2 : 1)}%` : '-')
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-ink">
          당첨 확률 <span className="text-xs font-normal text-muted">대상 {total.toLocaleString()}명 기준, 한 사람이</span>
        </h3>
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-sm">
            <tbody>
              {prizes.map((p, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5 font-semibold text-ink">{p.name || `${i + 1}번째`}</td>
                  <td className="num px-3 py-1.5 text-right text-ink-2">{p.count}명</td>
                  <td className="num px-3 py-1.5 text-right font-semibold text-brand">{pct(p.count)}</td>
                </tr>
              ))}
              <tr className="bg-paper">
                <td className="px-3 py-1.5 font-bold text-ink">무엇이든 당첨</td>
                <td className="num px-3 py-1.5 text-right text-ink-2">{need}명</td>
                <td className={clsx('num px-3 py-1.5 text-right font-bold', need > total && total ? 'text-danger' : 'text-accent')}>{need > total && total ? '인원 초과' : pct(need)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-ink">
            <History className="mr-1 inline size-4 text-muted" aria-hidden />
            최근 추첨 기록 <span className="text-xs font-normal text-muted">이 브라우저에만 · 가린 이름</span>
          </h3>
          {history.length > 0 && (
            <button type="button" className="ml-auto text-xs text-muted hover:text-danger" onClick={onClearHistory}>
              기록 지우기
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-faint">추첨하면 여기에 시각·대상 수·당첨자가 남습니다.</p>
        ) : (
          <ul className="flex max-h-60 flex-col gap-1.5 overflow-auto">
            {history.map((h, i) => (
              <li key={h.at + i} className="rounded-md border border-line bg-paper px-3 py-2 text-xs">
                <p className="font-semibold text-ink-2">
                  {h.at} · 대상 {h.total}명{h.removed ? ` (중복 ${h.removed}명 제외)` : ''}
                </p>
                <p className="mt-0.5 text-muted">{h.prizes.map((p) => `${p.name}: ${p.names.join(', ')}`).join(' / ')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
