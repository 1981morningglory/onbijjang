import { describe, expect, it } from 'vitest'
import { CATALOG, MODEL_BY_KEY, buildInput, extFor, hfError, isExpired, outputUrls, pickEndpoint, planRequest, usageByOwner } from '../../../server/lib/carrot.mjs'
import { choices, daysLeft, durationSteps, fitOptions, hasEndFrame, hasStartFrame, maxRefs, modelChipLabel, ratioLabel } from './logic'

const U = 'https://cdn.example.com/a.png'
const U2 = 'https://cdn.example.com/b.png'

describe('모델 목록', () => {
  it('이미지·영상 모델이 모두 있고 엔드포인트마다 입력 형식이 있다', () => {
    expect(CATALOG.models.filter((m) => m.kind === 'image').length).toBeGreaterThanOrEqual(8)
    expect(CATALOG.models.filter((m) => m.kind === 'video').length).toBeGreaterThanOrEqual(15)
    for (const m of CATALOG.models) for (const id of Object.values(m.endpoints)) expect(m.fields[id!]).toBeTruthy()
  })
  it('기본 모델(GPT 이미지 2.0)은 품질 보통·1K 가 기본', () => {
    const m = MODEL_BY_KEY['gpt-image-2']
    expect(fitOptions(m, {})).toMatchObject({ quality: 'medium', resolution: '1k' })
    expect(modelChipLabel(m, { quality: 'medium' })).toBe('GPT 이미지 2.0 보통')
  })
})

describe('엔드포인트 고르기', () => {
  const sd = MODEL_BY_KEY['seedance-2-5']
  it('영상: 아무것도 없으면 글→영상, 시작 프레임이면 이미지→영상, 레퍼런스면 레퍼런스→영상', () => {
    expect(pickEndpoint(sd, {})).toBe('bytedance/seedance-2.5/text-to-video')
    expect(pickEndpoint(sd, { start: U })).toBe('bytedance/seedance-2.5/image-to-video')
    expect(pickEndpoint(sd, { refs: [U] })).toBe('bytedance/seedance-2.5/reference-to-video')
  })
  it('레퍼런스→영상이 없는 모델은 첫 레퍼런스를 시작 프레임으로', () => {
    const k = MODEL_BY_KEY['kling-3-pro']
    const ep = pickEndpoint(k, { refs: [U] })
    expect(ep).toBe('kling-video/v3.0/pro/image-to-video')
    expect(buildInput(k, ep, { prompt: '달리는 강아지', refs: [U] }).image_url).toBe(U)
  })
  it('이미지: 레퍼런스가 있고 편집 엔드포인트가 있으면 편집', () => {
    const q = MODEL_BY_KEY['qwen-image-3']
    expect(pickEndpoint(q, {})).toBe('alibaba/qwen-image-3/text-to-image')
    expect(pickEndpoint(q, { refs: [U] })).toBe('alibaba/qwen-image-3/edit')
  })
})

describe('입력값 만들기', () => {
  it('받지 않는 비율·해상도는 빼고, 길이는 범위 안으로', () => {
    const k = MODEL_BY_KEY['kling-3-pro']
    const input = buildInput(k, k.endpoints.text!, { prompt: 'x', options: { aspect_ratio: '4:3', duration: 99, resolution: '4k' } })
    expect(input.aspect_ratio).toBeUndefined()
    expect(input.duration).toBe(15)
    expect(input.resolution).toBeUndefined()
  })
  it('소리: generate_audio(참거짓) 또는 sound(on/off)', () => {
    const sd = MODEL_BY_KEY['seedance-2-5']
    expect(buildInput(sd, sd.endpoints.text!, { prompt: 'x', options: { audio: false } }).generate_audio).toBe(false)
    const k = MODEL_BY_KEY['kling-3-pro']
    expect(buildInput(k, k.endpoints.text!, { prompt: 'x', options: { audio: false } }).sound).toBe('off')
  })
  it('레퍼런스는 모델이 받는 장수까지만, 끝 프레임은 그 모델 칸 이름으로', () => {
    const g = MODEL_BY_KEY['gpt-image-2']
    const many = Array.from({ length: 20 }, (_, i) => `https://cdn.example.com/${i}.png`)
    expect((buildInput(g, g.endpoints.text!, { prompt: 'x', refs: many }).image_urls as string[]).length).toBe(16)
    const sd = MODEL_BY_KEY['seedance-2-5']
    const input = buildInput(sd, sd.endpoints.image!, { prompt: 'x', start: U, end: U2 })
    expect(input).toMatchObject({ image_url: U, end_image_url: U2 })
  })
  it('프롬프트가 꼭 필요한 모델에 비어 있으면 알린다', () => {
    const g = MODEL_BY_KEY['gpt-image-2']
    expect(() => buildInput(g, g.endpoints.text!, { prompt: '  ' })).toThrow('적어')
  })
  it('Soul 은 한 번에 1장(batch_size)으로 보내고 개수만큼 따로 요청', () => {
    const plan = planRequest({ model: 'soul-2', prompt: '사진', count: 3 })
    expect(plan.input.batch_size).toBe(1)
    expect(plan.count).toBe(3)
  })
  it('영상은 한 번에 1개, 개수는 1~4 로', () => {
    expect(planRequest({ model: 'seedance-2-5', prompt: 'x', count: 4 }).count).toBe(1)
    expect(planRequest({ model: 'z-image', prompt: 'x', count: 9 }).count).toBe(4)
    expect(() => planRequest({ model: 'nope', prompt: 'x' })).toThrow('모델')
  })
  it('https 가 아닌 주소는 레퍼런스로 받지 않는다', () => {
    const plan = planRequest({ model: 'gpt-image-2', prompt: 'x', refs: ['http://a/b.png', 'javascript:alert(1)', U] })
    expect(plan.input.image_urls).toEqual([U])
  })
})

