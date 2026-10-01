import clsx from 'clsx'
import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

// ── 버튼 ──────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap select-none rounded-md border transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:opacity-45 disabled:active:translate-y-0'
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand border-brand-strong shadow-1 hover:bg-brand-strong',
  secondary: 'bg-surface text-ink border-line-strong shadow-1 hover:bg-sunken hover:border-faint',
  ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-sunken hover:text-ink',
  danger: 'bg-surface text-danger border-line-strong shadow-1 hover:bg-danger-soft hover:border-danger',
}
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-sm',
  md: 'h-10 px-3.5 text-base',
  lg: 'h-12 px-5 text-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  /** true 면 스피너를 보이고 클릭을 막는다 */
  loading?: boolean
  block?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading, block, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], block && 'w-full', className)}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin-slow" aria-hidden /> : Icon ? <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden /> : null}
      {children}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  /** 접근성 이름이자 툴팁 */
  label: string
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  active?: boolean
}

export function IconButton({ icon: Icon, label, variant = 'ghost', size = 'md', active, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={clsx(
        BUTTON_BASE,
        BUTTON_VARIANT[variant],
        size === 'sm' ? 'size-8' : 'size-10',
        active && 'bg-brand-soft! text-brand-ink! border-brand/40!',
        className,
      )}
      {...rest}
    >
      <Icon className={size === 'sm' ? 'size-4' : 'size-[18px]'} aria-hidden />
    </button>
  )
}

// ── 필드 ──────────────────────────────────────────────────
export interface FieldProps {
  label: ReactNode
  /** 라벨 오른쪽의 보조 값(현재 수치 등) */
  aside?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  /** 폼 컨트롤 하나. id 가 자동으로 연결된다. */
  children: (id: string) => ReactNode
}

/** 라벨 + 컨트롤 + 도움말/오류. 모든 입력은 이걸로 감싼다. */
export function Field({ label, aside, hint, error, className, children }: FieldProps) {
  const id = useId()
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-ink-2">
          {label}
        </label>
        {aside != null && <span className="num text-sm text-muted">{aside}</span>}
      </div>
      {children(id)}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

const CONTROL =
  'w-full h-10 rounded-md border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-faint focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20 disabled:bg-sunken disabled:text-faint aria-invalid:border-danger aria-invalid:ring-danger/20'

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className={clsx(CONTROL, className)} {...rest} />
}

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null
  onValue: (value: number | null) => void
  /** 입력칸 오른쪽에 붙는 단위(px, %, 원 …) */
  unit?: string
}

/** 숫자 입력. 비어 있으면 null. 단위는 칸 안쪽 오른쪽에 표시한다. */
export function NumberInput({ value, onValue, unit, className, ...rest }: NumberInputProps) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        onChange={(e) => onValue(e.target.value === '' ? null : Number(e.target.value))}
        className={clsx(CONTROL, 'num', unit && 'pr-10', className)}
        {...rest}
      />
      {unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{unit}</span>}
    </div>
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(CONTROL, 'h-auto min-h-24 py-2.5 leading-relaxed resize-y', className)} {...rest} />
}

export interface SelectProps<T extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  value: T
  onValue: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
}

export function Select<T extends string>({ value, onValue, options, className, ...rest }: SelectProps<T>) {
  return (
    <select value={value} onChange={(e) => onValue(e.target.value as T)} className={clsx(CONTROL, 'pr-8', className)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
  className?: string
}

/** 켜고 끄는 설정. 라벨 전체가 클릭 영역이다. */
export function Switch({ checked, onChange, label, hint, disabled, className }: SwitchProps) {
  const id = useId()
  return (
    <div className={clsx('flex items-start justify-between gap-3', className)}>
      <label htmlFor={id} className={clsx('flex-1 cursor-pointer', disabled && 'cursor-not-allowed opacity-50')}>
        <span className="block text-sm font-semibold text-ink-2">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 disabled:opacity-50',
          checked ? 'border-brand-strong bg-brand' : 'border-line-strong bg-sunken',
        )}
      >
        <span
          className={clsx(
            'absolute top-1/2 size-[18px] -translate-y-1/2 rounded-full bg-surface shadow-1 transition-[left] duration-150',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  )
}

export function Checkbox({ checked, onChange, label, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <label className={clsx('inline-flex cursor-pointer items-center gap-2 text-sm text-ink-2', disabled && 'cursor-not-allowed opacity-50', className)}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded-xs" />
      {label}
    </label>
  )
}

export interface SliderProps {
  value: number
  onValue: (value: number) => void
  min: number
  max: number
  step?: number
  id?: string
  disabled?: boolean
  className?: string
}

export function Slider({ value, onValue, min, max, step = 1, id, disabled, className }: SliderProps) {
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onValue(Number(e.target.value))}
      className={clsx('h-6 w-full cursor-pointer disabled:cursor-not-allowed', className)}
    />
  )
}

export interface SegmentedProps<T extends string> {
  value: T
  onValue: (value: T) => void
  options: ReadonlyArray<{ value: T; label: ReactNode; icon?: LucideIcon; disabled?: boolean }>
  /** 접근성용 그룹 이름 */
  label: string
  size?: 'sm' | 'md'
  block?: boolean
  className?: string
}

/** 2–5개 중 하나를 고르는 묶음 버튼 */
export function Segmented<T extends string>({ value, onValue, options, label, size = 'md', block, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('inline-flex rounded-md border border-line-strong bg-sunken p-0.5', block && 'flex w-full', className)}>
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={o.disabled}
            onClick={() => onValue(o.value)}
            className={clsx(
              'inline-flex items-center justify-center gap-1.5 rounded-[7px] font-semibold transition-[background-color,color,box-shadow] duration-150 disabled:opacity-40',
              size === 'sm' ? 'h-7 px-2.5 text-sm' : 'h-9 px-3 text-sm',
              block && 'flex-1',
              selected ? 'bg-surface text-ink shadow-1' : 'text-muted hover:text-ink',
            )}
          >
            {o.icon && <o.icon className="size-4" aria-hidden />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export interface TabsProps<T extends string> {
  value: T
  onValue: (value: T) => void
  tabs: ReadonlyArray<{ value: T; label: ReactNode; icon?: LucideIcon }>
  label: string
  className?: string
}

/** 도구 안에서 작업 모드를 바꾸는 탭(밑줄형). 가로로 넘치면 스크롤된다. */
export function Tabs<T extends string>({ value, onValue, tabs, label, className }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className={clsx('flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line', className)}>
      {tabs.map((t) => {
        const selected = t.value === value
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onValue(t.value)}
            className={clsx(
              'inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold transition-colors duration-150',
              selected ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.icon && <t.icon className="size-4" aria-hidden />}
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
