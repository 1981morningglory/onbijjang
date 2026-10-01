import { useEffect, useState, type ReactNode } from 'react'
import { Field, NumberInput, Slider } from '@/ui'

/**
 * 숫자 입력. 치는 동안에는 바깥 값이 끼어들지 않게 하고(지웠다 다시 쓸 수 있게),
 * 쓸 수 있는 숫자가 되면 바로 반영한다.
 */
export function Num({ label, value, onCommit, unit, min, max, step = 1, disabled, className }: { label: ReactNode; value: number; onCommit: (v: number) => void; unit?: string; min?: number; max?: number; step?: number; disabled?: boolean; className?: string }) {
  const [draft, setDraft] = useState<number | null>(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])
  return (
    <Field label={label} className={className}>
      {(id) => (
        <NumberInput
          id={id}
          value={focused ? draft : value}
          unit={unit}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onFocus={() => {
            setDraft(value)
            setFocused(true)
          }}
          onBlur={() => setFocused(false)}
          onValue={(v) => {
            setDraft(v)
            if (v == null || !Number.isFinite(v)) return
            if (min != null && v < min) return
            onCommit(max != null ? Math.min(max, v) : v)
          }}
        />
      )}
    </Field>
  )
}

/** 라벨 오른쪽에 현재 값을 보여 주는 슬라이더 */
export function Range({ label, value, onValue, min, max, step = 1, format, disabled }: { label: ReactNode; value: number; onValue: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string; disabled?: boolean }) {
  return (
    <Field label={label} aside={format ? format(value) : String(value)}>
      {(id) => <Slider id={id} min={min} max={max} step={step} value={Math.max(min, Math.min(max, value))} onValue={onValue} disabled={disabled} />}
    </Field>
  )
}
