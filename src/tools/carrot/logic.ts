// 당근 — 화면 계산(모델 옵션·비율 이름·용량 표시). 서버 모델 목록(server/routes/carrot-models.json)을 그대로 읽는다.

export type Kind = 'image' | 'video' | 'audio'
export interface Field {
  type?: string
  enum?: Array<string | number>
  default?: string | number | boolean
  min?: number
  max?: number
  maxItems?: number
  required?: boolean
}
export interface Model {
  key: string
  label: string
  kind: 'image' | 'video'
  note?: string
  defaults?: Record<string, string | number>
  endpoints: Partial<Record<'text' | 'image' | 'reference' | 'edit', string>>
  fields: Record<string, Record<string, Field>>
}
export interface Options {
  aspect_ratio?: string
  resolution?: string
  quality?: string
  duration?: number
  audio?: boolean
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
  kind: 'image' | 'video'
  model: string
  modelLabel: string
  prompt: string
  options: Options
  count: number
  refs: string[]
  start: string | null
  end: string | null
  status: 'running' | 'done' | 'failed' | 'nsfw'
  error: string | null
  usd: number | null
  createdAt: string
  doneAt: string | null
  expiresAt: string
  items: Item[]
}

/** 모델의 모든 엔드포인트에서 한 값의 선택지(합집합, 첫 엔드포인트 순서) */
export function choices(model: Model, key: string): Array<string | number> {
  const out: Array<string | number> = []
  for (const f of Object.values(model.fields)) {
    const x = f[key]
    if (!x) continue
    if (x.enum) {
      for (const v of x.enum) if (!out.includes(v)) out.push(v)
    } else if ((x.type === 'integer' || x.type === 'number') && x.min !== undefined && x.max !== undefined) {
      for (const v of durationSteps(x.min, x.max)) if (!out.includes(v)) out.push(v)
    }
  }
  return key === 'duration' ? out.map(Number).sort((a, b) => a - b) : out
}

/** 길이(초) 범위 → 고르기 쉬운 몇 단계 */
export function durationSteps(min: number, max: number): number[] {
  const nice = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30]
  const out = nice.filter((n) => n >= min && n <= max)
  if (!out.includes(min)) out.unshift(min)
  if (!out.includes(max)) out.push(max)
  return out
}

/** 모델의 기본값(모델 지정 기본 → 첫 엔드포인트 기본 → 첫 선택지) */
export function defaultOf(model: Model, key: string): string | number | boolean | undefined {
  if (model.defaults && key in model.defaults) return model.defaults[key]
  for (const f of Object.values(model.fields)) if (f[key]?.default !== undefined) return f[key].default
  return choices(model, key)[0]
}

/** 소리를 켜고 끌 수 있는 모델인가 */
export const hasAudio = (model: Model) => Object.values(model.fields).some((f) => 'generate_audio' in f || 'sound' in f)
export const audioDefault = (model: Model) => {
  for (const f of Object.values(model.fields)) {
    if (f.generate_audio) return f.generate_audio.default !== false
    if (f.sound) return f.sound.default !== 'off'
  }
  return false
}

/** 모델이 바뀌면 옵션을 그 모델이 받는 값으로 맞춘다 */
export function fitOptions(model: Model, prev: Options): Options {
  const next: Options = {}
  for (const key of ['aspect_ratio', 'resolution', 'quality'] as const) {
    const list = choices(model, key)
    if (!list.length) continue
    const v = prev[key]
    next[key] = String(v !== undefined && list.map(String).includes(String(v)) ? v : defaultOf(model, key))
  }
  const durations = choices(model, 'duration').map(Number)
  if (durations.length) {
    const d = prev.duration ?? Number(defaultOf(model, 'duration'))
    next.duration = durations.includes(d) ? d : durations.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a), durations[0])
  }
  if (hasAudio(model)) next.audio = prev.audio ?? audioDefault(model)
  return next
}

/** 레퍼런스를 몇 장까지 받는가(0 이면 안 받음) */
export function maxRefs(model: Model): number {
  let n = 0
  for (const f of Object.values(model.fields)) {
    if (f.image_urls) n = Math.max(n, f.image_urls.maxItems ?? 10)
    else if (model.kind === 'image' && (f.image_url || f.image_reference_url)) n = Math.max(n, 1)
  }
  // 레퍼런스→영상이 없는 영상 모델은 첫 장을 시작 프레임으로 쓴다
  if (model.kind === 'video' && !n && model.endpoints.image) n = 1
  return n
}
export const hasStartFrame = (model: Model) => model.kind === 'video' && Boolean(model.endpoints.image)
export const hasEndFrame = (model: Model) => Object.values(model.fields).some((f) => 'end_image_url' in f || 'last_image_url' in f || 'last_frame_url' in f)

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
export const QUALITY_LABEL: Record<string, string> = { low: '낮음', medium: '보통', high: '높음', xhigh: '아주 높음', max: '최고' }
export const qualityLabel = (q: string) => QUALITY_LABEL[q] ?? q

/** 모델 버튼에 쓰는 이름: ‘GPT 이미지 2.0 보통’처럼 품질을 붙인다 */
export const modelChipLabel = (model: Model, o: Options) => (o.quality ? `${model.label} ${qualityLabel(o.quality)}` : model.label)

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
