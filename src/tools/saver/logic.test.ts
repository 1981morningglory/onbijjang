import { describe, expect, it } from 'vitest'
// @ts-expect-error — 서버 모듈(.mjs)의 순수 함수도 함께 확인한다
import { checkUrl, filterSrt, friendlyError, keepRanges, srtToText } from '../../../server/routes/media.mjs'
import { extractUrl, fileNameFromTitle, formatTime, keptRanges, parseTime, siteOf, youtubeId } from './logic'

describe('시간 입력', () => {
  it('여러 표기를 초로', () => {
    expect(parseTime('83')).toBe(83)
    expect(parseTime('1:23')).toBe(83)
    expect(parseTime('01:02:03')).toBe(3723)
    expect(parseTime('1:23.5')).toBe(83.5)
    expect(parseTime('1분')).toBeNull()
  })
  it('초를 읽기 좋게', () => {
    expect(formatTime(83)).toBe('1:23')
    expect(formatTime(3723)).toBe('1:02:03')
  })
})

describe('구간 계산', () => {
  it('남기기: 겹치는 구간은 합친다', () => {
    expect(keptRanges('keep', [{ start: 10, end: 20 }, { start: 15, end: 30 }, { start: 40, end: 50 }], 60)).toEqual([[10, 30], [40, 50]])
  })
  it('잘라내기: 나머지가 남는다', () => {
    expect(keptRanges('cut', [{ start: 10, end: 20 }], 60)).toEqual([[0, 10], [20, 60]])
  })
  it('서버 계산과 같다', () => {
    const rs = [{ start: 5, end: 9 }, { start: 30, end: 35 }]
    expect(keepRanges('cut', rs, 40)).toEqual(keptRanges('cut', rs, 40))
  })
})

describe('링크', () => {
  it('사이트·유튜브 id·공유 문구', () => {
    expect(siteOf('https://youtu.be/abcdefg')).toBe('유튜브')
    expect(siteOf('https://www.tiktok.com/@a/video/1')).toBe('틱톡')
    expect(youtubeId('https://www.youtube.com/shorts/AbC_123xyz')).toBe('AbC_123xyz')
    expect(youtubeId('https://youtu.be/AbC_123xyz?t=3')).toBe('AbC_123xyz')
    expect(extractUrl('이 영상 보세요 https://youtu.be/x1y2z3 재밌어요')).toBe('https://youtu.be/x1y2z3')
  })
  it('서버: 내부망 주소는 받지 않는다', () => {
    expect(checkUrl('http://127.0.0.1/a').error).toBeTruthy()
    expect(checkUrl('http://10.0.0.5/a').error).toBeTruthy()
    expect(checkUrl('http://svc.railway.internal/a').error).toBeTruthy()
    expect(checkUrl('file:///etc/passwd').error).toBeTruthy()
    expect(checkUrl('https://youtu.be/abc').url).toBe('https://youtu.be/abc')
  })
})

describe('대본', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\n안녕하세요\n\n2\n00:00:03,000 --> 00:00:05,000\n안녕하세요\n반갑습니다\n\n3\n00:00:20,000 --> 00:00:22,000\n<i>끝</i>\n'
  it('자막을 대본으로(반복 줄 정리, 태그 제거)', () => {
    expect(srtToText(srt)).toBe('안녕하세요\n반갑습니다\n끝\n')
  })
  it('남길 구간의 자막만', () => {
    expect(filterSrt(srt, [[0, 6]])).not.toContain('끝')
  })
  it('오류를 사용자 말로', () => {
    expect(friendlyError("ERROR: [youtube] x: Sign in to confirm you're not a bot")).toContain('유튜브')
    expect(friendlyError('ERROR: Unsupported URL: https://a')).toContain('지원하지 않는')
  })
})

describe('파일 이름', () => {
  it('제목에서 군더더기를 뺀다', () => {
    expect(fileNameFromTitle("YENA(최예나) - '캐치 캐치' M/V")).toBe('YENA(최예나) 캐치 캐치')
    expect(fileNameFromTitle('Artist - Song (Official Music Video)')).toBe('Artist Song')
    expect(fileNameFromTitle('모닝글로리 신제품 소개 | 노트')).toBe('모닝글로리 신제품 소개 노트')
    expect(fileNameFromTitle('a/b:c?')).toBe('a b c')
    expect(fileNameFromTitle('')).toBe('영상')
  })
})

describe('음성 인식', () => {
  it('5분씩 끊어 인식하고 시간을 원본 기준으로 맞춘다', async () => {
    // @ts-expect-error — 서버 모듈
    const { transcribePcm, segmentsToSrt } = await import('../../../server/routes/asr.mjs')
    const calls: number[] = []
    const fake = async (pcm: Float32Array) => {
      calls.push(pcm.length / 16000)
      return { text: '', chunks: [{ timestamp: [1, 3], text: ' 안녕하세요 ' }, { timestamp: [3, 4], text: '안녕하세요' }, { timestamp: [10, null], text: '끝' }] }
    }
    const progress: number[] = []
    const segs = await transcribePcm(new Float32Array(16000 * 400), { offset: 60, transcriber: fake, onProgress: (f: number) => progress.push(f) })
    expect(calls).toEqual([300, 100])
    expect(segs[0]).toEqual({ start: 61, end: 64, text: '안녕하세요' })
    expect(segs[1]).toEqual({ start: 70, end: 360, text: '끝' })
    expect(segs[3].end).toBe(460)
    expect(progress.at(-1)).toBe(1)
    expect(segmentsToSrt(segs.slice(0, 1))).toBe('1\n00:01:01,000 --> 00:01:04,000\n안녕하세요\n')
  })
})
