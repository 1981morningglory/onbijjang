import clsx from 'clsx'
import { BookUser, CheckCircle2, ClipboardPaste, Download, FileText, Inbox, Mail, MailPlus, Paperclip, Plug, Plus, RefreshCw, Reply, Save, Search, Send, Trash2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react'
import { downloadBlob } from '@/lib/files'
import { Badge, Button, Callout, Checkbox, Dialog, EmptyState, Field, IconButton, Panel, Segmented, Select, Spinner, Textarea, TextInput, toast } from '@/ui'
import {
  blobToBase64,
  defaultBody,
  defaultSubject,
  deleteSaved,
  fetchSavedFile,
  fileSize,
  isEmail,
  labelOf,
  loadLog,
  loadMail,
  loadSaved,
  MAX_ATTACH,
  plainBody,
  providerFor,
  removeAccount,
  resolveRecipient,
  saveAccount,
  saveBook,
  sendMail,
  splitTokens,
  testAccount,
  type BookEntry,
  type MailLogEntry,
  type MailState,
  type SavedMail,
} from './mail'
import { uid, type CompanyKit, type Contact, type QuoteDoc } from './model'
import { useTeam } from './team'

const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

// ── 받는 사람·참조·숨은 참조 칸 ─────────────────────────
// 이름이나 주소를 넣고 Enter(또는 쉼표) → 주소 칩. [+] 는 넣던 글을 넣고 주소록 목록을 펼친다.
function RecipientField({ label, value, onChange, book }: { label: string; value: string[]; onChange: (v: string[]) => void; book: BookEntry[] }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const listId = useId()
  const has = (email: string) => value.some((x) => x.toLowerCase() === email.toLowerCase())
  /** 넣은 글을 주소로 바꿔 더한다. 못 바꾼 글은 칸에 남겨 고치게 한다 */
  const commit = (raw = text) => {
    const tokens = splitTokens(raw)
    if (!tokens.length) return setText('')
    const next = [...value]
    const left: string[] = []
    const errs: string[] = []
    for (const t of tokens) {
      const r = resolveRecipient(t, book)
      if ('email' in r) {
        if (!next.some((x) => x.toLowerCase() === r.email.toLowerCase())) next.push(r.email)
      } else {
        left.push(t)
        errs.push(r.error)
      }
    }
    onChange(next)
    setText(left.join(', '))
    setError(errs[0] ?? '')
  }
  const shown = book.filter((b) => !query.trim() || `${b.name} ${b.org} ${b.email}`.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <Field label={label} error={error || undefined}>
      {(id) => (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-1.5">
            <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1 rounded-md border border-line-strong bg-surface px-1.5 py-1 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
              {value.map((email) => (
                <span key={email} className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-soft py-0.5 pr-1 pl-2.5 text-xs font-semibold text-brand-ink">
                  <span className="truncate">{labelOf(email, book)}</span>
                  <button type="button" aria-label={`${email} 빼기`} className="rounded-full p-0.5 hover:bg-brand/15" onClick={() => onChange(value.filter((x) => x !== email))}>
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
              <input
                id={id}
                list={listId}
                value={text}
                autoComplete="off"
                placeholder={value.length ? '' : '이름 또는 메일 주소 (Enter)'}
                className="h-7 min-w-36 flex-1 bg-transparent px-1 text-sm outline-none"
                onChange={(e) => {
                  const v = e.target.value
                  setError('')
                  // 목록에서 고르면(‘홍길동(영업팀) <주소>’) 바로 넣는다. 쉼표·세미콜론을 치면 앞부분을 넣는다
                  if (/<[^<>]+@[^<>]+>\s*$/.test(v) || /[,;]\s*$/.test(v)) commit(v)
                  else setText(v)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    commit()
                  } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
                }}
                onBlur={() => text.trim() && commit()}
                onPaste={(e) => {
                  const t = e.clipboardData.getData('text')
                  if (/[,;\n]/.test(t)) {
                    e.preventDefault()
                    commit(`${text}${t}`)
                  }
                }}
              />
              <datalist id={listId}>
                {book.map((b) => (
                  <option key={b.id} value={`${b.name}${b.org ? `(${b.org})` : ''} <${b.email}>`} />
                ))}
              </datalist>
            </div>
            <IconButton
              icon={Plus}
              label={`${label} 추가`}
              variant="secondary"
              active={picking}
              className="mt-0.5"
              onClick={() => {
                if (text.trim()) commit()
                setPicking((v) => !v)
              }}
            />
          </div>
          {picking && (
            <div className="rounded-md border border-line bg-paper p-2">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-2">주소록에서 {label} 추가</span>
                <TextInput aria-label={`${label} 주소록 찾기`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·소속·주소" className="ml-auto h-7! w-40! text-xs!" />
                <IconButton icon={X} label="닫기" size="sm" onClick={() => setPicking(false)} />
              </div>
              {book.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted">주소록이 비어 있습니다. 팀 설정 → 메일·주소록에서 직원·관계자를 넣어 두세요.</p>
              ) : (
                <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                  {shown.map((b) => {
                    const on = has(b.email)
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={on}
                        title={b.email}
                        onClick={() => onChange(on ? value.filter((x) => x.toLowerCase() !== b.email.toLowerCase()) : [...value, b.email])}
                        className={clsx('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors', on ? 'border-brand bg-brand-soft font-semibold text-brand-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}
                      >
                        {on ? <CheckCircle2 className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
                        {b.name}
                        {b.org && <span className="text-muted">({b.org})</span>}
                      </button>
                    )
                  })}
                  {!shown.length && <p className="px-1 py-1 text-xs text-muted">맞는 사람이 없습니다.</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Field>
  )
}

// ── 메일 쓰기 창(문서 메일·새 메일·다시 보내기 모두) ─────────
interface DocParts {
  base: string
  customer: string
  docNo: string
  makePdf: () => Promise<Blob>
  makeXlsx: () => Promise<Blob>
  /** 보내기 전에 문서함에 저장하고 문서 id 를 돌려준다(메일 보냄 표시용) */
  remember: () => Promise<string | null>
}
interface Draft {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text?: string
  files: Array<{ name: string; blob: Blob }>
}
interface ComposeProps {
  open: boolean
  onClose: () => void
  title: string
  /** 보내는 사람 기본값(담당자 id) */
  senderId?: string
  initial: Draft
  /** 담당자에 맞춘 기본 본문(담당자를 바꾸면 서명도 바뀐다) */
  bodyFor: (sender: Contact | undefined) => string
  doc?: DocParts
  onOpenSettings: () => void
  onSent?: () => void
}

type Extra = { id: string; name: string; blob: Blob }

function ComposeMail({ open, onClose, title, senderId: initialSender, initial, bodyFor, doc, onOpenSettings, onSent }: ComposeProps) {
  const kit = useTeam((s) => s.kit)
  const contacts = kit.contacts.filter((c) => c.email.trim())
  const [state, setState] = useState<MailState | null>(null)
  const [senderId, setSenderId] = useState('')
  const [to, setTo] = useState<string[]>([])
  const [cc, setCc] = useState<string[]>([])
  const [bcc, setBcc] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [pdf, setPdf] = useState(true)
  const [xlsx, setXlsx] = useState(false)
  const [extra, setExtra] = useState<Extra[]>([])
  const [saveCopy, setSaveCopy] = useState(true)
  const [bccMe, setBccMe] = useState(false)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // 열 때마다 새로
  useEffect(() => {
    if (!open) return
    const first = contacts.find((c) => c.id === initialSender) ?? contacts[0]
    setSenderId(first?.id ?? '')
    setTo(initial.to)
    setCc(initial.cc)
    setBcc(initial.bcc)
    setSubject(initial.subject)
    setText(initial.text ?? bodyFor(first))
    setPdf(true)
    setXlsx(false)
    setExtra(initial.files.map((f) => ({ id: uid(), ...f })))
    setSaveCopy(true)
    setBccMe(false)
    setState(null)
    loadMail()
      .then((s) => {
        setState(s)
        // 이 거래처에 지난번 보낸 주소
        if (!initial.to.length && doc?.customer) setTo(s.lastTo[doc.customer] ?? [])
      })
      .catch((err) => toast.error(errText(err, '메일 설정을 불러오지 못했습니다.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const sender = contacts.find((c) => c.id === senderId)
  const account = sender ? state?.accounts[sender.id] : undefined
  const book = state?.addressBook ?? []
  const extraSize = extra.reduce((n, f) => n + f.blob.size, 0)

  const changeSender = (id: string) => {
    const next = contacts.find((c) => c.id === id)
    // 본문을 손대지 않았으면 서명도 새 담당자로
    if (text === bodyFor(sender)) setText(bodyFor(next))
    setSenderId(id)
  }
  const addFiles = (list: FileList | File[] | null) => {
    const files = [...(list ?? [])]
    if (!files.length) return
    const total = extraSize + files.reduce((n, f) => n + f.size, 0)
    if (total > MAX_ATTACH) return toast.error(`첨부 파일은 합쳐서 ${fileSize(MAX_ATTACH)}까지입니다. 지금 ${fileSize(total)}.`)
    setExtra((x) => [...x, ...files.map((f) => ({ id: uid(), name: f.name, blob: f as Blob }))].slice(0, 18))
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    addFiles(e.dataTransfer.files)
  }

  const send = async () => {
    if (!sender) return toast.error('보내는 사람(담당자)을 골라 주세요.')
    if (!account) return toast.error('이 담당자의 메일 계정을 먼저 설정해 주세요.')
    if (!to.length) return toast.error('받는 사람을 넣어 주세요. 이름이나 주소를 넣고 Enter 를 누르면 들어갑니다.')
    if (!subject.trim()) return toast.error('제목을 넣어 주세요.')
    const docFiles = doc ? Number(pdf) + Number(xlsx) : 0
    if (!docFiles && !extra.length && !confirm('첨부 파일 없이 보낼까요?')) return
    setBusy(true)
    try {
      const files: Array<{ filename: string; content: string; contentType: string }> = []
      const add = async (name: string, blob: Blob) => files.push({ filename: name, content: await blobToBase64(blob), contentType: blob.type || 'application/octet-stream' })
      let size = extraSize
      if (doc && pdf) {
        const b = await doc.makePdf()
        size += b.size
        await add(`${doc.base}.pdf`, b)
      }
      if (doc && xlsx) {
        const b = await doc.makeXlsx()
        size += b.size
        await add(`${doc.base}.xlsx`, b)
      }
      if (size > MAX_ATTACH) throw new Error(`첨부 파일이 너무 큽니다(합쳐서 ${fileSize(size)}). ${fileSize(MAX_ATTACH)} 이하로 줄여 주세요.`)
      for (const f of extra) await add(f.name, f.blob)
      const docId = doc ? await doc.remember().catch(() => null) : null
      const r = await sendMail({ contactId: sender.id, to, cc, bcc, bccMe, saveCopy, subject: subject.trim(), text, attachments: files, customer: doc?.customer ?? '', docNo: doc?.docNo ?? '', docId })
      if (r.rejected.length) toast.warn(`보냈지만 받지 않은 주소가 있습니다: ${r.rejected.join(', ')}`)
      else toast.success(`${to.length + cc.length + bcc.length}명에게 보냈습니다.${saveCopy ? ' 메일함에도 저장했습니다.' : ''}`)
      if (doc) void useTeam.getState().loadDocs().catch(() => {})
      onSent?.()
      onClose()
    } catch (err) {
      toast.error(errText(err, '메일을 보내지 못했습니다.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      size="lg"
      footer={
        <>
          <Checkbox checked={saveCopy} onChange={setSaveCopy} label="보낸 메일함에 저장(본문·첨부)" className="mr-auto" />
          <Button onClick={onClose} disabled={busy}>
            닫기
          </Button>
          <Button variant="primary" icon={Send} loading={busy} disabled={!state || !account} onClick={() => void send()}>
            보내기
          </Button>
        </>
      }
    >
      {!state ? (
        <div className="flex items-center gap-2 py-6 text-muted">
          <Spinner /> 메일 설정 불러오는 중
        </div>
      ) : !contacts.length ? (
        <Callout tone="warn" title="이메일이 있는 담당자가 없습니다">
          팀 설정 → 담당자에서 담당자 이메일을 넣고, 메일·주소록에서 메일 계정을 설정해 주세요.
          <div className="mt-2">
            <Button size="sm" icon={Mail} onClick={onOpenSettings}>
              메일 설정 열기
            </Button>
          </div>
        </Callout>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Field label="보내는 사람">
              {(id) => <Select id={id} value={senderId} onValue={changeSender} options={contacts.map((c) => ({ value: c.id, label: [c.name, c.title].filter(Boolean).join(' ') || c.email }))} />}
            </Field>
            <Field label="보내는 주소">{(id) => <TextInput id={id} value={sender?.email ?? ''} readOnly className="bg-sunken!" />}</Field>
          </div>
          {!account && (
            <Callout tone="warn" title={`${sender?.name || '이 담당자'}의 메일 계정이 아직 없습니다`}>
              팀 설정 → 메일·주소록에서 메일 비밀번호(앱 비밀번호)를 한 번만 넣어 두면, 다음부터 바로 보낼 수 있습니다.
              <div className="mt-2">
                <Button size="sm" icon={Mail} onClick={onOpenSettings}>
                  메일 계정 설정하기
                </Button>
              </div>
            </Callout>
          )}
          <RecipientField label="받는 사람" value={to} onChange={setTo} book={book} />
          <RecipientField label="참조" value={cc} onChange={setCc} book={book} />
          <RecipientField label="숨은 참조" value={bcc} onChange={setBcc} book={book} />
          <p className="-mt-1 text-xs text-muted">메일 주소나 주소록 이름을 넣고 Enter. [+]를 누르면 주소록에서 여러 명을 골라 넣을 수 있습니다. 숨은 참조는 다른 받는 사람에게 보이지 않습니다.</p>
          <Field label="제목">{(id) => <TextInput id={id} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />}</Field>
          <Field label="내용">{(id) => <Textarea id={id} value={text} maxLength={50000} onChange={(e) => setText(e.target.value)} className="min-h-52!" />}</Field>
          <div
            className={clsx('flex flex-col gap-2 rounded-md border border-dashed p-2.5 transition-colors', drag ? 'border-brand bg-brand-soft/40' : 'border-line-strong')}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink-2">
                <Paperclip className="size-4" aria-hidden /> 첨부
              </span>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
              <Button size="sm" icon={Plus} onClick={() => fileInput.current?.click()}>
                파일 추가
              </Button>
              <span className="text-xs text-muted">끌어다 놓아도 됩니다 · 합쳐서 {fileSize(MAX_ATTACH)}까지</span>
              <Checkbox checked={bccMe} onChange={setBccMe} label="내게도 한 통" className="ml-auto" />
            </div>
            {doc && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Checkbox checked={pdf} onChange={setPdf} label={`${doc.base}.pdf`} />
                <Checkbox checked={xlsx} onChange={setXlsx} label={`${doc.base}.xlsx`} />
              </div>
            )}
            {extra.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {extra.map((f) => (
                  <li key={f.id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-surface py-0.5 pr-0.5 pl-2 text-xs">
                    <FileText className="size-3.5 shrink-0 text-muted" aria-hidden />
                    <span className="truncate">{f.name}</span>
                    <span className="text-faint">{fileSize(f.blob.size)}</span>
                    <IconButton icon={X} label={`${f.name} 빼기`} size="sm" onClick={() => setExtra((x) => x.filter((y) => y.id !== f.id))} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {doc && <p className="text-xs text-muted">보내면 이 문서가 문서함에 저장되고 ‘메일 보냄’으로 표시됩니다.</p>}
        </div>
      )}
    </Dialog>
  )
}

// ── 문서 작성 화면의 [메일 보내기] ─────────────────────────
export interface SendMailProps {
  open: boolean
  onClose: () => void
  doc: QuoteDoc
  kit: CompanyKit
  /** 문서에 고른 담당자(보내는 사람 기본값) */
  contact: Contact | undefined
  total: number
  base: string
  makePdf: () => Promise<Blob>
  makeXlsx: () => Promise<Blob>
  remember: () => Promise<string | null>
  onOpenSettings: () => void
}

export function SendMailDialog({ open, onClose, doc, kit, contact, total, base, makePdf, makeXlsx, remember, onOpenSettings }: SendMailProps) {
  const what = doc.type === 'statement' ? '거래명세서' : '견적서'
  const initial = useMemo<Draft>(() => ({ to: [], cc: [], bcc: [], subject: defaultSubject(doc, kit), files: [] }), [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ComposeMail
      open={open}
      onClose={onClose}
      title={`${what} 메일 보내기`}
      senderId={contact?.id}
      initial={initial}
      bodyFor={(s) => defaultBody(doc, kit, s, total)}
      doc={{ base, customer: doc.customer.trim(), docNo: doc.docNo, makePdf, makeXlsx, remember }}
      onOpenSettings={onOpenSettings}
    />
  )
}

// ── 메일함: 발송 목록 · 저장한 메일 ───────────────────────
type BoxFilter = 'all' | 'saved' | 'failed'

export function MailBox({ onOpenSettings }: { onOpenSettings: () => void }) {
  const kit = useTeam((s) => s.kit)
  const [log, setLog] = useState<MailLogEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<BoxFilter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [compose, setCompose] = useState<{ title: string; initial: Draft; senderId?: string } | null>(null)
  const reload = () =>
    loadLog()
      .then(setLog)
      .catch((err) => toast.error(errText(err, '발송 목록을 불러오지 못했습니다.')))
  useEffect(() => {
    void reload()
  }, [])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (log ?? []).filter(
      (e) =>
        (filter === 'all' || (filter === 'saved' ? e.saved : !e.ok)) &&
        (!q || [e.subject, e.by, e.from, e.customer, e.docNo, ...e.to, ...e.cc, ...e.bcc, ...e.files.map((f) => f.name)].join(' ').toLowerCase().includes(q)),
    )
  }, [log, query, filter])
  const opened = (log ?? []).find((e) => e.id === openId) ?? null
  const contacts = kit.contacts
  const senderOf = (e: MailLogEntry) => contacts.find((c) => c.email.toLowerCase() === e.from.toLowerCase())?.id

  /** 다시 보내기·전달: 저장된 본문·첨부를 그대로 새 메일로 */
  const reuse = async (e: MailLogEntry, saved: SavedMail | null, mode: 'again' | 'forward') => {
    const files = saved ? await Promise.all(saved.files.map(async (f) => ({ name: f.name, blob: await fetchSavedFile(e.id, f.n) }))) : []
    const fwd = mode === 'forward'
    setOpenId(null)
    setCompose({
      title: fwd ? '전달' : '다시 보내기',
      senderId: senderOf(e),
      initial: {
        to: fwd ? [] : e.to,
        cc: fwd ? [] : e.cc,
        bcc: fwd ? [] : e.bcc,
        subject: fwd ? `FW: ${e.subject}` : e.subject,
        text: saved ? (fwd ? `\n\n---------- 전달한 메일 ----------\n보낸 사람: ${e.by} <${e.from}>\n보낸 때: ${when(e.at)}\n받는 사람: ${e.to.join(', ')}\n제목: ${e.subject}\n\n${saved.text}` : saved.text) : undefined,
        files,
      },
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Panel className="flex flex-wrap items-center gap-2 p-3">
        <Button variant="primary" icon={MailPlus} onClick={() => setCompose({ title: '새 메일', initial: { to: [], cc: [], bcc: [], subject: '', files: [] } })}>
          새 메일
        </Button>
        <Segmented<BoxFilter>
          label="보기"
          value={filter}
          onValue={setFilter}
          options={[
            { value: 'all', label: '발송 목록 전체' },
            { value: 'saved', label: '메일함 저장' },
            { value: 'failed', label: '실패' },
          ]}
        />
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <TextInput aria-label="메일 찾기" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목·받는 사람·거래처·첨부" className="w-64! pl-8!" />
        </div>
        <IconButton icon={RefreshCw} label="새로 고침" variant="secondary" onClick={() => void reload()} />
      </Panel>

      {!log ? (
        <div className="flex items-center gap-2 py-6 text-muted">
          <Spinner /> 불러오는 중
        </div>
      ) : !rows.length ? (
        <EmptyState icon={Inbox} title={log.length ? '맞는 메일이 없습니다' : '아직 보낸 메일이 없습니다'}>
          문서 작성 화면의 [메일 보내기]나 위의 [새 메일]로 보내면 여기에 쌓입니다. ‘보낸 메일함에 저장’을 켜고 보내면 본문·첨부까지 남아 다시 보거나 다시 보낼 수 있습니다.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-paper text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 whitespace-nowrap">보낸 때</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">제목</th>
                <th className="px-3 py-2 whitespace-nowrap">보낸 사람</th>
                <th className="px-3 py-2">받는 사람</th>
                <th className="px-3 py-2 whitespace-nowrap">첨부</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="cursor-pointer border-t border-line hover:bg-paper" onClick={() => setOpenId(e.id)}>
                  <td className="num px-3 py-2 text-xs whitespace-nowrap text-muted">{when(e.at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {!e.ok ? <Badge tone="warn">실패</Badge> : e.saved ? <Badge tone="brand">메일함</Badge> : <Badge>보냄</Badge>}
                  </td>
                  <td className="max-w-80 px-3 py-2">
                    <p className="truncate font-semibold text-ink">{e.subject}</p>
                    {(e.customer || e.docNo) && <p className="truncate text-xs text-muted">{[e.customer, e.docNo].filter(Boolean).join(' · ')}</p>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2">{e.by || e.from}</td>
                  <td className="max-w-72 px-3 py-2 text-xs text-ink-2">
                    <p className="truncate">{e.to.join(', ')}</p>
                    {(e.cc.length > 0 || e.bcc.length > 0) && (
                      <p className="truncate text-muted">
                        {e.cc.length > 0 && `참조 ${e.cc.length}`}
                        {e.cc.length > 0 && e.bcc.length > 0 && ' · '}
                        {e.bcc.length > 0 && `숨은 참조 ${e.bcc.length}`}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-muted">{e.files.length ? `${e.files.length}개` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MailDetail
        entry={opened}
        onClose={() => setOpenId(null)}
        onReuse={(e, saved, mode) => void reuse(e, saved, mode).catch((err) => toast.error(errText(err, '불러오지 못했습니다.')))}
        onDeleted={() => {
          setOpenId(null)
          void reload()
        }}
      />
      <ComposeMail
        open={!!compose}
        onClose={() => setCompose(null)}
        title={compose?.title ?? '새 메일'}
        senderId={compose?.senderId}
        initial={compose?.initial ?? { to: [], cc: [], bcc: [], subject: '', files: [] }}
        bodyFor={(s) => plainBody(kit, s)}
        onOpenSettings={onOpenSettings}
        onSent={() => void reload()}
      />
    </div>
  )
}

function MailDetail({ entry, onClose, onReuse, onDeleted }: { entry: MailLogEntry | null; onClose: () => void; onReuse: (e: MailLogEntry, saved: SavedMail | null, mode: 'again' | 'forward') => void; onDeleted: () => void }) {
  const [saved, setSaved] = useState<SavedMail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    setSaved(null)
    if (entry?.saved) loadSaved(entry.id).then(setSaved, (err) => toast.error(errText(err, '저장한 메일을 불러오지 못했습니다.')))
  }, [entry])
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (err) {
      toast.error(errText(err, '처리하지 못했습니다.'))
    } finally {
      setBusy(null)
    }
  }
  const e = entry
  const line = (label: string, list: string[]) =>
    list.length > 0 && (
      <div className="flex gap-2">
        <dt className="w-20 shrink-0 text-muted">{label}</dt>
        <dd className="min-w-0 break-all text-ink">{list.join(', ')}</dd>
      </div>
    )
  return (
    <Dialog
      open={!!e}
      onClose={onClose}
      title={e?.subject ?? '메일'}
      size="lg"
      footer={
        e && (
          <>
            {e.saved && (
              <Button
                variant="ghost"
                icon={Trash2}
                className="mr-auto"
                loading={busy === 'del'}
                onClick={() => {
                  if (confirm('메일함에서 이 메일(본문·첨부)을 지울까요? 발송 목록의 기록은 남습니다.')) void run('del', async () => (await deleteSaved(e.id), toast.success('메일함에서 지웠습니다.'), onDeleted()))
                }}
              >
                메일함에서 지우기
              </Button>
            )}
            {e.saved && (
              <Button icon={Download} loading={busy === 'eml'} onClick={() => void run('eml', async () => downloadBlob(await fetchSavedFile(e.id, 'eml'), `${e.subject.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'mail'}.eml`))}>
                메일 파일(.eml)
              </Button>
            )}
            <Button icon={Reply} disabled={e.saved && !saved} onClick={() => onReuse(e, saved, 'forward')}>
              전달
            </Button>
            <Button variant="primary" icon={Send} disabled={e.saved && !saved} onClick={() => onReuse(e, saved, 'again')}>
              다시 보내기
            </Button>
          </>
        )
      }
    >
      {e && (
        <div className="flex flex-col gap-3 text-sm">
          {!e.ok && (
            <Callout tone="danger" title="보내지 못한 메일입니다">
              {e.error}
            </Callout>
          )}
          <dl className="flex flex-col gap-1">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted">보낸 때</dt>
              <dd className="text-ink">{when(e.at)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted">보낸 사람</dt>
              <dd className="text-ink">
                {e.by} &lt;{e.from}&gt;
              </dd>
            </div>
            {line('받는 사람', e.to)}
            {line('참조', e.cc)}
            {line('숨은 참조', e.bcc)}
            {(e.customer || e.docNo) && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted">문서</dt>
                <dd className="text-ink">{[e.customer, e.docNo].filter(Boolean).join(' · ')}</dd>
              </div>
            )}
          </dl>
          {e.saved ? (
            !saved ? (
              <div className="flex items-center gap-2 text-muted">
                <Spinner /> 본문 불러오는 중
              </div>
            ) : (
              <>
                <pre className="max-h-80 overflow-auto rounded-md border border-line bg-paper p-3 font-sans text-sm whitespace-pre-wrap text-ink">{saved.text || '(내용 없음)'}</pre>
                {saved.files.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {saved.files.map((f) => (
                      <li key={f.n}>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs hover:bg-paper"
                          onClick={() => void run(`f${f.n}`, async () => downloadBlob(await fetchSavedFile(e.id, f.n), f.name))}
                        >
                          {busy === `f${f.n}` ? <Spinner /> : <Download className="size-3.5 text-muted" aria-hidden />}
                          {f.name} <span className="text-faint">{fileSize(f.size)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )
          ) : (
            <>
              {e.files.length > 0 && <p className="text-xs text-muted">첨부: {e.files.map((f) => f.name).join(', ')}</p>}
              <Callout tone="info">메일함에 저장하지 않고 보낸 메일이라 본문·첨부는 남아 있지 않습니다. ‘다시 보내기’를 누르면 받는 사람·제목만 채워집니다.</Callout>
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}

// ── 팀 설정: 메일·주소록 ─────────────────────────────────
export function MailSection({ onGoContacts }: { onGoContacts: () => void }) {
  const contacts = useTeam((s) => s.contacts)
  const team = useTeam((s) => s.team)
  const [state, setState] = useState<MailState | null>(null)
  const reload = () =>
    loadMail()
      .then(setState)
      .catch((err) => toast.error(errText(err, '메일 설정을 불러오지 못했습니다.')))
  useEffect(() => {
    void reload()
  }, [])
  if (!state)
    return (
      <div className="flex items-center gap-2 py-6 text-muted">
        <Spinner /> 불러오는 중
      </div>
    )
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Callout tone="info">
        메일 계정·주소록·메일함은 <b>{team?.name ?? '이'} 팀</b>(같은 팀 코드로 들어온 사람)끼리만 함께 씁니다. 다른 팀에서는 보이지 않습니다.
      </Callout>
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-bold text-ink">담당자 메일 계정</h3>
        <p className="text-sm text-ink-2">
          견적서를 담당자 본인의 메일 주소로 보냅니다. 담당자마다 <b>메일 비밀번호를 한 번만</b> 넣어 두면 됩니다. Gmail·네이버·다음은 로그인 비밀번호가 아니라 <b>앱 비밀번호</b>를 넣어야 하고, 네이버·다음은 메일 환경설정에서 <b>POP3/SMTP 사용</b>을 켜 두어야 합니다. 비밀번호는 서버에 암호화해 두며 화면에 다시 보이지 않습니다.
        </p>
        {contacts.length === 0 ? (
          <EmptyState icon={Mail} title="등록된 담당자가 없습니다" action={<Button size="sm" onClick={onGoContacts}>담당자 추가하러 가기</Button>}>
            담당자 탭에서 성명과 이메일을 넣고 저장한 뒤 여기서 메일 계정을 설정하세요.
          </EmptyState>
        ) : (
          contacts.map((c) => <AccountEditor key={c.id} contact={c} state={state} onSaved={reload} onGoContacts={onGoContacts} />)
        )}
      </section>
      <AddressBook state={state} onSaved={(addressBook) => setState((s) => (s ? { ...s, addressBook } : s))} />
    </div>
  )
}

function AccountEditor({ contact, state, onSaved, onGoContacts }: { contact: Contact; state: MailState; onSaved: () => Promise<void>; onGoContacts: () => void }) {
  const saved = state.accounts[contact.id]
  const guess = providerFor(state.providers, contact.email)
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('465')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const start = () => {
    const p = saved ? (state.providers.find((x) => x.host === saved.host) ?? null) : guess
    setProvider(p?.id ?? 'custom')
    setHost(saved?.host ?? p?.host ?? '')
    setPort(String(saved?.port ?? p?.port ?? 465))
    setUser(saved?.user ?? contact.email)
    setPass('')
    setOpen(true)
  }
  const pick = (id: string) => {
    setProvider(id)
    const p = state.providers.find((x) => x.id === id)
    if (p) {
      setHost(p.host)
      setPort(String(p.port))
    }
  }
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (err) {
      toast.error(errText(err, '처리하지 못했습니다.'))
    } finally {
      setBusy(null)
    }
  }
  const name = [contact.name, contact.title].filter(Boolean).join(' ') || '이름 없는 담당자'
  const hasEmail = isEmail(contact.email)
  return (
    <div className="rounded-lg border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-ink">{name}</p>
        <span className="text-sm text-muted">{contact.email || '이메일 없음'}</span>
        {saved ? (
          <Badge tone="brand">
            <CheckCircle2 className="mr-1 size-3" aria-hidden /> 설정됨 · {saved.host}
          </Badge>
        ) : (
          <Badge>설정 전</Badge>
        )}
        <div className="ml-auto flex gap-1.5">
          {!hasEmail ? (
            <Button size="sm" onClick={onGoContacts}>
              이메일 넣으러 가기
            </Button>
          ) : (
            <>
              {saved && (
                <Button size="sm" icon={Plug} loading={busy === 'test'} disabled={!!busy} onClick={() => void run('test', async () => (await testAccount(contact.id), toast.success(`${name}: 메일 서버에 잘 연결됩니다.`)))}>
                  연결 시험
                </Button>
              )}
              <Button size="sm" variant={saved ? 'secondary' : 'primary'} icon={Mail} onClick={() => (open ? setOpen(false) : start())}>
                {saved ? '고치기' : '메일 계정 설정'}
              </Button>
            </>
          )}
        </div>
      </div>
      {open && hasEmail && (
        <form
          className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run('save', async () => {
              await saveAccount(contact.id, { host: host.trim(), port: Number(port), user: user.trim(), pass })
              await onSaved()
              setOpen(false)
              toast.success(`${name}의 메일 계정을 저장했습니다. ‘연결 시험’으로 확인해 보세요.`)
            })
          }}
        >
          <Field label="메일 서비스" className="sm:col-span-2">
            {(id) => <Select id={id} value={provider} onValue={pick} options={[...state.providers.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: '직접 입력(회사 메일 서버)' }]} />}
          </Field>
          <Field label="보내는 메일 서버(SMTP)" hint="예: smtp.gmail.com">
            {(id) => <TextInput id={id} value={host} onChange={(e) => (setHost(e.target.value), setProvider('custom'))} required />}
          </Field>
          <Field label="포트" hint="보통 465(SSL) 또는 587">
            {(id) => <TextInput id={id} value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} required />}
          </Field>
          <Field label="메일 계정(아이디)" hint="보통 메일 주소 전체">
            {(id) => <TextInput id={id} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" required />}
          </Field>
          <Field label="메일 비밀번호(앱 비밀번호)" hint={saved ? '비워 두면 전에 넣은 비밀번호를 그대로 씁니다' : undefined}>
            {(id) => <TextInput id={id} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" required={!saved} />}
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" icon={Save} loading={busy === 'save'} disabled={!!busy}>
              저장
            </Button>
            <Button onClick={() => setOpen(false)}>취소</Button>
            {saved && (
              <Button
                variant="ghost"
                icon={Trash2}
                className="ml-auto"
                onClick={() => {
                  if (confirm(`${name}의 메일 계정 설정을 지울까요?`)) void run('del', async () => (await removeAccount(contact.id), await onSaved(), setOpen(false)))
                }}
              >
                설정 지우기
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

function AddressBook({ state, onSaved }: { state: MailState; onSaved: (b: BookEntry[]) => void }) {
  const [list, setList] = useState<BookEntry[]>(state.addressBook)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [paste, setPaste] = useState<string | null>(null)
  const dirty = JSON.stringify(list) !== JSON.stringify(state.addressBook)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return list.map((e, i) => [e, i] as const).filter(([e]) => !q || `${e.name} ${e.email} ${e.org}`.toLowerCase().includes(q))
  }, [list, query])
  const set = (i: number, patch: Partial<BookEntry>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const save = async () => {
    setBusy(true)
    try {
      const { addressBook } = await saveBook(list.filter((e) => e.name.trim() || e.email.trim()))
      setList(addressBook)
      onSaved(addressBook)
      toast.success(`주소록을 저장했습니다(${addressBook.length}명).`)
    } catch (err) {
      toast.error(errText(err, '저장하지 못했습니다.'))
    } finally {
      setBusy(false)
    }
  }
  /** 엑셀에서 '이름 · 메일 · 소속' 여러 줄을 붙여넣기 */
  const addPasted = () => {
    const rows = (paste ?? '')
      .split(/\r?\n/)
      .map((l) => l.split(/\t|,/).map((x) => x.trim()))
      .filter((c) => c.some(Boolean))
    const added: BookEntry[] = []
    for (const c of rows) {
      const email = c.find((x) => isEmail(x)) ?? ''
      const rest = c.filter((x) => x && x !== email)
      if (!email) continue
      added.push({ id: uid(), name: rest[0] ?? '', email, org: rest[1] ?? '' })
    }
    if (!added.length) return toast.error('메일 주소가 들어 있는 줄이 없습니다. ‘이름 [탭] 메일 [탭] 소속’ 순서로 붙여넣어 주세요.')
    setList((l) => [...l, ...added.filter((a) => !l.some((x) => x.email.toLowerCase() === a.email.toLowerCase()))])
    setPaste(null)
    toast.success(`${added.length}명을 넣었습니다. 아래에서 저장하세요.`)
  }
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold text-ink">주소록</h3>
        <Badge>{list.length}명</Badge>
        <TextInput aria-label="주소록 찾기" placeholder="이름·주소·소속 찾기" value={query} onChange={(e) => setQuery(e.target.value)} className="ml-auto h-8! w-48!" />
      </div>
      <p className="text-sm text-ink-2">직원·관계자·거래처 담당자를 넣어 두면 메일 보낼 때 받는 사람·참조 칸에 <b>이름만</b> 넣어도 메일 주소로 바뀝니다. 이름이 같은 사람이 있으면 소속으로 구분해 주세요.</p>
      {list.length === 0 && !paste && (
        <EmptyState icon={BookUser} title="주소록이 비어 있습니다">
          아래 ‘사람 추가’로 한 명씩 넣거나, 엑셀에서 이름·메일·소속 여러 줄을 복사해 ‘엑셀에서 붙여넣기’로 한 번에 넣으세요.
        </EmptyState>
      )}
      {paste !== null && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-paper p-3">
          <Field label="엑셀에서 붙여넣기" hint="한 줄에 한 명: 이름 [탭] 메일 [탭] 소속(없어도 됨)">
            {(id) => <Textarea id={id} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'홍길동\thong@company.co.kr\t영업팀\n김철수\tkim@company.co.kr\t물류팀'} className="min-h-28! font-mono text-xs" />}
          </Field>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" icon={Plus} onClick={addPasted}>
              목록에 넣기
            </Button>
            <Button size="sm" onClick={() => setPaste(null)}>
              취소
            </Button>
          </div>
        </div>
      )}
      {list.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-paper text-left text-xs text-muted">
              <tr>
                <th className="px-2 py-1.5">이름</th>
                <th className="px-2 py-1.5">메일 주소</th>
                <th className="px-2 py-1.5">소속·메모</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {shown.map(([e, i]) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-1.5 py-1">
                    <TextInput aria-label="이름" value={e.name} maxLength={30} onChange={(ev) => set(i, { name: ev.target.value })} className="h-8!" />
                  </td>
                  <td className="px-1.5 py-1">
                    <TextInput aria-label="메일 주소" value={e.email} maxLength={120} inputMode="email" onChange={(ev) => set(i, { email: ev.target.value.trim() })} className={clsx('h-8!', e.email && !isEmail(e.email) && 'border-danger!')} />
                  </td>
                  <td className="px-1.5 py-1">
                    <TextInput aria-label="소속·메모" value={e.org} maxLength={40} placeholder="예: 영업팀" onChange={(ev) => set(i, { org: ev.target.value })} className="h-8!" />
                  </td>
                  <td className="px-1 py-1">
                    <IconButton icon={Trash2} label={`${e.name || e.email || '이 사람'} 지우기`} size="sm" onClick={() => setList((l) => l.filter((_, j) => j !== i))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/95 p-2 shadow-sm backdrop-blur">
        <Button icon={Plus} disabled={list.length >= 500} onClick={() => (setQuery(''), setList((l) => [...l, { id: uid(), name: '', email: '', org: '' }]))}>
          사람 추가
        </Button>
        <Button icon={ClipboardPaste} onClick={() => setPaste('')}>
          엑셀에서 붙여넣기
        </Button>
        <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={() => void save()}>
          주소록 저장
        </Button>
        {dirty && <Badge tone="warn">저장 전</Badge>}
      </div>
    </section>
  )
}
