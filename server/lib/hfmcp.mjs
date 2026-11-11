// 힉스필드 MCP(https://mcp.higgsfield.ai/mcp) 연결 — 회사 힉스필드 계정의 구독 크레딧으로 생성한다.
//
// 로그인: 관리자가 힉스필드 로그인 화면에서 허용하면 브라우저가 http://localhost:8765/callback?code=… 로 넘어가며
// '연결할 수 없음'이 뜬다. 그 주소를 관리자 화면에 붙여 넣으면 서버가 코드를 토큰으로 바꿔 저장한다.
// (힉스필드는 돌아올 주소로 허용 목록과 내 컴퓨터 주소만 받는다.)
// 토큰은 하루짜리이고, 갱신 토큰으로 서버가 알아서 새로 받는다(갱신할 때마다 갱신 토큰도 바뀐다).
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'

const BASE = process.env.HF_MCP_URL || 'https://mcp.higgsfield.ai'
const MCP = `${BASE}/mcp`
const REDIRECT = 'http://localhost:8765/callback'
const SCOPE = 'openid email offline_access'

export class HfMcpError extends Error {
  constructor(message, kind = 'fail') {
    super(message)
    this.kind = kind // fail · auth(다시 로그인 필요) · net
  }
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function createHfMcp(file) {
  /** { clientId, tokens: { access, refresh, expiresAt }, pending: { verifier, state, at }, account, connectedAt } */
  let state = null
  let loaded = false
  let refreshing = null
  let initialized = null

  const load = async () => {
    if (loaded) return
    try {
      state = JSON.parse(await fsp.readFile(file, 'utf8'))
    } catch {
      state = {}
    }
    loaded = true
  }
  const save = async () => {
    const tmp = `${file}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 })
    await fsp.rename(tmp, file)
  }

  async function post(url, body, headers = {}, timeout = 30000) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeout)
    try {
      return await fetch(url, { method: 'POST', body, headers, signal: ctrl.signal })
    } catch (err) {
      throw new HfMcpError(err.name === 'AbortError' ? '힉스필드 응답이 늦습니다. 잠시 뒤 다시 해 주세요.' : `힉스필드에 연결하지 못했습니다: ${err.message}`, 'net')
    } finally {
      clearTimeout(t)
    }
  }
  async function tokenRequest(form) {
    const res = await post(`${BASE}/oauth2/token`, new URLSearchParams({ ...form, client_id: state.clientId, resource: MCP }).toString(), { 'content-type': 'application/x-www-form-urlencoded' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.access_token) throw new HfMcpError(j.error_description || j.error || `로그인 처리 실패(${res.status})`, res.status === 400 || res.status === 401 ? 'auth' : 'fail')
    state.tokens = { access: j.access_token, refresh: j.refresh_token ?? state.tokens?.refresh, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 }
    // id_token 의 이메일만 화면 표시용으로 남긴다
    try {
      const claims = JSON.parse(Buffer.from(String(j.id_token).split('.')[1], 'base64url').toString('utf8'))
      if (claims.email) state.account = claims.email
    } catch {
      // 없어도 된다
    }
    initialized = null
    await save()
  }

  /** 1) 로그인 주소 만들기(처음이면 앱 등록부터) */
  async function startLogin() {
    await load()
    if (!state.clientId) {
      const res = await post(`${BASE}/oauth2/register`, JSON.stringify({ client_name: 'Onbijjang Carrot', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPE }), { 'content-type': 'application/json' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.client_id) throw new HfMcpError(`힉스필드 연결 앱 등록 실패: ${j.error_description || res.status}`)
      state.clientId = j.client_id
    }
    const verifier = b64url(crypto.randomBytes(48))
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
    const st = b64url(crypto.randomBytes(16))
    state.pending = { verifier, state: st, at: Date.now() }
    await save()
    const q = new URLSearchParams({ response_type: 'code', client_id: state.clientId, redirect_uri: REDIRECT, scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state: st, resource: MCP })
    return `${BASE}/oauth2/authorize?${q}`
  }

  /** 2) 붙여 넣은 주소(…/callback?code=…&state=…) → 토큰 */
  async function finishLogin(pasted) {
    await load()
    let u
    try {
      u = new URL(String(pasted).trim())
    } catch {
      throw new HfMcpError('주소창의 주소 전체(http://localhost:8765/callback?code=… )를 붙여 넣어 주세요.')
    }
    const code = u.searchParams.get('code')
    if (u.searchParams.get('error')) throw new HfMcpError(`힉스필드가 로그인을 거절했습니다: ${u.searchParams.get('error_description') || u.searchParams.get('error')}`)
    if (!code) throw new HfMcpError('주소에 code 값이 없습니다. 마지막 화면의 주소 전체를 붙여 넣어 주세요.')
    if (!state.pending || u.searchParams.get('state') !== state.pending.state) throw new HfMcpError('이 주소는 지금 진행 중인 로그인의 것이 아닙니다. ‘힉스필드 로그인’을 다시 눌러 주세요.')
    if (Date.now() - state.pending.at > 15 * 60e3) throw new HfMcpError('로그인한 지 오래되어 만료됐습니다. 다시 로그인해 주세요.')
    const verifier = state.pending.verifier
    state.pending = null
    await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier })
    state.connectedAt = new Date().toISOString()
    await save()
  }

  async function logout() {
    await load()
    state = { clientId: state.clientId }
    initialized = null
    await save()
  }

  async function access() {
    await load()
    if (!state.tokens?.access) throw new HfMcpError('힉스필드 계정이 아직 연결되지 않았습니다. 관리자에게 연결을 부탁해 주세요.', 'auth')
    if (Date.now() < state.tokens.expiresAt - 5 * 60e3) return state.tokens.access
    if (!state.tokens.refresh) throw new HfMcpError('힉스필드 로그인이 만료됐습니다. 관리자 화면에서 다시 로그인해 주세요.', 'auth')
    // 갱신은 한 번에 하나만(갱신 토큰이 바뀌므로 동시에 하면 하나가 깨진다)
    refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: state.tokens.refresh })
      .catch((err) => {
        if (err.kind === 'auth') {
          state.tokens = null
          save().catch(() => {})
          throw new HfMcpError('힉스필드 로그인이 만료됐습니다. 관리자 화면에서 다시 로그인해 주세요.', 'auth')
        }
        throw err
      })
      .finally(() => {
        refreshing = null
      })
    await refreshing
    return state.tokens.access
  }

  let rpcId = 0
  async function rpc(method, params, { notify = false, timeout = 60000, retried = false } = {}) {
    const token = await access()
    const body = { jsonrpc: '2.0', method, params: params ?? {} }
    if (!notify) body.id = ++rpcId
    const res = await post(MCP, JSON.stringify(body), { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, timeout)
    if (res.status === 401 && !retried) {
      // 토큰이 서버에서 먼저 만료된 경우: 한 번 갱신하고 다시
      state.tokens.expiresAt = 0
      return rpc(method, params, { notify, timeout, retried: true })
    }
    if (res.status === 401) throw new HfMcpError('힉스필드 로그인이 만료됐습니다. 관리자 화면에서 다시 로그인해 주세요.', 'auth')
    const raw = await res.text()
    if (!res.ok) throw new HfMcpError(`힉스필드 MCP 오류(${res.status}): ${raw.slice(0, 160)}`)
    if (notify) return null
    let msg = null
    if (raw.trim().startsWith('{')) msg = JSON.parse(raw)
    else
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue
        try {
          const d = JSON.parse(line.slice(5))
          if (d.id === body.id) msg = d
        } catch {
          // 다음 줄
        }
      }
    if (!msg) throw new HfMcpError('힉스필드 MCP 응답을 읽지 못했습니다.')
    if (msg.error) throw new HfMcpError(`힉스필드 MCP 오류: ${msg.error.message ?? JSON.stringify(msg.error).slice(0, 160)}`)
    return msg.result
  }
  async function init() {
    initialized ??= (async () => {
      await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'onbijjang-carrot', version: '1.0' } })
      await rpc('notifications/initialized', {}, { notify: true })
    })().catch((err) => {
      initialized = null
      throw err
    })
    return initialized
  }
  /** MCP 도구 부르기 → result({ content, structuredContent, isError }) */
  async function callTool(name, args, opts = {}) {
    await init()
    return rpc('tools/call', { name, arguments: args }, opts)
  }

  async function status() {
    await load()
    return { connected: Boolean(state.tokens?.access), account: state.account ?? null, connectedAt: state.connectedAt ?? null, pending: Boolean(state.pending) }
  }

  return { startLogin, finishLogin, logout, callTool, status, connected: async () => (await status()).connected }
}
