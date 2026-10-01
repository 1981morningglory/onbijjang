import { describe, expect, it } from 'vitest'
import { applyFirstSeconds, itemProblem, moveItemEdge } from './items'

const item = (duration: number, start = 0, end = duration) => ({ status: 'ready' as const, duration, start, end })

describe('영상 여러 개 변환 — 구간', () => {
  it('모두 처음 N초: 긴 영상은 N초, 짧은 영상은 전체', () => {
    expect(applyFirstSeconds(item(30, 4, 20), 5)).toMatchObject({ start: 0, end: 5 })
    expect(applyFirstSeconds(item(3.2, 1, 2), 5)).toMatchObject({ start: 0, end: 3.2 })
    expect(applyFirstSeconds(item(30), 0.5)).toMatchObject({ start: 0, end: 0.5 })
  })

  it('모두 처음 N초: 잘못된 값이면 전체 길이, 읽는 중인 영상은 그대로', () => {
    expect(applyFirstSeconds(item(12, 3, 4), NaN)).toMatchObject({ start: 0, end: 12 })
    const loading = { status: 'loading' as const, duration: 0, start: 0, end: 0 }
    expect(applyFirstSeconds(loading, 5)).toBe(loading)
  })

  it('시작·끝은 서로 넘지 못한다', () => {
    expect(moveItemEdge(item(10, 2, 5), 'start', 9).start).toBe(4.9)
    expect(moveItemEdge(item(10, 2, 5), 'end', 0).end).toBe(2.1)
    expect(moveItemEdge(item(10, 2, 5), 'end', 50).end).toBe(10)
    expect(moveItemEdge(item(10, 2, 5), 'start', -1).start).toBe(0)
    expect(moveItemEdge(item(10, 2, 5), 'start', NaN).start).toBe(2)
  })

  it('GIF·WebP 는 60초까지, MP4 는 제한 없음', () => {
    expect(itemProblem({ start: 0, end: 60 }, 'gif')).toBeNull()
    expect(itemProblem({ start: 0, end: 75 }, 'gif')).toContain('60초')
    expect(itemProblem({ start: 0, end: 75 }, 'webp')).toContain('WebP')
    expect(itemProblem({ start: 0, end: 3000 }, 'mp4')).toBeNull()
    expect(itemProblem({ start: 5, end: 5 }, 'mp4')).toContain('짧습니다')
  })
})
