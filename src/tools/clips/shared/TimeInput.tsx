import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { TextInput } from '@/ui'
import { formatTime, parseTime } from './time'

export interface TimeInputProps {
  id?: string
  /** 초 */
  value: number
  onCommit: (seconds: number) => void
  /** 화면 낭독기용 이름(Field 로 감싸지 않을 때) */
  label?: string
  disabled?: boolean
  className?: string
}

/** 시각 입력칸. "1:23.4" 나 "83.4" 처럼 적고 Enter 또는 칸을 벗어나면 반영된다. 읽을 수 없으면 원래 값으로 돌아간다. */
export function TimeInput({ id, value, onCommit, label, disabled, className }: TimeInputProps) {
  const [draft, setDraft] = useState(() => formatTime(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setDraft(formatTime(value))
    setInvalid(false)
  }, [value])

  const commit = () => {
    const parsed = parseTime(draft)
    if (parsed === null) {
      setDraft(formatTime(value))
      setInvalid(false)
      return
    }
    setInvalid(false)
    setDraft(formatTime(parsed))
    if (Math.abs(parsed - value) > 0.0005) onCommit(parsed)
  }

  return (
    <TextInput
      id={id}
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        setInvalid(e.target.value.trim() !== '' && parseTime(e.target.value) === null)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          setDraft(formatTime(value))
          setInvalid(false)
        }
      }}
      className={clsx('num h-8! px-2! text-sm!', className)}
    />
  )
}
