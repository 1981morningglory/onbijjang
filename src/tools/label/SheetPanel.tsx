import { ClipboardPaste, Eraser, FileSpreadsheet, LayoutGrid, ListOrdered, Rows3, RotateCcw, Save } from 'lucide-react'
import { useRef, useState } from 'react'
import { usePersistentState } from '@/lib/hooks'
import { Button, Callout, Field, NumberInput, Section, Segmented, Select, Switch, Textarea, TextInput } from '@/ui'
import type { PasteMode } from './docops'
import { boundColumn, contentOf, usedColumns } from './factory'
import { SERIAL_KEY, cellsPerSheet, formatSerial, marginBottom, marginRight, round2, sheetProblems, sheetSummary, type LabelDoc, type SheetField, type planDoc } from './model'
import { SheetDiagram } from './SheetPicker'

const CUSTOM = '__custom__'

export interface SheetPanelProps {
  doc: LabelDoc
  plan: ReturnType<typeof planDoc>
  titles: Record<string, string>
  update: (fn: (doc: LabelDoc) => LabelDoc, tag?: string) => void
  onOpenPicker: () => void
  onSheetField: (field: SheetField, value: number) => void
  /** 기본 규격에서 값을 고친 경우에만 */
  onResetSheet: (() => void) | null
  onSaveCustom: () => void
  pasteMode: PasteMode
  setPasteMode: (mode: PasteMode) => void
  pasteColumn: string
  setPasteColumn: (column: string) => void
  onPasteText: (text: string) => void
  onImportFile: (file: File) => void
  importing: boolean
  onClearData: () => void
  onBind: (elementId: string, column: string) => void
  onAddColumnTexts: () => void
  onAddSerialText: () => void
  /** 미리보기에서 고른 칸의 설명("3번째 칸") — 없으면 null */
  selectionNote: string | null
  /** 고른 칸에 해당하는 표의 행 */
  selectedRows: number[]
  onSetSelectedValue: (column: string, value: string) => void
}

