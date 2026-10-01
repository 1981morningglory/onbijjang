import clsx from 'clsx'
import { ArrowDown, ArrowDownAZ, ArrowRight, ArrowUp, FileArchive, FileDown, FilePenLine, FileSpreadsheet, GripVertical, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react'
import { useTeamPresets } from '@/app/config'
import { useHandoffFiles } from '@/app/handoff'
import { downloadBlob, formatBytes, sanitizeFilename, todayStamp } from '@/lib/files'
import { fmt, useAbortable, usePersistentState } from '@/lib/hooks'
import {
  Button, Callout, Checkbox, Dropzone, EmptyState, Field, IconButton, MenuItem, NumberInput, Panel, Popover, Progress, Section, Segmented, Select, TextInput, Textarea, ToolLayout, toast,
} from '@/ui'
import {
  MAX_DIGITS, RULE_LABEL, computeRenames, createRule, dateStamp, moveItem, naturalCompare, normalizeRules, padNumber, rowsToMappingText, toChangeCsv,
  type AffixRule, type DateRule, type MappingInfo, type MappingRule, type ReplaceRule, type Rule, type RuleType, type SequenceRule,
} from './logic'
import { zipRenamed } from './zip'

const MAX_FILES = 2000
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024
const PAGE = 200
const RULE_TYPES: RuleType[] = ['sequence', 'replace', 'affix', 'date', 'mapping']
const SEPARATORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '_', label: '밑줄 _' },
  { value: '-', label: '줄표 -' },
  { value: ' ', label: '공백' },
  { value: '', label: '없음' },
]

