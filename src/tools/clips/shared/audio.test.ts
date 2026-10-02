import { describe, expect, it } from 'vitest'
import { AUDIO_MAX_BYTES, AUDIO_MAX_SECONDS, audioLimitReason, planarBlock, sampleRange } from './audio'

describe('소리 담기', () => {
  it('큰 원본은 소리를 담지 않는다', () => {
    expect(audioLimitReason(10 * 1024 * 1024, 60)).toBeNull()
    expect(audioLimitReason(AUDIO_MAX_BYTES + 1, 60)).toContain('200MB')
    expect(audioLimitReason(1024, AUDIO_MAX_SECONDS + 1)).toContain('15분')
  })

  it('구간을 표본 위치로 바꾸고 범위를 넘지 않는다', () => {
    expect(sampleRange(48000, 480000, 1, 2.5)).toEqual({ from: 48000, to: 120000 })
    expect(sampleRange(48000, 100000, 1, 5)).toEqual({ from: 48000, to: 100000 })
    expect(sampleRange(48000, 100000, 9, 10)).toEqual({ from: 100000, to: 100000 })
    expect(sampleRange(44100, 441000, -1, 0.5)).toEqual({ from: 0, to: 22050 })
  })

  it('채널별 표본을 채널 순서대로 이어 붙인다', () => {
    const left = [1, 2, 3, 4, 5]
    const right = [10, 20, 30, 40, 50]
    expect(Array.from(planarBlock([left, right], 1, 3, 2))).toEqual([2, 3, 4, 20, 30, 40])
  })

  it('모노 원본을 2채널로 내보내면 양쪽에 같은 소리를 넣는다', () => {
    expect(Array.from(planarBlock([[1, 2, 3]], 0, 3, 2))).toEqual([1, 2, 3, 1, 2, 3])
  })

  it('3채널 이상이면 앞의 두 채널만 쓰고, 끝을 넘으면 0으로 채운다', () => {
    expect(Array.from(planarBlock([[1, 2], [3, 4], [5, 6]], 0, 2, 2))).toEqual([1, 2, 3, 4])
    expect(Array.from(planarBlock([[1, 2]], 1, 3, 1))).toEqual([2, 0, 0])
  })
})
