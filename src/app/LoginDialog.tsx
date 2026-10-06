import { KeyRound, LogIn, LogOut, Settings, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { create } from 'zustand'
import { api } from '@/lib/api'
import { Button, Callout, Dialog, Field, MenuItem, Popover, TextInput, toast } from '@/ui'
import { ROLE_LABEL, useViewerStore } from './viewer'

/** 직원 로그인 창 — 머리말의 [로그인] 버튼과 권한 안내 화면에서 연다 */
export const useLoginDialog = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))

export function LoginDialog() {
  const open = useLoginDialog((s) => s.open)
  const hide = useLoginDialog((s) => s.hide)
  const login = useViewerStore((s) => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) return setError('아이디와 비밀번호를 입력하세요.')
    setBusy(true)
    try {
      await login(username.trim(), password)
      setPassword('')
      hide()
      toast.success('로그인했습니다.')
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={hide} title="직원 로그인" size="sm">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted">관리자에게 받은 아이디로 로그인하면 직원용 도구가 열립니다.</p>
        <Field label="아이디">{(id) => <TextInput id={id} autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />}</Field>
        <Field label="비밀번호">{(id) => <TextInput id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        {error && <Callout tone="danger">{error}</Callout>}
        <Button type="submit" variant="primary" icon={LogIn} loading={busy} block>
          로그인
        </Button>
        <p className="text-center text-xs text-muted">
          관리자 비밀번호로 들어가려면{' '}
          <Link to="/admin" onClick={hide} className="font-semibold text-brand underline">
            관리자 화면
          </Link>
          으로 가세요.
        </p>
      </form>
    </Dialog>
  )
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < 6) return toast.error('새 비밀번호는 6자 이상이어야 합니다.')
    setBusy(true)
    try {
      await api('/auth/password', { method: 'POST', body: { current, next } })
      setCurrent('')
      setNext('')
      toast.success('비밀번호를 바꿨습니다.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '바꾸지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="내 비밀번호 바꾸기" size="sm">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="현재 비밀번호">{(id) => <TextInput id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
        <Field label="새 비밀번호" hint="6자 이상">{(id) => <TextInput id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" icon={KeyRound} loading={busy} block>
          비밀번호 바꾸기
        </Button>
      </form>
    </Dialog>
  )
}

/** 머리말 오른쪽 — 방문자는 [로그인], 로그인한 사람은 이름 메뉴 */
export function AccountButton() {
  const user = useViewerStore((s) => s.user)
  const master = useViewerStore((s) => s.master)
  const admin = useViewerStore((s) => s.admin)
  const status = useViewerStore((s) => s.status)
  const logout = useViewerStore((s) => s.logout)
  const show = useLoginDialog((s) => s.show)
  const [pw, setPw] = useState(false)

  if (status === 'offline') return null
  if (!user && !master) {
    return (
      <Button size="sm" icon={LogIn} onClick={show}>
        로그인
      </Button>
    )
  }
  const label = user ? user.name : '관리자'
  return (
    <>
      <Popover
        align="end"
        trigger={(p) => (
          <button
            type="button"
            {...p}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-sm font-semibold text-ink shadow-1 transition-colors duration-150 hover:bg-sunken"
          >
            <UserRound className="size-4 text-brand" aria-hidden />
            <span className="max-w-24 truncate">{label}</span>
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="border-b border-line px-3 py-2">
              <p className="text-sm font-bold text-ink">{label}</p>
              <p className="text-xs text-muted">{user ? `${user.username} · ${ROLE_LABEL[user.role]}` : '관리자 비밀번호로 로그인'}</p>
            </div>
            {admin && (
              <Link to="/admin" onClick={close} className="flex h-9 items-center gap-2 rounded-md px-3 text-sm text-ink-2 hover:bg-sunken hover:text-ink">
                <Settings className="size-4" aria-hidden /> 관리자 화면
              </Link>
            )}
            {user && (
              <MenuItem
                icon={KeyRound}
                onClick={() => {
                  close()
                  setPw(true)
                }}
              >
                내 비밀번호 바꾸기
              </MenuItem>
            )}
            <MenuItem
              icon={LogOut}
              onClick={async () => {
                close()
                await logout()
                toast.success('로그아웃했습니다.')
              }}
            >
              로그아웃
            </MenuItem>
          </>
        )}
      </Popover>
      <PasswordDialog open={pw} onClose={() => setPw(false)} />
    </>
  )
}
