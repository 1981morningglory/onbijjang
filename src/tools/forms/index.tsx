import clsx from 'clsx'
import { ArrowDown, ArrowLeft, ArrowUp, BarChart3, ClipboardList, Copy, ExternalLink, FileDown, FileSpreadsheet, FileText, Link2, ListChecks, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { downloadBlob } from '@/lib/files'
import { Badge, Button, Callout, EmptyState, IconButton, Panel, Segmented, Select, Spinner, Switch, Tabs, Textarea, TextInput, toast } from '@/ui'
import { writeTable } from '@/tools/orders/excel'
import { exportPdf } from '@/tools/saju/share'
import { changeType, DEFAULT_SETTINGS, FORMAT_LABEL, fileSafe, formatAt, newQuestion, qid, responseRows, summarize, TEMPLATES, TYPE_LABEL, answerText, type Form, type FormSummary, type QType, type Question, type Response } from './logic'

type View = { mode: 'list' } | { mode: 'edit'; id: string | null } | { mode: 'responses'; id: string }
const readView = (): View => {
  const p = new URLSearchParams(location.search)
  const id = p.get('form')
  if (id && p.get('view') === 'responses') return { mode: 'responses', id }
  if (id) return { mode: 'edit', id }
  return { mode: 'list' }
}
const message = (e: unknown) => (e instanceof Error ? e.message : '처리하지 못했습니다.')
const shareLink = (f: { links?: { full: string; short: string }; settings: { linkType: 'short' | 'full' } }) => (f.links ? (f.settings.linkType === 'full' ? f.links.full : f.links.short) : '')
const copy = (text: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast.success('링크를 복사했습니다. 메신저·문자에 붙여 넣어 보내세요.'),
    () => toast.error('복사하지 못했습니다. 링크를 길게 눌러 복사해 주세요.'),
  )

/** 설문폼 — 목록 · 만들기/편집 · 응답 보기. 화면 상태는 주소(?form=…&view=…)에도 남긴다 */
export default function FormsTool() {
  const [view, setViewState] = useState<View>(readView)
  const setView = (v: View) => {
    setViewState(v)
    const u = new URL(location.href)
    u.searchParams.delete('form')
    u.searchParams.delete('view')
    if (v.mode !== 'list' && v.id) u.searchParams.set('form', v.id)
    if (v.mode === 'responses') u.searchParams.set('view', 'responses')
    history.replaceState(history.state, '', u)
    window.scrollTo({ top: 0 })
  }
  const [template, setTemplate] = useState<string>('blank')
  if (view.mode === 'edit') return <Editor id={view.id} template={template} onBack={() => setView({ mode: 'list' })} onSaved={(id) => setView({ mode: 'edit', id })} onResponses={(id) => setView({ mode: 'responses', id })} />
  if (view.mode === 'responses') return <Responses id={view.id} onBack={() => setView({ mode: 'list' })} onEdit={() => setView({ mode: 'edit', id: view.id })} />
  return (
    <FormList
      onNew={(t) => {
        setTemplate(t)
        setView({ mode: 'edit', id: null })
      }}
      onEdit={(id) => setView({ mode: 'edit', id })}
      onResponses={(id) => setView({ mode: 'responses', id })}
    />
  )
}

// ── 목록 ──────────────────────────────────────────────────
function FormList({ onNew, onEdit, onResponses }: { onNew: (template: string) => void; onEdit: (id: string) => void; onResponses: (id: string) => void }) {
  const [forms, setForms] = useState<FormSummary[] | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const load = useCallback(() => {
    api<{ forms: FormSummary[]; isAdmin: boolean }>('/forms')
      .then((r) => {
        setForms(r.forms)
        setIsAdmin(r.isAdmin)
      })
      .catch((e) => setError(e instanceof ApiError && e.status === 401 ? e.message : message(e)))
  }, [])
  useEffect(load, [load])
  const remove = async (f: FormSummary) => {
    if (!confirm(`‘${f.title}’ 설문을 지울까요?\n받은 응답 ${f.responses}개도 함께 지워지고 링크도 더 이상 열리지 않습니다.`)) return
    try {
      await api(`/forms/${f.id}`, { method: 'DELETE' })
      setForms((l) => l?.filter((x) => x.id !== f.id) ?? null)
      toast.success('설문을 지웠습니다.')
    } catch (e) {
      toast.error(message(e))
    }
  }
  const duplicate = async (f: FormSummary) => {
    try {
      const full = (await api<{ form: Form }>(`/forms/${f.id}`)).form
      await api('/forms', { method: 'POST', body: { title: `${full.title} (사본)`, description: full.description, questions: full.questions.map((x) => ({ ...x, id: qid() })), settings: full.settings } })
      toast.success('사본을 만들었습니다.')
      load()
    } catch (e) {
      toast.error(message(e))
    }
  }
  const excel = async (f: FormSummary) => {
    try {
      const r = await api<{ form: Form; responses: Response[] }>(`/forms/${f.id}/responses`)
      const { head, rows } = responseRows(r.form, r.responses)
      downloadBlob(await writeTable('응답', head, rows), `${fileSafe(r.form.title)}_응답.xlsx`)
    } catch (e) {
      toast.error(message(e))
    }
  }
  if (error) return <Callout tone="warn" title="설문폼을 열 수 없습니다">{error}</Callout>
  const list = (forms ?? []).filter((f) => !q.trim() || `${f.title} ${f.description}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-base">새 설문 만들기</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {TEMPLATES.map((t) => (
            <button key={t.key} type="button" onClick={() => onNew(t.key)} className="group flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-brand hover:bg-brand-soft/40">
              <span className={clsx('grid size-10 place-items-center rounded-lg', t.key === 'blank' ? 'bg-sunken text-ink-2' : 'bg-brand-soft text-brand-ink')}>{t.key === 'blank' ? <Plus className="size-5" aria-hidden /> : <ClipboardList className="size-5" aria-hidden />}</span>
              <span className="font-semibold text-ink">{t.name}</span>
              <span className="text-xs leading-relaxed text-muted">{t.note}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base">{isAdmin ? '모든 설문' : '내 설문'}</h2>
          {forms && <span className="text-sm text-muted">{forms.length}개</span>}
          <TextInput aria-label="설문 찾기" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목으로 찾기" className="ml-auto w-56!" />
          <IconButton icon={RefreshCw} label="새로 고침" onClick={load} />
        </div>
        {!forms ? (
          <div className="flex items-center gap-2 text-muted">
            <Spinner /> 불러오는 중
          </div>
        ) : !forms.length ? (
          <EmptyState icon={ClipboardList} title="아직 만든 설문이 없습니다" className="py-14">
            위 템플릿 중 하나를 골라 시작해 보세요.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-semibold">설문</th>
                  <th className="px-3 py-2.5 font-semibold">상태</th>
                  <th className="px-3 py-2.5 text-right font-semibold">응답</th>
                  <th className="px-3 py-2.5 font-semibold">마지막 응답</th>
                  <th className="px-3 py-2.5 font-semibold">고친 날</th>
                  <th className="px-3 py-2.5 text-right font-semibold">관리</th>
                </tr>
              </thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.id} className="border-b border-line/60 last:border-0 hover:bg-paper/60">
                    <td className="max-w-[320px] px-4 py-3">
                      <button type="button" className="block truncate text-left font-semibold text-ink hover:underline" onClick={() => onEdit(f.id)}>
                        {f.title}
                      </button>
                      <span className="block truncate text-xs text-muted">
                        질문 {f.questions}개{isAdmin ? ` · ${f.ownerName}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-3">{f.open ? <Badge tone="brand">응답 받는 중</Badge> : <Badge>마감</Badge>}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{f.responses}</td>
                    <td className="px-3 py-3 text-xs text-muted">{f.lastResponseAt ? formatAt(f.lastResponseAt) : '-'}</td>
                    <td className="px-3 py-3 text-xs text-muted">{formatAt(f.updatedAt).slice(0, 10)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-0.5">
                        <IconButton icon={BarChart3} label="응답 보기" size="sm" onClick={() => onResponses(f.id)} />
                        <IconButton icon={Pencil} label="편집" size="sm" onClick={() => onEdit(f.id)} />
                        <IconButton icon={Link2} label="응답 링크 복사" size="sm" onClick={() => void copy(shareLink(f))} />
                        <IconButton icon={FileSpreadsheet} label="응답 엑셀로 받기" size="sm" onClick={() => void excel(f)} />
                        <IconButton icon={Copy} label="사본 만들기" size="sm" onClick={() => void duplicate(f)} />
                        <IconButton icon={Trash2} label="지우기" size="sm" onClick={() => void remove(f)} />
                      </div>
                    </td>
                  </tr>
                ))}
                {!list.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted">
                      맞는 설문이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ── 만들기·편집 ───────────────────────────────────────────
function Editor({ id, template, onBack, onSaved, onResponses }: { id: string | null; template: string; onBack: () => void; onSaved: (id: string) => void; onResponses: (id: string) => void }) {
  const [form, setForm] = useState<Form | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    if (!id) {
      const t = TEMPLATES.find((x) => x.key === template) ?? TEMPLATES[0]
      const made = t.make()
      setForm({ id: '', ...made, settings: { ...DEFAULT_SETTINGS } })
      setDirty(true)
      setActive(made.questions[0]?.id ?? null)
      return
    }
    api<{ form: Form }>(`/forms/${id}`)
      .then((r) => {
        setForm(r.form)
        setDirty(false)
      })
      .catch((e) => setError(message(e)))
  }, [id, template])
  // 저장하지 않고 떠나면 묻기
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])
  const patch = (p: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...p } : f))
    setDirty(true)
  }
  const setQ = (qid: string, p: Partial<Question>) => patch({ questions: form!.questions.map((q) => (q.id === qid ? { ...q, ...p } : q)) })
  const replaceQ = (qid: string, next: Question) => patch({ questions: form!.questions.map((q) => (q.id === qid ? next : q)) })
  const move = (i: number, d: -1 | 1) => {
    const list = [...form!.questions]
    const j = i + d
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    patch({ questions: list })
  }
  const addQ = (type: QType = 'radio', at?: number) => {
    const q = newQuestion(type)
    const list = [...form!.questions]
    list.splice(at === undefined ? list.length : at + 1, 0, q)
    patch({ questions: list })
    setActive(q.id)
    setTimeout(() => document.getElementById(`edit-${q.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
  }
  const save = async () => {
    if (!form) return
    if (!form.questions.length) return toast.error('질문을 하나 이상 넣어 주세요.')
    const empty = form.questions.find((q) => q.type !== 'section' && !q.title.trim())
    if (empty) {
      setActive(empty.id)
      document.getElementById(`edit-${empty.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return toast.error('제목이 빈 질문이 있습니다. 질문 내용을 적어 주세요.')
    }
    setBusy(true)
    try {
      const body = { title: form.title, description: form.description, questions: form.questions, settings: form.settings }
      const r = form.id ? await api<{ form: Form }>(`/forms/${form.id}`, { method: 'PUT', body }) : await api<{ form: Form }>('/forms', { method: 'POST', body })
      setForm(r.form)
      setDirty(false)
      toast.success(form.id ? '저장했습니다.' : '설문을 만들었습니다. 오른쪽 링크를 복사해 보내세요.')
      if (!form.id) onSaved(r.form.id)
    } catch (e) {
      toast.error(message(e))
    } finally {
      setBusy(false)
    }
  }
  const back = () => {
    if (dirty && !confirm('저장하지 않은 내용이 있습니다. 그래도 목록으로 갈까요?')) return
    onBack()
  }
  if (error) return <Callout tone="warn" title="설문을 열 수 없습니다">{error}</Callout>
  if (!form)
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> 불러오는 중
      </div>
    )
  const link = shareLink(form)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={back}>
          설문 목록
        </Button>
        <span className="text-sm text-muted">{form.id ? (dirty ? '저장하지 않은 변경이 있습니다' : '저장됨') : '새 설문(아직 저장 전)'}</span>
        <div className="ml-auto flex gap-2">
          {form.id && (
            <Button icon={BarChart3} onClick={() => (dirty && !confirm('저장하지 않은 내용이 있습니다. 그래도 응답 화면으로 갈까요?') ? null : onResponses(form.id))}>
              응답 {form.responseCount ?? 0}개 보기
            </Button>
          )}
          <Button variant="primary" icon={Save} loading={busy} disabled={!dirty && Boolean(form.id)} onClick={() => void save()}>
            {form.id ? '저장' : '만들기'}
          </Button>
        </div>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3">
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="h-2.5 bg-brand" />
            <div className="flex flex-col gap-2 px-5 py-4">
              <input value={form.title} onChange={(e) => patch({ title: e.target.value })} aria-label="설문 제목" placeholder="설문 제목" className="w-full border-0 border-b border-transparent bg-transparent py-1 text-2xl font-bold text-ink outline-none focus:border-brand" />
              <textarea value={form.description} onChange={(e) => patch({ description: e.target.value })} aria-label="설문 설명" placeholder="설문 설명(응답하는 사람에게 보입니다)" rows={2} className="w-full resize-y border-0 border-b border-transparent bg-transparent py-1 text-[15px] text-ink-2 outline-none focus:border-brand" />
            </div>
          </div>
          {form.questions.map((q, i) => (
            <QuestionEditor
              key={q.id}
              q={q}
              index={i}
              total={form.questions.length}
              active={active === q.id}
              onFocus={() => setActive(q.id)}
              onChange={(p) => setQ(q.id, p)}
              onType={(t) => replaceQ(q.id, changeType(q, t))}
              onMove={(d) => move(i, d)}
              onCopy={() => {
                const c = { ...q, id: qid(), options: q.options ? [...q.options] : undefined }
                const list = [...form.questions]
                list.splice(i + 1, 0, c)
                patch({ questions: list })
                setActive(c.id)
              }}
              onDelete={() => patch({ questions: form.questions.filter((x) => x.id !== q.id) })}
              onAddAfter={() => addQ('radio', i)}
            />
          ))}
          <div className="flex flex-wrap gap-2">
            <Button icon={Plus} onClick={() => addQ('radio')}>
              질문 추가
            </Button>
            <Button variant="ghost" icon={FileText} onClick={() => addQ('section')}>
              안내 문구 추가
            </Button>
          </div>
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <Panel className="flex flex-col gap-3 p-4">
            <h3 className="flex items-center gap-2 text-[15px]">
              <Link2 className="size-4 text-brand" aria-hidden /> 응답 링크 보내기
            </h3>
            <Segmented
              label="링크 모양"
              size="sm"
              block
              value={form.settings.linkType}
              onValue={(v) => patch({ settings: { ...form.settings, linkType: v } })}
              options={[
                { value: 'short', label: '짧은 주소' },
                { value: 'full', label: '전체 주소' },
              ]}
            />
            {form.id ? (
              <>
                <div className="break-all rounded-md border border-line bg-paper px-3 py-2 font-mono text-xs text-ink-2">{link}</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" icon={Copy} className="flex-1" onClick={() => void copy(link)}>
                    링크 복사
                  </Button>
                  <Button size="sm" icon={ExternalLink} onClick={() => window.open(link, '_blank', 'noopener')}>
                    미리 보기
                  </Button>
                </div>
                {dirty && <p className="text-xs text-warn">바꾼 내용은 ‘저장’을 눌러야 응답 화면에 반영됩니다.</p>}
              </>
            ) : (
              <p className="text-xs text-muted">‘만들기’를 누르면 응답 링크가 생깁니다.</p>
            )}
            <p className="text-xs leading-relaxed text-muted">짧은 주소는 문자·카카오톡으로 보내기 좋고, 전체 주소는 설문 번호가 그대로 보입니다. 어느 쪽이든 같은 설문이 열립니다.</p>
          </Panel>
          <Panel className="flex flex-col gap-3 p-4">
            <h3 className="text-[15px]">설정</h3>
            <Switch checked={form.settings.open} onChange={(v) => patch({ settings: { ...form.settings, open: v } })} label="응답 받기" hint="끄면 링크를 열어도 ‘마감’으로 보입니다." />
            <div className="flex flex-col gap-1">
              <label htmlFor="close-at" className="text-sm font-medium text-ink-2">
                자동 마감 시각(선택)
              </label>
              <div className="flex gap-2">
                <input
                  id="close-at"
                  type="datetime-local"
                  value={form.settings.closeAt ? new Date(Date.parse(form.settings.closeAt) + 9 * 3600e3).toISOString().slice(0, 16) : ''}
                  onChange={(e) => patch({ settings: { ...form.settings, closeAt: e.target.value ? new Date(`${e.target.value}:00+09:00`).toISOString() : null } })}
                  className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                />
                {form.settings.closeAt && <IconButton icon={X} label="마감 시각 지우기" size="sm" onClick={() => patch({ settings: { ...form.settings, closeAt: null } })} />}
              </div>
            </div>
            <Switch checked={form.settings.oneResponse} onChange={(v) => patch({ settings: { ...form.settings, oneResponse: v } })} label="한 사람 한 번만" hint="같은 기기·브라우저에서는 한 번만 응답할 수 있습니다." />
            <div className="flex flex-col gap-1">
              <label htmlFor="thanks" className="text-sm font-medium text-ink-2">
                제출 뒤 보일 문구
              </label>
              <Textarea id="thanks" value={form.settings.thanks} onChange={(e) => patch({ settings: { ...form.settings, thanks: e.target.value } })} className="min-h-16!" />
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}

