import clsx from 'clsx'
import { BookUser, CheckCircle2, ClipboardPaste, Mail, Plug, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { Badge, Button, Callout, Checkbox, Dialog, EmptyState, Field, IconButton, Select, Spinner, Textarea, TextInput, toast } from '@/ui'
import {
  blobToBase64,
  defaultBody,
  defaultSubject,
  isEmail,
  labelOf,
  loadMail,
  providerFor,
  removeAccount,
  resolveRecipient,
  saveAccount,
  saveBook,
  sendMail,
  splitTokens,
  testAccount,
  type BookEntry,
  type MailState,
} from './mail'
import { uid, type CompanyKit, type Contact, type QuoteDoc } from './model'
import { useTeam } from './team'

const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

// ── 받는 사람·참조 칸: 이름이나 주소를 넣고 Enter(또는 쉼표) → 주소 칩 ─────
function RecipientField({ label, hint, value, onChange, book }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; book: BookEntry[] }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const listId = useId()
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
  return (
    <Field label={label} hint={hint} error={error || undefined}>
      {(id) => (
        <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-md border border-line-strong bg-surface px-1.5 py-1 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
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
            className="h-7 min-w-40 flex-1 bg-transparent px-1 text-sm outline-none"
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
      )}
    </Field>
  )
}

// ── 메일 보내기 창 ──────────────────────────────────────
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
  /** 보내기 전에 문서함에 저장하고 문서 id 를 돌려준다(메일 보냄 표시용) */
  remember: () => Promise<string | null>
  onOpenSettings: () => void
}

export function SendMailDialog({ open, onClose, doc, kit, contact, total, base, makePdf, makeXlsx, remember, onOpenSettings }: SendMailProps) {
  const contacts = kit.contacts.filter((c) => c.email.trim())
  const [state, setState] = useState<MailState | null>(null)
  const [senderId, setSenderId] = useState('')
  const [to, setTo] = useState<string[]>([])
  const [cc, setCc] = useState<string[]>([])
  const [bccMe, setBccMe] = useState(false)
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [pdf, setPdf] = useState(true)
  const [xlsx, setXlsx] = useState(false)
  const [busy, setBusy] = useState(false)

  // 열 때마다 새로: 보내는 사람 = 문서 담당자, 받는 사람 = 이 거래처에 지난번 보낸 주소
  useEffect(() => {
    if (!open) return
    const first = contacts.find((c) => c.id === contact?.id) ?? contacts[0]
    setSenderId(first?.id ?? '')
    setCc([])
    setBccMe(false)
    setPdf(true)
    setXlsx(false)
    setSubject(defaultSubject(doc, kit))
    setText(defaultBody(doc, kit, first, total))
    setState(null)
    loadMail()
      .then((s) => {
        setState(s)
        setTo(s.lastTo[doc.customer.trim()] ?? [])
      })
      .catch((err) => toast.error(errText(err, '메일 설정을 불러오지 못했습니다.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const sender = contacts.find((c) => c.id === senderId)
  const account = sender ? state?.accounts[sender.id] : undefined
  const book = state?.addressBook ?? []
  const what = doc.type === 'statement' ? '거래명세서' : '견적서'

  const changeSender = (id: string) => {
    const next = contacts.find((c) => c.id === id)
    // 본문을 손대지 않았으면 서명도 새 담당자로
    if (text === defaultBody(doc, kit, sender, total)) setText(defaultBody(doc, kit, next, total))
    setSenderId(id)
  }

  const send = async () => {
    if (!sender) return toast.error('보내는 사람(담당자)을 골라 주세요.')
    if (!account) return toast.error('이 담당자의 메일 계정을 먼저 설정해 주세요.')
    if (!to.length) return toast.error('받는 사람을 넣어 주세요. 이름이나 주소를 넣고 Enter 를 누르면 들어갑니다.')
    if (!subject.trim()) return toast.error('제목을 넣어 주세요.')
    if (!pdf && !xlsx && !confirm('첨부 파일 없이 보낼까요?')) return
    setBusy(true)
    try {
      const files: Array<{ filename: string; content: string; contentType: string }> = []
      if (pdf) files.push({ filename: `${base}.pdf`, content: await blobToBase64(await makePdf()), contentType: 'application/pdf' })
      if (xlsx) files.push({ filename: `${base}.xlsx`, content: await blobToBase64(await makeXlsx()), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const docId = await remember().catch(() => null)
      const r = await sendMail({ contactId: sender.id, to, cc, bccMe, subject: subject.trim(), text, attachments: files, customer: doc.customer.trim(), docNo: doc.docNo, docId })
      if (r.rejected.length) toast.warn(`보냈지만 받지 않은 주소가 있습니다: ${r.rejected.join(', ')}`)
      else toast.success(`${to.length + cc.length}명에게 ${what}를 보냈습니다.`)
      void useTeam.getState().loadDocs().catch(() => {})
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
      title={`${what} 메일 보내기`}
      size="lg"
      footer={
        <>
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
          <RecipientField label="받는 사람" hint="메일 주소 또는 주소록 이름" value={to} onChange={setTo} book={book} />
          <RecipientField label="참조" hint={book.length ? '이름만 넣어도 주소록 주소로 바뀝니다' : '주소록에 직원·관계자를 넣어 두면 이름만으로 넣을 수 있습니다'} value={cc} onChange={setCc} book={book} />
          <Field label="제목">{(id) => <TextInput id={id} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />}</Field>
          <Field label="내용">{(id) => <Textarea id={id} value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} className="min-h-56!" />}</Field>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-sm font-semibold text-ink-2">첨부</span>
            <Checkbox checked={pdf} onChange={setPdf} label={`${base}.pdf`} />
            <Checkbox checked={xlsx} onChange={setXlsx} label={`${base}.xlsx`} />
            <Checkbox checked={bccMe} onChange={setBccMe} label="내게도 한 통(숨은 참조)" className="sm:ml-auto" />
          </div>
          <p className="text-xs text-muted">보내면 이 문서가 문서함에 저장되고 ‘메일 보냄’으로 표시됩니다.</p>
        </div>
      )}
    </Dialog>
  )
}

// ── 팀 설정: 메일·주소록 ─────────────────────────────────
export function MailSection({ onGoContacts }: { onGoContacts: () => void }) {
  const contacts = useTeam((s) => s.contacts)
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
      {state.log.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-base font-bold text-ink">최근 보낸 메일</h3>
          <ul className="divide-y divide-line rounded-md border border-line bg-surface text-sm">
            {state.log.slice(0, 15).map((m, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="num text-xs text-muted">{new Date(m.at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span className="font-semibold text-ink">{m.subject}</span>
                <span className="text-xs text-muted">
                  {m.by} → {m.to.join(', ')}
                  {m.cc.length > 0 && ` · 참조 ${m.cc.join(', ')}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
