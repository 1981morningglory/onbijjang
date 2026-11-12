// 당근 — 화면 계산(모델 옵션·비율 이름·용량 표시). 모델 목록은 서버가 힉스필드 MCP 에서 받아 정리한 것(server/lib/carrot.mjs normalizeModel).

export type Kind = 'image' | 'video' | 'audio'
export interface Param {
  type?: string
  required?: boolean
  options?: Array<string | number>
  min?: number
  max?: number
  default?: string | number | boolean
}
export interface Model {
  key: string
  label: string
  kind: Kind
  provider: string
  note: string
  ratios: string[]
  params: Record<string, Param>
  roles: string[]
  maxRefs: number
  /** mode 가 작업 종류(글→영상 등)라 서버가 고르는 모델 */
  workflow: boolean
  /** 음성 TTS(목소리 필요) */
  tts: boolean
}
export interface Options {
  aspect_ratio?: string
  resolution?: string
  quality?: string
  duration?: number
  mode?: string
  variant?: string
  audio?: boolean
  voice?: string
  instrumental?: boolean
}
export interface Item {
  type: 'image' | 'video' | 'audio'
  url: string
  size: number
  name: string
}
export interface Job {
  id: string
  owner: string
  ownerName: string
  kind: Kind
  model: string
  modelLabel: string
  /** 다른 사람 결과면 null(프롬프트는 작성자만 본다) */
  prompt: string | null
  promptHidden?: boolean
  /** 작업 묶음(‘새로운 작업’ 단위). 예전 작업은 null */
  session?: string | null
  options: Options
  count: number
  refs: string[]
  status: 'running' | 'done' | 'failed' | 'nsfw'
  error: string | null
  credits: number | null
  createdAt: string
  doneAt: string | null
  expiresAt: string
  items: Item[]
}

/** 길이(초) 범위 → 고르기 쉬운 몇 단계 */
export function durationSteps(min: number, max: number): number[] {
  const lo = Math.max(1, min)
  const nice = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 45, 60, 90, 120, 180]
  const out = nice.filter((n) => n >= lo && n <= max)
  if (!out.includes(lo)) out.unshift(lo)
  if (!out.includes(max) && max <= 180) out.push(max)
  return out
}

/** 한 값의 선택지 */
export function choices(model: Model, key: string): Array<string | number> {
  if (key === 'aspect_ratio') return model.ratios
  if (key === 'mode' && model.workflow) return []
  const p = model.params[key]
  if (!p) return []
  if (p.options) return p.options
  if ((p.type === 'number' || p.type === 'integer') && p.min !== undefined && p.max !== undefined) return durationSteps(p.min, p.max)
  return []
}

/** 모델의 기본값 */
export function defaultOf(model: Model, key: string): string | number | boolean | undefined {
  if (key === 'aspect_ratio') return model.ratios.includes('auto') ? 'auto' : model.ratios[0]
  const p = model.params[key]
  if (p?.default !== undefined) return p.default
  return choices(model, key)[0]
}

/** 소리를 켜고 끌 수 있는 영상 모델인가 */
export const hasAudio = (model: Model) => model.kind === 'video' && Boolean(model.params.generate_audio || model.params.sound)
export const audioDefault = (model: Model) => (model.params.generate_audio ? model.params.generate_audio.default !== false : model.params.sound ? model.params.sound.default !== 'off' : false)

/** 모델이 바뀌면 옵션을 그 모델이 받는 값으로 맞춘다 */
export function fitOptions(model: Model, prev: Options, defaults: Options = {}): Options {
  const next: Options = {}
  const base = { ...defaults, ...prev }
  for (const key of ['aspect_ratio', 'resolution', 'quality', 'mode', 'variant'] as const) {
    const list = choices(model, key).map(String)
    if (!list.length) continue
    const v = base[key]
    next[key] = v !== undefined && list.includes(String(v)) ? String(v) : String(defaultOf(model, key))
  }
  const durations = choices(model, 'duration').map(Number)
  if (durations.length) {
    const d = base.duration ?? Number(defaultOf(model, 'duration') ?? durations[0])
    next.duration = durations.includes(d) ? d : durations.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a), durations[0])
  }
  if (hasAudio(model)) next.audio = base.audio ?? audioDefault(model)
  if (model.tts && base.voice) next.voice = base.voice
  if (model.params.force_instrumental) next.instrumental = base.instrumental ?? false
  return next
}

export const hasStartFrame = (model: Model) => model.kind === 'video' && model.roles.includes('start_image')
export const hasEndFrame = (model: Model) => model.kind === 'video' && model.roles.includes('end_image')
/** 레퍼런스를 몇 장까지 받는가(0 이면 안 받음) */
export const maxRefs = (model: Model) => (model.kind === 'audio' ? 0 : model.maxRefs)

/** 비율 이름: 4:3 → 가로 4:3, 3:4 → 세로 3:4 */
export function ratioLabel(r: string): string {
  if (r === 'auto') return '자동'
  if (r === 'adaptive') return '자동 맞춤'
  const m = /^(\d+):(\d+)$/.exec(r)
  if (!m) return r
  const w = Number(m[1])
  const h = Number(m[2])
  return w === h ? `정사각 ${r}` : w > h ? `가로 ${r}` : `세로 ${r}`
}
const WORDS: Record<string, string> = { auto: '자동', low: '낮음', medium: '보통', high: '높음', xhigh: '아주 높음', max: '최고', basic: '기본', ultra: '최고', std: '표준', standard: '표준', pro: '프로', fast: '빠름', '4k': '4K' }
export const optionLabel = (v: string | number) => WORDS[String(v)] ?? String(v).toUpperCase()
export const qualityLabel = optionLabel

/** 모델 버튼 이름: ‘챗GPT 이미지 2.0 보통’처럼 품질을 붙인다 */
export const modelChipLabel = (model: Model, o: Options) => (o.quality ? `${model.label} ${optionLabel(o.quality)}` : model.label)

/** 비율 → 미리보기 상자 비율(css aspect-ratio) */
export function ratioCss(r: string | undefined): string {
  const m = /^(\d+):(\d+)$/.exec(r ?? '')
  return m ? `${m[1]} / ${m[2]}` : '1 / 1'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)}KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`
  return `${(n / 1024 ** 3).toFixed(2)}GB`
}
export const formatCredits = (n: number) => `${Math.round(n * 10) / 10}크레딧`

/** 지워지기까지 남은 날(오늘 지워지면 0) */
export const daysLeft = (expiresAt: string, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 864e5))

/** 같은 날 묶음 제목 */
export function dayTitle(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  if (key(d) === key(now)) return '오늘'
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (key(d) === key(y)) return '어제'
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

export const PLACEHOLDER: Record<Kind, string> = {
  image: '만들고 싶은 이미지를 자세히 설명해 주세요',
  video: '장면·움직임·카메라를 자세히 설명해 주세요',
  audio: '원하는 음악이나 읽어줄 문장을 입력하세요',
}
/** 캐럿처럼 처음 고르는 모델 */
export const DEFAULT_MODEL: Record<Kind, string> = { image: 'gpt_image_2', video: 'kling3_0', audio: 'seed_audio' }
/** 처음 쓰는 사람의 기본 옵션(캐럿 화면: 챗GPT 이미지 2.0 Medium · 가로 4:3) */
export const DEFAULT_OPTIONS: Record<string, Options> = { gpt_image_2: { quality: 'medium', aspect_ratio: '4:3' } }
