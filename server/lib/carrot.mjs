// 당근(이미지·영상·오디오 생성기) — 힉스필드 MCP(구독 크레딧) 요청 만들기, 모델 목록 정리, 보관 기간, 사용량 계산.
// 서버 라우트(server/routes/carrot.mjs)와 시험(src/tools/carrot/carrot.test.ts)이 함께 쓴다.
import fs from 'node:fs'

/** 라이브러리 보관 기간(일) */
export const KEEP_DAYS = 7
export const MAX_COUNT = 4
export const MAX_PROMPT = 4000

// ── 모델 목록 ─────────────────────────────────────────────
/** 생성기에 맞지 않는 편집·보정·전용 워크플로 모델(목록에서 뺀다) */
const EXCLUDE = new Set([
  // 이미지
  'autosprite', 'image_auto', 'image_background_remover', 'outpaint', 'flux_2_pro_outpaint', 'topaz_image', 'topaz_image_generative', 'image_decompose', 'image_command',
  'bytedance_image_upscale', '3d_jutsu_angles', 'soul_cast', 'soul_location', 'cinematic_studio_soul_cast', 'cinematic_studio_soul_location', 'marketing_studio_image', 'ms_image', 'marketing_studio_2_image', 'nano_banana_2_shots',
  // 영상
  'video_background_remover', 'voice_change', 'dubbing', 'sync_so', 'ad_multiplier', 'ad_multiplier_v2', 'reframe', 'topaz_hyperion_2_5', 'topaz_video', 'bytedance_video_upscale', 'video_upscale',
  'video_deflicker', 'depth_anything_video', 'sam_3_video', 'fps_boost', 'flux_3_video_edit', 'kling_video_edit', 'hf_mult_motion_control', 'hf_mult_replace_object', 'hf_mult_motion_control_flash',
  'hf_mult_replace_object_flash', 'kling3_0_motion_control', 'draw_to_video', 'higgsfield_preset', 'intone', 'marketing_studio_video', 'marketing_studio_v2_video', 'marketing_studio_v2_reference2video', 'kling_o3_flf',
  // 오디오(게임 전용·목소리 따로 필요)
  'sonilo_music', 'mirelo_text_to_audio', 'inworld_text_to_speech', 'qwen_audio_tts',
])
/** 앞에 둘 모델(캐럿과 비슷하게 자주 쓰는 순서) */
const FIRST = ['gpt_image_2', 'gpt_image_2_6', 'gpt_image_2_5', 'nano_banana_pro', 'nano_banana_2', 'seedream_v5_pro', 'soul_2', 'flux_3_image', 'grok_image_2_0', 'ideogram_4_5', 'recraft_v4_1', 'z_image', 'kling4_0', 'seedance_2_5', 'veo3_1', 'kling3_0', 'seedance_2_0', 'wan3_0', 'minimax_h3', 'grok_video_v15', 'seed_audio', 'text2speech_v2', 'elevenlabs_v4_turbo', 'elevenlabs_v4', 'elevenlabs_music_v2_5', 'elevenlabs_music_v2']
/** 화면에 보일 이름(없으면 힉스필드 이름 그대로) */
const LABEL = {
  gpt_image_2: '챗GPT 이미지 2.0', gpt_image_2_5: '챗GPT 이미지 2.5', gpt_image_2_6: '챗GPT 이미지 2.6', gpt_image_2_6_flare: '챗GPT 이미지 2.6 Flare',
  nano_banana: '나노바나나', nano_banana_pro: '나노바나나 프로', nano_banana_2: '나노바나나 2', nano_banana_2_1: '나노바나나 2.1', nano_banana_2_lite: '나노바나나 2 라이트',
  seed_audio: '음성 TTS (Seed Audio)', text2speech_v2: '음성 TTS (엔진 선택)', elevenlabs_v4_turbo: '음성 TTS (ElevenLabs v4 Turbo)', elevenlabs_v4: '음성 TTS (ElevenLabs v4)', elevenlabs_music_v2_5: '음악 (ElevenLabs Music v2.5)', elevenlabs_music_v2: '음악 (ElevenLabs Music v2)',
}
/** 작업 종류를 고르는 mode 값(화질 고르기가 아님) — 넣은 이미지에 따라 서버가 고른다 */
const WORKFLOW_MODES = { text: ['text-to-video', 't2v'], image: ['image-to-video', 'i2v'], reference: ['reference-to-video', 'omni_reference'] }