function QuestionEditor({
  q,
  index,
  total,
  active,
  onFocus,
  onChange,
  onType,
  onMove,
  onCopy,
  onDelete,
  onAddAfter,
}: {
  q: Question
  index: number
  total: number
  active: boolean
  onFocus: () => void
  onChange: (p: Partial<Question>) => void
  onType: (t: QType) => void
  onMove: (d: -1 | 1) => void
  onCopy: () => void
  onDelete: () => void
  onAddAfter: () => void
}) {
  const optRefs = useRef<Array<HTMLInputElement | null>>([])
  const focusOpt = useRef<number | null>(null)
  const choice = q.type === 'radio' || q.type === 'checkbox' || q.type === 'select'
  const setOpt = (i: number, v: string) => onChange({ options: (q.options ?? []).map((o, j) => (j === i ? v : o)) })
  const addOpt = () => {
    const opts = [...(q.options ?? []), `옵션 ${(q.options?.length ?? 0) + 1}`]
    focusOpt.current = opts.length - 1
    onChange({ options: opts })
  }
  // 새 보기가 그려지자마자 그 칸으로(빨리 이어 쳐도 앞 보기에 들어가지 않게)
  useLayoutEffect(() => {
    if (focusOpt.current === null) return
    optRefs.current[focusOpt.current]?.select()
    focusOpt.current = null
  }, [q.options?.length])
  return (
    <div id={`edit-${q.id}`} onFocus={onFocus} onClick={onFocus} className={clsx('scroll-mt-24 rounded-xl border bg-surface transition-shadow', active ? 'border-brand shadow-2' : 'border-line')}>
      <div className={clsx('flex flex-col gap-3 px-5 py-4', active && 'border-l-4 border-l-brand pl-4')}>
        <div className="flex flex-wrap items-start gap-2">
          <input
            value={q.title}
            onChange={(e) => onChange({ title: e.target.value })}
            aria-label={`질문 ${index + 1} 제목`}
            placeholder={q.type === 'section' ? '안내 제목' : '질문'}
            className="min-w-0 flex-1 rounded-md border-0 bg-sunken/60 px-3 py-2.5 text-[15px] font-semibold text-ink outline-none focus:bg-sunken focus:ring-1 focus:ring-brand"
          />
          <Select<QType> aria-label={`질문 ${index + 1} 종류`} value={q.type} onValue={onType} className="w-auto! min-w-48" options={(Object.keys(TYPE_LABEL) as QType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
        </div>
        <input value={q.desc} onChange={(e) => onChange({ desc: e.target.value })} aria-label={`질문 ${index + 1} 설명`} placeholder="설명(선택)" className="w-full border-0 border-b border-line/70 bg-transparent py-1 text-sm text-ink-2 outline-none focus:border-brand" />

        {choice && (
          <div className="flex flex-col gap-1.5">
            {(q.options ?? []).map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={clsx('grid size-4 shrink-0 place-items-center border border-line-strong', q.type === 'radio' ? 'rounded-full' : q.type === 'checkbox' ? 'rounded-xs' : 'rounded-none border-0 text-xs text-muted')}>{q.type === 'select' ? `${i + 1}.` : ''}</span>
                <input
                  ref={(el) => {
                    optRefs.current[i] = el
                  }}
                  value={o}
                  onChange={(e) => setOpt(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addOpt()
                    }
                  }}
                  aria-label={`질문 ${index + 1} 보기 ${i + 1}`}
                  className="min-w-0 flex-1 border-0 border-b border-transparent bg-transparent py-1 text-[15px] outline-none hover:border-line focus:border-brand"
                />
                {(q.options?.length ?? 0) > 1 && <IconButton icon={X} label={`보기 ${i + 1} 지우기`} size="sm" onClick={() => onChange({ options: q.options!.filter((_, j) => j !== i) })} />}
              </div>
            ))}
            {q.other && (
              <div className="flex items-center gap-2 text-[15px] text-muted">
                <span className={clsx('size-4 shrink-0 border border-line-strong', q.type === 'radio' ? 'rounded-full' : 'rounded-xs')} />
                기타(직접 입력)
                <IconButton icon={X} label="기타 지우기" size="sm" onClick={() => onChange({ other: false })} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pl-6 text-sm">
              <button type="button" className="text-muted hover:text-ink" onClick={addOpt}>
                보기 추가
              </button>
              {q.type !== 'select' && !q.other && (
                <>
                  <span className="text-muted">또는</span>
                  <button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => onChange({ other: true })}>
                    ‘기타’ 추가
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {q.type === 'short' && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="flex-1 border-b border-dashed border-line py-1">단답형 답변</span>
            <Select aria-label={`질문 ${index + 1} 입력 형식`} value={q.format ?? 'text'} onValue={(v) => onChange({ format: v })} className="w-auto!" options={(Object.keys(FORMAT_LABEL) as Array<keyof typeof FORMAT_LABEL>).map((k) => ({ value: k, label: `형식: ${FORMAT_LABEL[k]}` }))} />
          </div>
        )}
        {q.type === 'long' && <div className="border-b border-dashed border-line py-1 text-sm text-muted">장문형 답변</div>}
        {q.type === 'date' && <div className="w-40 border-b border-dashed border-line py-1 text-sm text-muted">년-월-일</div>}
        {q.type === 'time' && <div className="w-28 border-b border-dashed border-line py-1 text-sm text-muted">시:분</div>}
        {q.type === 'scale' && q.scale && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Select aria-label="최소 점수" value={String(q.scale.min)} onValue={(v) => onChange({ scale: { ...q.scale!, min: Number(v) } })} className="w-auto!" options={['0', '1'].map((v) => ({ value: v, label: v }))} />
            <span className="text-muted">~</span>
            <Select aria-label="최대 점수" value={String(q.scale.max)} onValue={(v) => onChange({ scale: { ...q.scale!, max: Number(v) } })} className="w-auto!" options={['3', '4', '5', '6', '7', '8', '9', '10'].map((v) => ({ value: v, label: v }))} />
            <input value={q.scale.minLabel} onChange={(e) => onChange({ scale: { ...q.scale!, minLabel: e.target.value } })} aria-label="최소 점수 설명" placeholder="낮은 쪽 설명" className="w-32 rounded-md border border-line bg-paper px-2 py-1" />
            <input value={q.scale.maxLabel} onChange={(e) => onChange({ scale: { ...q.scale!, maxLabel: e.target.value } })} aria-label="최대 점수 설명" placeholder="높은 쪽 설명" className="w-32 rounded-md border border-line bg-paper px-2 py-1" />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1 border-t border-line pt-2">
          <IconButton icon={ArrowUp} label="위로" size="sm" disabled={index === 0} onClick={() => onMove(-1)} />
          <IconButton icon={ArrowDown} label="아래로" size="sm" disabled={index === total - 1} onClick={() => onMove(1)} />
          <IconButton icon={Plus} label="아래에 질문 추가" size="sm" onClick={onAddAfter} />
          <span className="ml-auto" />
          <IconButton icon={Copy} label="질문 복제" size="sm" onClick={onCopy} />
          <IconButton icon={Trash2} label="질문 지우기" size="sm" onClick={onDelete} />
          {q.type !== 'section' && (
            <>
              <span className="mx-2 h-5 w-px bg-line" />
              <Switch checked={q.required} onChange={(v) => onChange({ required: v })} label="필수" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 응답 ──────────────────────────────────────────────────
function Responses({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit: () => void }) {
  const [data, setData] = useState<{ form: Form; responses: Response[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'summary' | 'each' | 'table'>('summary')
  const [pdfBusy, setPdfBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const load = useCallback(() => {
    api<{ form: Form; responses: Response[] }>(`/forms/${id}/responses`)
      .then(setData)
      .catch((e) => setError(message(e)))
  }, [id])
  useEffect(load, [load])
  // 응답 받는 중이면 30초마다 새로
  useEffect(() => {
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])
  const summary = useMemo(() => (data ? summarize(data.form, data.responses) : []), [data])
  if (error) return <Callout tone="warn" title="응답을 불러오지 못했습니다">{error}</Callout>
  if (!data)
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> 불러오는 중
      </div>
    )
  const { form, responses } = data
  const excel = async () => {
    const { head, rows } = responseRows(form, responses)
    downloadBlob(await writeTable('응답', head, rows), `${fileSafe(form.title)}_응답.xlsx`)
  }
  const pdf = async () => {
    if (!box.current) return
    setPdfBusy(true)
    try {
      await exportPdf(box.current, `${fileSafe(form.title)}_${tab === 'summary' ? '요약' : '응답'}.pdf`, form.title)
    } catch (e) {
      toast.error(message(e))
    } finally {
      setPdfBusy(false)
    }
  }
  const removeOne = async (r: Response) => {
    if (!confirm('이 응답을 지울까요? 되돌릴 수 없습니다.')) return
    try {
      const res = await api<{ responses: Response[] }>(`/forms/${id}/responses/${r.id}`, { method: 'DELETE' })
      setData({ form, responses: res.responses })
    } catch (e) {
      toast.error(message(e))
    }
  }
  const removeAll = async () => {
    if (!confirm(`응답 ${responses.length}개를 모두 지울까요? 되돌릴 수 없습니다.\n지우기 전에 엑셀로 받아 두는 것을 권합니다.`)) return
    try {
      const res = await api<{ responses: Response[] }>(`/forms/${id}/responses/all`, { method: 'DELETE' })
      setData({ form, responses: res.responses })
    } catch (e) {
      toast.error(message(e))
    }
  }
  const { head, rows } = responseRows(form, responses)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
          설문 목록
        </Button>
        <div className="min-w-0">
          <h2 className="truncate text-lg">{form.title}</h2>
          <p className="text-xs text-muted">
            응답 {responses.length}개{responses.length ? ` · 마지막 ${formatAt(responses[responses.length - 1].at)}` : ''}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" icon={Link2} onClick={() => void copy(shareLink(form))}>
            응답 링크
          </Button>
          <Button size="sm" icon={Pencil} onClick={onEdit}>
            편집
          </Button>
          <IconButton icon={RefreshCw} label="새로 고침" onClick={load} />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Tabs
          label="응답 보기"
          value={tab}
          onValue={setTab}
          className="min-w-0 flex-1"
          tabs={[
            { value: 'summary', label: '요약', icon: BarChart3 },
            { value: 'each', label: '개별 응답', icon: ListChecks },
            { value: 'table', label: '표', icon: FileSpreadsheet },
          ]}
        />
        <div className="flex flex-wrap gap-2 pb-1.5">
          <Button size="sm" icon={FileSpreadsheet} disabled={!responses.length} onClick={() => void excel()}>
            엑셀
          </Button>
          <a href={`/api/forms/${id}/responses.csv`} className={clsx('inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink-2 hover:border-line-strong', !responses.length && 'pointer-events-none opacity-45')}>
            <FileDown className="size-4" aria-hidden /> CSV(서버 파일)
          </a>
          <Button size="sm" icon={FileText} loading={pdfBusy} disabled={!responses.length || tab === 'table'} onClick={() => void pdf()} title={tab === 'table' ? '요약·개별 응답 탭에서 PDF 로 받을 수 있습니다' : undefined}>
            PDF
          </Button>
        </div>
      </div>
      {!responses.length ? (
        <EmptyState icon={BarChart3} title="아직 응답이 없습니다" className="py-14">
          응답 링크를 복사해 보내면 여기에 바로 쌓입니다.
        </EmptyState>
      ) : (
        <div ref={box} className="flex flex-col gap-3">
          {tab !== 'table' && (
            <div data-pdf-block className="rounded-xl border border-line bg-surface px-5 py-4">
              <h3 className="text-lg">{form.title}</h3>
              <p className="text-sm text-muted">
                응답 {responses.length}개 · {formatAt(new Date().toISOString())} 기준
              </p>
            </div>
          )}
          {tab === 'summary' &&
            summary.map((s) => (
              <div key={s.q.id} data-pdf-block className="rounded-xl border border-line bg-surface px-5 py-4">
                <p className="font-semibold text-ink">{s.q.title || '질문'}</p>
                <p className="mb-3 text-xs text-muted">
                  응답 {s.answered}개{s.average !== undefined ? ` · 평균 ${s.average}점` : ''}
                </p>
                {s.counts && (
                  <div className="flex flex-col gap-1.5">
                    {s.counts.map((c) => {
                      const base = s.q.type === 'checkbox' ? responses.length : Math.max(1, s.answered)
                      const pct = base ? Math.round((c.n / base) * 100) : 0
                      return (
                        <div key={c.label} className="grid grid-cols-[minmax(90px,200px)_1fr_auto] items-center gap-3 text-sm">
                          <span className="truncate text-ink-2" title={c.label}>
                            {c.label}
                          </span>
                          <span className="h-5 overflow-hidden rounded bg-sunken">
                            <span className="block h-full rounded bg-brand" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="w-20 text-right tabular-nums text-muted">
                            {c.n}명 ({pct}%)
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
                {s.texts && (
                  <ul className={clsx('flex max-h-72 flex-col gap-1 overflow-auto', s.counts && 'mt-3 border-t border-line pt-2')}>
                    {s.texts.slice(-100).reverse().map((t, i) => (
                      <li key={i} className="rounded-md bg-paper px-3 py-1.5 text-sm text-ink-2">
                        {t}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          {tab === 'each' &&
            [...responses].reverse().map((r, idx) => (
              <div key={r.id} data-pdf-block className="rounded-xl border border-line bg-surface px-5 py-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-semibold text-ink">응답 {responses.length - idx}</span>
                  <span className="text-xs text-muted">{formatAt(r.at)}</span>
                  <span className="ml-auto" data-pdf-skip>
                    <IconButton icon={Trash2} label="이 응답 지우기" size="sm" onClick={() => void removeOne(r)} />
                  </span>
                </div>
                <dl className="flex flex-col gap-2">
                  {form.questions
                    .filter((q) => q.type !== 'section')
                    .map((q) => (
                      <div key={q.id}>
                        <dt className="text-xs text-muted">{q.title || '질문'}</dt>
                        <dd className="whitespace-pre-wrap text-[15px] text-ink">{answerText(r.answers?.[q.id]) || <span className="text-muted">(답 없음)</span>}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            ))}
          {tab === 'table' && (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper text-left text-xs text-muted">
                    {head.map((h, i) => (
                      <th key={i} className="whitespace-nowrap px-3 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-line/60 align-top last:border-0">
                      {r.map((c, j) => (
                        <td key={j} className={clsx('px-3 py-2', j < 2 ? 'whitespace-nowrap text-muted' : 'min-w-40 text-ink')}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end" data-pdf-skip>
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void removeAll()}>
              응답 모두 지우기
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