describe('결과·보관', () => {
  it('완료 응답에서 이미지·영상 주소를 꺼낸다', () => {
    expect(outputUrls({ status: 'completed', images: [{ url: U }, { url: U2 }] })).toEqual([
      { url: U, type: 'image' },
      { url: U2, type: 'image' },
    ])
    expect(outputUrls({ video: { url: 'https://cdn/v.mp4' } })).toEqual([{ url: 'https://cdn/v.mp4', type: 'video' }])
  })
  it('확장자: 응답 형식 → 주소 → 종류 순', () => {
    expect(extFor('image/jpeg', 'https://x/a', 'image')).toBe('jpg')
    expect(extFor(null, 'https://x/a.webp?sig=1', 'image')).toBe('webp')
    expect(extFor('application/octet-stream', 'https://x/a', 'video')).toBe('mp4')
  })
  it('7일이 지나면 만료', () => {
    const now = Date.parse('2026-11-11T00:00:00Z')
    expect(isExpired({ createdAt: '2026-11-04T01:00:00Z' }, now)).toBe(false)
    expect(isExpired({ createdAt: '2026-11-03T23:00:00Z' }, now)).toBe(true)
    expect(daysLeft('2026-11-12T12:00:00Z', now)).toBe(2)
  })
  it('계정별 사용량: 용량 큰 순', () => {
    const u = usageByOwner([
      { owner: 'a', ownerName: '가', status: 'done', usd: 0.1, createdAt: '2026-11-10T00:00:00Z', items: [{ type: 'image', size: 100 }] },
      { owner: 'b', ownerName: '나', status: 'done', usd: 0.5, createdAt: '2026-11-10T00:00:00Z', items: [{ type: 'video', size: 5000 }] },
      { owner: 'a', ownerName: '가', status: 'failed', createdAt: '2026-11-11T00:00:00Z', items: [] },
    ])
    expect(u.map((x) => x.owner)).toEqual(['b', 'a'])
    expect(u[1]).toMatchObject({ jobs: 2, images: 1, failed: 1, bytes: 100, usd: 0.1 })
  })
  it('힉스필드 오류를 한국어로', () => {
    expect(hfError(403, '')).toContain('잔액')
    expect(hfError(401, '')).toContain('키')
  })
})

describe('화면 계산', () => {
  it('비율 이름', () => {
    expect(ratioLabel('4:3')).toBe('가로 4:3')
    expect(ratioLabel('9:16')).toBe('세로 9:16')
    expect(ratioLabel('1:1')).toBe('정사각 1:1')
    expect(ratioLabel('auto')).toBe('자동')
  })
  it('길이 단계와 선택지', () => {
    expect(durationSteps(4, 30)).toEqual([4, 5, 6, 8, 10, 12, 15, 20, 25, 30])
    expect(choices(MODEL_BY_KEY['ltx-pro'], 'duration')).toEqual([6, 8, 10])
  })
  it('모델이 바뀌면 옵션을 그 모델 값으로', () => {
    const k = MODEL_BY_KEY['kling-3-pro']
    expect(fitOptions(k, { aspect_ratio: '4:3', duration: 7 })).toMatchObject({ aspect_ratio: '16:9', duration: 6 })
  })
  it('레퍼런스·프레임 칸', () => {
    expect(maxRefs(MODEL_BY_KEY['gpt-image-2'])).toBe(16)
    expect(maxRefs(MODEL_BY_KEY['recraft'])).toBe(0)
    expect(hasStartFrame(MODEL_BY_KEY['seedance-2-5'])).toBe(true)
    expect(hasEndFrame(MODEL_BY_KEY['seedance-2-5'])).toBe(true)
    expect(hasEndFrame(MODEL_BY_KEY['kling-2-6'])).toBe(false)
  })
})
