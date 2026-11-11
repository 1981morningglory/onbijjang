import { describe, expect, it } from 'vitest'
import { SNAPSHOT, extFor, isExpired, jobIds, jobResult, normalizeModel, planRequest, toolError, usageByOwner } from '../../../server/lib/carrot.mjs'
import { DEFAULT_MODEL, DEFAULT_OPTIONS, choices, daysLeft, durationSteps, fitOptions, hasEndFrame, hasStartFrame, maxRefs, modelChipLabel, ratioLabel } from './logic'

const M = (key: string) => {
  const m = SNAPSHOT.find((x) => x.key === key)
  if (!m) throw new Error(`없는 모델 ${key}`)
  return m
}
const ID = '276007ef-6f89-47d5-ab07-6124b4fef216'
const ID2 = '41da35f2-5598-4c4a-bd72-31c18c0394b9'

describe('모델 목록(힉스필드 MCP)', () => {
  it('이미지·영상·오디오 모델이 있고, 편집·보정 전용 모델은 뺀다', () => {
    expect(SNAPSHOT.filter((m) => m.kind === 'image').length).toBeGreaterThanOrEqual(25)
    expect(SNAPSHOT.filter((m) => m.kind === 'video').length).toBeGreaterThanOrEqual(25)
    expect(SNAPSHOT.filter((m) => m.kind === 'audio').map((m) => m.key)).toEqual(expect.arrayContaining(['seed_audio', 'text2speech_v2', 'elevenlabs_v4_turbo', 'elevenlabs_music_v2_5']))
    for (const k of ['image_background_remover', 'video_upscale', 'reframe', 'dubbing']) expect(SNAPSHOT.some((m) => m.key === k)).toBe(false)
  })
  it('기본 모델이 목록에 있고 챗GPT 이미지 2.0 이 맨 앞', () => {
    for (const k of Object.values(DEFAULT_MODEL)) expect(SNAPSHOT.some((m) => m.key === k)).toBe(true)
    expect(SNAPSHOT[0].key).toBe('gpt_image_2')
    expect(M('gpt_image_2').label).toBe('챗GPT 이미지 2.0')
  })
  it('캐럿처럼 처음엔 보통 품질 · 가로 4:3', () => {
    const m = M('gpt_image_2')
    const o = fitOptions(m, {}, DEFAULT_OPTIONS.gpt_image_2)
    expect(o).toMatchObject({ quality: 'medium', aspect_ratio: '4:3', resolution: '1k' })
    expect(modelChipLabel(m, o)).toBe('챗GPT 이미지 2.0 보통')
  })
  it('채울 수 없는 필수 값이 있는 모델은 뺀다', () => {
    expect(normalizeModel({ id: 'x', name: 'X', output_type: 'image', parameters: [{ name: 'secret_id', required: 'required', type: 'string' }] })).toBeNull()
  })
})

describe('요청 만들기', () => {
  it('이미지: 모델·프롬프트·비율·품질·개수, 레퍼런스는 image_references', () => {
    const p = planRequest({ model: 'gpt_image_2', prompt: '꽃병', options: { quality: 'medium', aspect_ratio: '4:3', resolution: '1k' }, count: 3, refs: [ID] }, SNAPSHOT)
    expect(p.tool).toBe('generate_image')
    expect(p.params).toMatchObject({ model: 'gpt_image_2', prompt: '꽃병', quality: 'medium', aspect_ratio: '4:3', resolution: '1k', count: 3, medias: [{ role: 'image', value: ID }] })
  })
  it('받지 않는 값은 빼고 길이는 범위 안으로', () => {
    const p = planRequest({ model: 'kling3_0', prompt: 'x', options: { aspect_ratio: '4:3', duration: 99, quality: 'high' } }, SNAPSHOT)
    expect(p.params.aspect_ratio).toBeUndefined()
    expect(p.params.duration).toBe(15)
    expect(p.params.quality).toBeUndefined()
  })
  it('영상: 시작·끝 프레임은 start_image·end_image, 영상은 한 번에 1개', () => {
    const p = planRequest({ model: 'kling3_0', prompt: 'x', start: ID, end: ID2, count: 4 }, SNAPSHOT)
    expect(p.tool).toBe('generate_video')
    expect(p.params.medias).toEqual([{ role: 'start_image', value: ID }, { role: 'end_image', value: ID2 }])
    expect(p.params.count).toBeUndefined()
  })
  it('레퍼런스를 받지 않는 영상 모델은 첫 레퍼런스를 시작 프레임으로', () => {
    expect(planRequest({ model: 'veo3_1', prompt: 'x', refs: [ID] }, SNAPSHOT).params.medias).toEqual([{ role: 'start_image', value: ID }])
  })
  it('작업 종류 mode(Kling 4.0)는 넣은 이미지로 고른다', () => {
    expect(planRequest({ model: 'kling4_0', prompt: 'x' }, SNAPSHOT).params.mode).toBe('text-to-video')
    expect(planRequest({ model: 'kling4_0', prompt: 'x', start: ID }, SNAPSHOT).params.mode).toBe('image-to-video')
    expect(planRequest({ model: 'kling4_0', prompt: 'x', refs: [ID] }, SNAPSHOT).params.mode).toBe('reference-to-video')
    expect(choices(M('kling4_0'), 'mode')).toEqual([])
  })
  it('소리: generate_audio(참거짓) 또는 sound(on/off)', () => {
    expect(planRequest({ model: 'seedance_2_0', prompt: 'x', options: { audio: false } }, SNAPSHOT).params.generate_audio).toBe(false)
    expect(planRequest({ model: 'kling3_0', prompt: 'x', options: { audio: false } }, SNAPSHOT).params.sound).toBe('off')
  })
  it('음성 TTS: 목소리를 골라야 하고 dialogue 로 보낸다', () => {
    expect(() => planRequest({ model: 'seed_audio', prompt: '안녕하세요' }, SNAPSHOT)).toThrow('목소리')
    expect(planRequest({ model: 'seed_audio', prompt: '안녕하세요', options: { voice: 'v1' } }, SNAPSHOT)).toMatchObject({ tool: 'generate_audio', params: { model: 'seed_audio', prompt: '안녕하세요', voice_type: 'preset', voice_id: 'v1' } })
    const p = planRequest({ model: 'elevenlabs_v4_turbo', prompt: '안녕하세요', options: { voice: 'v1' } }, SNAPSHOT)
    expect(p).toMatchObject({ tool: 'generate_audio', params: { model: 'elevenlabs_v4_turbo', prompt: '안녕하세요', dialogue: [{ text: '안녕하세요', voice_type: 'preset', voice_id: 'v1' }] } })
    expect(planRequest({ model: 'text2speech_v2', prompt: '안녕', options: { voice: 'v1' } }, SNAPSHOT).params.variant).toBe('elevenlabs')
  })
  it('음악: 프롬프트·길이·보컬 없음', () => {
    const p = planRequest({ model: 'elevenlabs_music_v2_5', prompt: '밝은 피아노', options: { duration: 45, instrumental: true } }, SNAPSHOT)
    expect(p.params).toMatchObject({ prompt: '밝은 피아노', duration: 45, force_instrumental: true })
  })
  it('잘못된 값은 거른다', () => {
    expect(() => planRequest({ model: 'nope', prompt: 'x' }, SNAPSHOT)).toThrow('모델')
    expect(() => planRequest({ model: 'gpt_image_2', prompt: '  ' }, SNAPSHOT)).toThrow('적어')
    expect(planRequest({ model: 'gpt_image_2', prompt: 'x', refs: ['https://evil/x.png', ID] }, SNAPSHOT).params.medias).toEqual([{ role: 'image', value: ID }])
    expect(planRequest({ model: 'z_image', prompt: 'x', count: 9 }, SNAPSHOT).count).toBe(4)
  })
})

