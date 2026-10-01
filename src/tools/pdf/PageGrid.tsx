/** 작업대: 올린 문서 목록 + 쪽 미리보기 격자(고르기·범위 입력·끌어서 순서 바꾸기·회전·삭제). */
import clsx from 'clsx'
import { ArrowLeft, ArrowRight, Check, FileText, Image as ImageIcon, ListChecks, Lock, RotateCcw, RotateCw, Trash2, X, ZoomIn } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { formatBytes } from '@/lib/files'
import { useObjectUrl } from '@/lib/hooks'
import { Badge, Button, Dialog, IconButton, MenuItem, Popover, Spinner, Stage, TextInput, toast } from '@/ui'
import type { PaperSettings } from './geometry'
import { parseRanges } from './ranges'
import { previewBlob, thumbUrl } from './render'
import { clearWorkspace, movePages, nudgePages, removePages, removeSource, rotatePages, selectWhere, toggleSelect, useWorkspace, type PageItem, type Source } from './store'

/** 원본 순서대로 A, B, C … (문서가 여럿일 때 어느 문서의 쪽인지 알아보게) */
const letterOf = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (Math.floor(i / 26) - 1))}${String.fromCharCode(65 + (i % 26))}`)

export function Workspace({ paper }: { paper: PaperSettings }) {
  const sources = useWorkspace((s) => s.sources)
  const sourceOrder = useWorkspace((s) => s.sourceOrder)
  const pages = useWorkspace((s) => s.pages)
  const busy = useWorkspace((s) => s.job !== null)
  const [range, setRange] = useState('')
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PageItem | null>(null)
  const [drag, setDrag] = useState<Set<string> | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null)

  const selected = useMemo(() => new Set(pages.filter((p) => p.selected).map((p) => p.id)), [pages])
  const letters = useMemo(() => new Map(sourceOrder.map((id, i) => [id, letterOf(i)])), [sourceOrder])
  const many = sourceOrder.length > 1
  /** 회전·옮기기는 고른 쪽에, 고른 쪽이 없으면 전체에 */
  const acting = selected.size ? selected : new Set(pages.map((p) => p.id))

  const applyRange = () => {
    const r = parseRanges(range, pages.length)
    setRangeError(r.error)
    if (r.error) return
    if (!r.indices.length) return void toast.info('고를 쪽 번호를 적어 주세요. 예: 1-3,5')
    const pick = new Set(r.indices)
    selectWhere((_p, i) => pick.has(i))
  }

  const onDragStart = (e: DragEvent, page: PageItem) => {
    const ids = page.selected ? new Set(selected) : new Set([page.id])
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `${ids.size}쪽`)
    setDrag(ids)
  }
  const onDragOver = (e: DragEvent, page: PageItem) => {
    if (!drag) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientX > rect.left + rect.width / 2
    if (dropAt?.id !== page.id || dropAt.after !== after) setDropAt({ id: page.id, after })
  }
  const onDrop = (e: DragEvent) => {
    if (!drag) return
    e.preventDefault()
    e.stopPropagation()
    if (dropAt) {
      const at = pages.findIndex((p) => p.id === dropAt.id)
      const before = dropAt.after ? (pages[at + 1]?.id ?? null) : dropAt.id
      movePages(drag, before)
    }
    setDrag(null)
    setDropAt(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2" aria-label="올린 문서">
        {sourceOrder.map((id) => {
          const src = sources[id]
          const Icon = src.kind === 'pdf' ? FileText : ImageIcon
          return (
            <li key={id} className="flex max-w-full items-center gap-2 rounded-md border border-line bg-surface py-1 pl-2.5 pr-1 shadow-1">
              {many && <Badge tone="brand">{letters.get(id)}</Badge>}
              <Icon className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 truncate text-sm font-semibold text-ink" title={src.name}>
                {src.name}
              </span>
              <span className="num shrink-0 text-xs text-muted">
                {src.kind === 'pdf' ? `${src.pageCount}쪽 · ` : ''}
                {formatBytes(src.size)}
              </span>
              {src.kind === 'pdf' && src.encrypted && (
                <span title={src.editable ? '암호를 풀어 열었습니다' : '원본 그대로 복사할 수 없어 PDF 로 저장할 때 그림으로 넣습니다'}>
                  <Lock className={clsx('size-3.5 shrink-0', src.editable ? 'text-muted' : 'text-warn')} aria-hidden />
                </span>
              )}
              <IconButton icon={X} label={`${src.name} 빼기`} size="sm" disabled={busy} onClick={() => removeSource(id)} />
            </li>
          )
        })}
      </ul>

      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="num mr-auto text-sm text-ink-2" aria-live="polite">
            전체 <strong className="text-ink">{pages.length}</strong>쪽{selected.size > 0 && (
              <>
                {' '}
                · <strong className="text-ink">{selected.size}</strong>쪽 고름
              </>
            )}
          </p>
          <div className="flex items-center gap-1.5">
            <TextInput
              value={range}
              onChange={(e) => {
                setRange(e.target.value)
                setRangeError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && applyRange()}
              placeholder="1-3,5"
              aria-label="고를 쪽 범위"
              aria-invalid={rangeError ? true : undefined}
              className="num h-8! w-28! text-sm!"
            />
            <Button size="sm" onClick={applyRange} disabled={!range.trim()}>
              범위 고르기
            </Button>
          </div>
          <Popover
            align="end"
            trigger={({ ref, ...props }) => (
              <span ref={ref} className="inline-flex">
                <Button size="sm" icon={ListChecks} {...props}>
                  고르기
                </Button>
              </span>
            )}
          >
            {(close) => {
              const pick = (fn: (p: PageItem, i: number) => boolean) => () => {
                selectWhere(fn)
                close()
              }
              return (
                <>
                  <MenuItem onClick={pick(() => true)}>모두 고르기</MenuItem>
                  <MenuItem onClick={pick(() => false)} disabled={!selected.size}>
                    고르기 풀기
                  </MenuItem>
                  <MenuItem onClick={pick((_p, i) => i % 2 === 0)}>홀수 쪽만</MenuItem>
                  <MenuItem onClick={pick((_p, i) => i % 2 === 1)}>짝수 쪽만</MenuItem>
                  <MenuItem onClick={pick((p) => !p.selected)}>고른 쪽 뒤집기</MenuItem>
                </>
              )
            }}
          </Popover>
        </div>
        {rangeError && (
          <p className="text-sm text-danger" role="alert">
            {rangeError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
          <span className="mr-1 text-xs text-muted">{selected.size ? '고른 쪽을' : '모든 쪽을'}</span>
          <Button size="sm" icon={RotateCcw} disabled={busy} onClick={() => rotatePages(acting, -90)}>
            왼쪽으로
          </Button>
          <Button size="sm" icon={RotateCw} disabled={busy} onClick={() => rotatePages(acting, 90)}>
            오른쪽으로
          </Button>
          <Button size="sm" icon={ArrowLeft} disabled={busy || !selected.size} onClick={() => nudgePages(selected, -1)}>
            앞으로
          </Button>
          <Button size="sm" icon={ArrowRight} disabled={busy || !selected.size} onClick={() => nudgePages(selected, 1)}>
            뒤로
          </Button>
          <Button size="sm" variant="danger" icon={Trash2} disabled={busy || !selected.size} onClick={() => removePages(selected)}>
            빼기
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={clearWorkspace}>
            모두 비우기
          </Button>
        </div>
      </div>

      <Stage minHeight={240} className="items-start! p-4!">
        <ol
          className="grid w-full grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3"
          aria-label="쪽 목록"
          onDragOver={(e) => drag && e.preventDefault()}
          onDrop={onDrop}
          onDragEnd={() => {
            setDrag(null)
            setDropAt(null)
          }}
        >
          {pages.map((page, i) => (
            <PageCard
              key={page.id}
              page={page}
              position={i}
              source={sources[page.sourceId]}
              letter={many ? (letters.get(page.sourceId) ?? null) : null}
              busy={busy}
              dragging={drag?.has(page.id) ?? false}
              drop={dropAt?.id === page.id ? (dropAt.after ? 'after' : 'before') : null}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onPreview={setPreview}
            />
          ))}
        </ol>
      </Stage>
      <p className="text-xs text-muted">쪽을 누르면 고르고, Shift 를 누른 채 누르면 사이의 쪽을 한꺼번에 고릅니다. 끌어서 순서를 바꿀 수 있습니다.</p>

      <PreviewDialog page={preview} source={preview ? sources[preview.sourceId] : undefined} paper={paper} position={preview ? pages.findIndex((p) => p.id === preview.id) : -1} onClose={() => setPreview(null)} />
    </div>
  )
}

interface PageCardProps {
  page: PageItem
  position: number
  source: Source | undefined
  letter: string | null
  busy: boolean
  dragging: boolean
  drop: 'before' | 'after' | null
  onDragStart: (e: DragEvent, page: PageItem) => void
  onDragOver: (e: DragEvent, page: PageItem) => void
  onPreview: (page: PageItem) => void
}

const PageCard = memo(function PageCard({ page, position, source, letter, busy, dragging, drop, onDragStart, onDragOver, onPreview }: PageCardProps) {
  const ref = useRef<HTMLLIElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // 화면에 가까워졌을 때만 미리보기를 그린다.
  useEffect(() => {
    const el = ref.current
    if (!el || !source) return
    let alive = true
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        thumbUrl(page, source)
          .then((u) => alive && setUrl(u))
          .catch(() => alive && setFailed(true))
      },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
    }
    // 같은 쪽이면 다시 그릴 필요가 없다(회전은 CSS 로 돌린다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.sourceId, page.index])

  const label = `${position + 1}쪽${source ? ` (${source.name}${source.kind === 'pdf' ? ` ${page.index + 1}쪽` : ''})` : ''}`
  return (
    <li
      ref={ref}
      draggable={!busy}
      onDragStart={(e) => onDragStart(e, page)}
      onDragOver={(e) => onDragOver(e, page)}
      className={clsx(
        'relative flex flex-col rounded-md bg-surface shadow-2 outline-3 transition-[outline-color,opacity] duration-150',
        page.selected ? 'outline-mark' : 'outline-transparent',
        dragging && 'opacity-40',
      )}
    >
      {drop && <span className={clsx('pointer-events-none absolute inset-y-0 z-10 w-1 rounded-full bg-mark', drop === 'before' ? '-left-2' : '-right-2')} aria-hidden />}
      <button
        type="button"
        aria-pressed={page.selected}
        aria-label={`${label} ${page.selected ? '고르기 풀기' : '고르기'}`}
        title={source?.name}
        onClick={(e) => toggleSelect(page.id, e.shiftKey)}
        className="relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-t-md bg-sunken p-2 focus-visible:outline-3 focus-visible:outline-brand"
      >
        {url ? (
          <img src={url} alt="" draggable={false} className="max-h-full max-w-full shadow-1 transition-transform duration-200" style={{ transform: `rotate(${page.rotation}deg)` }} />
        ) : failed ? (
          <span className="text-xs text-muted">미리보기를 그리지 못했습니다</span>
        ) : (
          <Spinner className="text-faint" />
        )}
        {page.selected && (
          <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-mark text-ink shadow-1">
            <Check className="size-3.5" aria-hidden />
          </span>
        )}
      </button>
      <div className="flex items-center gap-0.5 border-t border-line px-1.5 py-0.5">
        <span className="num mr-auto flex items-center gap-1 text-sm font-semibold text-ink">
          {position + 1}
          {letter && <span className="text-2xs font-bold text-muted">{letter}</span>}
        </span>
        <IconButton icon={ZoomIn} label={`${position + 1}쪽 크게 보기`} size="sm" onClick={() => onPreview(page)} />
        <IconButton icon={RotateCw} label={`${position + 1}쪽 오른쪽으로 돌리기`} size="sm" disabled={busy} onClick={() => rotatePages(new Set([page.id]), 90)} />
        <IconButton icon={Trash2} label={`${position + 1}쪽 빼기`} size="sm" disabled={busy} onClick={() => removePages(new Set([page.id]))} />
      </div>
    </li>
  )
})

function PreviewDialog({ page, source, paper, position, onClose }: { page: PageItem | null; source: Source | undefined; paper: PaperSettings; position: number; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [failed, setFailed] = useState(false)
  const url = useObjectUrl(blob)
  useEffect(() => {
    setBlob(null)
    setFailed(false)
    if (!page || !source) return
    let alive = true
    previewBlob(page, source, paper)
      .then((b) => alive && setBlob(b))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, page?.rotation])
  return (
    <Dialog open={page !== null} onClose={onClose} title={page ? `${position + 1}쪽 크게 보기` : ''} size="xl">
      <div className="flex min-h-64 items-center justify-center rounded-md bg-sunken p-3">
        {url ? (
          <img src={url} alt={`${position + 1}쪽`} className="max-h-[70dvh] max-w-full shadow-2" />
        ) : failed ? (
          <p className="text-sm text-muted">이 쪽을 그리지 못했습니다. 파일이 손상되었을 수 있습니다.</p>
        ) : (
          <span className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> 그리는 중
          </span>
        )}
      </div>
    </Dialog>
  )
}
