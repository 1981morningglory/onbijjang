// 당근(이미지·영상 생성기) 모델 목록 만들기.
// 힉스필드 문서 전체(https://docs.higgsfield.ai/llms-full.txt)에서 모델별 입력 형식을 읽어
// server/routes/carrot-models.json 을 다시 만든다. 모델이 바뀌면: node scripts/carrot-catalog.mjs <llms-full.txt 경로>
import fs from 'node:fs'

const src = process.argv[2]
if (!src) throw new Error('사용법: node scripts/carrot-catalog.mjs llms-full.txt')
const lines = fs.readFileSync(src, 'utf8').split('\n')

// 문서에서 엔드포인트별 JSON 형식 뽑기
const schemas = {}
let cur = null
for (let i = 0; i < lines.length; i++) {
  const m = /^\*\*Endpoint ID:\*\* `([^`]+)`/.exec(lines[i])
  if (m) cur = m[1]
  if (cur && lines[i].includes('**Complete JSON schema**')) {
    let j = i + 1
    while (!lines[j].includes('```json')) j++
    const buf = []
    for (j++; !lines[j].replace(/^>\s?/, '').startsWith('```'); j++) buf.push(lines[j].replace(/^>\s?/, ''))
    schemas[cur] = JSON.parse(buf.join('\n'))
    cur = null
    i = j
  }
}

/** 화면에서 고를 수 있게 남길 입력값과 참고 이미지 칸 */
const KEEP = ['prompt', 'aspect_ratio', 'resolution', 'quality', 'duration', 'generate_audio', 'sound', 'batch_size', 'image_urls', 'image_url', 'image_reference_url', 'first_frame_url', 'end_image_url', 'last_image_url', 'last_frame_url', 'enhance_prompt', 'seed']
function fieldsOf(id) {
  const s = schemas[id]
  if (!s) throw new Error(`문서에 없는 엔드포인트: ${id}`)
  const out = {}
  for (const [k, v0] of Object.entries(s.properties ?? {})) {
    if (!KEEP.includes(k)) continue
    // anyOf(null 허용) 이면 null 이 아닌 쪽
    const v = v0.anyOf ? (v0.anyOf.find((x) => x.type !== 'null') ?? v0) : v0
    const f = { type: v.type ?? v0.type }
    if (v.enum) f.enum = v.enum
    if (v0.default !== undefined && v0.default !== null) f.default = v0.default
    if (v.minimum !== undefined) f.min = v.minimum
    if (v.maximum !== undefined) f.max = v.maximum
    if (v.maxItems !== undefined) f.maxItems = v.maxItems
    if ((s.required ?? []).includes(k)) f.required = true
    out[k] = f
  }
  return out
}

