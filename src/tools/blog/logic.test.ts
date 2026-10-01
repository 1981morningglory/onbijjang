import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BANNED, DEFAULT_CLEAN, activeBanned, cleanText, collapseBlankLines, countStats, findRanges, formatReadTime, highlightSegments, keywordReport, mergeLines, normalizeSpaces,
  parseKeywords, parseWordList, scanBanned, stripEmoji, toHashtags, visualWidth, wrapLine, wrapText,
  type CleanOptions,
} from './logic'

const OFF: CleanOptions = { mergeShortLines: false, wrap: false, wrapWidth: 18, collapseBlankLines: false, trimLineEnds: false, normalizeSpaces: false, removeEmoji: false }

describe('정리 옵션 하나씩', () => {
  it('아무 옵션도 켜지 않으면 줄바꿈 기호만 통일한다', () => {
    expect(cleanText('가 \r\n나\r다', OFF)).toBe('가 \n나\n다')
  })
  it('줄 끝 공백 제거', () => {
    expect(cleanText('가  \n나\t\n  다', { ...OFF, trimLineEnds: true })).toBe('가\n나\n  다')
  })
  it('전각·특수 공백 변환', () => {
    expect(normalizeSpaces('가　나 다​라﻿')).toBe('가 나 다라')
  })
  it('이모지 제거 뒤 겹친 공백 정리(상표 기호·숫자는 남긴다)', () => {
    expect(stripEmoji('좋아요 😀 정말 👍🏽')).toBe('좋아요 정말')
    expect(stripEmoji('✨신상✨ 입고')).toBe('신상 입고')
    expect(stripEmoji('가족 👨‍👩‍👧 사진 🇰🇷')).toBe('가족 사진')
    expect(stripEmoji('온비™ 1위  그대로')).toBe('온비™ 1위  그대로')
    expect(stripEmoji('1️⃣ 첫째')).toBe('1 첫째')
  })
  it('연속 빈 줄 줄이기', () => {
    expect(collapseBlankLines('\n\n가\n\n\n\n나\n \n\t\n다\n라\n\n')).toBe('가\n\n나\n\n다\n라')
  })
  it('짧은 줄 이어 붙이기: 문단 안에서만 잇는다', () => {
    expect(mergeLines('오늘은 날씨가\n  좋아서  \n산책을 했어요.\n\n두 번째\n문단')).toBe('오늘은 날씨가 좋아서 산책을 했어요.\n\n두 번째 문단')
  })
})

describe('어절 단위 줄바꿈', () => {
  it('너비 계산: 한글 1, 영문·숫자·공백 0.5', () => {
    expect(visualWidth('한글')).toBe(2)
    expect(visualWidth('ab 12')).toBe(2.5)
    expect(visualWidth('한a')).toBe(1.5)
  })
  it('어절을 자르지 않고 너비에 맞춘다', () => {
    expect(wrapLine('오늘은 날씨가 좋아서 산책을 했어요', 8)).toEqual(['오늘은 날씨가', '좋아서 산책을', '했어요'])
    expect(wrapLine('가나다라마바사아자차카타파하 끝', 8)).toEqual(['가나다라마바사아자차카타파하', '끝'])
    expect(wrapLine('   ', 8)).toEqual([''])
  })
  it('빈 줄(문단 구분)은 그대로 둔다', () => {
    expect(wrapText('오늘은 날씨가 좋아서 산책을 했어요\n\n끝', 8)).toBe('오늘은 날씨가\n좋아서 산책을\n했어요\n\n끝')
  })
  it('나눈 줄은 모두 너비 안에 들어온다(긴 어절 제외)', () => {
    const text = '블로그 글을 모바일에서 읽기 좋게 가운데 정렬로 짧게 끊어 쓰는 경우가 많습니다 ABC test 123'
    for (const width of [8, 12, 18, 30]) {
      for (const line of wrapText(text, width).split('\n')) expect(visualWidth(line)).toBeLessThanOrEqual(width)
    }
    expect(wrapText(text, 18).replace(/\n/g, ' ')).toBe(text)
  })
})