/** 힉스필드 models_explore 결과 하나 → 화면·서버가 쓰는 모델 */
export function normalizeModel(x) {
  const kind = x.output_type
  if (!['image', 'video', 'audio'].includes(kind) || EXCLUDE.has(x.id)) return null
  const params = {}
  for (const p of x.parameters ?? []) {
    if (['folder_id', 'style_id', 'soul_id', 'brand_kit_id', 'preset_id', 'product_ids', 'ad_reference_id', 'kling_element_ids', 'draft_job_id', 'size', 'width', 'height'].includes(p.name)) continue
    params[p.name] = { type: p.type, required: p.required === 'required', ...(p.options ? { options: p.options } : {}), ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}), ...(p.default !== undefined && p.default !== null ? { default: p.default } : {}) }
  }
  // 채울 수 없는 필수 값이 있으면 뺀다(오디오의 dialogue·duration 은 화면이 채운다)
  const fillable = ['dialogue', 'duration', 'voice_type', 'voice_id']
  if (Object.entries(params).some(([k, v]) => v.required && !fillable.includes(k) && !v.options && v.default === undefined)) return null
  const roles = [...new Set((x.medias ?? []).flatMap((m) => m.roles ?? []))]
  const max = Math.max(0, ...(x.medias ?? []).map((m) => m.max ?? 0))
  if (roles.includes('input_video') && !roles.includes('start_image') && kind === 'video') return null
  const mode = params.mode?.options ?? []
  const workflow = mode.some((m) => WORKFLOW_MODES.text.includes(m) || WORKFLOW_MODES.reference.includes(m))
  return {
    key: x.id,
    label: LABEL[x.id] ?? x.name,
    kind,
    provider: x.provider_name ?? '',
    note: String(x.description ?? '').slice(0, 120),
    ratios: (x.aspect_ratios ?? []).map(String),
    params,
    roles,
    maxRefs: roles.some((r) => ['image_references', 'image', 'input_images'].includes(r)) ? Math.min(max || 8, 14) : 0,
    workflow,
    tts: Boolean(params.dialogue || params.voice_id),
  }
}
export function normalizeModels(raw) {
  const list = raw.map(normalizeModel).filter(Boolean)
  const rank = (m) => (FIRST.includes(m.key) ? FIRST.indexOf(m.key) : 1000)
  return list.sort((a, b) => rank(a) - rank(b))
}
/** 저장해 둔 목록(힉스필드에 닿지 못할 때) */
export const SNAPSHOT = normalizeModels(JSON.parse(fs.readFileSync(new URL('../routes/carrot-models.json', import.meta.url), 'utf8')).models)

// ── 요청 만들기 ───────────────────────────────────────────
/** 옵션 하나를 그 모델이 받는 값으로(못 맞추면 undefined → 보내지 않음) */
export function fit(p, v) {
  if (!p || v === undefined || v === null || v === '') return undefined
  if (p.options) return p.options.find((x) => String(x) === String(v))
  if (p.type === 'bool' || p.type === 'boolean') return Boolean(v)
  if (p.type === 'number' || p.type === 'integer') {
    let n = Math.round(Number(v))
    if (!Number.isFinite(n)) return undefined
    if (p.min !== undefined) n = Math.max(Math.max(1, p.min), n)
    if (p.max !== undefined) n = Math.min(p.max, n)
    return n
  }
  return String(v)
}

/**
 * 화면에서 받은 값 → generate_* 도구 이름과 params.
 * refs·start·end 는 이미 올린 힉스필드 media_id(또는 이전 결과 job_id).
 */
