import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Plus, Table2, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, EmptyState, IconButton, Panel } from '@/ui'
import type { DataTable } from './model'

const PAGE_SIZE = 50
const CELL_INPUT = 'h-8 w-full min-w-28 rounded-xs border border-transparent bg-transparent px-2 text-sm text-ink transition-colors duration-150 hover:border-line-strong focus:border-brand focus:bg-surface focus:outline-none'

interface DataTableEditorProps {
  table: DataTable
  /** 미리보기에서 고른 칸에 해당하는 행 */
  highlight: Set<number>
  onCell: (row: number, col: number, value: string) => void
  onRenameColumn: (col: number, name: string) => void
  onRemoveColumn: (col: number) => void
  onAddColumn: () => void
  onAddRow: () => void
  onRemoveRow: (row: number) => void
}

/** 열 이름 칸 — 다 쓴 뒤(포커스를 떠나거나 Enter)에 한 번만 바꾼다. 디자인의 {열이름} 도 같이 바뀌기 때문. */
function ColumnName({ name, onRename }: { name: string; onRename: (next: string) => void }) {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const commit = () => {
    const next = draft.trim()
    if (next && next !== name) onRename(next)
    else setDraft(name)
  }
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(name)
      }}
      aria-label={`열 이름 ${name}`}
      maxLength={30}
      className={clsx(CELL_INPUT, 'font-bold')}
    />
  )
}

/** 라벨 내용 표. 행 하나가 라벨 한 장이고, 빈 행은 빈 칸으로 남는다. */
export function DataTableEditor({ table, highlight, onCell, onRenameColumn, onRemoveColumn, onAddColumn, onAddRow, onRemoveRow }: DataTableEditorProps) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(table.rows.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  // 미리보기에서 칸을 고르면 그 행이 있는 쪽으로 넘긴다.
  const firstHighlight = highlight.size ? Math.min(...highlight) : -1
  useEffect(() => {
    if (firstHighlight >= 0) setPage(Math.floor(firstHighlight / PAGE_SIZE))
  }, [firstHighlight])

  if (!table.columns.length) {
    return (
      <Panel>
        <EmptyState icon={Table2} title="아직 내용이 없습니다">
          엑셀에서 칸을 복사해 오른쪽 ‘붙여넣기’ 칸에 넣거나 엑셀 파일을 불러오세요. 미리보기에서 칸을 골라 직접 적어도 됩니다.
        </EmptyState>
      </Panel>
    )
  }
  const start = current * PAGE_SIZE
  const rows = table.rows.slice(start, start + PAGE_SIZE)
  return (
    <Panel className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-sm font-bold text-ink">
          라벨 내용 <span className="num font-medium text-muted">{table.rows.length}줄</span>
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={Plus} onClick={onAddColumn}>
            열 추가
          </Button>
          <Button size="sm" variant="ghost" icon={Plus} onClick={onAddRow}>
            줄 추가
          </Button>
        </div>
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-sunken">
            <tr>
              <th scope="col" className="num w-12 px-2 py-1.5 text-right text-xs font-semibold text-muted">
                번호
              </th>
              {table.columns.map((name, c) => (
                <th key={c} scope="col" className="border-l border-line px-1 py-1 text-left">
                  <div className="flex items-center gap-0.5">
                    <ColumnName name={name} onRename={(next) => onRenameColumn(c, next)} />
                    <IconButton icon={X} label={`‘${name}’ 열 지우기`} size="sm" onClick={() => onRemoveColumn(c)} />
                  </div>
                </th>
              ))}
              <th scope="col" className="w-10">
                <span className="sr-only">줄 지우기</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const r = start + i
              return (
                <tr key={r} className={clsx('border-t border-line', highlight.has(r) ? 'bg-brand-soft' : 'hover:bg-paper')}>
                  <td className="num px-2 text-right text-xs text-muted">{r + 1}</td>
                  {table.columns.map((name, c) => (
                    <td key={c} className="border-l border-line px-1 py-0.5">
                      <input value={row[c] ?? ''} onChange={(e) => onCell(r, c, e.target.value)} aria-label={`${r + 1}번째 줄 ${name}`} className={CELL_INPUT} />
                    </td>
                  ))}
                  <td className="px-1">
                    <IconButton icon={Trash2} label={`${r + 1}번째 줄 지우기`} size="sm" onClick={() => onRemoveRow(r)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2">
          <IconButton icon={ChevronLeft} label="앞 50줄" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)} />
          <span className="num text-sm text-muted">
            {start + 1}–{Math.min(start + PAGE_SIZE, table.rows.length)} / {table.rows.length}
          </span>
          <IconButton icon={ChevronRight} label="다음 50줄" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} />
        </div>
      )}
    </Panel>
  )
}
