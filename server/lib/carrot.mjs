// 당근(이미지·영상 생성기) — 힉스필드 요청 만들기, 보관 기간, 사용량 계산.
// 서버 라우트(server/routes/carrot.mjs)와 시험(src/tools/carrot/carrot.test.ts)이 함께 쓴다.
import fs from 'node:fs'

export const CATALOG = JSON.parse(fs.readFileSync(new URL('../routes/carrot-models.json', import.meta.url), 'utf8'))
export const MODEL_BY_KEY = Object.fromEntries(CATALOG.models.map((m) => [m.key, m]))

/** 라이브러리 보관 기간(일) */
export const KEEP_DAYS = 7
export const MAX_COUNT = 4
export const MAX_PROMPT = 4000

const START_KEYS = ['image_url', 'first_frame_url']
const END_KEYS = ['end_image_url', 'last_image_url', 'last_frame_url']
/** 화면에서 고르는 값(나머지는 힉스필드 기본값) */
export const OPTION_KEYS = ['aspect_ratio', 'resolution', 'quality', 'duration', 'audio']

const has = (fields, keys) => keys.find((k) => k in fields)

/**
 * 어떤 엔드포인트로 보낼지 고른다.
 * 영상: 시작·끝 프레임 → 이미지→영상, 레퍼런스만 → 레퍼런스→영상(없으면 첫 장을 시작 프레임으로), 아무것도 없으면 글→영상.
 * 이미지: 레퍼런스가 있고 편집 엔드포인트가 있으면 편집, 아니면 기본.
 */
export function pickEndpoint(model, { refs = [], start = null, end = null } = {}) {
  const e = model.endpoints
  if (model.kind === 'image') return refs.length && e.edit ? e.edit : (e.text ?? e.edit)
  if ((start || end) && e.image) return e.image
  if (refs.length && e.reference) return e.reference
  if (refs.length && e.image) return e.image
  return e.text ?? e.reference ?? e.image
}

/** 옵션 하나를 그 엔드포인트가 받는 값으로 맞춘다(못 맞추면 undefined → 보내지 않음) */
function fit(field, v) {
  if (v === undefined || v === null || v === '') return undefined
  if (field.enum) {
    const hit = field.enum.find((x) => String(x) === String(v))
    return hit
  }
  if (field.type === 'integer' || field.type === 'number') {
    let n = Number(v)
    if (!Number.isFinite(n)) return undefined
    if (field.type === 'integer') n = Math.round(n)
    if (field.min !== undefined) n = Math.max(field.min, n)
    if (field.max !== undefined) n = Math.min(field.max, n)
    return n
  }
  if (field.type === 'boolean') return Boolean(v)
  return String(v)
}

/** 화면에서 받은 값 → 힉스필드에 보낼 입력. 레퍼런스·프레임은 이미 올린 공개 주소 */
export function buildInput(model, endpoint, { prompt = '', refs = [], start = null, end = null, options = {} } = {}) {
  const fields = model.fields[endpoint]
  if (!fields) throw new Error('모델 정보가 맞지 않습니다.')
  const input = {}
  const text = String(prompt).trim().slice(0, MAX_PROMPT)
  if ('prompt' in fields && text) input.prompt = text
  if (fields.prompt?.required && !text) throw new Error('만들고 싶은 내용을 적어 주세요.')
  const opts = { ...(model.defaults ?? {}), ...options }
  for (const k of ['aspect_ratio', 'resolution', 'quality', 'duration']) {
    if (!(k in fields)) continue
    const v = fit(fields[k], opts[k])
    if (v !== undefined) input[k] = v
  }
  // 소리: generate_audio(참·거짓) 또는 sound(on·off)
  if (opts.audio !== undefined) {
    if ('generate_audio' in fields) input.generate_audio = Boolean(opts.audio)
    else if ('sound' in fields) input.sound = opts.audio ? 'on' : 'off'
  }
  if ('batch_size' in fields) input.batch_size = fields.batch_size.enum?.includes(1) ? 1 : (fields.batch_size.min ?? 1)
  // 프레임
  let startUrl = start
  let restRefs = refs
  const sk = has(fields, START_KEYS)
  if (model.kind === 'video' && !startUrl && refs.length && sk && !('image_urls' in fields)) {
    // 레퍼런스→영상이 없는 모델: 첫 레퍼런스를 시작 프레임으로
    startUrl = refs[0]
    restRefs = refs.slice(1)
  }
  if (startUrl && sk) input[sk] = startUrl
  const ek = has(fields, END_KEYS)
  if (end && ek) input[ek] = end
  // 레퍼런스
  if (restRefs.length) {
    if ('image_urls' in fields) input.image_urls = restRefs.slice(0, fields.image_urls.maxItems ?? 10)
    else if (model.kind === 'image' && 'image_url' in fields) input.image_url = restRefs[0]
    else if ('image_reference_url' in fields) input.image_reference_url = restRefs[0]
  }
  // 꼭 필요한 값이 비었으면 기본값으로, 기본값도 없으면 알린다
  for (const [k, f] of Object.entries(fields)) {
    if (!f.required || input[k] !== undefined) continue
    if (f.default !== undefined) input[k] = f.default
    else if (k === 'image_url' || k === 'first_frame_url') throw new Error('이 모델은 시작 프레임(이미지)이 필요합니다.')
    else if (k === 'image_urls') throw new Error('이 모델은 레퍼런스 이미지가 필요합니다.')
    else if (k === 'duration' && f.enum) input[k] = f.enum[0]
    else if (k !== 'prompt') throw new Error(`필요한 값(${k})이 비어 있습니다.`)
  }
  return input
}