describe('cleanText 전체 흐름', () => {
  it('기본 옵션: 줄을 잇고 빈 줄을 줄인 뒤 너비에 맞춰 나눈다', () => {
    const source = '오늘 소개할 제품은  \n봄 신상 원피스예요.　가볍고\n시원합니다.\n\n\n\n두 번째 문단입니다.   \n'
    expect(cleanText(source, { ...DEFAULT_CLEAN, wrapWidth: 12 })).toBe('오늘 소개할 제품은 봄\n신상 원피스예요. 가볍고\n시원합니다.\n\n두 번째 문단입니다.')
  })
  it('원문 문자열은 바뀌지 않는다', () => {
    const source = '가  \n\n\n나 😀'
    const copy = source.slice()
    cleanText(source, { ...DEFAULT_CLEAN, removeEmoji: true })
    expect(source).toBe(copy)
  })
})

describe('글자 수', () => {
  it('공백 포함/제외, 줄, 문단, 읽기 시간', () => {
    const s = countStats('안녕 하세요\n반갑습니다\n\n둘째 문단')
    expect(s).toEqual({ withSpaces: 16, withoutSpaces: 14, lines: 3, paragraphs: 2, readSeconds: 2 })
  })
  it('빈 글', () => {
    expect(countStats('')).toEqual({ withSpaces: 0, withoutSpaces: 0, lines: 0, paragraphs: 0, readSeconds: 0 })
    expect(countStats(' \n \n')).toEqual({ withSpaces: 2, withoutSpaces: 0, lines: 0, paragraphs: 0, readSeconds: 0 })
  })
  it('이모지 한 개는 한 글자로 센다', () => {
    expect(countStats('👨‍👩‍👧가').withSpaces).toBe(2)
  })
  it('읽기 시간: 1분에 500자', () => {
    expect(countStats('가'.repeat(1000)).readSeconds).toBe(120)
    expect(formatReadTime(0)).toBe('0초')
    expect(formatReadTime(45)).toBe('약 45초')
    expect(formatReadTime(120)).toBe('약 2분')
    expect(formatReadTime(134)).toBe('약 2분 10초')
    expect(formatReadTime(178)).toBe('약 3분')
  })
})

describe('키워드·해시태그', () => {
  it('공백·쉼표·# 로 나누고 중복을 뺀다', () => {
    expect(parseKeywords('#봄원피스 #신상, 원피스，봄원피스\n  SALE sale ＃데일리룩')).toEqual({ keywords: ['봄원피스', '신상', '원피스', 'SALE', '데일리룩'], dropped: 0 })
    expect(parseKeywords(' , # ')).toEqual({ keywords: [], dropped: 0 })
  })
  it('최대 100개', () => {
    const r = parseKeywords(Array.from({ length: 130 }, (_, i) => `키워드${i}`).join(' '))
    expect(r.keywords).toHaveLength(100)
    expect(r.dropped).toBe(30)
  })
  it('해시태그로', () => {
    expect(toHashtags(['봄원피스', '신상'])).toBe('#봄원피스 #신상')
  })
  it('횟수와 많음/적음 표시', () => {
    const text = '원피스 추천! 봄 원피스는 역시 원피스. Sale 중인 SALE 상품'
    expect(keywordReport(text, ['원피스', 'sale', '가을'], 1, 2)).toEqual([
      { keyword: '원피스', count: 3, status: 'high' },
      { keyword: 'sale', count: 2, status: 'ok' },
      { keyword: '가을', count: 0, status: 'low' },
    ])
    expect(keywordReport(text, ['원피스'], 0, 0)[0].status).toBe('ok')
  })
  it('겹치지 않게 세고, 정규식 기호가 든 낱말도 글자 그대로 찾는다', () => {
    expect(findRanges('아아아아', '아아')).toEqual([[0, 2], [2, 4]])
    expect(findRanges('효과 100% 보장 (100%)', '100%')).toEqual([[3, 7], [12, 16]])
    expect(findRanges('a.b axb', 'a.b')).toEqual([[0, 3]])
    expect(findRanges('글', ' ')).toEqual([])
  })
})

