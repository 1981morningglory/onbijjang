import clsx from 'clsx'
import { ArrowDown, ArrowUp, KeyRound, LogOut, Plus, Save, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from '@/lib/api'
import { readAsDataURL } from '@/lib/files'
import { Badge, Button, Callout, ColorField, Field, IconButton, NumberInput, Panel, PositionGrid, Segmented, Slider, Spinner, Switch, Tabs, TextInput, Textarea, toast } from '@/ui'
import { useSite, type SiteConfig } from './config'
import { GROUPS, TOOLS, artUrl, type GroupId } from './registry'

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
  const onCount = TOOLS.filter((t) => draft.tools[t.id].enabled && draft.groups[t.group].enabled).length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          스위치를 끄면 그 메뉴가 홈·사이드바·검색에서 사라지고, 주소로 직접 들어와도 열리지 않습니다. 지금 <b className="num text-ink">{onCount}</b> / {TOOLS.length}개가 보입니다.
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
        const tools = TOOLS.filter((t) => t.group === group.id).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
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
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
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
                  </li>
                )
              })}
            </ul>
          </Panel>
        )
      })}
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

interface KitStatus {
  available: boolean
  updatedAt: string | null
  codeSet: boolean
  needsCode: boolean
}

/** 팀 기본 회사 자료(인감·사업자등록증·통장 사본)와 팀 코드 */
function CompanyKitEditor() {
  const [status, setStatus] = useState<KitStatus | null>(null)
  const [summary, setSummary] = useState<{ name: string; seals: string[]; registration: number; bankbook: number; contacts: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    const st = await api<KitStatus>('/company-kit/status')
    setStatus(st)
    if (st.available) {
      const res = await api<{ kit: { company?: { name?: string }; seals?: Array<{ dataUrl: string }>; registration?: { pages?: string[] } | null; bankbook?: { pages?: string[] } | null; contacts?: unknown[] } }>('/company-kit')
      const k = res.kit
      setSummary({ name: k.company?.name ?? '', seals: (k.seals ?? []).map((x) => x.dataUrl), registration: k.registration?.pages?.length ?? 0, bankbook: k.bankbook?.pages?.length ?? 0, contacts: k.contacts?.length ?? 0 })
    } else setSummary(null)
  }
  useEffect(() => {
    refresh().catch(() => {})
  }, [])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '처리하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const upload = (file: File) =>
    run('upload', async () => {
      const { kitFromFile } = await import('@/tools/quote/kit')
      const kit = await kitFromFile(file)
      await api('/admin/company-kit', { method: 'PUT', body: { kit } })
      await refresh()
      toast.success(`${kit.company.name || '회사'} 자료를 팀 기본으로 올렸습니다.`)
    })

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel className="flex flex-col gap-4 p-5">
        <div>
          <h3 className="text-base">팀 기본 회사 자료</h3>
          <p className="text-sm text-muted">견적서·거래명세표에 자동으로 들어가는 상호·직인·사업자등록증·통장 사본입니다. 이 서버에만 저장되고 GitHub 에는 올라가지 않습니다.</p>
        </div>
        {status?.available && summary ? (
          <div className="flex items-center gap-3 rounded-md border border-line bg-paper p-3">
            <div className="flex -space-x-3">
              {summary.seals.slice(0, 3).map((src, i) => (
                <img key={i} src={src} alt="" className="checker size-12 rounded-full border border-line object-contain" />
              ))}
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-ink">{summary.name || '이름 없음'}</p>
              <p className="text-muted">
                직인 {summary.seals.length}개 · 사업자등록증 {summary.registration}쪽 · 통장 사본 {summary.bankbook}쪽 · 담당자 {summary.contacts}명
              </p>
              {status.updatedAt && <p className="text-xs text-faint">{new Date(status.updatedAt).toLocaleString('ko-KR')} 올림</p>}
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-line-strong p-4 text-sm text-muted">아직 올린 자료가 없습니다.</p>
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
            {status?.available ? '회사 자료 파일로 바꾸기' : '회사 자료 파일 올리기'}
          </Button>
          {status?.available && (
            <Button
              variant="danger"
              icon={Trash2}
              loading={busy === 'delete'}
              onClick={() =>
                run('delete', async () => {
                  if (!confirm('팀 기본 회사 자료를 지울까요? 팀원 화면에서도 사라집니다.')) return
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
        <p className="text-xs text-muted">회사 자료 파일은 견적서·거래명세표 → 회사 자료 → ‘파일로 주고받기’에서 만들 수 있습니다.</p>
      </Panel>

      <Panel className="flex flex-col gap-4 p-5">
        <div>
          <h3 className="text-base">팀 코드</h3>
          <p className="text-sm text-muted">사이트는 누구나 열 수 있으므로, 회사 자료는 이 코드를 한 번 넣은 브라우저에만 보입니다. 바꾸면 모든 팀원이 새 코드를 다시 넣어야 합니다.</p>
        </div>
        <p className="text-sm">
          지금 상태: <b className={status?.codeSet ? 'text-brand-ink' : 'text-warn'}>{status?.codeSet ? '정해져 있음' : '아직 없음'}</b>
          {status && !status.needsCode && <span className="text-muted"> · 사내망 모드라 코드 없이 보입니다</span>}
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            run('code', async () => {
              await api('/admin/team-code', { method: 'PUT', body: { code } })
              setCode('')
              await refresh()
              toast.success('팀 코드를 정했습니다. 팀원에게 알려 주세요.')
            })
          }}
        >
          <Field label={status?.codeSet ? '새 팀 코드' : '팀 코드'} hint="4자 이상. 관리자 비밀번호와 다르게 정하세요." className="min-w-56 flex-1">
            {(id) => <TextInput id={id} type="password" autoComplete="new-password" value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <Button type="submit" icon={KeyRound} loading={busy === 'code'} disabled={code.trim().length < 4}>
            {status?.codeSet ? '바꾸기' : '정하기'}
          </Button>
        </form>
      </Panel>
    </div>
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
  const [tab, setTab] = useState<'menu' | 'presets' | 'company' | 'account'>('menu')
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
        <PasswordForm mode={auth.configured ? 'login' : 'setup'} onDone={refresh} />
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
          { value: 'menu', label: '메뉴 노출' },
          { value: 'presets', label: '공지·팀 프리셋' },
          { value: 'company', label: '회사 자료' },
          { value: 'account', label: '계정' },
        ]}
      />
      {tab === 'menu' && <MenuEditor draft={draft} setDraft={setDraft} />}
      {tab === 'presets' && <PresetEditor draft={draft} setDraft={setDraft} />}
      {tab === 'company' && <CompanyKitEditor />}
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
