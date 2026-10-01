import clsx from 'clsx'
import { Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Dialog, EmptyState, Field, IconButton, NumberInput, TextInput } from '@/ui'
import { cellOutlineCmds, cellRect, cellsPerSheet, cmdsToD, deriveSheet, newId, sheetProblems, sheetSummary, type SheetSpec } from './model'
import { SHEETS, searchSheets } from './sheets'

/** 용지 한 장의 칸 배치를 작게 그린 그림(비율 그대로). */
export function SheetDiagram({ sheet, className }: { sheet: SheetSpec; className?: string }) {
  const d = Array.from({ length: cellsPerSheet(sheet) }, (_, i) => cellOutlineCmds({ ...sheet, radius: Math.min(sheet.radius, 3) }, cellRect(sheet, i)).map(cmdsToD).join('')).join('')
  return (
    <svg viewBox={`-2 -2 ${sheet.pageW + 4} ${sheet.pageH + 4}`} className={className} aria-hidden>
      <rect x={0} y={0} width={sheet.pageW} height={sheet.pageH} rx={3} fill="var(--color-surface)" stroke="var(--color-line-strong)" strokeWidth={2.5} />
      <path d={d} fill="var(--color-brand-soft)" fillRule="evenodd" stroke="var(--color-brand)" strokeWidth={1.6} />
    </svg>
  )
}

interface SheetPickerProps {
  open: boolean
  onClose: () => void
  currentId: string
  custom: SheetSpec[]
  onPick: (sheet: SheetSpec) => void
  onAddCustom: (sheet: SheetSpec) => void
  onRemoveCustom: (id: string) => void
}

const EMPTY_FORM = { name: '', cols: 2 as number | null, rows: 5 as number | null, labelW: 90 as number | null, labelH: 50 as number | null }

export function SheetPicker({ open, onClose, currentId, custom, onPick, onAddCustom, onRemoveCustom }: SheetPickerProps) {
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const found = useMemo(() => ({ custom: searchSheets(custom, query), builtin: searchSheets(SHEETS, query) }), [custom, query])

  const draft = useMemo(() => {
    if (!form.cols || !form.rows || !form.labelW || !form.labelH) return null
    return deriveSheet({ id: 'draft', name: form.name.trim() || `내 규격 ${form.cols}×${form.rows}`, cols: form.cols, rows: form.rows, labelW: form.labelW, labelH: form.labelH, radius: 2 })
  }, [form])
  const draftProblems = draft ? sheetProblems(draft) : []

  const addCustom = () => {
    if (!draft || draftProblems.length) return
    const sheet: SheetSpec = { ...draft, id: `custom-${newId()}`, custom: true }
    onAddCustom(sheet)
    onPick(sheet)
    setAdding(false)
    setForm(EMPTY_FORM)
    onClose()
  }

  const card = (sheet: SheetSpec) => {
    const selected = sheet.id === currentId
    return (
      <div key={sheet.id} className="relative">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => {
            onPick(sheet)
            onClose()
          }}
          className={clsx(
            'flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors duration-150',
            selected ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong hover:bg-sunken',
          )}
        >
          <SheetDiagram sheet={sheet} className="h-16 w-12 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink">{sheet.name}</span>
            <span className="num block text-xs text-muted">{sheetSummary(sheet)}</span>
          </span>
        </button>
        {sheet.custom && <IconButton icon={Trash2} label={`${sheet.name} 삭제`} size="sm" className="absolute right-1.5 top-1.5" onClick={() => onRemoveCustom(sheet.id)} />}
      </div>
    )
  }

  const total = found.custom.length + found.builtin.length
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="라벨 용지 고르기"
      size="lg"
      footer={
        adding ? (
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              취소
            </Button>
            <Button variant="primary" icon={Plus} disabled={!draft || draftProblems.length > 0} onClick={addCustom}>
              이 규격 추가
            </Button>
          </>
        ) : (
          <Button icon={Plus} onClick={() => setAdding(true)}>
            직접 규격 추가
          </Button>
        )
      }
    >
      {adding ? (
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="grid flex-1 grid-cols-2 gap-3">
            <Field label="이름" className="col-span-2">
              {(id) => <TextInput id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 창고 선반 라벨" maxLength={30} />}
            </Field>
            <Field label="가로 칸 수">{(id) => <NumberInput id={id} value={form.cols} onValue={(cols) => setForm({ ...form, cols })} min={1} max={30} step={1} />}</Field>
            <Field label="세로 칸 수">{(id) => <NumberInput id={id} value={form.rows} onValue={(rows) => setForm({ ...form, rows })} min={1} max={60} step={1} />}</Field>
            <Field label="칸 너비">{(id) => <NumberInput id={id} value={form.labelW} onValue={(labelW) => setForm({ ...form, labelW })} min={1} max={210} step={0.1} unit="mm" />}</Field>
            <Field label="칸 높이">{(id) => <NumberInput id={id} value={form.labelH} onValue={(labelH) => setForm({ ...form, labelH })} min={1} max={297} step={0.1} unit="mm" />}</Field>
            <p className="col-span-2 text-sm text-muted">여백과 간격은 A4 가운데에 오도록 계산합니다. 추가한 뒤 ‘여백·간격 고치기’에서 실제 용지에 맞게 다듬을 수 있습니다.</p>
            {draftProblems.map((p) => (
              <p key={p} className="col-span-2 text-sm text-danger" role="alert">
                {p}
              </p>
            ))}
          </div>
          <div className="flex shrink-0 items-start justify-center">{draft && <SheetDiagram sheet={draft} className="h-52 w-36" />}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="칸 수나 크기로 찾기 (예: 21, 63, 3x7, CD)" aria-label="용지 찾기" className="pl-9" />
          </div>
          {total === 0 ? (
            <EmptyState icon={Search} title="맞는 용지가 없습니다" action={<Button icon={Plus} onClick={() => setAdding(true)}>직접 규격 추가</Button>}>
              칸 수(21)나 칸 크기(63)로 다시 찾아보거나, 용지 포장에 적힌 크기로 직접 추가하세요.
            </EmptyState>
          ) : (
            <>
              {found.custom.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-bold text-ink">내 규격</h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{found.custom.map(card)}</div>
                </section>
              )}
              <section className="flex flex-col gap-2">
                {found.custom.length > 0 && <h3 className="text-sm font-bold text-ink">기본 규격</h3>}
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{found.builtin.map(card)}</div>
              </section>
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}
