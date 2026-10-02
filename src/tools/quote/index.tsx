import { Building2, FilePenLine, Inbox, KeyRound, LockKeyhole, LogIn, LogOut, Package, Settings2, ShieldCheck, Store, UsersRound, WifiOff } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { usePersistentState } from '@/lib/hooks'
import { Badge, Button, Callout, Field, Panel, Spinner, Tabs, TextInput, toast } from '@/ui'
import { CustomersBoard, DocsBoard, ItemsBoard, type BoardFilter } from './Board'
import { draftKey, Editor, freshDraft, type Draft } from './Editor'
import { proposeDocNo, todayIso, uid, type QuoteDoc } from './model'
import { TeamSettings, type SettingsSection } from './TeamSettings'
import { useTeam, type TeamInfo } from './team'

export default function QuoteTool() {
  const phase = useTeam((s) => s.phase)
  const team = useTeam((s) => s.team)
  const load = useTeam((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])

  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted">
        <Spinner /> 팀 공간을 여는 중
      </div>
    )
  }
  if (phase === 'offline') {
    return (
      <Callout tone="warn" title="서버에 연결되지 않습니다">
        견적서·거래명세표는 팀별 문서함을 서버에 보관하므로 온비짱 서버가 켜져 있어야 씁니다. 잠시 뒤 새로고침해 주세요.
        <div className="mt-2">
          <Button size="sm" icon={WifiOff} onClick={() => void load()}>
            다시 연결
          </Button>
        </div>
      </Callout>
    )
  }
  if (phase === 'out' || !team) return <Gate />
  // 팀이 바뀌면 작성 중 문서·화면 상태를 새로 시작한다
  return <TeamApp key={team.id} team={team} />
}

