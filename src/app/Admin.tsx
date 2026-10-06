import clsx from 'clsx'
import { ArrowDown, ArrowUp, KeyRound, LogOut, Plus, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError } from '@/lib/api'
import { readAsDataURL } from '@/lib/files'
import { Badge, Button, Callout, ColorField, Field, IconButton, NumberInput, Panel, PositionGrid, Segmented, Slider, Spinner, Switch, Tabs, TextInput, Textarea, toast } from '@/ui'
import { useSite, type SiteConfig } from './config'
import { GROUPS, TOOLS, artUrl, type GroupId } from './registry'
import { AccountsEditor, DeletedEditor, LinksEditor, RoleChips } from './AdminAccess'
import { useLoginDialog } from './LoginDialog'
import { useViewerStore } from './viewer'

type AuthStatus = { configured: boolean; loggedIn: boolean } | 'offline' | null

function PasswordForm({ mode, onDone }: { mode: 'setup' | 'login'; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'setup') {
      if (password.length < 8) return setError('비밀번호는 8자 이상으로 정해 주세요.')
      if (password !== confirm) return setError('두 칸의 비밀번호가 서로 다릅니다.')
    }
    setBusy(true)
    try {
      await api(mode === 'setup' ? '/admin/setup' : '/admin/login', { method: 'POST', body: { password } })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : '요청에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel className="mx-auto mt-10 w-full max-w-sm p-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl">{mode === 'setup' ? '관리자 비밀번호 정하기' : '관리자 로그인'}</h1>
          <p className="mt-1 text-sm text-muted">
            {mode === 'setup' ? '처음 한 번만 정합니다. 이 비밀번호를 아는 사람이 메뉴와 팀 프리셋을 바꿀 수 있습니다.' : '메뉴 노출과 팀 프리셋을 관리합니다.'}
          </p>
        </div>
        <Field label="비밀번호" hint={mode === 'setup' ? '8자 이상' : undefined}>
          {(id) => <TextInput id={id} type="password" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {mode === 'setup' && (
          <Field label="비밀번호 다시 입력">{(id) => <TextInput id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
        <Button type="submit" variant="primary" loading={busy} icon={KeyRound}>
          {mode === 'setup' ? '비밀번호 정하고 시작' : '로그인'}
        </Button>
      </form>
    </Panel>
  )
}

// ── 메뉴 관리 ─────────────────────────────────────────────
function MenuEditor({ draft, setDraft }: { draft: SiteConfig; setDraft: (c: SiteConfig) => void }) {
  const rank = useMemo(() => new Map(draft.toolOrder.map((id, i) => [id, i])), [draft.toolOrder])
  const move = (group: GroupId, id: string, dir: -1 | 1) => {
    const inGroup = TOOLS.filter((t) => t.group === group).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)).map((t) => t.id)
    const i = inGroup.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= inGroup.length) return
    const order = [...draft.toolOrder]
    const a = order.indexOf(inGroup[i])
    const b = order.indexOf(inGroup[j])
    ;[order[a], order[b]] = [order[b], order[a]]
    setDraft({ ...draft, toolOrder: order })
  }
  const setTool = (id: string, patch: Partial<SiteConfig['tools'][string]>) => setDraft({ ...draft, tools: { ...draft.tools, [id]: { ...draft.tools[id], ...patch } } })
  const setAll = (enabled: boolean) => setDraft({ ...draft, tools: Object.fromEntries(Object.entries(draft.tools).map(([id, t]) => [id, { ...t, enabled }])) })
  const onCount = TOOLS.filter((t) => draft.tools[t.id].enabled && !draft.tools[t.id].deleted && draft.groups[t.group].enabled).length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          스위치를 끄면 모두에게서 숨겨집니다. <b className="text-ink">전체마스터·직원등급·일반등급·전체공개</b> 칩을 눌러 등급별로 보이기/감추기를 정하고, 휴지통으로 메뉴에서 삭제합니다(아래에서 복원). 지금 <b className="num text-ink">{onCount}</b> / {TOOLS.length}개가 켜져 있습니다.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAll(true)}>
            전부 켜기
          </Button>
          <Button size="sm" onClick={() => setAll(false)}>
            전부 끄기
          </Button>
        </div>
      </div>
      {GROUPS.map((group) => {
        const groupOn = draft.groups[group.id].enabled
        const tools = TOOLS.filter((t) => t.group === group.id && !draft.tools[t.id].deleted).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
        return (
          <Panel key={group.id} className="overflow-hidden">
            <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-3">
              <group.icon className="size-[18px] text-brand" aria-hidden />
              <div className="min-w-0 flex-1">
                <h3 className="text-base">{group.title}</h3>
                <p className="text-xs text-muted">그룹을 끄면 아래 도구가 모두 숨겨집니다.</p>
              </div>
              <Switch className="w-auto!" checked={groupOn} onChange={(enabled) => setDraft({ ...draft, groups: { ...draft.groups, [group.id]: { enabled } } })} label={<span className="sr-only">{group.title} 그룹 노출</span>} />
            </div>
            <ul className={clsx('divide-y divide-line', !groupOn && 'opacity-50')}>
              {tools.map((t, i) => {
                const state = draft.tools[t.id]
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                    <img src={artUrl(t.art)} alt="" className={clsx('size-10 shrink-0 object-contain transition-[filter,opacity]', !state.enabled && 'opacity-40 grayscale')} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 font-semibold text-ink">
                        <span className="truncate">{t.title}</span>
                        {state.badge === 'new' && <Badge tone="accent">NEW</Badge>}
                        {!state.enabled && <Badge>숨김</Badge>}
                      </p>
                      <p className="truncate text-sm text-muted">{t.summary}</p>
                    </div>
                    <button
                      type="button"
                      aria-pressed={state.badge === 'new'}
                      onClick={() => setTool(t.id, { badge: state.badge === 'new' ? null : 'new' })}
                      className={clsx('hidden h-7 rounded-full border px-2.5 text-xs font-semibold transition-colors sm:block', state.badge === 'new' ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line-strong text-muted hover:text-ink')}
                    >
                      NEW 표시
                    </button>
                    <div className="flex">
                      <IconButton icon={ArrowUp} label={`${t.title} 위로`} size="sm" disabled={i === 0} onClick={() => move(group.id, t.id, -1)} />
                      <IconButton icon={ArrowDown} label={`${t.title} 아래로`} size="sm" disabled={i === tools.length - 1} onClick={() => move(group.id, t.id, 1)} />
                    </div>
                    <Switch className="w-auto!" checked={state.enabled} disabled={!groupOn} onChange={(enabled) => setTool(t.id, { enabled })} label={<span className="sr-only">{t.title} 노출</span>} />
                    <IconButton icon={Trash2} label={`${t.title} 메뉴에서 삭제`} size="sm" onClick={() => setTool(t.id, { deleted: true })} />
                    <div className="basis-full pl-[52px]">
                      <RoleChips value={state.roles} onChange={(roles) => setTool(t.id, { roles })} size="sm" disabled={!state.enabled || !groupOn} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </Panel>
        )
      })}
      <LinksEditor draft={draft} setDraft={setDraft} />
      <DeletedEditor draft={draft} setDraft={setDraft} />
    </div>
  )
}

// ── 공지·팀 프리셋 ────────────────────────────────────────
function PresetEditor({ draft, setDraft }: { draft: SiteConfig; setDraft: (c: SiteConfig) => void }) {
  const p = draft.presets
  const setPresets = (patch: Partial<SiteConfig['presets']>) => setDraft({ ...draft, presets: { ...p, ...patch } })
  const wm = p.watermark
  const setWm = (patch: Partial<typeof wm>) => setPresets({ watermark: { ...wm, ...patch } })
  const logoInput = useRef<HTMLInputElement>(null)
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel className="flex flex-col gap-4 p-5">
        <div>
          <h3 className="text-base">공지 띠</h3>
          <p className="text-sm text-muted">모든 화면 맨 위에 한 줄로 보입니다. 점검 안내나 사용 팁에 쓰세요.</p>
        </div>
        <Switch checked={draft.notice.enabled} onChange={(enabled) => setDraft({ ...draft, notice: { ...draft.notice, enabled } })} label="공지 보이기" />
        <Field label="공지 내용" aside={`${draft.notice.text.length}/300`}>
          {(id) => <Textarea id={id} value={draft.notice.text} maxLength={300} onChange={(e) => setDraft({ ...draft, notice: { ...draft.notice, text: e.target.value } })} placeholder="예: 10/5(월) 오전 9시~10시 서버 점검이 있습니다." className="min-h-20!" />}
        </Field>
      </Panel>

      <Panel className="flex flex-col gap-4 p-5">
        <div>
          <h3 className="text-base">브랜드 색</h3>
          <p className="text-sm text-muted">모든 도구의 색 고르기 옆에 빠른 선택으로 나옵니다.</p>
        </div>
        <ul className="flex flex-col gap-2">
          {p.brandColors.map((c, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="relative inline-flex size-10 shrink-0 overflow-hidden rounded-md border border-line-strong">
                <input
                  type="color"
                  value={c.hex}
                  aria-label={`${c.name || '색'} 값`}
                  onChange={(e) => setPresets({ brandColors: p.brandColors.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)) })}
                  className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 p-0"
                />
              </span>
              <TextInput value={c.name} aria-label="색 이름" placeholder="색 이름" maxLength={20} onChange={(e) => setPresets({ brandColors: p.brandColors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <span className="num w-20 shrink-0 text-sm uppercase text-muted">{c.hex}</span>
              <IconButton icon={Trash2} label="색 삭제" size="sm" onClick={() => setPresets({ brandColors: p.brandColors.filter((_, j) => j !== i) })} />
            </li>
          ))}
        </ul>
        <Button size="sm" icon={Plus} className="self-start" disabled={p.brandColors.length >= 12} onClick={() => setPresets({ brandColors: [...p.brandColors, { name: '새 색', hex: '#0b7a53' }] })}>
          색 추가
        </Button>
      </Panel>

      <Panel className="flex flex-col gap-4 p-5">
        <div>
          <h3 className="text-base">팀 워터마크</h3>
          <p className="text-sm text-muted">이미지·영상 도구의 “팀 워터마크 불러오기”로 한 번에 적용됩니다.</p>
        </div>
        <Segmented label="워터마크 종류" value={wm.kind} onValue={(kind) => setWm({ kind })} options={[{ value: 'text', label: '문자' }, { value: 'logo', label: '로고 이미지' }]} className="self-start" />
        {wm.kind === 'text' ? (
          <>
            <Field label="문구">{(id) => <TextInput id={id} value={wm.text} maxLength={60} onChange={(e) => setWm({ text: e.target.value })} />}</Field>
            <ColorField label="글자 색" value={wm.color} onValue={(color) => setWm({ color })} />
          </>
        ) : (
          <div className="flex items-center gap-3">
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                if (f.size > 1024 * 1024) return toast.error('로고는 1MB 이하 이미지로 올려 주세요. 투명 PNG 를 권장합니다.')
                setWm({ logoDataUrl: await readAsDataURL(f) })
              }}
            />
            <div className="checker flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-strong">
              {wm.logoDataUrl ? <img src={wm.logoDataUrl} alt="팀 로고 미리보기" className="max-h-full max-w-full" /> : <span className="text-xs text-muted">로고 없음</span>}
            </div>
            <div className="flex flex-col gap-2">
              <Button size="sm" icon={Upload} onClick={() => logoInput.current?.click()}>
                로고 올리기
              </Button>
              {wm.logoDataUrl && (
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setWm({ logoDataUrl: null })}>
                  지우기
                </Button>
              )}
            </div>
          </div>
        )}
        <div className="flex gap-5">
          <PositionGrid value={wm.position} onValue={(position) => setWm({ position })} />
          <div className="flex flex-1 flex-col gap-2.5">
            <Field label="크기" aside={`${wm.sizePct}%`}>{(id) => <Slider id={id} min={1} max={25} value={wm.sizePct} onValue={(sizePct) => setWm({ sizePct })} />}</Field>
            <Field label="농도" aside={`${wm.opacity}%`}>{(id) => <Slider id={id} min={5} max={100} step={5} value={wm.opacity} onValue={(opacity) => setWm({ opacity })} />}</Field>
            <Field label="가장자리 여백" aside={`${wm.margin}px`}>{(id) => <Slider id={id} min={0} max={120} step={4} value={wm.margin} onValue={(margin) => setWm({ margin })} />}</Field>
          </div>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-4 p-5">
        <div>
          <h3 className="text-base">자주 쓰는 크기</h3>
          <p className="text-sm text-muted">템플릿 캔버스와 이미지 편집의 크기 빠른 선택에 나옵니다.</p>
        </div>
        <ul className="flex flex-col gap-2">
          {p.canvasSizes.map((s, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_auto] items-center gap-2">
              <TextInput value={s.name} aria-label="크기 이름" maxLength={24} onChange={(e) => setPresets({ canvasSizes: p.canvasSizes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <NumberInput value={s.w} unit="px" aria-label="가로" min={1} max={10000} onValue={(v) => setPresets({ canvasSizes: p.canvasSizes.map((x, j) => (j === i ? { ...x, w: v ?? 1 } : x)) })} />
              <NumberInput value={s.h} unit="px" aria-label="세로" min={1} max={20000} onValue={(v) => setPresets({ canvasSizes: p.canvasSizes.map((x, j) => (j === i ? { ...x, h: v ?? 1 } : x)) })} />
              <IconButton icon={Trash2} label="크기 삭제" size="sm" onClick={() => setPresets({ canvasSizes: p.canvasSizes.filter((_, j) => j !== i) })} />
            </li>
          ))}
        </ul>
        <Button size="sm" icon={Plus} className="self-start" disabled={p.canvasSizes.length >= 20} onClick={() => setPresets({ canvasSizes: [...p.canvasSizes, { name: '새 크기', w: 1000, h: 1000 }] })}>
          크기 추가
        </Button>
        <div className="border-t border-line pt-4">
          <h3 className="text-base">파일명 규칙</h3>
          <p className="mb-3 text-sm text-muted">파일명 일괄 변경의 기본값입니다. 예: {p.filename.base}_{String(p.filename.start).padStart(p.filename.digits, '0')}.jpg</p>
          <div className="grid grid-cols-3 gap-2">
            <Field label="공통 이름">{(id) => <TextInput id={id} value={p.filename.base} maxLength={40} onChange={(e) => setPresets({ filename: { ...p.filename, base: e.target.value } })} />}</Field>
            <Field label="시작 번호">{(id) => <NumberInput id={id} value={p.filename.start} min={0} onValue={(v) => setPresets({ filename: { ...p.filename, start: v ?? 1 } })} />}</Field>
            <Field label="자릿수">{(id) => <NumberInput id={id} value={p.filename.digits} min={1} max={8} onValue={(v) => setPresets({ filename: { ...p.filename, digits: Math.min(8, Math.max(1, v ?? 3)) } })} />}</Field>
          </div>
        </div>
      </Panel>
    </div>
  )
}

interface AdminTeam {
  id: string
  name: string
  createdAt: string
  codeChangedAt: string | null
  docs: number
  lastDocAt: string | null
  ownKit: boolean
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '')

async function attempt(fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '처리하지 못했습니다.')
  }
}

/** 팀 만들기·팀 코드 정하기 + 모든 팀이 함께 쓰는 회사 공통 자료 */
function TeamsEditor() {
  const navigate = useNavigate()
  const [teams, setTeams] = useState<AdminTeam[] | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; field: 'name' | 'code'; value: string } | null>(null)

  const refresh = async () => setTeams((await api<{ teams: AdminTeam[] }>('/admin/teams')).teams)
  useEffect(() => {
    void attempt(refresh)
  }, [])
  const run = (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    void attempt(fn).finally(() => setBusy(null))
  }

  const create = (e: FormEvent) => {
    e.preventDefault()
    run('create', async () => {
      await api('/admin/teams', { method: 'POST', body: { name: name.trim(), code: code.trim() } })
      toast.success(`${name.trim()} 팀을 만들었습니다. 팀 코드를 팀에 알려 주세요.`)
      setName('')
      setCode('')
      await refresh()
    })
  }
  const saveEdit = () => {
    if (!editing) return
    const { id, field, value } = editing
    run(`edit:${id}`, async () => {
      await api(`/admin/teams/${id}`, { method: 'PATCH', body: { [field]: value.trim() } })
      toast.success(field === 'code' ? '팀 코드를 바꿨습니다. 그 팀 사람들은 새 코드로 다시 들어와야 합니다.' : '팀 이름을 바꿨습니다.')
      setEditing(null)
      await refresh()
    })
  }
  const enter = (t: AdminTeam) =>
    run(`enter:${t.id}`, async () => {
      const { useTeam } = await import('@/tools/quote/team')
      await useTeam.getState().adminEnter(t.id)
      navigate('/tools/quote')
    })

  return (
    <div className="flex flex-col gap-5">
      <Panel className="flex flex-col gap-4 p-5">
        <div>
          <h3 className="text-base">팀</h3>
          <p className="text-sm text-muted">
            팀마다 견적서·거래명세서 문서함, 담당자, (원하면) 회사 자료가 따로 저장됩니다. 팀 코드를 알아야 그 팀 공간에 들어갈 수 있고, 팀은 팀 설정에서 코드를 직접 바꿀 수 있습니다.
          </p>
        </div>
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <Field label="팀 이름" className="min-w-44 flex-1">
            {(id) => <TextInput id={id} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="예: 영업1팀" />}
          </Field>
          <Field label="처음 팀 코드" hint="4자 이상. 팀마다 다르게." className="min-w-44 flex-1">
            {(id) => <TextInput id={id} value={code} maxLength={40} autoComplete="off" onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" icon={Plus} loading={busy === 'create'} disabled={!name.trim() || code.trim().length < 4} className="mb-[22px]">
            팀 추가
          </Button>
        </form>

        {teams === null ? (
          <Spinner />
        ) : teams.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong p-4 text-sm text-muted">아직 팀이 없습니다. 위에서 첫 팀을 만들어 주세요.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {teams.map((t) => {
              const edit = editing?.id === t.id ? editing : null
              return (
                <li key={t.id} className="flex flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-semibold text-ink">{t.name}</p>
                    <span className="num text-sm text-muted">문서 {t.docs}건</span>
                    {t.lastDocAt && <span className="text-xs text-faint">최근 {when(t.lastDocAt)}</span>}
                    {t.ownKit && <Badge tone="accent">팀 전용 회사 자료</Badge>}
                    {t.codeChangedAt && <span className="text-xs text-faint">코드 바꿈 {when(t.codeChangedAt)}</span>}
                    <div className="ml-auto flex flex-wrap gap-1">
                      <Button size="sm" variant="primary" loading={busy === `enter:${t.id}`} onClick={() => enter(t)}>
                        들어가기
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: t.id, field: 'name', value: t.name })}>
                        이름 바꾸기
                      </Button>
                      <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => setEditing({ id: t.id, field: 'code', value: '' })}>
                        코드 다시 정하기
                      </Button>
                      <IconButton
                        icon={Trash2}
                        label={`${t.name} 삭제`}
                        size="sm"
                        onClick={() =>
                          run(`del:${t.id}`, async () => {
                            if (!confirm(`${t.name} 팀을 지울까요? 이 팀의 문서 ${t.docs}건과 담당자·회사 자료가 모두 사라지고 되돌릴 수 없습니다.`)) return
                            if (t.docs > 0 && prompt(`확인을 위해 팀 이름 “${t.name}”을 그대로 적어 주세요.`)?.trim() !== t.name) return toast.info('지우지 않았습니다.')
                            await api(`/admin/teams/${t.id}`, { method: 'DELETE' })
                            toast.success('팀을 지웠습니다.')
                            await refresh()
                          })
                        }
                      />
                    </div>
                  </div>
                  {edit && (
                    <form
                      className="flex flex-wrap items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        saveEdit()
                      }}
                    >
                      <TextInput
                        aria-label={edit.field === 'name' ? '새 팀 이름' : '새 팀 코드'}
                        autoFocus
                        autoComplete="off"
                        value={edit.value}
                        maxLength={40}
                        placeholder={edit.field === 'name' ? '새 팀 이름' : '새 팀 코드 (4자 이상)'}
                        onChange={(e) => setEditing({ ...edit, value: e.target.value })}
                        className="max-w-72"
                      />
                      <Button type="submit" size="sm" variant="primary" loading={busy === `edit:${t.id}`} disabled={edit.field === 'code' ? edit.value.trim().length < 4 : !edit.value.trim()}>
                        저장
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        취소
                      </Button>
                      {edit.field === 'code' && <span className="text-xs text-muted">팀이 코드를 잊었을 때 쓰세요. 그 팀 사람들은 새 코드로 다시 들어와야 합니다.</span>}
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
      <CommonKitEditor />
    </div>
  )
}