export function planRequest(body, models) {
  const model = models.find((m) => m.key === String(body?.model ?? ''))
  if (!model) throw new Error('모델을 골라 주세요.')
  const ids = (a) => (Array.isArray(a) ? a : []).filter((u) => typeof u === 'string' && /^[0-9a-f-]{16,64}$/i.test(u)).slice(0, 14)
  const refs = ids(body.refs)
  const start = ids([body.start])[0] ?? null
  const end = ids([body.end])[0] ?? null
  const prompt = String(body.prompt ?? '').trim().slice(0, MAX_PROMPT)
  const o = body.options ?? {}
  const P = model.params
  const params = { model: model.key }

  if (model.kind === 'audio') {
    if (!prompt) throw new Error(model.tts ? '읽어 줄 문장을 적어 주세요.' : '원하는 음악을 적어 주세요.')
    if (model.tts) {
      if (!o.voice) throw new Error('목소리를 골라 주세요.')
      // 힉스필드는 음성도 최상위 prompt 를 함께 받아야 한다
      params.prompt = prompt
      if (P.dialogue) params.dialogue = [{ text: prompt, voice_type: 'preset', voice_id: String(o.voice) }]
      if (P.voice_id) Object.assign(params, { voice_type: 'preset', voice_id: String(o.voice) })
      if (P.variant) params.variant = fit(P.variant, o.variant) ?? P.variant.default ?? P.variant.options?.[0]
    } else {
      params.prompt = prompt
      params.duration = fit(P.duration, o.duration ?? 30) ?? 30
      if (P.force_instrumental && o.instrumental !== undefined) params.force_instrumental = Boolean(o.instrumental)
    }
    return { model, tool: 'generate_audio', params, count: 1 }
  }

  if (!prompt && !start && !refs.length) throw new Error('만들고 싶은 내용을 적어 주세요.')
  if (prompt) params.prompt = prompt
  if (model.ratios.length) {
    const r = model.ratios.find((x) => x === String(o.aspect_ratio))
    if (r) params.aspect_ratio = r
  }
  for (const k of ['quality', 'resolution', 'duration', 'variant']) {
    const v = fit(P[k], o[k])
    if (v !== undefined) params[k] = v
  }
  if (P.mode && !model.workflow) {
    const v = fit(P.mode, o.mode)
    if (v !== undefined) params.mode = v
  }
  if (o.audio !== undefined) {
    if (P.generate_audio) params.generate_audio = Boolean(o.audio)
    else if (P.sound) params.sound = o.audio ? 'on' : 'off'
  }
  // 넣은 이미지 → medias(역할 이름은 모델마다 다르다)
  const medias = []
  const has = (r) => model.roles.includes(r)
  let restRefs = refs
  let startId = start
  if (model.kind === 'video' && !startId && refs.length && !has('image_references') && has('start_image')) {
    startId = refs[0]
    restRefs = refs.slice(1)
  }
  if (startId && has('start_image')) medias.push({ role: 'start_image', value: startId })
  if (end && has('end_image')) medias.push({ role: 'end_image', value: end })
  const refRole = ['image_references', 'image', 'input_images'].find(has)
  if (refRole) for (const id of restRefs.slice(0, model.maxRefs || 8)) medias.push({ role: refRole, value: id })
  if (medias.length) params.medias = medias
  // 작업 종류 mode(Kling 4.0·Seedance 2.5 등)
  if (model.workflow) {
    const opts = P.mode.options
    const pick = (list) => opts.find((m) => list.includes(m))
    const usedRef = medias.some((m) => m.role === refRole)
    params.mode = (usedRef && pick(WORKFLOW_MODES.reference)) || (medias.some((m) => m.role === 'start_image') && pick(WORKFLOW_MODES.image)) || pick(WORKFLOW_MODES.text) || opts[0]
  }
  const count = model.kind === 'image' ? Math.max(1, Math.min(MAX_COUNT, Math.round(Number(body.count) || 1))) : 1
  if (count > 1) params.count = count
  return { model, tool: model.kind === 'image' ? 'generate_image' : 'generate_video', params, count }
}

// ── 결과 ─────────────────────────────────────────────────
/** MCP 도구 결과 → 오류 문구(문제 없으면 null) */
export function toolError(result) {
  if (!result?.isError) return null
  const sc = result.structuredContent ?? {}
  const text = (result.content ?? []).map((c) => c.text ?? '').join(' ')
  return koreanToolError(String(sc.error ?? sc.message ?? text))
}
export function koreanToolError(msg) {
  if (/credit|insufficient|balance|not enough/i.test(msg)) return '힉스필드 크레딧이 부족합니다. 구독 크레딧을 확인해 주세요.'
  if (/nsfw|moderation|policy|safety/i.test(msg)) return '내용 검수에 걸려 만들 수 없습니다. 프롬프트를 바꿔 주세요.'
  if (/plan|upgrade|subscription/i.test(msg)) return `지금 요금제에서 쓸 수 없는 설정입니다: ${msg.slice(0, 160)}`
  return `힉스필드가 요청을 받지 않았습니다: ${msg.slice(0, 200)}`
}
/** generate_* 결과 → 작업 ID 들 */
export const jobIds = (result) => (result?.structuredContent?.results ?? []).map((r) => r?.id).filter((x) => typeof x === 'string')

