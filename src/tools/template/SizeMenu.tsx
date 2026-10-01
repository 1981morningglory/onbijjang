import { ChevronDown, Ruler } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTeamPresets } from '@/app/config'
import { Badge, Button, Checkbox, Field, NumberInput, Popover, TextInput } from '@/ui'
import { MAX_SIDE, MIN_SIDE, mergePresets, parseSizeText, searchPresets } from './model'

export interface SizeMenuProps {
  width: number
  height: number
  /** 객체가 하나라도 있으면 "내용도 맞추기"를 보여 준다 */
  hasContent: boolean
  onApply: (width: number, height: number, fitContent: boolean) => void
}

/** 페이지 크기 고르기: 프리셋 검색 + 팀 크기 + 직접 입력 */
export function SizeMenu({ width, height, hasContent, onApply }: SizeMenuProps) {
  const team = useTeamPresets().canvasSizes
  const presets = useMemo(() => mergePresets(team), [team])
  const [query, setQuery] = useState('')
  const [w, setW] = useState<number | null>(width)
  const [h, setH] = useState<number | null>(height)
  const [fit, setFit] = useState(true)
  const current = presets.find((p) => p.w === width && p.h === height)
  const found = searchPresets(presets, query)
  const typed = parseSizeText(query)
  const valid = w != null && h != null && w >= MIN_SIDE && h >= MIN_SIDE && w <= MAX_SIDE && h <= MAX_SIDE

  return (
    <Popover
      className="w-80 p-0!"
      trigger={({ ref, onClick, ...props }) => (
        <span ref={ref} className="inline-flex">
          <Button
            size="sm"
            icon={Ruler}
            onClick={() => {
              setW(width)
              setH(height)
              setQuery('')
              onClick()
            }}
            {...props}
          >
            <span className="num">
              {width} × {height}
            </span>
            {current && <span className="hidden text-muted sm:inline">{current.name}</span>}
            <ChevronDown className="size-3.5 text-muted" aria-hidden />
          </Button>
        </span>
      )}
    >
      {(close) => {
        const apply = (nw: number, nh: number) => {
          onApply(nw, nh, hasContent && fit)
          close()
        }
        return (
          <div className="flex flex-col">
            <div className="border-b border-line p-3">
              <Field label="크기 찾기">{(id) => <TextInput id={id} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름이나 숫자 (예: 카드뉴스, 1080)" />}</Field>
            </div>
            <ul className="max-h-60 overflow-auto p-1.5">
              {typed && (
                <li>
                  <button type="button" onClick={() => apply(typed.w, typed.h)} className="flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-2 text-left text-sm font-medium text-ink-2 transition-colors duration-100 hover:bg-sunken hover:text-ink">
                    <span>이 크기로 만들기</span>
                    <span className="num text-muted">
                      {typed.w} × {typed.h}
                    </span>
                  </button>
                </li>
              )}
              {found.map((p) => {
                const active = p.w === width && p.h === height
                return (
                  <li key={`${p.name}-${p.w}-${p.h}`}>
                    <button
                      type="button"
                      aria-current={active || undefined}
                      onClick={() => apply(p.w, p.h)}
                      className={`flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-2 text-left text-sm font-medium transition-colors duration-100 hover:bg-sunken hover:text-ink ${active ? 'bg-brand-soft text-brand-ink' : 'text-ink-2'}`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        {p.team && <Badge tone="brand">팀</Badge>}
                      </span>
                      <span className="num shrink-0 text-muted">
                        {p.w} × {p.h}
                      </span>
                    </button>
                  </li>
                )
              })}
              {!found.length && !typed && <li className="px-2.5 py-4 text-center text-sm text-muted">맞는 크기가 없습니다. 아래에 직접 입력해 주세요.</li>}
            </ul>
            <div className="flex flex-col gap-2.5 border-t border-line p-3">
              <div className="flex items-end gap-2">
                <Field label="너비" className="flex-1">
                  {(id) => <NumberInput id={id} value={w} onValue={setW} unit="px" min={MIN_SIDE} max={MAX_SIDE} />}
                </Field>
                <Field label="높이" className="flex-1">
                  {(id) => <NumberInput id={id} value={h} onValue={setH} unit="px" min={MIN_SIDE} max={MAX_SIDE} />}
                </Field>
                <Button disabled={!valid || (w === width && h === height)} onClick={() => valid && apply(w, h)}>
                  적용
                </Button>
              </div>
              {!valid && (
                <p className="text-sm text-danger" role="alert">
                  한 변은 {MIN_SIDE}–{MAX_SIDE}px 사이로 입력해 주세요.
                </p>
              )}
              {hasContent && <Checkbox checked={fit} onChange={setFit} label="안의 내용도 새 크기에 맞춰 옮기기" />}
              <p className="text-xs text-muted">크기는 모든 페이지에 함께 적용됩니다.</p>
            </div>
          </div>
        )
      }}
    </Popover>
  )
}
