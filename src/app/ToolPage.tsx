import clsx from 'clsx'
import { ChevronRight, EyeOff, Lock, RotateCcw, ShieldCheck, Star } from 'lucide-react'
import { Component, Suspense, useEffect, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Button, Callout, EmptyState } from '@/ui'
import { groupOf, hiddenByRole, isToolVisible, useSite } from './config'
import { useViewer, useViewerStore } from './viewer'
import { useLoginDialog } from './LoginDialog'
import { usePrefs } from './prefs'
import { GROUP_BY_ID, TOOL_BY_ID, artUrl, type ToolDef } from './registry'

class ToolErrorBoundary extends Component<{ children: ReactNode; toolId: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    // 새 버전 배포 뒤 예전 파일을 찾다 실패한 경우 — 새로고침하면 해결되므로 자동으로 한 번 새로고침한다.
    if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(error.message)) {
      ;(window as unknown as { __onbijjangReload?: () => boolean }).__onbijjangReload?.()
    }
  }
  componentDidUpdate(prev: { toolId: string }) {
    if (prev.toolId !== this.props.toolId && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <Callout tone="danger" title="도구를 여는 중 문제가 생겼습니다">
        <p>새로고침하면 대부분 해결됩니다. 계속되면 관리자에게 아래 내용을 전해 주세요.</p>
        <p className="mt-1 font-mono text-xs text-muted">{this.state.error.message}</p>
        <Button size="sm" icon={RotateCcw} className="mt-2" onClick={() => location.reload()}>
          새로고침
        </Button>
      </Callout>
    )
  }
}

function ToolSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true" aria-label="도구를 불러오는 중">
      <div className="skeleton h-80" />
      <div className="flex flex-col gap-3">
        <div className="skeleton h-10" />
        <div className="skeleton h-10" />
        <div className="skeleton h-24" />
      </div>
    </div>
  )
}

function ToolHeader({ tool }: { tool: ToolDef }) {
  const group = useSite((s) => groupOf(s.config, tool))
  const favorite = usePrefs((s) => s.favorites.includes(tool.id))
  const toggle = usePrefs((s) => s.toggleFavorite)
  return (
    <header className="no-print flex flex-wrap items-center gap-x-4 gap-y-2">
      <img src={artUrl(tool.art)} alt="" className="size-16 shrink-0 object-contain drop-shadow-[0_6px_6px_rgb(60_48_20/0.16)]" />
      <div className="min-w-0 flex-1">
        <nav aria-label="현재 위치" className="flex items-center gap-1 text-xs text-muted">
          <Link to="/" className="hover:text-ink hover:underline">
            모든 도구
          </Link>
          <ChevronRight className="size-3" aria-hidden />
          <span>{GROUP_BY_ID[group].title}</span>
        </nav>
        <h1 className="text-2xl">{tool.title}</h1>
        <p className="text-sm text-muted">{tool.summary}</p>
      </div>
      <div className="flex items-center gap-2">
        {tool.local && (
          <span className="hidden items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-ink sm:inline-flex" title="선택한 파일은 서버로 올라가지 않습니다">
            <ShieldCheck className="size-3.5" aria-hidden />내 기기에서 처리
          </span>
        )}
        <button
          type="button"
          onClick={() => toggle(tool.id)}
          aria-pressed={favorite}
          className={clsx(
            'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold shadow-1 transition-colors duration-150',
            favorite ? 'border-warn/40 bg-mark-soft text-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-sunken',
          )}
        >
          <Star className={clsx('size-4', favorite ? 'fill-mark text-warn' : 'text-muted')} aria-hidden />
          즐겨찾기
        </button>
      </div>
    </header>
  )
}

export function ToolPage() {
  const { id = '' } = useParams()
  const tool = TOOL_BY_ID[id]
  const config = useSite((s) => s.config)
  const status = useSite((s) => s.status)
  const viewer = useViewer()
  const viewerStatus = useViewerStore((s) => s.status)
  const openLogin = useLoginDialog((s) => s.show)
  const touchRecent = usePrefs((s) => s.touchRecent)
  const visible = tool ? isToolVisible(config, tool, viewer) : false

  useEffect(() => {
    if (tool && visible) {
      touchRecent(tool.id)
      document.title = `${tool.title} · 온비짱`
    }
    return () => {
      document.title = '온비짱 · 팀 작업대'
    }
  }, [tool, visible, touchRecent])

  if (!tool) {
    return (
      <EmptyState title="없는 도구입니다" className="py-24" action={<Link to="/" className="font-semibold text-brand underline">모든 도구 보기</Link>}>
        주소가 바뀌었거나 잘못 입력되었습니다.
      </EmptyState>
    )
  }
  if (status !== 'loading' && viewerStatus !== 'loading' && !visible && config.groups[groupOf(config, tool)].enabled && hiddenByRole(config.tools[tool.id], tool.id, viewer)) {
    const guest = viewer.role === 'guest'
    return (
      <EmptyState
        icon={Lock}
        title={guest ? `‘${tool.title}’은(는) 로그인하면 쓸 수 있습니다` : `‘${tool.title}’을(를) 쓸 권한이 없습니다`}
        className="py-24"
        action={
          guest ? (
            <Button variant="primary" onClick={openLogin}>
              로그인
            </Button>
          ) : (
            <Link to="/" className="font-semibold text-brand underline">
              모든 도구 보기
            </Link>
          )
        }
      >
        {guest ? '계정으로 로그인하세요. 계정이 없으면 관리자에게 요청하세요.' : '필요하면 관리자에게 이 도구의 권한을 요청하세요.'}
      </EmptyState>
    )
  }
  if (status !== 'loading' && viewerStatus !== 'loading' && !visible) {
    return (
      <EmptyState icon={EyeOff} title={`‘${tool.title}’은(는) 지금 꺼져 있습니다`} className="py-24" action={<Link to="/" className="font-semibold text-brand underline">모든 도구 보기</Link>}>
        관리자가 이 메뉴를 숨겼습니다. 필요하면 관리자에게 다시 켜 달라고 요청하세요.
      </EmptyState>
    )
  }
  const Tool = tool.component
  return (
    <div className={clsx('mx-auto flex flex-col gap-5 px-4 pb-16 pt-6 sm:px-6', !tool.wide && 'max-w-[1400px]')}>
      <ToolHeader tool={tool} />
      <ToolErrorBoundary toolId={tool.id}>
        <Suspense fallback={<ToolSkeleton />}>
          <Tool key={tool.id} />
        </Suspense>
      </ToolErrorBoundary>
    </div>
  )
}