const MEDIA_EXT = /\.(png|jpe?g|webp|gif|svg|mp4|mov|webm|mp3|wav|ogg|m4a)(?:$|[?#])/i
/** job_status 결과 → 상태와 원본 파일 주소들(작은 미리보기·썸네일은 뺀다) */
export function jobResult(result) {
  const g = result?.structuredContent?.generation ?? result?.structuredContent ?? {}
  const status = String(g.status ?? 'pending').toLowerCase()
  const urls = []
  const walk = (v, key = '') => {
    if (typeof v === 'string') {
      if (/^https:\/\//.test(v) && MEDIA_EXT.test(v) && !/min|thumb|preview|poster|cover/i.test(key) && !urls.includes(v)) urls.push(v)
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k)
  }
  walk(g.results ?? g.result ?? g.outputs ?? {})
  const error = typeof g.error === 'string' ? g.error : typeof g.failure_reason === 'string' ? g.failure_reason : null
  return { status, urls, error }
}
export const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'canceled', 'cancelled', 'error'])

/** 파일 확장자(응답 형식 → 주소 순) */
export function extFor(contentType, url, kind) {
  const ct = String(contentType ?? '').split(';')[0].trim()
  const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' }
  if (map[ct]) return map[ct]
  const m = MEDIA_EXT.exec(String(url ?? ''))
  if (m) return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()
  return kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png'
}
export const typeOfExt = (ext) => (['mp4', 'mov', 'webm'].includes(ext) ? 'video' : ['mp3', 'wav', 'ogg', 'm4a'].includes(ext) ? 'audio' : 'image')

// ── 라이브러리 접근 권한 ──────────────────────────────────
/** 접근 설정 하나 정리: { mode: 'own' | 'all' | 'some', owners: [계정 ID] } */
export function cleanAccess(v) {
  const mode = ['own', 'all', 'some'].includes(v?.mode) ? v.mode : 'own'
  const owners = mode === 'some' ? [...new Set((Array.isArray(v?.owners) ? v.owners : []).filter((x) => typeof x === 'string' && /^[a-z0-9]{1,40}$/.test(x)))].slice(0, 200) : []
  return { mode: mode === 'some' && !owners.length ? 'own' : mode, owners }
}
/** viewer 가 owner 의 라이브러리를 볼 수 있는가(기본은 모두 함께 봄. 관리자가 ‘내 것만’·‘선택한 사람’으로 좁힐 수 있다) */
export function canView(access, viewer, owner, admin = false) {
  if (admin || viewer === owner) return true
  const a = access?.[viewer]
  if (!a) return true
  return a.mode === 'all' || (a.mode === 'some' && a.owners.includes(owner))
}
/** 다른 사람 라이브러리를 볼 수 있는 사람인가(화면에 ‘라이브러리 보기’ 고르기를 보일지) */
export const canBrowse = (access, viewer, admin = false) => admin || (access?.[viewer]?.mode ?? 'all') !== 'own'
/** 프롬프트는 작성한 본인과 전체마스터만 본다 */
export const canSeePrompt = (viewer, owner, admin = false) => admin || viewer === owner

/** 거래 내역에서 가장 최근 구독 크레딧 지급(매달 갱신) 찾기 */
export function lastSubscriptionGrant(items) {
  const g = (Array.isArray(items) ? items : []).find((t) => t?.action === 'grant' && /subscription/i.test(String(t.display_name ?? '')))
  return g ? { at: g.created_at, credits: Number(g.credits) || 0 } : null
}
/** 지난 갱신 시각 → 다음 갱신 시각(한 달 뒤 같은 날·시각, 이미 지났으면 한 달씩 더) */
export function nextRenewal(lastIso, now = Date.now()) {
  const last = new Date(lastIso)
  if (Number.isNaN(last.getTime())) return null
  for (let k = 1; k < 24; k++) {
    const d = new Date(last)
    const day = last.getUTCDate()
    d.setUTCDate(1)
    d.setUTCMonth(last.getUTCMonth() + k)
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    d.setUTCDate(Math.min(day, lastDay))
    if (d.getTime() > now) return d.toISOString()
  }
  return null
}

/** 보관 기간이 지났는가 */
export const isExpired = (job, now = Date.now()) => now - Date.parse(job.createdAt) > KEEP_DAYS * 864e5

/** 계정별 사용량(관리자 화면). 크레딧은 보관 기간과 상관없이 쌓아 둔 기록(ledger)으로 센다 */
export function usageByOwner(jobs, ledger = []) {
  const map = new Map()
  const get = (owner, name, username) => {
    const u = map.get(owner) ?? { owner, name: name ?? owner, username: username ?? '', jobs: 0, images: 0, videos: 0, audios: 0, failed: 0, bytes: 0, credits: 0, credits30: 0, lastAt: null }
    map.set(owner, u)
    return u
  }
  for (const j of jobs) {
    const u = get(j.owner, j.ownerName, j.ownerUsername)
    u.jobs++
    for (const it of j.items ?? []) {
      if (it.type === 'video') u.videos++
      else if (it.type === 'audio') u.audios++
      else u.images++
      u.bytes += it.size ?? 0
    }
    if (j.status === 'failed' || j.status === 'nsfw') u.failed++
    u.credits += Number(j.credits) || 0
    if (!u.lastAt || j.createdAt > u.lastAt) u.lastAt = j.createdAt
  }
  const since = Date.now() - 30 * 864e5
  for (const l of ledger) {
    if (Date.parse(l.at) < since) continue
    get(l.owner, l.name, l.username).credits30 += Number(l.credits) || 0
  }
  return [...map.values()].map((u) => ({ ...u, credits: Math.round(u.credits * 10) / 10, credits30: Math.round(u.credits30 * 10) / 10 })).sort((a, b) => b.bytes - a.bytes || b.credits30 - a.credits30)
}