// ── 입장 ──────────────────────────────────────────────────
function Gate() {
  const login = useTeam((s) => s.login)
  const adminEnter = useTeam((s) => s.adminEnter)
  const admin = useTeam((s) => s.admin)
  const teams = useTeam((s) => s.teams)
  const hasTeams = useTeam((s) => s.hasTeams)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    setBusy('code')
    login(code.trim())
      .then(() => setCode(''))
      .catch((err) => toast.error(err instanceof Error ? err.message : '들어가지 못했습니다.'))
      .finally(() => setBusy(null))
  }
  const enter = (t: TeamInfo) => {
    setBusy(t.id)
    adminEnter(t.id)
      .catch((err) => toast.error(err instanceof Error ? err.message : '들어가지 못했습니다.'))
      .finally(() => setBusy(null))
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-6">
      <Panel className="overflow-hidden">
        <div className="flex items-center gap-4 border-b border-line bg-paper px-6 py-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
            <LockKeyhole className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-ink">팀 문서함 입장</h2>
            <p className="text-sm text-ink-2">팀 코드를 넣으면 우리 팀의 견적서·거래명세표 공간으로 들어갑니다.</p>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3 px-6 py-5">
          <Field label="팀 코드" hint="관리자나 팀장에게 받은 코드입니다. 다른 팀의 문서는 그 팀 코드 없이는 볼 수 없습니다.">
            {(id) => <TextInput id={id} type="password" autoComplete="current-password" autoFocus value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} placeholder="팀 코드 입력" />}
          </Field>
          <Button type="submit" variant="primary" size="lg" icon={LogIn} loading={busy === 'code'} disabled={!code.trim()} block>
            들어가기
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck className="size-3.5" aria-hidden /> 이 브라우저는 180일 동안 기억합니다. 팀 코드가 바뀌면 다시 물어봅니다.
          </p>
        </form>
      </Panel>

      {!hasTeams && (
        <Callout tone="info" title="아직 만들어진 팀이 없습니다">
          {admin ? (
            <>
              관리자 화면 ‘팀·회사 자료’에서 팀을 만들고 팀 코드를 정해 팀에 알려 주세요.
              <div className="mt-2">
                <Link to="/admin" className="font-semibold text-brand-ink underline">
                  관리자 화면으로
                </Link>
              </div>
            </>
          ) : (
            '관리자에게 팀을 만들어 달라고 요청하세요.'
          )}
        </Callout>
      )}

      {admin && teams.length > 0 && (
        <Panel className="p-4">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-ink">
            <UsersRound className="size-4 text-brand" aria-hidden /> 관리자로 팀 들어가기
          </h3>
          <p className="mb-3 text-sm text-muted">관리자는 팀 코드 없이 모든 팀 공간을 열 수 있습니다.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {teams.map((t) => (
              <li key={t.id}>
                <Button block icon={Building2} loading={busy === t.id} disabled={!!busy} onClick={() => enter(t)} className="justify-start!">
                  {t.name}
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}

// ── 팀 공간 ───────────────────────────────────────────────
type View = 'write' | 'docs' | 'customers' | 'items' | 'settings'

const hasContent = (d: QuoteDoc) => Boolean(d.customer.trim() || d.title.trim() || d.items.some((i) => i.name.trim() || i.qty || i.unitPrice))

function TeamApp({ team }: { team: TeamInfo }) {
  const admin = useTeam((s) => s.admin)
  const docs = useTeam((s) => s.docs)
  const logout = useTeam((s) => s.logout)
  const [view, setView] = useState<View>('write')
  const [section, setSection] = useState<SettingsSection>('company')
  const [filter, setFilter] = useState<BoardFilter>({})
  const [draft, setDraftState] = usePersistentState<Draft>(draftKey(team.id), freshDraft())
  const setDraft = (fn: (d: Draft) => Draft) => setDraftState((d) => fn(d))

  /** 작성 중인 내용을 덮어써도 되는지 */
  const canReplace = () => {
    const dirty = draft.savedJson !== JSON.stringify(draft.doc)
    if (!dirty || !hasContent(draft.doc)) return true
    return confirm('작성 중인 문서에 저장하지 않은 내용이 있습니다. 그래도 다른 문서를 열까요?')
  }
  const openDoc = (doc: QuoteDoc, id: string) => {
    if (!canReplace()) return
    setDraft(() => ({ doc, savedId: id, savedJson: JSON.stringify(doc) }))
    setView('write')
  }
  const copyDoc = (doc: QuoteDoc) => {
    if (!canReplace()) return
    const today = todayIso()
    const docNo = proposeDocNo(doc.type, today, (docs ?? []).map((d) => d.docNo))
    setDraft(() => ({ doc: { ...doc, date: today, docNo, items: doc.items.map((i) => ({ ...i, id: uid() })) }, savedId: null, savedJson: null }))
    setView('write')
    toast.success('복사했습니다. 고친 뒤 저장하면 새 문서로 남습니다.')
  }
  const showDocs = (f: BoardFilter) => {
    setFilter(f)
    setView('docs')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-4 py-2.5 shadow-1">
        <span className="flex items-center gap-2 font-bold text-ink">
          <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
            <UsersRound className="size-4" aria-hidden />
          </span>
          {team.name}
        </span>
        {admin && <Badge tone="mark">관리자로 보는 중</Badge>}
        <span className="num text-sm text-muted">문서 {docs?.length ?? '…'}건</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={KeyRound}
            onClick={() => {
              setSection('code')
              setView('settings')
            }}
          >
            팀 코드
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={LogOut}
            onClick={() => {
              if (hasContent(draft.doc) && draft.savedJson !== JSON.stringify(draft.doc) && !confirm('저장하지 않은 작성 중 문서는 나가면 지워집니다. 나갈까요?')) return
              void logout()
            }}
          >
            나가기
          </Button>
        </div>
      </div>

      <Tabs
        label="팀 문서 공간"
        value={view}
        onValue={setView}
        tabs={[
          { value: 'write', label: draft.savedId ? '문서 작성 · 고치는 중' : '문서 작성', icon: FilePenLine },
          { value: 'docs', label: '문서함', icon: Inbox },
          { value: 'customers', label: '거래처', icon: Store },
          { value: 'items', label: '품목', icon: Package },
          { value: 'settings', label: '팀 설정', icon: Settings2 },
        ]}
      />

      {view === 'write' && (
        <Editor
          draft={draft}
          setDraft={setDraft}
          onOpenSettings={(s) => {
            setSection(s)
            setView('settings')
          }}
        />
      )}
      {view === 'docs' && <DocsBoard filter={filter} setFilter={setFilter} onOpen={openDoc} onCopy={copyDoc} />}
      {view === 'customers' && <CustomersBoard onShow={(customer) => showDocs({ customer })} />}
      {view === 'items' && <ItemsBoard onShow={(item) => showDocs({ item })} />}
      {view === 'settings' && <TeamSettings section={section} setSection={setSection} />}
    </div>
  )
}