/** 모든 팀 문서에 기본으로 들어가는 회사 공통 자료(팀이 따로 저장하면 그 팀은 팀 자료를 쓴다) */
function CommonKitEditor() {
  const [state, setState] = useState<{ kit: { company?: { name?: string }; seals?: Array<{ dataUrl: string }>; registration?: { pages?: string[] } | null; bankbook?: { pages?: string[] } | null } | null; updatedAt: string | null; previous?: { name: string; seals: number; updatedAt: string | null } | null } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const refresh = async () => setState(await api('/admin/company-kit'))
  useEffect(() => {
    void attempt(refresh)
  }, [])
  const run = (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    void attempt(fn).finally(() => setBusy(null))
  }
  const upload = (file: File) =>
    run('upload', async () => {
      const { kitFromFile } = await import('@/tools/quote/kit')
      const kit = await kitFromFile(file)
      await api('/admin/company-kit', { method: 'PUT', body: { kit: { ...kit, contacts: [] } } })
      await refresh()
      toast.success(`${kit.company.name || '회사'} 자료를 회사 공통 자료로 올렸습니다.`)
    })
  const k = state?.kit

  return (
    <Panel className="flex flex-col gap-4 p-5">
      <div>
        <h3 className="text-base">회사 공통 자료</h3>
        <p className="text-sm text-muted">모든 팀의 견적서·거래명세서에 기본으로 들어가는 상호·직인·사업자등록증·통장 사본입니다. 이 서버에만 저장되고 GitHub 에는 올라가지 않으며, 팀 코드로 들어온 사람만 볼 수 있습니다.</p>
      </div>
      {k ? (
        <div className="flex items-center gap-3 rounded-md border border-line bg-paper p-3">
          <div className="flex -space-x-3">
            {(k.seals ?? []).slice(0, 3).map((s, i) => (
              <img key={i} src={s.dataUrl} alt="" className="checker size-12 rounded-full border border-line object-contain" />
            ))}
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-ink">{k.company?.name || '이름 없음'}</p>
            <p className="text-muted">
              직인 {k.seals?.length ?? 0}개 · 사업자등록증 {k.registration?.pages?.length ?? 0}쪽 · 통장 사본 {k.bankbook?.pages?.length ?? 0}쪽
            </p>
            {state?.updatedAt && <p className="text-xs text-faint">{when(state.updatedAt)} 올림</p>}
          </div>
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-line-strong p-4 text-sm text-muted">{state ? '아직 올린 자료가 없습니다.' : '불러오는 중…'}</p>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) upload(f)
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Upload} loading={busy === 'upload'} onClick={() => fileInput.current?.click()}>
          {k ? '회사 자료 파일로 바꾸기' : '회사 자료 파일 올리기'}
        </Button>
        {state?.previous && (
          <Button
            icon={RotateCcw}
            loading={busy === 'restore'}
            onClick={() =>
              run('restore', async () => {
                const p = state.previous!
                if (!confirm(`직전 자료(${p.name || '이름 없음'} · 직인 ${p.seals}개 · ${when(p.updatedAt)})로 되돌릴까요? 지금 자료는 직전 자료로 남습니다.`)) return
                await api('/admin/company-kit/restore', { method: 'POST' })
                await refresh()
                toast.success('직전 자료로 되돌렸습니다.')
              })
            }
          >
            직전 자료로 되돌리기
          </Button>
        )}
        {k && (
          <Button
            variant="danger"
            icon={Trash2}
            loading={busy === 'delete'}
            onClick={() =>
              run('delete', async () => {
                if (!confirm('회사 공통 자료를 지울까요? 팀 전용 자료가 없는 팀은 직인·첨부가 빠집니다. (지운 자료는 ‘직전 자료로 되돌리기’로 살릴 수 있습니다.)')) return
                await api('/admin/company-kit', { method: 'DELETE' })
                await refresh()
                toast.success('지웠습니다.')
              })
            }
          >
            지우기
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">
        회사 자료 파일은 견적서·거래명세서 → 팀 설정 → 회사 자료 → ‘파일로 주고받기’에서 만들 수 있습니다. 바꾸거나 지우면 직전 자료 한 벌을 남겨 두어 되돌릴 수 있습니다.
        {state?.previous && ` (직전 자료: ${state.previous.name || '이름 없음'} · 직인 ${state.previous.seals}개 · ${when(state.previous.updatedAt)})`}
      </p>
    </Panel>
  )
}

function AccountEditor({ onLogout }: { onLogout: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const change = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < 8) return toast.error('새 비밀번호는 8자 이상이어야 합니다.')
    setBusy(true)
    try {
      await api('/admin/password', { method: 'POST', body: { current, next } })
      setCurrent('')
      setNext('')
      toast.success('비밀번호를 바꿨습니다.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '바꾸지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel className="flex max-w-md flex-col gap-4 p-5">
      <form onSubmit={change} className="flex flex-col gap-4">
        <h3 className="text-base">관리자 비밀번호 바꾸기</h3>
        <Field label="현재 비밀번호">{(id) => <TextInput id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
        <Field label="새 비밀번호" hint="8자 이상">{(id) => <TextInput id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <Button type="submit" icon={KeyRound} loading={busy} className="self-start">
          비밀번호 바꾸기
        </Button>
      </form>
      <div className="border-t border-line pt-4">
        <Button icon={LogOut} onClick={onLogout}>
          로그아웃
        </Button>
      </div>
    </Panel>
  )
}

export function Admin() {
  const [auth, setAuth] = useState<AuthStatus>(null)
  const config = useSite((s) => s.config)
  const save = useSite((s) => s.save)
  const [draft, setDraft] = useState<SiteConfig>(config)
  const [tab, setTab] = useState<'menu' | 'accounts' | 'presets' | 'company' | 'account'>('menu')
  const reloadViewer = useViewerStore((s) => s.load)
  const viewerUser = useViewerStore((s) => s.user)
  const showLogin = useLoginDialog((s) => s.show)
  const [saving, setSaving] = useState(false)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [draft, config])

  const refresh = () =>
    api<{ configured: boolean; loggedIn: boolean }>('/admin/status')
      .then(setAuth)
      .catch((err) => setAuth(err instanceof ApiError && err.status === 0 ? 'offline' : { configured: true, loggedIn: false }))
  useEffect(() => {
    document.title = '관리자 · 온비짱'
    refresh()
  }, [])
  useEffect(() => setDraft(config), [config])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const onSave = async () => {
    setSaving(true)
    try {
      await save(draft)
      toast.success('저장했습니다. 모든 팀원 화면에 바로 반영됩니다.')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        toast.error('로그인이 만료되었습니다. 다시 로그인해 주세요.')
        refresh()
      } else toast.error(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }
  const logout = async () => {
    await api('/admin/logout', { method: 'POST' }).catch(() => {})
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    void reloadViewer()
    refresh()
  }

  if (auth === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted">
        <Spinner /> 확인하는 중
      </div>
    )
  }
  if (auth === 'offline') {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <Callout tone="warn" title="온비짱 서버에 연결할 수 없습니다">
          관리자 기능은 서버가 켜져 있어야 쓸 수 있습니다. 서버 컴퓨터에서 <code className="font-mono text-xs">npm start</code> 가 실행 중인지 확인하세요. 서버가 없는 동안 도구는 기본 설정(전체 메뉴 표시)으로 동작합니다.
        </Callout>
      </div>
    )
  }
  if (!auth.loggedIn) {
    return (
      <div className="px-4">
        {viewerUser && (
          <Callout tone="warn" className="mx-auto mt-10 max-w-sm">
            {viewerUser.name} 님 계정은 전체마스터 등급이 아니라 관리자 화면을 쓸 수 없습니다. 필요하면 전체마스터에게 등급 변경을 요청하세요.
          </Callout>
        )}
        <PasswordForm
          mode={auth.configured ? 'login' : 'setup'}
          onDone={() => {
            refresh()
            void reloadViewer()
          }}
        />
        {auth.configured && !viewerUser && (
          <p className="mt-4 text-center text-sm text-muted">
            전체마스터 계정이 있으면{' '}
            <button type="button" onClick={showLogin} className="font-semibold text-brand underline">
              계정으로 로그인
            </button>
            하세요.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 pb-28 pt-6 sm:px-6">
      <header>
        <h1 className="text-2xl">관리자</h1>
        <p className="text-sm text-muted">여기서 바꾼 내용은 저장하는 즉시 팀원 모두에게 적용됩니다.</p>
      </header>
      <Tabs
        label="관리 항목"
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'menu', label: '메뉴·앱 관리' },
          { value: 'accounts', label: '계정·권한' },
          { value: 'presets', label: '공지·팀 프리셋' },
          { value: 'company', label: '팀·회사 자료' },
          { value: 'account', label: '관리자 비밀번호' },
        ]}
      />
      {tab === 'menu' && <MenuEditor draft={draft} setDraft={setDraft} />}
      {tab === 'presets' && <PresetEditor draft={draft} setDraft={setDraft} />}
      {tab === 'accounts' && <AccountsEditor />}
      {tab === 'company' && <TeamsEditor />}
      {tab === 'account' && <AccountEditor onLogout={logout} />}

      {(tab === 'menu' || tab === 'presets') && (
        <div className={clsx('fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-sm transition-transform duration-200', dirty ? 'translate-y-0' : 'translate-y-full')}>
          <div className="mx-auto flex max-w-[1100px] items-center justify-end gap-3">
            <p className="mr-auto text-sm font-semibold text-ink-2">저장하지 않은 변경이 있습니다.</p>
            <Button onClick={() => setDraft(config)} disabled={!dirty || saving}>
              되돌리기
            </Button>
            <Button variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={onSave}>
              저장
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