const M = (key, label, kind, endpoints, extra = {}) => ({ key, label, kind, endpoints, ...extra })
const MODELS = [
  // ── 이미지 ──
  M('gpt-image-2', 'GPT 이미지 2.0', 'image', { text: 'marketing-studio/image' }, { note: '마케팅 스튜디오 이미지 2.0', defaults: { quality: 'medium', resolution: '1k' } }),
  M('gpt-image-2-5', 'GPT 이미지 2.5 Flare', 'image', { text: 'marketing-studio/image/flare' }, { note: '마케팅 스튜디오 이미지 2.5 Flare', defaults: { quality: 'medium', resolution: '1k' } }),
  M('sunburst', '마케팅 스튜디오 2.5 Sunburst', 'image', { text: 'marketing-studio/image/sunburst' }, { defaults: { quality: 'medium', resolution: '1k' } }),
  M('soul-2', 'Soul 2.0', 'image', { text: 'higgsfield-ai/soul/v2/standard' }, { note: '힉스필드 인물·패션 사진' }),
  M('soul', 'Soul', 'image', { text: 'higgsfield-ai/soul/standard' }),
  M('grok-image', 'Grok 이미지 2.0', 'image', { text: 'xai/grok-imagine-image-2.0' }),
  M('ideogram-4', 'Ideogram 4.0', 'image', { text: 'ideogram/v4.0' }, { note: '글자가 들어간 이미지에 강함' }),
  M('recraft-pro', 'Recraft V4.1 Pro', 'image', { text: 'recraft/v4.1/pro/text-to-image' }, { note: '디자인·일러스트' }),
  M('recraft', 'Recraft V4.1', 'image', { text: 'recraft/v4.1/text-to-image' }),
  M('qwen-image-3', 'Qwen 이미지 3', 'image', { text: 'alibaba/qwen-image-3/text-to-image', edit: 'alibaba/qwen-image-3/edit' }, { note: '레퍼런스를 넣으면 편집' }),
  M('z-image', 'Z-Image 터보', 'image', { text: 'z-image/turbo' }, { note: '빠르고 저렴' }),
  // ── 영상 ──
  M('seedance-2-5', 'Seedance 2.5', 'video', { text: 'bytedance/seedance-2.5/text-to-video', image: 'bytedance/seedance-2.5/image-to-video', reference: 'bytedance/seedance-2.5/reference-to-video' }, { defaults: { duration: 5 } }),
  M('seedance-2', 'Seedance 2.0', 'video', { text: 'bytedance/seedance-2.0/text-to-video', image: 'bytedance/seedance-2.0/image-to-video', reference: 'bytedance/seedance-2.0/reference-to-video' }, { defaults: { duration: 5 } }),
  M('kling-3-pro', 'Kling 3.0 Pro', 'video', { text: 'kling-video/v3.0/pro/text-to-video', image: 'kling-video/v3.0/pro/image-to-video' }),
  M('kling-3-std', 'Kling 3.0 Standard', 'video', { text: 'kling-video/v3.0/std/text-to-video', image: 'kling-video/v3.0/std/image-to-video' }),
  M('kling-3-turbo', 'Kling 3.0 Turbo', 'video', { text: 'kling-video/v3.0-turbo/text-to-video', image: 'kling-video/v3.0-turbo/image-to-video' }),
  M('kling-3-4k', 'Kling 3.0 4K', 'video', { text: 'kling-video/v3.0/4k/text-to-video', image: 'kling-video/v3.0/4k/image-to-video' }),
  M('kling-2-6', 'Kling 2.6 Pro', 'video', { text: 'kling-video/v2.6/pro/text-to-video', image: 'kling-video/v2.6/pro/image-to-video' }),
  M('kling-2-5', 'Kling 2.5 Turbo Pro', 'video', { text: 'kling-video/v2.5-turbo/pro/text-to-video', image: 'kling-video/v2.5-turbo/pro/image-to-video' }),
  M('wan-3-prime', 'Wan 3.0 Prime', 'video', { text: 'alibaba/wan-3.0-prime/text-to-video', image: 'alibaba/wan-3.0-prime/image-to-video', reference: 'alibaba/wan-3.0-prime/reference-to-video' }),
  M('wan-3', 'Wan 3.0', 'video', { text: 'alibaba/wan-3.0/text-to-video', image: 'alibaba/wan-3.0/image-to-video', reference: 'alibaba/wan-3.0/reference-to-video' }),
  M('wan-2-7', 'Wan 2.7', 'video', { text: 'wan/v2.7/text-to-video', image: 'wan/v2.7/image-to-video', reference: 'wan/v2.7/reference-to-video' }),
  M('minimax-h3', 'MiniMax H3', 'video', { text: 'minimax/h3/text-to-video', image: 'minimax/h3/image-to-video', reference: 'minimax/h3/reference-to-video' }),
  M('hailuo-2-3', 'Hailuo 2.3', 'video', { text: 'minimax/hailuo-2.3/standard/text-to-video', image: 'minimax/hailuo-2.3/standard/image-to-video' }),
  M('happy-horse', 'HappyHorse 1.1', 'video', { text: 'alibaba/happy-horse/v1.1/text-to-video', image: 'alibaba/happy-horse/v1.1/image-to-video', reference: 'alibaba/happy-horse/v1.1/reference-to-video' }),
  M('ltx-pro', 'LTX-2.5 Pro', 'video', { text: 'lightricks/ltx-2.5/text-to-video/pro', image: 'lightricks/ltx-2.5/image-to-video/pro' }),
  M('ltx-fast', 'LTX-2.5 Fast', 'video', { text: 'lightricks/ltx-2.5/text-to-video/fast', image: 'lightricks/ltx-2.5/image-to-video/fast' }),
  M('pixverse-6', 'PixVerse V6', 'video', { text: 'pixverse/v6/text-to-video', image: 'pixverse/v6/image-to-video' }),
  M('grok-video', 'Grok 비디오 1.5', 'video', { reference: 'xai/grok-imagine-video/v1.5/reference-to-video' }),
  M('cinema-4', '시네마 스튜디오 4.0', 'video', { text: 'higgsfield/cinema-studio/4.0' }, { note: '영화 같은 장면' }),
]

const out = {
  source: 'https://docs.higgsfield.ai/llms-full.txt',
  builtAt: new Date().toISOString().slice(0, 10),
  models: MODELS.map((m) => ({ ...m, fields: Object.fromEntries(Object.values(m.endpoints).map((id) => [id, fieldsOf(id)])) })),
}
fs.writeFileSync(new URL('../server/routes/carrot-models.json', import.meta.url), JSON.stringify(out))
console.log(`모델 ${out.models.length}개, 엔드포인트 ${out.models.reduce((s, m) => s + Object.keys(m.endpoints).length, 0)}개`)
