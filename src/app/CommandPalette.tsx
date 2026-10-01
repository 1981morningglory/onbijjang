import clsx from 'clsx'
import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Kbd } from '@/ui'
import { useVisibleGroups } from './config'
import { GROUP_BY_ID, artUrl, toolPath } from './registry'
import { searchTools } from './search'

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const navigate = useNavigate()
  const groups = useVisibleGroups()
  const all = useMemo(() => groups.flatMap((g) => g.tools), [groups])
  const results = useMemo(() => searchTools(all, query), [all, query])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      setQuery('')
      setIndex(0)
      el.showModal()
    }
    if (!open && el.open) el.close()
  }, [open])
  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const go = (id: string) => {
    onClose()
    navigate(toolPath(id))
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="mx-auto mt-[12dvh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink shadow-3 backdrop:bg-ink/45 open:animate-pop"
    >
      {open && (
        <div
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(results.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter' && results[index]) {
              e.preventDefault()
              go(results[index].id)
            }
          }}
        >
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-[18px] shrink-0 text-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="도구 이름이나 하려는 일 (예: 누끼, 마진, ㅂㄱㅈㄱ)"
              aria-label="도구 찾기"
              className="h-13 flex-1 bg-transparent text-lg outline-none placeholder:text-faint"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div ref={list} className="max-h-[52dvh] overflow-auto p-1.5">
            {results.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">
                <b className="text-ink-2">“{query}”</b>에 맞는 도구가 없습니다. 다른 말로 찾아보세요.
              </p>
            ) : (
              results.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  data-active={i === index}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => go(t.id)}
                  className={clsx('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left', i === index && 'bg-sunken')}
                >
                  <img src={artUrl(t.art)} alt="" className="size-10 shrink-0 object-contain" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{t.title}</span>
                    <span className="block truncate text-sm text-muted">{t.summary}</span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-faint sm:block">{GROUP_BY_ID[t.group].title}</span>
                  {i === index && <CornerDownLeft className="size-4 shrink-0 text-muted" aria-hidden />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </dialog>
  )
}