export function SheetPanel(p: SheetPanelProps) {
  const { doc, plan, update } = p
  const { sheet } = doc
  const [tuning, setTuning] = usePersistentState('onbijjang:label:tuning', false)
  const [draft, setDraft] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const perSheet = cellsPerSheet(sheet)
  const problems = sheetProblems(sheet)
  const columns = doc.table.columns
  const unused = columns.filter((c) => !usedColumns(doc.design, columns).has(c))
  const bindable = doc.design.filter((el) => el.type === 'text' || el.type === 'barcode')
  const printed = plan.labels.filter(Boolean).length

  const dim = (label: string, field: SheetField, value: number, opts: { min?: number; max?: number; step?: number; unit?: string } = {}) => (
    <Field label={label}>
      {(id) => <NumberInput id={id} value={round2(value)} onValue={(v) => v !== null && p.onSheetField(field, v)} step={opts.step ?? 0.1} min={opts.min} max={opts.max} unit={opts.unit ?? 'mm'} />}
    </Field>
  )

  return (
    <>
      {doc.mode === 'data' && p.selectedRows.length > 0 && (
        <Section title="고른 칸의 내용" hint={p.selectedRows.length > 1 ? `${p.selectedRows.length}칸에 같은 내용을 넣습니다.` : undefined}>
          {(columns.length ? columns : ['내용']).map((column) => {
            const ci = columns.indexOf(column)
            const values = new Set(p.selectedRows.map((r) => (ci >= 0 ? (doc.table.rows[r]?.[ci] ?? '') : '')))
            const value = values.size === 1 ? [...values][0] : ''
            return (
              <Field key={column} label={column}>
                {(id) => <TextInput id={id} value={value} placeholder={values.size > 1 ? '칸마다 다른 값' : '이 칸에 적을 내용'} onChange={(e) => p.onSetSelectedValue(column, e.target.value)} />}
              </Field>
            )
          })}
        </Section>
      )}

      <Section title="용지">
        <div className="flex items-center gap-3">
          <SheetDiagram sheet={sheet} className="h-20 w-14 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-ink">{sheet.name}</p>
            <p className="num text-sm text-muted">{sheetSummary(sheet)}</p>
            <Button size="sm" icon={LayoutGrid} className="mt-1.5" onClick={p.onOpenPicker}>
              용지 바꾸기
            </Button>
          </div>
        </div>
        <Switch checked={tuning} onChange={setTuning} label="여백·간격 고치기" hint="제조사마다 조금씩 달라 실제 용지에 맞게 고칠 수 있습니다." />
        {tuning && (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              {dim('칸 너비', 'labelW', sheet.labelW, { min: 1, max: 210 })}
              {dim('칸 높이', 'labelH', sheet.labelH, { min: 1, max: 297 })}
              {dim('가로 칸 수', 'cols', sheet.cols, { min: 1, max: 30, step: 1, unit: '칸' })}
              {dim('세로 칸 수', 'rows', sheet.rows, { min: 1, max: 60, step: 1, unit: '칸' })}
              {dim('왼쪽 여백', 'marginLeft', sheet.marginLeft)}
              {dim('오른쪽 여백', 'marginRight', marginRight(sheet))}
              {dim('위 여백', 'marginTop', sheet.marginTop)}
              {dim('아래 여백', 'marginBottom', marginBottom(sheet))}
              {dim('가로 간격', 'gapX', sheet.gapX, { min: 0 })}
              {dim('세로 간격', 'gapY', sheet.gapY, { min: 0 })}
              {sheet.shape === 'cd' ? dim('가운데 구멍', 'hole', sheet.hole, { min: 0 }) : dim('모서리 둥글기', 'radius', sheet.radius, { min: 0, step: 0.5 })}
            </div>
            <p className="text-sm text-muted">오른쪽·아래 여백을 바꾸면 칸 간격이 그에 맞게 조정됩니다.</p>
            <div className="flex flex-wrap gap-2">
              {p.onResetSheet && (
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={p.onResetSheet}>
                  처음 값으로
                </Button>
              )}
              <Button size="sm" icon={Save} onClick={p.onSaveCustom}>
                내 규격으로 저장
              </Button>
            </div>
          </>
        )}
        {problems.length > 0 && (
          <Callout tone="warn" title="칸이 용지를 벗어납니다">
            {problems.map((msg) => (
              <p key={msg}>{msg}</p>
            ))}
          </Callout>
        )}
      </Section>

      <Section title="내용">
        <Segmented
          label="내용 넣는 방법"
          block
          value={doc.mode}
          onValue={(mode) => update((d) => ({ ...d, mode }))}
          options={[
            { value: 'same', label: '모든 칸 동일' },
            { value: 'data', label: '칸마다 다르게' },
          ]}
        />
        {doc.mode === 'same' ? (
          <Field label="찍을 장수" hint={`비워 두면 첫 장의 남은 ${plan.free0.length}칸을 가득 채웁니다.`}>
            {(id) => <NumberInput id={id} value={doc.copies} onValue={(copies) => update((d) => ({ ...d, copies: copies === null ? null : Math.max(0, Math.min(5000, Math.floor(copies))) }), 'copies')} min={0} max={5000} step={1} unit="장" placeholder="가득" />}
          </Field>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink-2">엑셀에서 붙여넣기</span>
              <Segmented
                label="붙여넣는 방법"
                block
                size="sm"
                value={p.pasteMode}
                onValue={p.setPasteMode}
                options={[
                  { value: 'cells', label: '셀 하나 = 한 칸' },
                  { value: 'rows', label: '한 줄 = 한 장' },
                ]}
              />
              <p className="text-sm text-muted">{p.pasteMode === 'cells' ? '복사한 셀을 왼쪽 위부터 가로로 읽어 라벨 한 칸씩 채웁니다.' : '첫 줄은 열 이름으로 쓰고, 그 아래 한 줄이 라벨 한 장이 됩니다.'}</p>
            </div>
            {p.pasteMode === 'cells' && columns.length > 1 && (
              <Field label="채울 열">{(id) => <Select id={id} value={columns.includes(p.pasteColumn) ? p.pasteColumn : columns[0]} onValue={p.setPasteColumn} options={columns.map((c) => ({ value: c, label: c }))} />}</Field>
            )}
            <Field label="붙여넣을 내용" hint={p.selectionNote ? `미리보기에서 고른 ${p.selectionNote}부터 채웁니다.` : '지금 내용을 통째로 바꿉니다. 미리보기에서 칸을 고르면 그 칸부터 채웁니다.'}>
              {(id) => (
                <Textarea
                  id={id}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text/plain')
                    if (!text) return
                    e.preventDefault()
                    setDraft('')
                    p.onPasteText(text)
                  }}
                  rows={3}
                  className="min-h-20!"
                  placeholder="여기를 누르고 Ctrl+V. 직접 적을 때는 한 줄에 라벨 하나씩"
                  spellCheck={false}
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={ClipboardPaste}
                disabled={!draft.trim()}
                onClick={() => {
                  p.onPasteText(draft)
                  setDraft('')
                }}
              >
                칸에 넣기
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.txt"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) p.onImportFile(file)
                }}
              />
              <Button size="sm" icon={FileSpreadsheet} loading={p.importing} onClick={() => fileInput.current?.click()}>
                엑셀 파일 불러오기
              </Button>
            </div>
            <p className="-mt-1 text-sm text-muted">파일은 첫 시트를 읽고, 첫 줄을 열 이름으로 씁니다(xlsx·xls·csv, 10MB 이하).</p>

            {columns.length > 0 && bindable.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-line bg-paper p-3">
                <p className="text-sm font-bold text-ink">열 연결</p>
                <p className="-mt-1 text-sm text-muted">디자인의 글자·바코드가 표의 어느 열 값을 쓸지 고릅니다.</p>
                {bindable.map((el) => {
                  const bound = boundColumn(el)
                  const value = bound !== null && (columns.includes(bound) || bound === SERIAL_KEY) ? bound : CUSTOM
                  return (
                    <Field key={el.id} label={p.titles[el.id]}>
                      {(id) => (
                        <Select
                          id={id}
                          value={value}
                          onValue={(v) => v !== CUSTOM && p.onBind(el.id, v)}
                          options={[
                            { value: CUSTOM, label: value === CUSTOM ? `직접 적은 내용: ${(contentOf(el) ?? '').slice(0, 18) || '(비어 있음)'}` : '직접 적은 내용', disabled: value !== CUSTOM },
                            ...columns.map((c) => ({ value: c, label: `열: ${c}` })),
                            { value: SERIAL_KEY, label: '연번 (001, 002 …)' },
                          ]}
                        />
                      )}
                    </Field>
                  )
                })}
                {unused.length > 0 && (
                  <Button size="sm" icon={Rows3} className="self-start" onClick={p.onAddColumnTexts}>
                    안 쓰인 열 {unused.length}개를 글자로 추가
                  </Button>
                )}
              </div>
            )}

            <Field label="같은 내용 반복" hint="한 줄을 몇 장씩 찍을지 정합니다.">
              {(id) => <NumberInput id={id} value={doc.repeat} onValue={(v) => v !== null && update((d) => ({ ...d, repeat: Math.max(1, Math.min(1000, Math.floor(v))) }), 'repeat')} min={1} max={1000} step={1} unit="장씩" />}
            </Field>
            {doc.table.rows.length > 0 && (
              <Button size="sm" variant="danger" icon={Eraser} className="self-start" onClick={p.onClearData}>
                내용 모두 지우기
              </Button>
            )}
          </>
        )}

        <Field label="인쇄를 시작할 칸" hint={`쓰다 남은 용지라면 첫 장에서 몇 번째 칸부터 찍을지 정합니다(1–${perSheet}). 미리보기에서 칸을 골라 정해도 됩니다.`}>
          {(id) => <NumberInput id={id} value={doc.startCell + 1} onValue={(v) => v !== null && update((d) => ({ ...d, startCell: Math.max(0, Math.min(perSheet - 1, Math.floor(v) - 1)) }), 'startCell')} min={1} max={perSheet} step={1} unit="번째" />}
        </Field>
        <p className="num -mt-1 text-sm text-ink-2">
          라벨 {printed}장 · 용지 {plan.pages}장
        </p>
      </Section>

      <Section title="연번" hint={`글자나 바코드 값에 {${SERIAL_KEY}} 을 넣으면 라벨마다 번호가 오릅니다.`}>
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="시작 번호">{(id) => <NumberInput id={id} value={doc.serial.start} onValue={(v) => v !== null && update((d) => ({ ...d, serial: { ...d.serial, start: Math.floor(v) } }), 'serial-start')} step={1} />}</Field>
          <Field label="자릿수">{(id) => <NumberInput id={id} value={doc.serial.digits} onValue={(v) => v !== null && update((d) => ({ ...d, serial: { ...d.serial, digits: Math.max(1, Math.min(12, Math.floor(v))) } }), 'serial-digits')} min={1} max={12} step={1} />}</Field>
          <Field label="증가">{(id) => <NumberInput id={id} value={doc.serial.step} onValue={(v) => v !== null && v !== 0 && update((d) => ({ ...d, serial: { ...d.serial, step: Math.floor(v) || 1 } }), 'serial-step')} step={1} />}</Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={ListOrdered} onClick={p.onAddSerialText}>
            연번 글자 넣기
          </Button>
          <span className="num text-sm text-muted">
            {formatSerial(doc.serial, 0)}, {formatSerial(doc.serial, 1)}, {formatSerial(doc.serial, 2)} …
          </span>
        </div>
      </Section>

      <Section title="인쇄 설정">
        <Switch checked={doc.print.cutLines} onChange={(cutLines) => update((d) => ({ ...d, print: { ...d.print, cutLines } }))} label="칼선 함께 찍기" hint="칸 테두리를 가는 선으로 찍습니다. 일반 종이에 먼저 뽑아 라벨지와 겹쳐 볼 때 켜세요." />
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="가로 위치 보정">{(id) => <NumberInput id={id} value={doc.print.offsetX} onValue={(v) => update((d) => ({ ...d, print: { ...d.print, offsetX: Math.max(-20, Math.min(20, v ?? 0)) } }), 'offsetX')} min={-20} max={20} step={0.1} unit="mm" />}</Field>
          <Field label="세로 위치 보정">{(id) => <NumberInput id={id} value={doc.print.offsetY} onValue={(v) => update((d) => ({ ...d, print: { ...d.print, offsetY: Math.max(-20, Math.min(20, v ?? 0)) } }), 'offsetY')} min={-20} max={20} step={0.1} unit="mm" />}</Field>
        </div>
        <p className="text-sm text-muted">인쇄가 왼쪽으로 1mm 밀려 나오면 가로에 1, 위로 밀리면 세로에 1 을 넣습니다(+ 는 오른쪽·아래로 옮김).</p>
        <Callout tone="info" title="실제 크기로 뽑으려면">
          인쇄 창에서 용지 A4, 배율 100%(기본값), 여백 ‘없음’으로 두세요. ‘용지에 맞춤’이 켜져 있으면 칸 위치가 어긋납니다.
        </Callout>
      </Section>
    </>
  )
}
