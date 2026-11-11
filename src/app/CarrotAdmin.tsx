import { KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button, Callout, Field, Panel, Spinner, TextInput, toast } from '@/ui'
import { formatBytes } from '@/tools/carrot/logic'

interface KeyState {
  connected: boolean
  fromEnv: boolean
  savedAt: string | null
  hint: string
}
interface Usage {
  keepDays: number
  totalBytes: number
  totalJobs: number
  running: number
  users: Array<{ owner: string; name: string; username: string; jobs: number; images: number; videos: number; failed: number; bytes: number; usd: number; lastAt: string | null }>
  hf: null | { error: string } | { days: number; usd: number; models: Array<{ model: string; quantity: number; cost: number }> }
}

/** 관리자 화면 ‘당근 연결’ — 힉스필드 API 키와 사용량(용량) 보기. 개인별 제한은 두지 않는다. */
export function CarrotAdmin() {
  const [state, setState] = useState<KeyState | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [keyId, setKeyId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const loadUsage = () => api<Usage>('/admin/carrot/usage').then(setUsage)
  useEffect(() => {
    api<KeyState>('/admin/carrot').then(setState).catch(() => {})
    loadUsage().catch(() => {})
  }, [])
  const run = (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    fn()
      .catch((err) => toast.error(err instanceof Error ? err.message : '처리하지 못했습니다.'))
      .finally(() => setBusy(null))
  }
  const hf = usage?.hf
  return (
    <div className="mt-5 flex flex-col gap-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Panel className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="text-base">당근 연결 (힉스필드 API)</h3>
            <p className="text-sm text-muted">‘당근’ 앱에서 이미지·영상을 만들 때 씁니다. 키는 이 서버에만 저장하고 화면에 다시 보여 주지 않습니다.</p>
          </div>
          {state?.connected ? (
            <Callout tone="success" title="연결됨">
              {state.fromEnv ? 'Railway 변수(HF_CREDENTIALS 또는 HF_API_KEY_ID·HF_API_KEY_SECRET)를 쓰는 중입니다.' : `저장된 키 ${state.hint}`}
              {state.savedAt && !state.fromEnv && <> · {new Date(state.savedAt).toLocaleString('ko-KR')} 저장</>}
            </Callout>
          ) : (
            <Callout tone="info" title="아직 연결되지 않았습니다">키를 넣으면 스탭 이상 계정이 당근 앱에서 바로 만들 수 있습니다.</Callout>
          )}
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              run('save', async () => {
                const r = await api<KeyState>('/admin/carrot', { method: 'PUT', body: { keyId: keyId.trim(), secret: secret.trim() } })
                setKeyId('')
                setSecret('')
                setState(r)
                toast.success('힉스필드 키를 확인하고 저장했습니다.')
              })
            }}
          >
            <Field label="키 ID (Key ID)">{(id) => <TextInput id={id} autoComplete="off" value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="힉스필드 콘솔의 Key ID" />}</Field>
            <Field label="비밀값 (Secret)" hint="넣으면 서버가 비용이 들지 않는 요청으로 바로 확인합니다.">
              {(id) => <TextInput id={id} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="힉스필드 콘솔의 Secret" />}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" icon={KeyRound} loading={busy === 'save'} disabled={keyId.trim().length < 8 || secret.trim().length < 8}>
                {state?.connected && !state.fromEnv ? '새 키로 바꾸기' : '연결하기'}
              </Button>
              {state?.connected && !state.fromEnv && (
                <Button
                  variant="ghost"
                  icon={Trash2}
                  loading={busy === 'del'}
                  onClick={() => {
                    if (!confirm('힉스필드 키를 지울까요? 당근 앱에서 만들 수 없게 됩니다.')) return
                    run('del', async () => setState(await api<KeyState>('/admin/carrot', { method: 'DELETE' })))
                  }}
                >
                  연결 끊기
                </Button>
              )}
            </div>
          </form>
        </Panel>
        <Panel className="flex flex-col gap-3 p-5 text-sm leading-relaxed text-ink-2">
          <h3 className="text-base text-ink">힉스필드 API 키 받는 순서</h3>
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            <li>
              <a className="text-brand-ink underline" href="https://console.higgsfield.ai" target="_blank" rel="noreferrer">
                console.higgsfield.ai
              </a>
              에 회사 힉스필드 계정으로 로그인합니다.
            </li>
            <li>결제(Billing)에서 API 잔액을 충전합니다. 웹사이트 구독 크레딧과 별도인 선불 잔액이며, 충전한 금액은 1년 뒤 사라집니다.</li>
            <li>API Keys 에서 새 키를 만들고 Key ID 와 Secret 을 복사합니다(Secret 은 한 번만 보입니다).</li>
            <li>왼쪽 칸에 붙여 넣고 ‘연결하기’를 누릅니다.</li>
          </ol>
          <p className="text-xs text-muted">실패하거나 내용 검수에 걸린 요청은 비용이 빠지지 않습니다. 결과 파일은 이 서버에 {usage?.keepDays ?? 7}일 보관한 뒤 자동으로 지웁니다.</p>
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
              <Stat label="힉스필드 최근 30일" value={hf && 'usd' in hf ? `$${hf.usd}` : hf && 'error' in hf ? '조회 실패' : '키 없음'} />
            </div>
            {hf && 'error' in hf && <p className="text-xs text-warn">힉스필드 사용량을 읽지 못했습니다: {hf.error}</p>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-semibold">계정</th>
                    <th className="py-2 pr-3 text-right font-semibold">작업</th>
                    <th className="py-2 pr-3 text-right font-semibold">이미지</th>
                    <th className="py-2 pr-3 text-right font-semibold">영상</th>
                    <th className="py-2 pr-3 text-right font-semibold">실패</th>
                    <th className="py-2 pr-3 text-right font-semibold">용량</th>
                    <th className="py-2 pr-3 text-right font-semibold">예상 비용</th>
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
                      <td className="py-2 pr-3 text-right tabular-nums">{u.failed}</td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatBytes(u.bytes)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">${u.usd}</td>
                      <td className="py-2 text-right text-xs text-muted">{u.lastAt ? new Date(u.lastAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                    </tr>
                  ))}
                  {!usage.users.length && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted">
                        아직 만든 결과가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {hf && 'models' in hf && hf.models.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-ink-2">힉스필드 모델별 사용 금액(최근 30일, 힉스필드 집계)</summary>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
                  {hf.models.map((m) => (
                    <li key={m.model} className="flex justify-between gap-3 border-b border-line/50 py-1">
                      <span className="font-mono">{m.model}</span>
                      <span className="tabular-nums">
                        {m.quantity}회 · ${Math.round(m.cost * 100) / 100}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
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
