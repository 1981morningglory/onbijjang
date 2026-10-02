import clsx from 'clsx'
import { CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { IconButton } from './controls'

// ── 패널·구획 ─────────────────────────────────────────────
/** 흰 종이 한 장. 도구의 설정 묶음이나 결과 영역을 담는다. 패널 안에 패널을 넣지 않는다. */
export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('rounded-lg border border-line bg-surface shadow-1', className)} {...rest}>
      {children}
    </div>
  )
}

export interface SectionProps {
  title: ReactNode
  /** 제목 오른쪽 작은 동작(초기화 등) */
  action?: ReactNode
  hint?: ReactNode
  className?: string
  children: ReactNode
}

/** 설정 패널 안의 한 구획. 구획 사이는 선으로 나뉜다. */
export function Section({ title, action, hint, className, children }: SectionProps) {
  return (
    <section className={clsx('flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {action}
      </div>
      {hint && <p className="-mt-1.5 text-sm text-muted">{hint}</p>}
      {children}
    </section>
  )
}

// ── 안내 ──────────────────────────────────────────────────
type Tone = 'info' | 'success' | 'warn' | 'danger'
const TONE: Record<Tone, { box: string; icon: LucideIcon; iconColor: string }> = {
  info: { box: 'bg-info-soft text-ink', icon: Info, iconColor: 'text-info' },
  success: { box: 'bg-success-soft text-ink', icon: CircleCheck, iconColor: 'text-success' },
  warn: { box: 'bg-warn-soft text-ink', icon: TriangleAlert, iconColor: 'text-warn' },
  danger: { box: 'bg-danger-soft text-ink', icon: CircleX, iconColor: 'text-danger' },
}

/** 화면 안에 머무는 안내·경고. 오류는 "무엇이 문제이고 어떻게 하면 되는지"를 쓴다. */
export function Callout({ tone = 'info', title, children, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const t = TONE[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'note'} className={clsx('flex gap-2.5 rounded-md px-3 py-2.5 text-sm', t.box, className)}>
      <t.icon className={clsx('mt-0.5 size-4 shrink-0', t.iconColor)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
      </div>
    </div>
  )
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'brand' | 'accent' | 'mark' | 'warn'; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex h-5 items-center rounded-full px-2 text-2xs font-bold tracking-wide',
        tone === 'neutral' && 'bg-sunken text-muted',
        tone === 'brand' && 'bg-brand-soft text-brand-ink',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'mark' && 'bg-mark text-ink',
        tone === 'warn' && 'bg-warn-soft text-warn',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-strong bg-surface px-1 font-sans text-2xs font-semibold text-muted">{children}</kbd>
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={clsx('size-4 animate-spin-slow', className)} aria-hidden />
}

/** value 가 null 이면 끝을 알 수 없는 진행(불확정) 표시 */
export function Progress({ value, label, className }: { value: number | null; label?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      {label && (
        <div className="flex items-baseline justify-between gap-2 text-sm text-ink-2">
          <span>{label}</span>
          {value != null && <span className="num text-muted">{Math.round(value)}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        className="h-2 overflow-hidden rounded-full bg-sunken"
      >
        <div
          className={clsx('h-full rounded-full bg-brand transition-[width] duration-200', value == null && 'w-1/3 animate-pulse')}
          style={value != null ? { width: `${Math.max(0, Math.min(100, value))}%` } : undefined}
        />
      </div>
    </div>
  )
}

/** 비어 있는 상태. 무엇을 하면 채워지는지 알려준다. */
export function EmptyState({ icon: Icon, title, children, action, className }: { icon?: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {Icon && <Icon className="size-7 text-faint" aria-hidden />}
      <p className="font-semibold text-ink-2">{title}</p>
      {children && <p className="max-w-[46ch] text-sm text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// ── 토스트 ────────────────────────────────────────────────
interface ToastItem {
  id: number
  tone: Tone
  message: string
}
const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }))
let toastSeq = 0

function pushToast(tone: Tone, message: string, ms = 4000) {
  const id = ++toastSeq
  useToasts.setState((s) => ({ items: [...s.items.slice(-3), { id, tone, message }] }))
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), ms)
}

/** 짧은 완료·실패 알림. 긴 안내나 복구 방법이 필요한 오류는 Callout 으로 화면에 남긴다. */
export const toast = {
  success: (message: string) => pushToast('success', message),
  info: (message: string) => pushToast('info', message),
  warn: (message: string) => pushToast('warn', message, 6000),
  error: (message: string) => pushToast('danger', message, 7000),
}

export function ToastViewport() {
  const items = useToasts((s) => s.items)
  return createPortal(
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-5 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {items.map((t) => {
        const tone = TONE[t.tone]
        return (
          <div key={t.id} className="animate-pop pointer-events-auto flex max-w-md items-start gap-2.5 rounded-lg border border-line bg-ink px-4 py-3 text-sm text-paper shadow-3">
            <tone.icon className={clsx('mt-0.5 size-4 shrink-0', t.tone === 'danger' ? 'text-ink-danger' : t.tone === 'warn' ? 'text-mark' : 'text-ink-success')} aria-hidden />
            <span>{t.message}</span>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

// ── 대화상자 ──────────────────────────────────────────────
export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** sm 420 · md 560 · lg 760 · xl 1040 · full 화면 대부분 */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
}

/** 집중이 필요한 작업(정밀 편집, 삭제 확인)에만 쓴다. 단순 설정은 화면 안에 펼친다. */
export function Dialog({ open, onClose, title, children, footer, size = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={clsx(
        'm-auto max-h-[92dvh] w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink shadow-3 backdrop:bg-ink/45 open:flex open:flex-col open:animate-pop',
        size === 'sm' && 'max-w-[420px]',
        size === 'md' && 'max-w-[560px]',
        size === 'lg' && 'max-w-[760px]',
        size === 'xl' && 'max-w-[1040px]',
        size === 'full' && 'h-[92dvh] max-w-[1400px]',
      )}
    >
      {open && (
        <>
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 className="text-lg">{title}</h2>
            <IconButton icon={X} label="닫기" size="sm" onClick={onClose} />
          </header>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper px-5 py-3">{footer}</footer>}
        </>
      )}
    </dialog>
  )
}

// ── 팝오버 ────────────────────────────────────────────────
export interface PopoverProps {
  /** 여는 버튼. onClick 과 aria 속성은 자동으로 붙는다. */
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; ref: (el: HTMLElement | null) => void }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  className?: string
}

/** 버튼 아래에 뜨는 작은 패널. 화면 고정 위치라 스크롤 영역에 잘리지 않는다. */
export function Popover({ trigger, children, align = 'start', className }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return
    const place = () => {
      const a = anchor.current!.getBoundingClientRect()
      const p = panel.current!.getBoundingClientRect()
      let left = align === 'end' ? a.right - p.width : a.left
      left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8))
      let top = a.bottom + 6
      if (top + p.height > window.innerHeight - 8) top = Math.max(8, a.top - p.height - 6)
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        anchor.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, ref: (el) => (anchor.current = el) })}
      {open &&
        createPortal(
          <div
            ref={panel}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
            className={clsx('animate-pop fixed z-[90] max-h-[70dvh] min-w-52 overflow-auto rounded-lg border border-line bg-surface p-1.5 shadow-3', className)}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  )
}

export function MenuItem({ icon: Icon, children, onClick, disabled, danger }: { icon?: LucideIcon; children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm font-medium transition-colors duration-100 disabled:opacity-40',
        danger ? 'text-danger hover:bg-danger-soft' : 'text-ink-2 hover:bg-sunken hover:text-ink',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}