/** 생성 요청 하나를 정리(잘못된 값은 오류) */
export function planRequest(body) {
  const model = MODEL_BY_KEY[String(body?.model ?? '')]
  if (!model) throw new Error('모델을 골라 주세요.')
  const urls = (a) => (Array.isArray(a) ? a : []).filter((u) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 16)
  const refs = urls(body.refs)
  const start = urls([body.start])[0] ?? null
  const end = urls([body.end])[0] ?? null
  const count = Math.max(1, Math.min(MAX_COUNT, Math.round(Number(body.count) || 1)))
  const endpoint = pickEndpoint(model, { refs, start, end })
  const input = buildInput(model, endpoint, { prompt: body.prompt, refs, start, end, options: body.options ?? {} })
  return { model, endpoint, input, count: model.kind === 'video' ? 1 : count }
}

/** 받은 결과 응답 → 파일 주소들 */
export function outputUrls(status) {
  const out = []
  for (const im of Array.isArray(status?.images) ? status.images : []) if (im?.url) out.push({ url: im.url, type: 'image' })
  if (status?.video?.url) out.push({ url: status.video.url, type: 'video' })
  for (const v of Array.isArray(status?.videos) ? status.videos : []) if (v?.url && !out.some((o) => o.url === v.url)) out.push({ url: v.url, type: 'video' })
  if (status?.audio?.url) out.push({ url: status.audio.url, type: 'audio' })
  return out
}

/** 파일 확장자(응답 형식 → 주소 순) */
export function extFor(contentType, url, type) {
  const ct = String(contentType ?? '').split(';')[0].trim()
  const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' }
  if (map[ct]) return map[ct]
  const m = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(String(url ?? ''))
  if (m && Object.values(map).includes(m[1].toLowerCase())) return m[1].toLowerCase()
  return type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'png'
}

/** 보관 기간이 지났는가 */
export const isExpired = (job, now = Date.now()) => now - Date.parse(job.createdAt) > KEEP_DAYS * 864e5

/** 사람별 사용량(관리자 화면) */
export function usageByOwner(jobs) {
  const map = new Map()
  for (const j of jobs) {
    const u = map.get(j.owner) ?? { owner: j.owner, name: j.ownerName ?? j.owner, username: j.ownerUsername ?? '', jobs: 0, images: 0, videos: 0, failed: 0, bytes: 0, usd: 0, lastAt: null }
    u.jobs++
    for (const it of j.items ?? []) {
      if (it.type === 'video') u.videos++
      else u.images++
      u.bytes += it.size ?? 0
    }
    if (j.status === 'failed' || j.status === 'nsfw') u.failed++
    u.usd += Number(j.usd) || 0
    if (!u.lastAt || j.createdAt > u.lastAt) u.lastAt = j.createdAt
    map.set(j.owner, u)
  }
  return [...map.values()].map((u) => ({ ...u, usd: Math.round(u.usd * 1000) / 1000 })).sort((a, b) => b.bytes - a.bytes)
}

/** 힉스필드 오류 → 화면에 보일 한국어 */
export function hfError(status, detail) {
  const d = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((x) => x?.msg ?? '').join(', ') : (detail?.message ?? '')
  if (status === 401) return '힉스필드 API 키가 맞지 않습니다. 관리자 화면에서 키를 확인해 주세요.'
  if (status === 403) return '힉스필드 API 잔액이 부족합니다. 힉스필드 콘솔에서 충전해 주세요.'
  if (status === 404) return '이 계정에서 쓸 수 없는 모델입니다.'
  if (status === 423 || status === 503) return '모델이 잠시 쉬는 중입니다. 조금 뒤 다시 해 주세요.'
  if (status === 429) return '요청이 밀려 있습니다. 잠시 뒤 다시 해 주세요.'
  if (status === 400 || status === 422) return `입력값을 받지 않았습니다${d ? `: ${String(d).slice(0, 160)}` : ''}`
  return `힉스필드 오류(${status})${d ? `: ${String(d).slice(0, 160)}` : ''}`
}