interface Item {
  id: number
  file: File
}
let itemSeq = 0
const newRuleId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// ── 규칙 편집기 ───────────────────────────────────────────
function SequenceEditor({ rule, onChange }: { rule: SequenceRule; onChange: (patch: Partial<SequenceRule>) => void }) {
  return (
    <>
      <Segmented
        label="번호 넣는 방식"
        block
        size="sm"
        value={rule.placement}
        onValue={(placement) => onChange({ placement })}
        options={[
          { value: 'replace', label: '새 이름으로' },
          { value: 'suffix', label: '뒤에 번호' },
          { value: 'prefix', label: '앞에 번호' },
        ]}
      />
      {rule.placement === 'replace' && (
        <Field label="공통 이름" hint="비워 두면 번호만 남습니다.">
          {(id) => <TextInput id={id} value={rule.base} onChange={(e) => onChange({ base: e.target.value })} placeholder="예: 상품" maxLength={120} />}
        </Field>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Field label="시작 번호">{(id) => <NumberInput id={id} min={0} step={1} value={rule.start} onValue={(v) => onChange({ start: Math.max(0, Math.floor(v ?? 0)) })} />}</Field>
        <Field label="자릿수">{(id) => <NumberInput id={id} min={1} max={MAX_DIGITS} step={1} value={rule.digits} onValue={(v) => onChange({ digits: Math.min(MAX_DIGITS, Math.max(1, Math.floor(v ?? 1))) })} />}</Field>
        <Field label="사이 글자">{(id) => <Select id={id} value={rule.separator} onValue={(separator) => onChange({ separator })} options={SEPARATORS} />}</Field>
      </div>
      <p className="num text-sm text-muted">
        예: {rule.placement === 'replace' ? `${rule.base}${rule.base ? rule.separator : ''}${padNumber(rule.start, rule.digits)}` : rule.placement === 'suffix' ? `지금이름${rule.separator}${padNumber(rule.start, rule.digits)}` : `${padNumber(rule.start, rule.digits)}${rule.separator}지금이름`}
      </p>
    </>
  )
}

function ReplaceEditor({ rule, error, onChange }: { rule: ReplaceRule; error?: string; onChange: (patch: Partial<ReplaceRule>) => void }) {
  return (
    <>
      <Field label="찾을 말" error={error} hint={rule.regex ? '정규식으로 찾습니다. 바꿀 말에 $1, $2 로 묶음을 쓸 수 있습니다.' : undefined}>
        {(id) => <TextInput id={id} value={rule.find} onChange={(e) => onChange({ find: e.target.value })} placeholder={rule.regex ? '예: (\\d+)번' : '예: IMG_'} aria-invalid={error ? true : undefined} spellCheck={false} />}
      </Field>
      <Field label="바꿀 말" hint="비워 두면 찾은 말을 지웁니다.">
        {(id) => <TextInput id={id} value={rule.replace} onChange={(e) => onChange({ replace: e.target.value })} spellCheck={false} />}
      </Field>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Checkbox checked={rule.regex} onChange={(regex) => onChange({ regex })} label="정규식 사용" />
        <Checkbox checked={rule.caseSensitive} onChange={(caseSensitive) => onChange({ caseSensitive })} label="대소문자 구분" />
      </div>
    </>
  )
}

function AffixEditor({ rule, onChange }: { rule: AffixRule; onChange: (patch: Partial<AffixRule>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="앞에 붙일 말">{(id) => <TextInput id={id} value={rule.prefix} onChange={(e) => onChange({ prefix: e.target.value })} placeholder="예: 신상_" />}</Field>
      <Field label="뒤에 붙일 말">{(id) => <TextInput id={id} value={rule.suffix} onChange={(e) => onChange({ suffix: e.target.value })} placeholder="예: _최종" />}</Field>
    </div>
  )
}

function DateEditor({ rule, onChange }: { rule: DateRule; onChange: (patch: Partial<DateRule>) => void }) {
  const today = dateStamp(Date.now())
  return (
    <>
      <Segmented
        label="어떤 날짜"
        block
        size="sm"
        value={rule.source}
        onValue={(source) => onChange({ source })}
        options={[
          { value: 'today', label: '오늘' },
          { value: 'modified', label: '파일 수정일' },
        ]}
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="넣을 자리">
          {(id) => (
            <Select
              id={id}
              value={rule.position}
              onValue={(position) => onChange({ position })}
              options={[
                { value: 'prefix', label: '이름 앞' },
                { value: 'suffix', label: '이름 뒤' },
              ]}
            />
          )}
        </Field>
        <Field label="사이 글자">{(id) => <Select id={id} value={rule.separator} onValue={(separator) => onChange({ separator })} options={SEPARATORS} />}</Field>
      </div>
      <p className="num text-sm text-muted">예: {rule.position === 'prefix' ? `${today}${rule.separator}지금이름` : `지금이름${rule.separator}${today}`}</p>
    </>
  )
}

function MappingEditor({ rule, info, fileCount, onChange }: { rule: MappingRule; info?: MappingInfo; fileCount: number; onChange: (patch: Partial<MappingRule>) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const readSheet = async (file: File) => {
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer())
      const sheet = book.Sheets[book.SheetNames[0]]
      const rows = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' }) : []
      const text = rowsToMappingText(rows)
      if (!text) return toast.warn('첫 번째 시트에서 내용을 찾지 못했습니다. A열에 원래 이름, B열에 새 이름을 적어 주세요.')
      onChange({ text })
      toast.success(`엑셀에서 ${text.split('\n').length}줄을 읽었습니다.`)
    } catch {
      toast.error('엑셀 파일을 읽지 못했습니다. xlsx·xls·csv 파일인지 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Field label="원래 이름과 새 이름" hint="엑셀에서 두 열(원래 이름, 새 이름)을 복사해 붙여넣으세요. 확장자는 적지 않아도 됩니다.">
        {(id) => <Textarea id={id} value={rule.text} onChange={(e) => onChange({ text: e.target.value })} placeholder={'IMG_0001\t봄 원피스 정면\nIMG_0002\t봄 원피스 뒷면'} rows={5} spellCheck={false} className="font-mono text-sm! whitespace-pre" />}
      </Field>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void readSheet(f)
        }}
      />
      <Button size="sm" icon={FileSpreadsheet} loading={busy} onClick={() => input.current?.click()}>
        엑셀 파일에서 불러오기
      </Button>
      {info && info.total > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm text-ink-2">
          <li>
            <span className="num font-semibold">{fmt.format(info.total)}줄</span> 읽음
            {info.skipped > 0 && <span className="text-muted"> · 칸이 모자란 {fmt.format(info.skipped)}줄은 건너뜀</span>}
          </li>
          {fileCount > 0 && (
            <li className={info.unmatchedFiles ? 'text-warn' : undefined}>
              {info.unmatchedFiles ? `목록에 없는 파일 ${fmt.format(info.unmatchedFiles)}개는 이름이 그대로입니다` : '모든 파일이 목록과 맞습니다'}
            </li>
          )}
          {fileCount > 0 && info.unused.length > 0 && (
            <li className="text-muted" title={info.unused.slice(0, 30).join('\n')}>
              맞는 파일이 없는 줄 {fmt.format(info.unused.length)}개 ({info.unused.slice(0, 2).join(', ')}
              {info.unused.length > 2 ? ' 등' : ''})
            </li>
          )}
        </ul>
      )}
    </>
  )
}

// ── 도구 ──────────────────────────────────────────────────
export default function RenameTool() {
  const preset = useTeamPresets().filename
  const [stored, setStored] = usePersistentState<Rule[] | null>('onbijjang:rename:rules', null)
  const rules = useMemo(() => normalizeRules(stored, preset) ?? [createRule('sequence', 'team-default', preset)], [stored, preset])
  const [items, setItems] = useState<Item[]>([])
  const [limitNote, setLimitNote] = useState<string | null>(null)
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [visible, setVisible] = useState(PAGE)
  const [zipName, setZipName] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const [fileOver, setFileOver] = useState(false)
  const { start, abort } = useAbortable()
  const busy = progress !== null

  const itemsRef = useRef(items)
  itemsRef.current = items
  const addFiles = useCallback((incoming: File[]) => {
    const next = [...itemsRef.current]
    let total = next.reduce((sum, it) => sum + it.file.size, 0)
    let overCount = 0
    let overSize = 0
    for (const file of incoming) {
      if (next.length >= MAX_FILES) overCount++
      else if (total + file.size > MAX_TOTAL_BYTES) overSize++
      else {
        next.push({ id: ++itemSeq, file })
        total += file.size
      }
    }
    const notes: string[] = []
    if (overCount) notes.push(`한 번에 ${fmt.format(MAX_FILES)}개까지 다룰 수 있어 ${fmt.format(overCount)}개는 넣지 않았습니다.`)
    if (overSize) notes.push(`합계 ${formatBytes(MAX_TOTAL_BYTES)}를 넘어 ${fmt.format(overSize)}개는 넣지 않았습니다.`)
    itemsRef.current = next
    setItems(next)
    setLimitNote(notes.length ? `${notes.join(' ')} 나눠서 작업해 주세요.` : null)
  }, [])
  useHandoffFiles('rename', addFiles)

  const infos = useMemo(() => items.map((it) => ({ name: it.file.name, lastModified: it.file.lastModified })), [items])
  const outcome = useMemo(() => computeRenames(infos, rules), [infos, rules])
  const totalBytes = useMemo(() => items.reduce((sum, it) => sum + it.file.size, 0), [items])
  const issueCount = outcome.errorCount + outcome.warnCount

  const listed = useMemo(() => {
    const all = items.map((item, index) => ({ item, index, row: outcome.rows[index] }))
    return onlyIssues ? all.filter((x) => x.row.issues.length > 0) : all
  }, [items, outcome, onlyIssues])
  const shown = listed.slice(0, visible)

  // ── 규칙 바꾸기 ──
  const patchRule = (id: string, patch: Partial<Rule>) => setStored(rules.map((r) => (r.id === id ? ({ ...r, ...patch } as Rule) : r)))
  const addRule = (type: RuleType) => setStored([...rules, createRule(type, newRuleId(), preset)])
  const removeRule = (id: string) => setStored(rules.filter((r) => r.id !== id))
  const moveRule = (index: number, delta: number) => setStored(moveItem(rules, index, index + delta))

  // ── 순서 바꾸기 ──
  const move = (index: number, to: number) => setItems((prev) => moveItem(prev, index, to))
  const dropOn = (targetId: number) => {
    if (dragId === null || dragId === targetId) return
    setItems((prev) => {
      const from = prev.findIndex((it) => it.id === dragId)
      const to = prev.findIndex((it) => it.id === targetId)
      return from < 0 || to < 0 ? prev : moveItem(prev, from, to)
    })
  }
  const sortByName = () => setItems((prev) => [...prev].sort((a, b) => naturalCompare(a.file.name, b.file.name)))
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  // ── 저장 ──
  const stamp = todayStamp()
  const saveZip = async () => {
    if (!items.length || outcome.errorCount) return
    const signal = start()
    setProgress(0)
    try {
      const blob = await zipRenamed(items.map((it, i) => ({ name: outcome.rows[i].next, file: it.file })), signal, setProgress)
      downloadBlob(blob, `${sanitizeFilename(zipName, `이름변경_${stamp}`)}.zip`)
      toast.success(`파일 ${fmt.format(items.length)}개를 새 이름으로 묶어 저장했습니다.`)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') toast.info('ZIP 만들기를 취소했습니다.')
      else toast.error('ZIP 을 만들지 못했습니다. 파일이 너무 크면 나눠서 저장해 주세요.')
    } finally {
      setProgress(null)
    }
  }
  const saveCsv = () => downloadBlob(new Blob(['﻿', toChangeCsv(outcome.rows)], { type: 'text/csv;charset=utf-8' }), `이름변경_내역_${stamp}.csv`)

  const panel = (
    <>
      <Section
        title="이름 규칙"
        hint="위에서부터 차례로 적용됩니다. 확장자는 바꾸지 않습니다."
        action={
          <Popover
            align="end"
            trigger={({ ref, ...props }) => (
              <span ref={ref} className="inline-flex">
                <Button size="sm" icon={Plus} {...props}>
                  규칙 추가
                </Button>
              </span>
            )}
          >
            {(close) =>
              RULE_TYPES.map((type) => (
                <MenuItem
                  key={type}
                  onClick={() => {
                    addRule(type)
                    close()
                  }}
                >
                  {RULE_LABEL[type]}
                </MenuItem>
              ))
            }
          </Popover>
        }
      >
        {rules.length === 0 && <p className="text-sm text-muted">규칙이 없어 이름이 그대로입니다. ‘규칙 추가’로 시작하세요.</p>}
        {stored !== null && (
          <Button size="sm" variant="ghost" icon={RotateCcw} className="self-start" onClick={() => setStored(null)}>
            팀 기본 규칙으로 되돌리기
          </Button>
        )}
      </Section>

      {rules.map((rule, index) => (
        <Section
          key={rule.id}
          title={<span className={clsx(!rule.enabled && 'text-faint line-through')}>{RULE_LABEL[rule.type]}</span>}
          action={
            <div className="flex items-center gap-0.5">
              <Checkbox checked={rule.enabled} onChange={(enabled) => patchRule(rule.id, { enabled })} label="사용" className="mr-1.5" />
              <IconButton icon={ArrowUp} size="sm" label="규칙을 위로" disabled={index === 0} onClick={() => moveRule(index, -1)} />
              <IconButton icon={ArrowDown} size="sm" label="규칙을 아래로" disabled={index === rules.length - 1} onClick={() => moveRule(index, 1)} />
              <IconButton icon={Trash2} size="sm" label="규칙 삭제" onClick={() => removeRule(rule.id)} />
            </div>
          }
        >
          {rule.enabled &&
            (rule.type === 'sequence' ? (
              <SequenceEditor rule={rule} onChange={(p) => patchRule(rule.id, p)} />
            ) : rule.type === 'replace' ? (
              <ReplaceEditor rule={rule} error={outcome.ruleErrors[rule.id]} onChange={(p) => patchRule(rule.id, p)} />
            ) : rule.type === 'affix' ? (
              <AffixEditor rule={rule} onChange={(p) => patchRule(rule.id, p)} />
            ) : rule.type === 'date' ? (
              <DateEditor rule={rule} onChange={(p) => patchRule(rule.id, p)} />
            ) : (
              <MappingEditor rule={rule} info={outcome.mapping[rule.id]} fileCount={items.length} onChange={(p) => patchRule(rule.id, p)} />
            ))}
        </Section>
      ))}

      <Section title="저장" hint="원본 파일은 그대로 두고, 새 이름을 붙인 사본을 ZIP 으로 묶습니다.">
        {outcome.errorCount > 0 && (
          <Callout tone="danger" title={`이름에 문제가 있는 파일 ${fmt.format(outcome.errorCount)}개`}>
            같은 이름이 겹치거나 Windows 에서 쓸 수 없는 문자가 있습니다. 순번 규칙을 더하거나 찾아 바꾸기로 고친 뒤 저장하세요.
          </Callout>
        )}
        {outcome.errorCount === 0 && outcome.warnCount > 0 && (
          <Callout tone="warn" title={`확인할 파일 ${fmt.format(outcome.warnCount)}개`}>
            매핑 목록에 없는 파일은 원래 이름 그대로 저장됩니다.
          </Callout>
        )}
        <Field label="ZIP 이름">{(id) => <TextInput id={id} value={zipName} onChange={(e) => setZipName(e.target.value)} placeholder={`이름변경_${stamp}`} maxLength={80} />}</Field>
        {busy ? (
          <div className="flex flex-col gap-2">
            <Progress value={progress} label="ZIP 으로 묶는 중" />
            <Button icon={X} onClick={abort}>
              취소
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="lg" block icon={FileArchive} disabled={!items.length || outcome.errorCount > 0} onClick={saveZip}>
              ZIP 으로 저장{items.length ? ` (${fmt.format(items.length)}개)` : ''}
            </Button>
            <Button block icon={FileDown} disabled={!items.length} onClick={saveCsv}>
              변경 내역 CSV 받기
            </Button>
          </div>
        )}
      </Section>
    </>
  )

  return (
    <ToolLayout panel={panel}>
      <div
        className="flex flex-col gap-4"
        onDragOver={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setFileOver(true)
        }}
        onDragLeave={() => setFileOver(false)}
        onDrop={(e) => {
          setFileOver(false)
          if (!hasFiles(e) || e.defaultPrevented) return
          e.preventDefault()
          addFiles(Array.from(e.dataTransfer.files))
        }}
      >
        <Dropzone
          compact={items.length > 0}
          onFiles={addFiles}
          disabled={busy}
          icon={FilePenLine}
          title={items.length ? '파일 더 넣기' : '이름을 바꿀 파일들을 끌어다 놓으세요'}
          hint={`최대 ${fmt.format(MAX_FILES)}개 · 합계 ${formatBytes(MAX_TOTAL_BYTES)} 이하 · 어떤 종류의 파일이든`}
        />
        {limitNote && (
          <Callout tone="warn" title="일부 파일을 넣지 못했습니다">
            {limitNote}
          </Callout>
        )}
        <Panel className={clsx('overflow-hidden transition-colors duration-150', fileOver && 'border-brand')}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-ink-2">
              <span className="num font-bold text-ink">{fmt.format(items.length)}개</span>
              <span className="num text-muted"> · {formatBytes(totalBytes)}</span>
              {items.length > 0 && <span className="num text-muted"> · 이름이 바뀌는 파일 {fmt.format(outcome.changedCount)}개</span>}
              {issueCount > 0 && <span className={clsx('num font-semibold', outcome.errorCount ? 'text-danger' : 'text-warn')}> · 확인 필요 {fmt.format(issueCount)}개</span>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox checked={onlyIssues} onChange={setOnlyIssues} label="확인 필요한 것만" disabled={!issueCount && !onlyIssues} />
              <Button size="sm" icon={ArrowDownAZ} disabled={items.length < 2 || busy} onClick={sortByName}>
                원본 이름순
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={Trash2}
                disabled={!items.length || busy}
                onClick={() => {
                  setItems([])
                  setLimitNote(null)
                  setVisible(PAGE)
                }}
              >
                모두 비우기
              </Button>
            </div>
          </div>
          {items.length === 0 ? (
            <EmptyState icon={FilePenLine} title="아직 파일이 없습니다">
              파일을 넣으면 바뀌기 전 이름과 바뀐 뒤 이름을 나란히 보여 줍니다. 원본 파일은 건드리지 않습니다.
            </EmptyState>
          ) : listed.length === 0 ? (
            <EmptyState title="확인이 필요한 파일이 없습니다">모든 이름이 겹치지 않고 Windows 에서 쓸 수 있습니다.</EmptyState>
          ) : (
            <div className="@container overflow-x-auto">
              <table className="w-full min-w-[300px] table-fixed text-sm">
                <thead className="bg-paper text-left text-muted">
                  <tr>
                    <th className="w-9 py-2 pl-2" />
                    <th className="w-10 px-1 py-2 text-right font-semibold">순서</th>
                    <th className="px-3 py-2 font-semibold">
                      <span className="flex items-center gap-1.5">
                        바뀌기 전 <ArrowRight className="size-3.5" aria-hidden /> 바뀐 뒤
                      </span>
                    </th>
                    <th className="w-[6.75rem] px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ item, index, row }) => (
                    <tr
                      key={item.id}
                      onDragOver={(e) => {
                        if (dragId === null) return
                        e.preventDefault()
                        if (overId !== item.id) setOverId(item.id)
                      }}
                      onDrop={(e) => {
                        if (dragId === null) return
                        e.preventDefault()
                        dropOn(item.id)
                        setDragId(null)
                        setOverId(null)
                      }}
                      className={clsx('border-t border-line align-top transition-colors duration-100 hover:bg-sunken', dragId === item.id && 'opacity-40', overId === item.id && dragId !== item.id && 'bg-brand-soft')}
                    >
                      <td className="py-1.5 pl-2">
                        <span
                          draggable={!busy}
                          onDragStart={(e) => {
                            setDragId(item.id)
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', row.original)
                            const tr = e.currentTarget.closest('tr')
                            if (tr) e.dataTransfer.setDragImage(tr, 12, 12)
                          }}
                          onDragEnd={() => {
                            setDragId(null)
                            setOverId(null)
                          }}
                          title="끌어서 순서 바꾸기"
                          aria-hidden
                          className="flex size-7 cursor-grab items-center justify-center rounded-xs text-faint hover:bg-line hover:text-ink-2 active:cursor-grabbing"
                        >
                          <GripVertical className="size-4" />
                        </span>
                      </td>
                      <td className="num px-1 py-2.5 text-right text-muted">{index + 1}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-x-3 gap-y-1 @xl:flex-row">
                          <p className="min-w-0 break-all text-ink-2 @xl:flex-1">
                            {row.original}
                            <span className="num ml-1.5 whitespace-nowrap text-2xs text-faint">{formatBytes(item.file.size)}</span>
                          </p>
                          <div className="flex min-w-0 gap-1.5 @xl:flex-1">
                            <ArrowRight className="mt-0.5 size-4 shrink-0 text-faint" aria-label="바뀐 뒤" />
                            <div className="min-w-0">
                              <p className={clsx('break-all', row.changed ? 'font-semibold text-ink' : 'text-muted')}>{row.next}</p>
                              {row.issues.length > 0 && (
                                <p className="mt-1 flex flex-wrap gap-1">
                                  {row.issues.map((issue) => (
                                    <span key={issue.code} className={clsx('rounded-full px-2 py-0.5 text-2xs font-bold', issue.level === 'error' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn')}>
                                      {issue.message}
                                    </span>
                                  ))}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex justify-end">
                          <IconButton icon={ArrowUp} size="sm" label={`${row.original} 위로`} disabled={index === 0 || busy} onClick={() => move(index, index - 1)} />
                          <IconButton icon={ArrowDown} size="sm" label={`${row.original} 아래로`} disabled={index === items.length - 1 || busy} onClick={() => move(index, index + 1)} />
                          <IconButton icon={X} size="sm" label={`${row.original} 빼기`} disabled={busy} onClick={() => setItems((prev) => prev.filter((it) => it.id !== item.id))} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {listed.length > shown.length && (
            <div className="flex items-center justify-center gap-3 border-t border-line px-4 py-3">
              <span className="num text-sm text-muted">
                {fmt.format(shown.length)} / {fmt.format(listed.length)}개 표시 중
              </span>
              <Button size="sm" onClick={() => setVisible((v) => v + PAGE)}>
                {fmt.format(Math.min(PAGE, listed.length - shown.length))}개 더 보기
              </Button>
            </div>
          )}
        </Panel>
      </div>
    </ToolLayout>
  )
}