describe('결과·보관', () => {
  it('생성 결과에서 작업 번호, 상태 결과에서 원본 주소(미리보기 제외)', () => {
    expect(jobIds({ structuredContent: { results: [{ id: ID2, status: 'pending' }] } })).toEqual([ID2])
    const r = jobResult({ structuredContent: { generation: { status: 'completed', results: { rawUrl: 'https://cdn/x.png', minUrl: 'https://cdn/x_min.webp' } } } })
    expect(r).toEqual({ status: 'completed', urls: ['https://cdn/x.png'], error: null })
    expect(jobResult({ structuredContent: { generation: { status: 'in_progress' } } }).status).toBe('in_progress')
  })
  it('도구 오류를 한국어로', () => {
    expect(toolError({ isError: true, structuredContent: { error: 'Not enough credits' } })).toContain('크레딧')
    expect(toolError({ content: [] })).toBeNull()
  })
  it('확장자', () => {
    expect(extFor('image/jpeg', 'https://x/a', 'image')).toBe('jpg')
    expect(extFor(null, 'https://x/a.mp4?sig=1', 'video')).toBe('mp4')
    expect(extFor('application/octet-stream', 'https://x/a', 'audio')).toBe('mp3')
  })
  it('7일이 지나면 만료', () => {
    const now = Date.parse('2026-11-11T00:00:00Z')
    expect(isExpired({ createdAt: '2026-11-04T01:00:00Z' }, now)).toBe(false)
    expect(isExpired({ createdAt: '2026-11-03T23:00:00Z' }, now)).toBe(true)
    expect(daysLeft('2026-11-12T12:00:00Z', now)).toBe(2)
  })
  it('계정별 사용량: 용량·크레딧(30일 기록)', () => {
    const at = new Date().toISOString()
    const u = usageByOwner(
      [
        { owner: 'a', ownerName: '가', status: 'done', credits: 2, createdAt: at, items: [{ type: 'image', size: 100 }] },
        { owner: 'b', ownerName: '나', status: 'done', credits: 22.5, createdAt: at, items: [{ type: 'video', size: 5000 }] },
        { owner: 'a', ownerName: '가', status: 'failed', createdAt: at, items: [] },
      ],
      [{ owner: 'a', name: '가', credits: 2, at }, { owner: 'a', name: '가', credits: 5, at: '2020-01-01T00:00:00Z' }],
    )
    expect(u.map((x) => x.owner)).toEqual(['b', 'a'])
    expect(u[1]).toMatchObject({ jobs: 2, images: 1, failed: 1, bytes: 100, credits: 2, credits30: 2 })
  })
})

describe('화면 계산', () => {
  it('비율 이름', () => {
    expect(ratioLabel('4:3')).toBe('가로 4:3')
    expect(ratioLabel('9:16')).toBe('세로 9:16')
    expect(ratioLabel('1:1')).toBe('정사각 1:1')
    expect(ratioLabel('auto')).toBe('자동')
  })
  it('길이 단계', () => {
    expect(durationSteps(4, 15)).toEqual([4, 5, 6, 8, 10, 12, 15])
    expect(choices(M('veo3_1'), 'duration')).toEqual([4, 6, 8])
  })
  it('레퍼런스·프레임 칸', () => {
    expect(maxRefs(M('gpt_image_2'))).toBeGreaterThan(0)
    expect(maxRefs(M('elevenlabs_music_v2_5'))).toBe(0)
    expect(hasStartFrame(M('kling3_0'))).toBe(true)
    expect(hasEndFrame(M('kling3_0'))).toBe(true)
    expect(hasEndFrame(M('veo3_1'))).toBe(false)
  })
})
