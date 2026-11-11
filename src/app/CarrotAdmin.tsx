import { Link2, LogIn, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button, Callout, Panel, Spinner, TextInput, toast } from '@/ui'
import { formatBytes, formatCredits } from '@/tools/carrot/logic'

interface McpState {
  connected: boolean
  account: string | null
  connectedAt: string | null
  pending: boolean
  balance: { credits: number; subscription_plan_type: string } | null
  error?: string
  modelsAt?: string | null
  models?: number
}
interface Usage {
  keepDays: number
  totalBytes: number
  totalJobs: number
  running: number
  credits30: number
  users: Array<{ owner: string; name: string; username: string; jobs: number; images: number; videos: number; audios: number; failed: number; bytes: number; credits: number; credits30: number; lastAt: string | null }>
}

/** 관리자 화면 ‘당근 연결’ — 회사 힉스필드 계정 로그인(MCP, 구독 크레딧)과 사용량 보기. 개인별 제한은 두지 않는다. */
export function CarrotAdmin() {
  const [state, setState] = useState<McpState | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [pasted, setPasted] = useState('')
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const loadUsage = () => api<Usage>('/admin/carrot/usage').then(setUsage)
  useEffect(() => {
    api<McpState>('/admin/carrot').then(setState).catch(() => {})
    loadUsage().catch(() => {})
  }, [])
  const run = (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    fn()
      .catch((err) => toast.error(err instanceof Error ? err.message : '처리하지 못했습니다.'))
      .finally(() => setBusy(null))
  }
  const startLogin = () =>
    run('login', async () => {
      const r = await api<{ url: string }>('/admin/carrot/login', { method: 'POST' })
      setLoginUrl(r.url)
      window.open(r.url, '_blank', 'noopener')
    })
  return (
    <div className="mt-5 flex flex-col gap-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Panel className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="text-base">당근 연결 (힉스필드 계정)</h3>
            <p className="text-sm text-muted">‘당근’ 앱은 회사 힉스필드 계정의 구독 크레딧으로 만듭니다(추가 결제 없음). 로그인 정보는 이 서버에만 저장합니다.</p>
          </div>
          {state?.connected ? (
            <Callout tone="success" title="연결됨">
              {state.account ?? '힉스필드 계정'}
              {state.balance && (
                <>
                  {' '}
                  · 남은 크레딧 <b>{state.balance.credits.toLocaleString('ko-KR')}</b> · 요금제 {state.balance.subscription_plan_type}
                </>
              )}
              {state.connectedAt && <> · {new Date(state.connectedAt).toLocaleString('ko-KR')} 연결</>}
            </Callout>
          ) : (
            <Callout tone={state?.error ? 'warn' : 'info'} title={state?.error ? '다시 로그인이 필요합니다' : '아직 연결되지 않았습니다'}>
              {state?.error ?? '아래 순서대로 한 번 로그인하면 스탭 이상 계정이 당근 앱에서 바로 만들 수 있습니다.'}
            </Callout>
          )}
          <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-ink-2">
            <li>
              <Button size="sm" variant={state?.connected ? 'secondary' : 'primary'} icon={LogIn} loading={busy === 'login'} onClick={startLogin}>
                {state?.connected ? '다른 계정으로 다시 로그인' : '힉스필드 로그인'}
              </Button>
              <p className="mt-1 text-xs text-muted">새 창에서 회사 힉스필드 계정으로 로그인하고 접근을 허용합니다. 창이 안 열리면 {loginUrl ? <a className="text-brand-ink underline" href={loginUrl} target="_blank" rel="noreferrer">여기</a> : '버튼을 다시'}를 누르세요.</p>
            </li>
            <li>
              마지막에 <b>‘사이트에 연결할 수 없음’</b> 화면이 나오면 정상입니다. 그 창 <b>주소창의 주소 전체</b>를 복사해 아래에 붙여 넣습니다.
              <form
                className="mt-2 flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  run('cb', async () => {
                    const r = await api<McpState>('/admin/carrot/callback', { method: 'POST', body: { url: pasted.trim() } })
                    setPasted('')
                    setLoginUrl(null)
                    setState(r)
                    toast.success('힉스필드 계정을 연결했습니다.')
                  })
                }}
              >
                <TextInput aria-label="로그인 뒤 주소" autoComplete="off" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="http://localhost:8765/callback?code=…" className="font-mono text-xs" />
                <Button type="submit" variant="primary" icon={Link2} loading={busy === 'cb'} disabled={!/code=/.test(pasted)}>
                  연결하기
                </Button>
              </form>
            </li>
          </ol>
          {state?.connected && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={RefreshCw} loading={busy === 'refresh'} onClick={() => run('refresh', async () => setState(await api<McpState>('/admin/carrot')))}>
                크레딧 다시 보기
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                loading={busy === 'del'}
                onClick={() => {
                  if (!confirm('힉스필드 연결을 끊을까요? 당근 앱에서 만들 수 없게 됩니다.')) return
                  run('del', async () => setState(await api<McpState>('/admin/carrot', { method: 'DELETE' })))
                }}
              >
                연결 끊기
              </Button>
            </div>
          )}
        </Panel>
        <Panel className="flex flex-col gap-3 p-5 text-sm leading-relaxed text-ink-2">
          <h3 className="text-base text-ink">알아 두기</h3>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>힉스필드 MCP 연결이라 웹사이트 구독 크레딧에서 빠집니다. 따로 충전하는 API 잔액은 쓰지 않습니다.</li>
            <li>웹사이트의 무제한·무료 생성은 적용되지 않고, 항상 표준 크레딧이 빠집니다. 생성 버튼 옆에 예상 크레딧이 보입니다.</li>
            <li>실패하거나 내용 검수에 걸린 요청은 크레딧이 빠지지 않습니다.</li>
            <li>로그인은 서버가 하루마다 알아서 이어 갑니다. 힉스필드에서 비밀번호를 바꾸거나 연결을 끊으면 여기서 다시 로그인하세요.</li>
            <li>직원들이 만든 것도 모두 이 계정 크레딧에서 빠집니다. 누가 얼마나 썼는지는 아래 표에서 봅니다.</li>
            <li>결과 파일은 이 서버에 {usage?.keepDays ?? 7}일 보관한 뒤 자동으로 지웁니다.</li>
          </ul>
          {state?.models ? <p className="text-xs text-muted">모델 {state.models}개{state.modelsAt ? ` · 목록 갱신 ${new Date(state.modelsAt).toLocaleString('ko-KR')}` : ' · 저장된 목록 사용 중'}</p> : null}
        </Panel>
      </div>

      <Panel className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base">사용 용량</h3>
            <p className="text-sm text-muted">계정별로 보관 중인 결과(최근 {usage?.keepDays ?? 7}일)입니다. 개인별 용량 제한은 두지 않았습니다.</p>
          </div>
          <Button size="sm" icon={RefreshCw} loading={busy === 'usage'} onClick={() => run('usage', loadUsage)}>
            새로 고침
          </Button>
        </div>
        {!usage ? (
          <div className="flex items-center gap-2 text-muted">
            <Spinner /> 불러오는 중
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="전체 보관 용량" value={formatBytes(usage.totalBytes)} />
              <Stat label="보관 중인 작업" value={`${usage.totalJobs}건`} />
              <Stat label="만드는 중" value={`${usage.running}건`} />
              <Stat label="최근 30일 사용 크레딧" value={formatCredits(usage.credits30)} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-semibold">계정</th>
                    <th className="py-2 pr-3 text-right font-semibold">작업</th>
                    <th className="py-2 pr-3 text-right font-semibold">이미지</th>
                    <th className="py-2 pr-3 text-right font-semibold">영상</th>
                    <th className="py-2 pr-3 text-right font-semibold">오디오</th>
                    <th className="py-2 pr-3 text-right font-semibold">실패</th>
                    <th className="py-2 pr-3 text-right font-semibold">용량</th>
                    <th className="py-2 pr-3 text-right font-semibold">크레딧(30일)</th>
                    <th className="py-2 text-right font-semibold">마지막 생성</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.users.map((u) => (
                    <tr key={u.owner} className="border-b border-line/60">
                      <td className="py-2 pr-3">
                        <span className="font-medium text-ink">{u.name}</span>
                        {u.username && <span className="ml-1 text-xs text-muted">{u.username}</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{u.jobs}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{u.images}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{u.videos}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{u.audios}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{u.failed}</td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatBytes(u.bytes)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCredits(u.credits30)}</td>
                      <td className="py-2 text-right text-xs text-muted">{u.lastAt ? new Date(u.lastAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                    </tr>
                  ))}
                  {!usage.users.length && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-muted">
                        아직 만든 결과가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-bold tabular-nums text-ink">{value}</p>
    </div>
  )
}
