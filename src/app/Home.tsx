import clsx from 'clsx'
import { Search, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, EmptyState } from '@/ui'
import { useSite, useVisibleGroups } from './config'
import { usePrefs } from './prefs'
import { artUrl, toolPath, type ToolDef } from './registry'
import { searchTools } from './search'

/** 책상 위에 놓인 도구 하나. 카드 상자 없이 종이 위에 바로 놓인다. */
function ToolTile({ tool, isNew }: { tool: ToolDef; isNew: boolean }) {
  const favorite = usePrefs((s) => s.favorites.includes(tool.id))
  const toggle = usePrefs((s) => s.toggleFavorite)
  return (
    <div className="group relative">
      <Link
        to={toolPath(tool.id)}
        className="flex h-full flex-col items-start gap-1 rounded-xl p-3 transition-colors duration-200 hover:bg-surface hover:shadow-2 focus-visible:bg-surface"
      >
        <img
          src={artUrl(tool.art)}
          alt=""
          width={112}
          height={112}
          loading="lazy"
          className="size-28 object-contain drop-shadow-[0_10px_10px_rgb(60_48_20/0.16)] transition-transform duration-300 ease-out-expo group-hover:-translate-y-1.5 group-hover:rotate-[-3deg]"
        />
        <span className="mt-1 flex items-center gap-1.5 text-base font-bold text-ink">
          {tool.title}
          {isNew && <Badge tone="accent">NEW</Badge>}
        </span>
        <span className="text-sm leading-snug text-muted">{tool.summary}</span>
      </Link>
      <button
        type="button"
        onClick={() => toggle(tool.id)}
        aria-pressed={favorite}
        aria-label={favorite ? `${tool.title} 즐겨찾기 해제` : `${tool.title} 즐겨찾기`}
        title={favorite ? '즐겨찾기 해제' : '즐겨찾기'}
        className={clsx(
          'absolute right-2 top-2 flex size-8 items-center justify-center rounded-full transition-[opacity,background-color] duration-150 hover:bg-sunken focus-visible:opacity-100',
          favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <Star className={clsx('size-4', favorite ? 'fill-mark text-warn' : 'text-faint')} aria-hidden />
      </button>
    </div>
  )
}

function QuickChip({ tool }: { tool: ToolDef }) {
  return (
    <Link
      to={toolPath(tool.id)}
      className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1.5 pr-3.5 text-sm font-semibold text-ink shadow-1 transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-2"
    >
      <img src={artUrl(tool.art)} alt="" className="size-8 object-contain" />
      {tool.title}
    </Link>
  )
}

/** 작업 매트 위에 도구들이 놓인 장면. 홈 화면의 얼굴. */
function DeskScene() {
  const pieces: Array<{ art: string; className: string }> = [
    { art: 'split', className: 'left-[6%] top-[10%] w-[30%] rotate-[-8deg]' },
    { art: 'coupang', className: 'right-[8%] top-[6%] w-[30%] rotate-[6deg]' },
    { art: 'signature', className: 'left-[34%] top-[30%] w-[34%] rotate-[3deg]' },
    { art: 'label', className: 'left-[4%] bottom-[4%] w-[32%] rotate-[5deg]' },
    { art: 'clips', className: 'right-[5%] bottom-[5%] w-[31%] rotate-[-5deg]' },
  ]
  return (
    <div className="mat relative aspect-[5/4] w-full overflow-hidden rounded-2xl border border-mat-deep shadow-3" aria-hidden>
      {pieces.map((p) => (
        <img key={p.art} src={artUrl(p.art)} alt="" className={clsx('absolute drop-shadow-[0_14px_14px_rgb(0_0_0/0.35)]', p.className)} />
      ))}
    </div>
  )
}

export function Home() {
  const groups = useVisibleGroups()
  const config = useSite((s) => s.config)
  const favorites = usePrefs((s) => s.favorites)
  const recents = usePrefs((s) => s.recents)
  const [query, setQuery] = useState('')
  const all = useMemo(() => groups.flatMap((g) => g.tools), [groups])
  const byId = useMemo(() => new Map(all.map((t) => [t.id, t])), [all])
  const results = query.trim() ? searchTools(all, query) : null
  const favTools = favorites.map((id) => byId.get(id)).filter((t): t is ToolDef => Boolean(t))
  const recentTools = recents.map((id) => byId.get(id)).filter((t): t is ToolDef => Boolean(t) && !favorites.includes(t!.id)).slice(0, 5)

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-12 px-4 pb-20 pt-8 sm:px-8">
      <section className="grid items-center gap-8 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="flex flex-col gap-5">
          <h1 className="font-display text-[clamp(2.25rem,5vw,3.75rem)] font-normal leading-[1.12] tracking-[-0.01em]">
            매일 하는 일,
            <br />
            <span className="marker">한 책상</span>에서 끝.
          </h1>
          <p className="max-w-[44ch] text-lg text-ink-2">사진 다듬기부터 영상 자르기, PDF 정리, 마켓 수수료 계산까지. 필요한 도구를 집어 바로 쓰세요.</p>
          <label className="flex h-13 max-w-md items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 shadow-2 transition-[border-color,box-shadow] duration-150 focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/20">
            <Search className="size-5 shrink-0 text-muted" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="무엇을 하시겠어요? 예: 누끼, 마진, 병합"
              aria-label="도구 찾기"
              className="h-full flex-1 bg-transparent text-base outline-none placeholder:text-faint"
            />
          </label>
        </div>
        <DeskScene />
      </section>

      {results ? (
        <section aria-live="polite">
          <h2 className="mb-3 text-xl">
            “{query.trim()}” 검색 결과 <span className="num font-medium text-muted">{results.length}</span>
          </h2>
          {results.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
              {results.map((t) => (
                <ToolTile key={t.id} tool={t} isNew={config.tools[t.id]?.badge === 'new'} />
              ))}
            </div>
          ) : (
            <EmptyState icon={Search} title="맞는 도구가 없습니다">
              다른 낱말로 찾아보세요. “크기”, “gif”, “쿠팡”처럼 하려는 일을 짧게 적으면 됩니다.
            </EmptyState>
          )}
        </section>
      ) : (
        <>
          {(favTools.length > 0 || recentTools.length > 0) && (
            <section className="flex flex-col gap-3">
              {favTools.length > 0 && (
                <div className="flex items-center gap-3">
                  <h2 className="w-20 shrink-0 text-sm font-bold text-muted">즐겨찾기</h2>
                  <div className="flex gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {favTools.map((t) => (
                      <QuickChip key={t.id} tool={t} />
                    ))}
                  </div>
                </div>
              )}
              {recentTools.length > 0 && (
                <div className="flex items-center gap-3">
                  <h2 className="w-20 shrink-0 text-sm font-bold text-muted">최근 사용</h2>
                  <div className="flex gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {recentTools.map((t) => (
                      <QuickChip key={t.id} tool={t} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {groups.map(({ group, tools }) => (
            <section key={group.id} className="grid gap-x-8 gap-y-3 border-t border-line pt-8 lg:grid-cols-[200px_minmax(0,1fr)]">
              <div className="lg:sticky lg:top-20 lg:self-start">
                <h2 className="text-2xl">{group.title}</h2>
                <p className="mt-1 text-sm text-muted">{group.blurb}</p>
              </div>
              <div className="-m-3 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
                {tools.map((t) => (
                  <ToolTile key={t.id} tool={t} isNew={config.tools[t.id]?.badge === 'new'} />
                ))}
              </div>
            </section>
          ))}

          {groups.length === 0 && (
            <EmptyState title="지금 열려 있는 도구가 없습니다">관리자가 모든 메뉴를 꺼 두었습니다. 관리자 화면에서 다시 켤 수 있습니다.</EmptyState>
          )}
        </>
      )}
    </div>
  )
}