describe('금칙어', () => {
  it('기본 목록은 20–40개이고 겹치는 낱말이 없다', () => {
    expect(DEFAULT_BANNED.length).toBeGreaterThanOrEqual(20)
    expect(DEFAULT_BANNED.length).toBeLessThanOrEqual(40)
    expect(new Set(DEFAULT_BANNED.map((b) => b.word)).size).toBe(DEFAULT_BANNED.length)
  })
  it('내 목록 입력은 쉼표·줄바꿈으로 나눈다(띄어쓰기는 유지)', () => {
    expect(parseWordList('강력 추천,  세일가\n강력  추천,,')).toEqual(['강력 추천', '세일가'])
  })
  it('끈 기본 낱말은 빼고 내 낱말을 더한다', () => {
    const list = activeBanned(['최고', '보장'], ['강력 추천', '완벽'])
    expect(list.some((b) => b.word === '최고')).toBe(false)
    expect(list.some((b) => b.word === '보장')).toBe(false)
    expect(list.filter((b) => b.word === '완벽')).toEqual([{ word: '완벽', group: '과장' }])
    expect(list.at(-1)).toEqual({ word: '강력 추천', group: '내 목록' })
    expect(list).toHaveLength(DEFAULT_BANNED.length - 2 + 1)
  })
  it('걸린 낱말과 횟수, 긴 낱말 우선', () => {
    const text = '원금 보장 상품! 효과도 보장하고 최고의 선택, 최고!'
    const scan = scanBanned(text, DEFAULT_BANNED)
    expect(scan.hits).toEqual([
      { word: '최고', group: '과장', count: 2 },
      { word: '보장', group: '보장', count: 1 },
      { word: '원금 보장', group: '보장', count: 1 },
    ])
    expect(scan.total).toBe(4)
    expect(scan.ranges.map(([s, e]) => text.slice(s, e))).toEqual(['원금 보장', '보장', '최고', '최고'])
  })
  it('줄바꿈으로 끊긴 두 낱말 표현도 찾는다', () => {
    expect(scanBanned('이 제품은 부작용\n없는 제품', DEFAULT_BANNED).hits).toEqual([{ word: '부작용 없', group: '의료·효능', count: 1 }])
  })
  it('걸린 것이 없으면 비어 있다', () => {
    expect(scanBanned('담백한 사용 후기입니다', DEFAULT_BANNED)).toEqual({ hits: [], ranges: [], total: 0 })
  })
})

describe('강조 조각', () => {
  it('금칙어가 키워드보다 우선이고, 조각을 이으면 원문이다', () => {
    const text = '최고급 원피스, 최고의 봄원피스'
    const scan = scanBanned(text, DEFAULT_BANNED)
    const segs = highlightSegments(text, ['원피스', '봄원피스', '최고급'], scan.ranges)
    expect(segs).toEqual([
      { text: '최고', kind: 'banned' },
      { text: '급 ', kind: 'plain' },
      { text: '원피스', kind: 'keyword' },
      { text: ', ', kind: 'plain' },
      { text: '최고', kind: 'banned' },
      { text: '의 ', kind: 'plain' },
      { text: '봄원피스', kind: 'keyword' },
    ])
    expect(segs.map((s) => s.text).join('')).toBe(text)
  })
  it('강조할 것이 없으면 통째로 한 조각', () => {
    expect(highlightSegments('그냥 글', [], [])).toEqual([{ text: '그냥 글', kind: 'plain' }])
    expect(highlightSegments('', ['가'], [])).toEqual([])
  })
})
