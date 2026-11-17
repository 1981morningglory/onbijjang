import clsx from 'clsx'
import { CheckCircle2, Lock, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api } from '@/lib/api'
import { Button, Spinner } from '@/ui'
import { missingRequired, type Answer, type Question } from './logic'

interface PublicForm {
  id: string
  title: string
  description: string
  questions: Question[]
  open: boolean
  oneResponse: boolean
  thanks: string
  closeAt: string | null
}

const doneKey = (id: string) => `onbijjang.form.done.${id}`
const wasDone = (id: string) => {
  try {
    return localStorage.getItem(doneKey(id)) === '1'
  } catch {
    return false
  }
}

/** 설문 응답 화면(메뉴 없이, 로그인 없이). 주소: /form/<설문ID> 또는 /f/<짧은 코드> */
export default function FormFill() {
  const { key = '' } = useParams()
  const [form, setForm] = useState<PublicForm | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, Answer | undefined>>({})
  const [others, setOthers] = useState<Record<string, string>>({})
  const [invalid, setInvalid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    api<{ form: PublicForm }>(`/forms/public/${encodeURIComponent(key)}`)
      .then((r) => {
        setForm(r.form)
        document.title = `${r.form.title} — 설문`
        if (r.form.oneResponse && wasDone(r.form.id)) setDone(true)
      })
      .catch((e) => setError(e instanceof Error ? e.message : '설문을 불러오지 못했습니다.'))
  }, [key])

  const set = (id: string, v: Answer | undefined) => {
    setAnswers((a) => ({ ...a, [id]: v }))
    if (invalid === id) setInvalid(null)
  }
  /** ‘기타’를 고른 답은 ‘기타: 적은 글’로 바꿔 보낸다 */
  const finalAnswers = () => {
    const out: Record<string, Answer | undefined> = {}
    for (const q of form?.questions ?? []) {
      let a = answers[q.id]
      const o = (others[q.id] ?? '').trim()
      if (q.type === 'radio' && a === '__other') a = o ? `기타: ${o}` : undefined
      if (q.type === 'checkbox' && Array.isArray(a)) a = a.map((x) => (x === '__other' ? (o ? `기타: ${o}` : '') : x)).filter(Boolean)
      out[q.id] = a
    }
    return out
  }
  const submit = async () => {
    if (!form) return
    const final = finalAnswers()
    const miss = missingRequired(form, final)
    if (miss) {
      setInvalid(miss.id)
      document.getElementById(`q-${miss.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    setBusy(true)
    try {
      await api(`/forms/public/${encodeURIComponent(key)}`, { method: 'POST', body: { answers: final } })
      try {
        localStorage.setItem(doneKey(form.id), '1')
      } catch {
        // 저장 못 해도 제출은 됐다
      }
      setDone(true)
      window.scrollTo({ top: 0 })
    } catch (e) {
      setError(null)
      alert(e instanceof Error ? e.message : '보내지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-dvh bg-paper px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">{children}</div>
      <p className="mt-8 text-center text-xs text-muted">온비짱 설문폼</p>
    </div>
  )
  if (error) return shell(<div className="rounded-xl border border-line bg-surface p-6 text-center text-ink-2">{error}</div>)
  if (!form)
    return shell(
      <div className="flex items-center justify-center gap-2 py-20 text-muted">
        <Spinner /> 불러오는 중
      </div>,
    )
  const header = (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="h-2.5 bg-brand" />
      <div className="px-5 py-5 sm:px-6">
        <h1 className="text-2xl leading-snug">{form.title}</h1>
        {form.description && <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{form.description}</p>}
        {!done && form.open && form.questions.some((q) => q.required) && <p className="mt-3 text-xs text-danger">* 표시는 꼭 답해야 하는 질문입니다</p>}
      </div>
    </div>
  )
  if (done)
    return shell(
      <>
        {header}
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-10 text-center">
          <CheckCircle2 className="size-10 text-brand" aria-hidden />
          <p className="whitespace-pre-wrap text-lg text-ink">{form.thanks}</p>
          {!form.oneResponse && (
            <button type="button" className="text-sm text-brand-ink underline" onClick={() => (setAnswers({}), setOthers({}), setDone(false))}>
              응답 하나 더 하기
            </button>
          )}
        </div>
      </>,
    )
  if (!form.open)
    return shell(
      <>
        {header}
        <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface px-6 py-10 text-center text-ink-2">
          <Lock className="size-8 text-muted" aria-hidden />
          <p>이 설문은 응답을 받지 않습니다(마감).</p>
        </div>
      </>,
    )

  return shell(
    <>
      {header}
      {form.questions.map((q) => (
        <QuestionField key={q.id} q={q} value={answers[q.id]} other={others[q.id] ?? ''} invalid={invalid === q.id} onChange={(v) => set(q.id, v)} onOther={(t) => setOthers((o) => ({ ...o, [q.id]: t }))} />
      ))}
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button variant="primary" icon={Send} loading={busy} onClick={() => void submit()}>
          제출하기
        </Button>
        <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => (setAnswers({}), setOthers({}))}>
          양식 지우기
        </button>
      </div>
    </>,
  )
}

function QuestionField({ q, value, other, invalid, onChange, onOther }: { q: Question; value: Answer | undefined; other: string; invalid: boolean; onChange: (v: Answer | undefined) => void; onOther: (t: string) => void }) {
  if (q.type === 'section')
    return (
      <div className="rounded-xl border border-line bg-surface px-5 py-4 sm:px-6">
        <h2 className="text-lg">{q.title}</h2>
        {q.desc && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{q.desc}</p>}
      </div>
    )
  const input = 'w-full rounded-md border border-line bg-paper px-3 py-2 text-[15px] text-ink outline-none focus:border-brand'
  const list = Array.isArray(value) ? value : []
  return (
    <div id={`q-${q.id}`} className={clsx('scroll-mt-6 rounded-xl border bg-surface px-5 py-5 sm:px-6', invalid ? 'border-danger ring-1 ring-danger' : 'border-line')}>
      <p className="text-[15px] font-semibold text-ink">
        {q.title || '질문'}
        {q.required && <span className="ml-1 text-danger">*</span>}
      </p>
      {q.desc && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{q.desc}</p>}
      <div className="mt-3">
        {q.type === 'short' && (
          <input
            className={input}
            type={q.format === 'email' ? 'email' : q.format === 'phone' ? 'tel' : 'text'}
            inputMode={q.format === 'number' ? 'decimal' : q.format === 'phone' ? 'tel' : undefined}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder="내 답변"
            aria-label={q.title}
          />
        )}
        {q.type === 'long' && <textarea className={clsx(input, 'min-h-28 resize-y')} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="내 답변" aria-label={q.title} />}
        {q.type === 'date' && <input className={clsx(input, 'w-auto')} type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} aria-label={q.title} />}
        {q.type === 'time' && <input className={clsx(input, 'w-auto')} type="time" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} aria-label={q.title} />}
        {q.type === 'select' && (
          <select className={clsx(input, 'w-auto min-w-48')} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || undefined)} aria-label={q.title}>
            <option value="">선택</option>
            {q.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        {(q.type === 'radio' || q.type === 'checkbox') && (
          <div className="flex flex-col gap-1" role={q.type === 'radio' ? 'radiogroup' : 'group'} aria-label={q.title}>
            {[...(q.options ?? []), ...(q.other ? ['__other'] : [])].map((o) => {
              const checked = q.type === 'radio' ? value === o : list.includes(o)
              return (
                <label key={o} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-sunken">
                  <input
                    type={q.type}
                    name={q.id}
                    checked={checked}
                    onChange={(e) => (q.type === 'radio' ? onChange(o) : onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o)))}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  {o === '__other' ? (
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="shrink-0 whitespace-nowrap text-[15px] text-ink">기타:</span>
                      <input
                        className="min-w-0 flex-1 border-0 border-b border-line bg-transparent py-0.5 text-[15px] outline-none focus:border-brand"
                        value={other}
                        onChange={(e) => {
                          onOther(e.target.value)
                          if (e.target.value && !checked) q.type === 'radio' ? onChange('__other') : onChange([...list, '__other'])
                        }}
                        aria-label={`${q.title} 기타 직접 입력`}
                      />
                    </span>
                  ) : (
                    <span className="text-[15px] text-ink">{o}</span>
                  )}
                </label>
              )
            })}
            {q.type === 'radio' && value !== undefined && !q.required && (
              <button type="button" className="self-start px-2 text-xs text-muted hover:text-ink" onClick={() => onChange(undefined)}>
                선택 지우기
              </button>
            )}
          </div>
        )}
        {q.type === 'scale' && q.scale && (
          <div className="flex flex-wrap items-end gap-2 sm:gap-3">
            <span className="pb-2 text-xs text-muted">{q.scale.minLabel}</span>
            {Array.from({ length: q.scale.max - q.scale.min + 1 }, (_, i) => q.scale!.min + i).map((n) => (
              <label key={n} className="flex cursor-pointer flex-col items-center gap-1">
                <span className="text-sm text-ink-2">{n}</span>
                <input type="radio" name={q.id} checked={value === n} onChange={() => onChange(n)} className="size-5 accent-[var(--color-brand)]" aria-label={`${n}점`} />
              </label>
            ))}
            <span className="pb-2 text-xs text-muted">{q.scale.maxLabel}</span>
          </div>
        )}
      </div>
      {invalid && <p className="mt-2 text-sm text-danger">꼭 답해야 하는 질문입니다.</p>}
    </div>
  )
}
