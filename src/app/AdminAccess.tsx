import clsx from 'clsx'
import { ArrowDown, ArrowUp, Ban, Check, Eye, EyeOff, KeyRound, Link2, Plus, Search, ShieldCheck, Sparkles, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { Badge, Button, Callout, Dialog, EmptyState, Field, IconButton, Panel, Segmented, Select, Spinner, Switch, TextInput, toast } from '@/ui'
import { canSee, groupOf, useSite, type LinkApp, type SiteConfig } from './config'
import { GROUPS, TOOLS, artUrl, type GroupId } from './registry'
import { ACCOUNT_ROLES, ALL_ROLES, ROLE_LABEL, ROLE_OPTIONS, useViewerStore, type Access, type AccountRole, type PublicUser, type Role } from './viewer'

/** 등급 칩 — 눌러서 그 등급에게 보이기/감추기 */
export function RoleChips({ value, onChange, disabled, size = 'md' }: { value: Role[]; onChange: (v: Role[]) => void; disabled?: boolean; size?: 'sm' | 'md' }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="보이는 등급">
      {ROLE_OPTIONS.map(({ value: r, label }) => {
        const on = value.includes(r)
        return (
          <button
            key={r}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            title={on ? `${label}에게 보임 — 누르면 감춤` : `${label}에게 감춤 — 누르면 보임`}
            onClick={() => onChange(on ? value.filter((v) => v !== r) : ALL_ROLES.filter((x) => x === r || value.includes(x)))}
            className={clsx(
              'inline-flex items-center gap-1 rounded-full border font-semibold transition-colors duration-150 disabled:opacity-50',
              size === 'sm' ? 'h-6 px-2 text-2xs' : 'h-7 px-2.5 text-xs',
              on ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-line-strong bg-surface text-faint line-through hover:text-muted',
            )}
          >
            {on ? <Eye className="size-3" aria-hidden /> : <EyeOff className="size-3" aria-hidden />}
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ── 새로 추가한 앱(링크) ──────────────────────────────────
const newId = () => Math.random().toString(36).slice(2, 10)
const validUrl = (u: string) => /^https?:\/\/\S+$/i.test(u.trim()) || /^\/\S*$/.test(u.trim())

export function LinksEditor({ draft, setDraft }: { draft: SiteConfig; setDraft: (c: SiteConfig) => void }) {
  const [form, setForm] = useState({ title: '', url: '', summary: '', group: 'doc' as GroupId })
  const live = draft.links.filter((l) => !l.deleted)
  const setLinks = (links: LinkApp[]) => setDraft({ ...draft, links })
  const patch = (id: string, p: Partial<LinkApp>) => setLinks(draft.links.map((l) => (l.id === id ? { ...l, ...p } : l)))
  const move = (id: string, dir: -1 | 1) => {
    const arr = [...draft.links]
    const i = arr.findIndex((l) => l.id === id)
    let j = i + dir
    while (j >= 0 && j < arr.length && arr[j].deleted) j += dir
    if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    setLinks(arr)
  }
  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return toast.error('앱 이름을 입력하세요.')
    if (!validUrl(form.url)) return toast.error('주소는 https:// 로 시작하는 외부 주소나 / 로 시작하는 사이트 안 주소여야 합니다.')
    const id = newId()
    const links = [
      ...draft.links,
      { id, title: form.title.trim(), url: form.url.trim(), summary: form.summary.trim(), group: form.group, enabled: true, badge: 'new' as const, roles: ['member', 'admin'] as Role[], deleted: false },
    ]
    // 신상앱 자동 등록이 켜져 있으면 맨 앞에 올린다
    const newApps = draft.newApps.autoAdd ? { ...draft.newApps, items: [`link-${id}`, ...draft.newApps.items] } : draft.newApps
    setDraft({ ...draft, links, newApps })
    setForm({ title: '', url: '', summary: '', group: form.group })
    toast.info('목록에 추가했습니다. 아래 [저장]을 눌러야 모두에게 보입니다.')
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-3">
        <Link2 className="size-[18px] text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-base">새로 추가한 앱</h3>
          <p className="text-xs text-muted">새로 만든 도구나 자주 쓰는 사이트를 메뉴에 추가합니다. 처음에는 NEW 표시가 붙고 직원등급·전체마스터에게만 보입니다.</p>
        </div>
      </div>
      {live.length > 0 && (
        <ul className="divide-y divide-line">
          {live.map((l, i) => (
            <li key={l.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid size-10 shrink-0 place-items-center rounded-md border border-line bg-surface text-brand">
                  <Link2 className="size-5" aria-hidden />
                </span>
                <TextInput value={l.title} aria-label="앱 이름" maxLength={30} onChange={(e) => patch(l.id, { title: e.target.value })} className="w-40! flex-none" />
                <TextInput value={l.url} aria-label="주소" onChange={(e) => patch(l.id, { url: e.target.value })} className="num min-w-0 flex-1" />
                <Select value={l.group} onValue={(g) => patch(l.id, { group: g })} options={GROUPS.map((g) => ({ value: g.id, label: g.title }))} aria-label="그룹" className="w-32!" />
                <div className="flex">
                  <IconButton icon={ArrowUp} label={`${l.title} 위로`} size="sm" disabled={i === 0} onClick={() => move(l.id, -1)} />
                  <IconButton icon={ArrowDown} label={`${l.title} 아래로`} size="sm" disabled={i === live.length - 1} onClick={() => move(l.id, 1)} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-12">
                <TextInput value={l.summary} aria-label="한 줄 설명" placeholder="한 줄 설명(선택)" maxLength={120} onChange={(e) => patch(l.id, { summary: e.target.value })} className="min-w-0 flex-1 basis-60" />
                <RoleChips value={l.roles} onChange={(roles) => patch(l.id, { roles })} size="sm" />
                <button
                  type="button"
                  aria-pressed={l.badge === 'new'}
                  onClick={() => patch(l.id, { badge: l.badge === 'new' ? null : 'new' })}
                  className={clsx('h-7 rounded-full border px-2.5 text-xs font-semibold transition-colors', l.badge === 'new' ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line-strong text-muted hover:text-ink')}
                >
                  NEW 표시
                </button>
                <Switch className="w-auto!" checked={l.enabled} onChange={(enabled) => patch(l.id, { enabled })} label={<span className="sr-only">{l.title} 노출</span>} />
                <IconButton icon={Trash2} label={`${l.title} 삭제`} size="sm" onClick={() => patch(l.id, { deleted: true })} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-col gap-3 border-t border-line bg-paper/60 px-4 py-4">
        <p className="text-sm font-bold text-ink">새 앱 추가</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="앱 이름">{(id) => <TextInput id={id} value={form.title} maxLength={30} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: ERP 재고 조회" />}</Field>
          <Field label="주소" hint="https://… 는 새 탭, /tools/… 는 이 사이트 안">{(id) => <TextInput id={id} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" className="num" />}</Field>
          <Field label="한 줄 설명(선택)">{(id) => <TextInput id={id} value={form.summary} maxLength={120} onChange={(e) => setForm({ ...form, summary: e.target.value })} />}</Field>
          <Field label="넣을 그룹">{(id) => <Select id={id} value={form.group} onValue={(group) => setForm({ ...form, group })} options={GROUPS.map((g) => ({ value: g.id, label: g.title }))} />}</Field>
        </div>
        <Button type="submit" icon={Plus} className="self-start" disabled={draft.links.length >= 60}>
          목록에 추가
        </Button>
      </form>
    </Panel>
  )
}

/** 삭제한 도구·앱 — 복원 또는 (추가한 앱만) 완전 삭제 */
export function DeletedEditor({ draft, setDraft }: { draft: SiteConfig; setDraft: (c: SiteConfig) => void }) {
  const tools = TOOLS.filter((t) => draft.tools[t.id]?.deleted)
  const links = draft.links.filter((l) => l.deleted)
  if (!tools.length && !links.length) return null
  return (
    <Panel className="p-4">
      <h3 className="text-base">삭제한 메뉴 {tools.length + links.length}개</h3>
      <p className="mb-3 text-xs text-muted">홈·사이드바·검색에서 빠진 상태입니다. 복원하면 원래 설정 그대로 돌아옵니다.</p>
      <ul className="flex flex-col gap-2">
        {tools.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3">
            <img src={artUrl(t.art)} alt="" className="size-8 object-contain opacity-50 grayscale" />
            <span className="min-w-0 flex-1 text-sm text-ink-2">{t.title}</span>
            <Button size="sm" onClick={() => setDraft({ ...draft, tools: { ...draft.tools, [t.id]: { ...draft.tools[t.id], deleted: false } } })}>
              복원
            </Button>
          </li>
        ))}
        {links.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3">
            <span className="grid size-8 place-items-center rounded-md border border-line text-faint">
              <Link2 className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 text-sm text-ink-2">
              {l.title} <span className="num text-xs text-muted">{l.url}</span>
            </span>
            <Button size="sm" onClick={() => setDraft({ ...draft, links: draft.links.map((x) => (x.id === l.id ? { ...x, deleted: false } : x)) })}>
              복원
            </Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => setDraft({ ...draft, links: draft.links.filter((x) => x.id !== l.id), newApps: { ...draft.newApps, items: draft.newApps.items.filter((k) => k !== `link-${l.id}`) } })}>
              완전 삭제
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// ── 계정 관리 ─────────────────────────────────────────────
const ROLE_RANK: Record<AccountRole, number> = { admin: 0, member: 1, general: 2 }
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-')

function AccessDialog({ user, onClose, onSaved }: { user: PublicUser | null; onClose: () => void; onSaved: (u: PublicUser) => void }) {
  const config = useSite((s) => s.config)
  const [access, setAccess] = useState<Access>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => setAccess(user?.access ?? {}), [user])
  if (!user) return null
  const viewerFor = (a: Access) => ({ role: user.role as Role, access: a })
  const items: Array<{ key: string; title: string; group: GroupId; entry: SiteConfig['tools'][string]; art?: string }> = [
    ...TOOLS.filter((t) => !config.tools[t.id]?.deleted).map((t) => ({ key: t.id, title: t.title, group: groupOf(config, t), entry: config.tools[t.id], art: t.art })),
    ...config.links.filter((l) => !l.deleted).map((l) => ({ key: `link-${l.id}`, title: l.title, group: l.group, entry: l })),
  ]
  const set = async (key: string, v: 'default' | 'allow' | 'deny') => {
    const next = { ...access }
    if (v === 'default') delete next[key]
    else next[key] = v
    setAccess(next)
    setBusy(true)
    try {
      const r = await api<{ user: PublicUser }>(`/admin/users/${user.id}`, { method: 'PATCH', body: { access: next } })
      onSaved(r.user)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장하지 못했습니다.')
      setAccess(access)
    } finally {
      setBusy(false)
    }
  }
  const exceptions = Object.keys(access).length
  return (
    <Dialog open onClose={onClose} title={`${user.name} 님의 도구 권한`} size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          등급(<b className="text-ink">{ROLE_LABEL[user.role]}</b>) 설정과 다르게 이 사람만 <b className="text-ink">허용</b>하거나 <b className="text-ink">차단</b>합니다. 바꾸면 바로 저장됩니다. 지금 예외 <b className="num text-ink">{exceptions}</b>개.
        </p>
        <div className="max-h-[60dvh] overflow-auto rounded-md border border-line">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="sticky top-0 z-10 bg-surface text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-semibold">도구</th>
                <th className="px-3 py-2 font-semibold">등급 기본</th>
                <th className="px-3 py-2 font-semibold">이 사람만</th>
                <th className="px-3 py-2 font-semibold">결과</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => {
                const rows = items.filter((it) => it.group === g.id)
                if (!rows.length) return null
                return [
                  <tr key={`g-${g.id}`} className="bg-paper">
                    <td colSpan={4} className="px-3 py-1.5 text-xs font-bold text-muted">
                      {g.title}
                    </td>
                  </tr>,
                  ...rows.map((it) => {
                    const byRole = canSee(it.entry, it.key, viewerFor({}))
                    const final = canSee(it.entry, it.key, viewerFor(access))
                    const cur = access[it.key] ?? 'default'
                    return (
                      <tr key={it.key} className="border-t border-line">
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2 font-semibold text-ink">
                            {it.art ? <img src={artUrl(it.art)} alt="" className="size-7 object-contain" /> : <Link2 className="size-5 text-brand" aria-hidden />}
                            {it.title}
                            {!it.entry.enabled && <Badge>꺼짐</Badge>}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">{byRole ? '보임' : '감춤'}</td>
                        <td className="px-3 py-2">
                          <Segmented
                            label={`${it.title} 권한`}
                            size="sm"
                            value={cur}
                            onValue={(v) => void set(it.key, v)}
                            options={[
                              { value: 'default', label: '등급대로' },
                              { value: 'allow', label: '허용', disabled: busy },
                              { value: 'deny', label: '차단', disabled: busy },
                            ]}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', final ? 'bg-brand-soft text-brand-ink' : 'bg-sunken text-muted')}>
                            {final ? <Eye className="size-3" aria-hidden /> : <EyeOff className="size-3" aria-hidden />}
                            {final ? '보임' : '감춤'}
                          </span>
                        </td>
                      </tr>
                    )
                  }),
                ]
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">관리자가 메뉴를 꺼 둔 도구는 허용해도 보이지 않습니다.</p>
      </div>
    </Dialog>
  )
}

export function AccountsEditor() {
  const me = useViewerStore((s) => s.user)
  const reloadViewer = useViewerStore((s) => s.load)
  const [users, setUsers] = useState<PublicUser[] | null>(null)
  const [q, setQ] = useState('')
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'member' as AccountRole })
  const [busy, setBusy] = useState<string | null>(null)
  const [accessOf, setAccessOf] = useState<PublicUser | null>(null)
  const [reset, setReset] = useState<{ user: PublicUser; pw: string } | null>(null)
  const [del, setDel] = useState<PublicUser | null>(null)

  const refresh = async () => setUsers((await api<{ users: PublicUser[] }>('/admin/users')).users)
  useEffect(() => {
    refresh().catch((err) => toast.error(err instanceof Error ? err.message : '계정 목록을 불러오지 못했습니다.'))
  }, [])
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '요청에 실패했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const replace = (u: PublicUser) => {
    setUsers((list) => list?.map((x) => (x.id === u.id ? u : x)) ?? null)
    if (u.id === me?.id) void reloadViewer()
  }

  const create = (e: FormEvent) => {
    e.preventDefault()
    void run('create', async () => {
      await api('/admin/users', { method: 'POST', body: form })
      toast.success(`${form.name} 계정을 만들었습니다. 아이디와 비밀번호를 본인에게 알려 주세요.`)
      setForm({ username: '', name: '', password: '', role: form.role })
      await refresh()
    })
  }
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    return (users ?? []).filter((u) => !k || `${u.name} ${u.username}`.toLowerCase().includes(k)).sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.name.localeCompare(b.name, 'ko'))
  }, [users, q])

  return (
    <div className="flex flex-col gap-5">
      <Callout tone="info" title="등급">
        <b>전체마스터</b>는 이 관리자 화면까지 쓰는 사람, <b>직원등급</b>은 팀원(팀 보관함 저장 가능), <b>일반등급</b>은 로그인한 일반 사용자, <b>전체공개</b>는 로그인하지 않은 모든 사람입니다. 도구별로 어떤 등급에게 보일지는 [메뉴·앱 관리]에서, 특정 사람만 다르게 하려면 아래 목록의 [도구 권한]에서 정합니다.
      </Callout>

      <Panel className="p-5">
        <form onSubmit={create} className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-base">
            <UserPlus className="size-[18px] text-brand" aria-hidden /> 계정 추가
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="이름">{(id) => <TextInput id={id} value={form.name} maxLength={30} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 김담당" />}</Field>
            <Field label="아이디" hint="한글·영문·숫자 2~30자">{(id) => <TextInput id={id} value={form.username} maxLength={30} autoComplete="off" onChange={(e) => setForm({ ...form, username: e.target.value })} />}</Field>
            <Field label="처음 비밀번호" hint="6자 이상 · 로그인 후 본인이 바꿀 수 있음">{(id) => <TextInput id={id} value={form.password} autoComplete="new-password" onChange={(e) => setForm({ ...form, password: e.target.value })} />}</Field>
            <Field label="등급">{(id) => <Select id={id} value={form.role} onValue={(role) => setForm({ ...form, role })} options={ACCOUNT_ROLES} />}</Field>
          </div>
          <Button type="submit" variant="primary" icon={Plus} loading={busy === 'create'} className="self-start">
            계정 만들기
          </Button>
        </form>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-3">
          <h3 className="text-base">
            계정 <span className="num text-muted">{users?.length ?? ''}</span>
          </h3>
          <label className="ml-auto flex h-9 w-full items-center gap-2 rounded-md border border-line-strong bg-surface px-3 sm:w-64">
            <Search className="size-4 text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·아이디 찾기" aria-label="계정 찾기" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
          </label>
        </div>
        {users === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted">
            <Spinner /> 불러오는 중
          </div>
        ) : !users.length ? (
          <EmptyState icon={UserPlus} title="아직 계정이 없습니다" className="py-10">
            위에서 팀원 계정을 만들면 여기에 나옵니다.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-semibold">이름</th>
                  <th className="px-4 py-2 font-semibold">아이디</th>
                  <th className="px-4 py-2 font-semibold">등급</th>
                  <th className="px-4 py-2 font-semibold">사용</th>
                  <th className="px-4 py-2 font-semibold">마지막 로그인</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const exceptions = Object.keys(u.access ?? {}).length
                  return (
                    <tr key={u.id} className={clsx('border-b border-line last:border-b-0', u.disabled && 'opacity-60')}>
                      <td className="px-4 py-2.5 font-semibold text-ink">
                        {u.name}
                        {u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-muted">(나)</span>}
                      </td>
                      <td className="num px-4 py-2.5 text-ink-2">{u.username}</td>
                      <td className="px-4 py-2.5">
                        <Select
                          value={u.role}
                          aria-label={`${u.name} 등급`}
                          onValue={(role) => void run(`role:${u.id}`, async () => replace((await api<{ user: PublicUser }>(`/admin/users/${u.id}`, { method: 'PATCH', body: { role } })).user))}
                          options={ACCOUNT_ROLES}
                          className="h-8! w-32!"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <Switch
                          className="w-auto!"
                          checked={!u.disabled}
                          disabled={u.id === me?.id}
                          onChange={(on) => void run(`dis:${u.id}`, async () => replace((await api<{ user: PublicUser }>(`/admin/users/${u.id}`, { method: 'PATCH', body: { disabled: !on } })).user))}
                          label={<span className="sr-only">{u.name} 사용</span>}
                        />
                      </td>
                      <td className="num px-4 py-2.5 text-xs text-muted">{fmtDate(u.lastLoginAt)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" icon={ShieldCheck} onClick={() => setAccessOf(u)}>
                            도구 권한{exceptions ? <span className="num ml-0.5 text-accent">{exceptions}</span> : null}
                          </Button>
                          <IconButton icon={KeyRound} label={`${u.name} 비밀번호 다시 정하기`} size="sm" onClick={() => setReset({ user: u, pw: '' })} />
                          <IconButton icon={Trash2} label={`${u.name} 계정 삭제`} size="sm" disabled={u.id === me?.id} onClick={() => setDel(u)} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <AccessDialog user={accessOf} onClose={() => setAccessOf(null)} onSaved={(u) => { replace(u); setAccessOf(u) }} />

      <Dialog
        open={!!reset}
        onClose={() => setReset(null)}
        title={`${reset?.user.name ?? ''} 비밀번호 다시 정하기`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setReset(null)}>취소</Button>
            <Button
              variant="primary"
              icon={Check}
              loading={busy === 'reset'}
              disabled={(reset?.pw.length ?? 0) < 6}
              onClick={() =>
                reset &&
                void run('reset', async () => {
                  await api(`/admin/users/${reset.user.id}`, { method: 'PATCH', body: { password: reset.pw } })
                  toast.success('비밀번호를 바꿨습니다. 그 사람은 새 비밀번호로 다시 로그인해야 합니다.')
                  setReset(null)
                })
              }
            >
              바꾸기
            </Button>
          </>
        }
      >
        <Field label="새 비밀번호" hint="6자 이상">{(id) => <TextInput id={id} autoFocus value={reset?.pw ?? ''} onChange={(e) => reset && setReset({ ...reset, pw: e.target.value })} />}</Field>
      </Dialog>

      <Dialog
        open={!!del}
        onClose={() => setDel(null)}
        title="계정 삭제"
        size="sm"
        footer={
          <>
            <Button onClick={() => setDel(null)}>취소</Button>
            <Button
              variant="danger"
              icon={Ban}
              loading={busy === 'del'}
              onClick={() =>
                del &&
                void run('del', async () => {
                  await api(`/admin/users/${del.id}`, { method: 'DELETE' })
                  toast.success(`${del.name} 계정을 삭제했습니다.`)
                  setDel(null)
                  await refresh()
                })
              }
            >
              삭제
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          <b>{del?.name}</b>({del?.username}) 계정을 삭제할까요? 되돌릴 수 없습니다. 잠시 막아 두려면 삭제 대신 [사용] 스위치를 끄세요.
        </p>
      </Dialog>
    </div>
  )
}

// ── 신상앱(메인 화면 소개 칸) ─────────────────────────────
export function NewAppsEditor({ draft, setDraft }: { draft: SiteConfig; setDraft: (c: SiteConfig) => void }) {
  const na = draft.newApps
  const setNa = (p: Partial<SiteConfig['newApps']>) => setDraft({ ...draft, newApps: { ...na, ...p } })
  const options = [
    ...TOOLS.filter((t) => !draft.tools[t.id]?.deleted).map((t) => ({ key: t.id, title: t.title, art: t.art as string | undefined, group: groupOf(draft, t) })),
    ...draft.links.filter((l) => !l.deleted).map((l) => ({ key: `link-${l.id}`, title: l.title, art: undefined, group: l.group })),
  ]
  const byKey = new Map(options.map((o) => [o.key, o]))
  const items = na.items.filter((k) => byKey.has(k))
  const rest = options.filter((o) => !items.includes(o.key))
  const [pick, setPick] = useState('')
  const move = (i: number, dir: -1 | 1) => {
    const arr = [...items]
    const j = i + dir
    if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    setNa({ items: arr })
  }
  const add = () => {
    const key = pick || rest[0]?.key
    if (!key) return
    setNa({ items: [key, ...items] })
    setPick('')
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-mark-soft/60 px-4 py-3">
        <Sparkles className="size-[18px] text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-base">
            신상앱 <Badge tone="accent">NEW</Badge>
          </h3>
          <p className="text-xs text-muted">메인 화면 맨 위에 새로 들어온 앱을 소개합니다. 넣고 빼기·순서는 여기서 정하고, 누구에게 보일지는 각 도구의 등급 설정을 따릅니다.</p>
        </div>
        <Switch className="w-auto!" checked={na.enabled} onChange={(enabled) => setNa({ enabled })} label={<span className="text-sm font-semibold">메인 화면에 보이기</span>} />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr] sm:items-end">
          <Field label="칸 제목">{(id) => <TextInput id={id} value={na.title} maxLength={20} onChange={(e) => setNa({ title: e.target.value })} />}</Field>
          <Switch checked={na.autoAdd} onChange={(autoAdd) => setNa({ autoAdd })} label="새로 추가되는 앱은 자동으로 신상앱 맨 앞에 넣기" hint="새 도구가 생기거나 아래 [새로 추가한 앱]에서 링크 앱을 추가하면 바로 올라갑니다." />
        </div>

        {items.length ? (
          <ol className="flex flex-col divide-y divide-line rounded-md border border-line">
            {items.map((k, i) => {
              const o = byKey.get(k)!
              return (
                <li key={k} className="flex items-center gap-3 px-3 py-2">
                  <span className="num w-5 text-right text-xs text-muted">{i + 1}</span>
                  {o.art ? <img src={artUrl(o.art)} alt="" className="size-9 object-contain" /> : <span className="grid size-9 place-items-center rounded-md border border-line text-brand"><Link2 className="size-4" aria-hidden /></span>}
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{o.title}</span>
                  <div className="flex">
                    <IconButton icon={ArrowUp} label={`${o.title} 앞으로`} size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton icon={ArrowDown} label={`${o.title} 뒤로`} size="sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} />
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setNa({ items: items.filter((x) => x !== k) })}>
                    빼기
                  </Button>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-sm text-muted">신상앱에 올린 앱이 없습니다. 아래에서 골라 넣으세요. 비어 있으면 메인 화면에 칸이 보이지 않습니다.</p>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <Field label="신상앱에 넣을 앱" className="min-w-0 flex-1 basis-60">
            {(id) => (
              <Select
                id={id}
                value={pick || rest[0]?.key || ''}
                onValue={setPick}
                disabled={!rest.length}
                options={rest.length ? rest.map((o) => ({ value: o.key, label: `${GROUPS.find((g) => g.id === o.group)?.title ?? ''} · ${o.title}` })) : [{ value: '', label: '넣을 수 있는 앱이 없습니다' }]}
              />
            )}
          </Field>
          <Button icon={Plus} disabled={!rest.length || items.length >= 24} onClick={add}>
            넣기
          </Button>
        </div>
      </div>
    </Panel>
  )
}
