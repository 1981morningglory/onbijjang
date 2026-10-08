import { describe, expect, it } from 'vitest'
// 서버 쪽 순수 함수도 여기서 함께 확인한다
import { blogIdFromUrl, classifyGraphError, parseCount, parseIgOg, parseVisitors, summarizeIg } from '../../../server/lib/sns.mjs'
import { blogKey, guessKind, igKey, linesToApplicants, parseList } from './parse'
import { percentiles, rankBlog, rankIg, type BlogData, type IgData } from './score'

describe('인스타그램 주소 읽기', () => {
  it.each([
    ['https://www.instagram.com/elle__haus', 'elle__haus'],
    ['https://www.instagram.com/bbang22_rao_/', 'bbang22_rao_'],
    ['https://www.instagram.com/t._.y_bubu?igsi=NnA4NjNtNXJjOXY0&utm_source=qr', 't._.y_bubu'],
    ['www.instagram. com/j704755', 'j704755'],
    ['https://www.instagrram.com/slamnight0315', 'slamnight0315'],
    ['https://www.i nstagram.com/2wishtwo', '2wishtwo'],
    ['www//instargram.com/leedaeun_0528', 'leedaeun_0528'],
    ['https://www.instagram/hello.hi.home', 'hello.hi.home'],
    ['@nayoung12071', 'nayoung12071'],
    ['im_daisy_life', 'im_daisy_life'],
    ['instagram.com/Elle__Haus/', 'elle__haus'],
    ['https://www.instagram.con/vjfjadutl', 'vjfjadutl'],
    ['https://instagarm.com/hhhkkk5992', 'hhhkkk5992'],
    ['https://www.instagram.comyunhyijin9815', 'yunhyijin9815'],
    ['hytps://www.instagram.com:pongpong5440', 'pongpong5440'],
    ['인스타그램/ @ihyesug4179', 'ihyesug4179'],
    ['@luvsoyul.soi', 'luvsoyul.soi'],
    ['@instamom', 'instamom'],
    ['instagram_lover', 'instagram_lover'],
  ])('%s → %s', (input, out) => expect(igKey(input)).toBe(out))
  it.each(['https://www.instagram.com/', 'https://www.instagram.com/p/C9xyz/', 'kitttkk@naver.com', 'https://youtube.com/@happything11', '혀ㅕㅠㅍ', '12345'])('%s → 못 읽음', (input) => expect(igKey(input)).toBeNull())
})

describe('블로그 주소 읽기', () => {
  it.each([
    ['https://m.blog.naver.com/lovesome_sun0530', 'lovesome_sun0530'],
    ['https://blog.naver.com/freshday9656', 'freshday9656'],
    ['https://blog.naver.com/PostView.naver?blogId=treetravel&logNo=2234', 'treetravel'],
    ['https://m.blog.naver.com/PostView.naver?blogId=Abc_12&logNo=1', 'abc_12'],
    ['treetravel.blog.me', 'treetravel'],
    ['https://naver.me/5abcDEF', 'naverme:5abcDEF'],
    ['treetravel', 'treetravel'],
    ['https://blog.naver.co/heisenberg09', 'heisenberg09'],
    ['tooyou7848@naver.com', 'tooyou7848'],
    ['yunni901019@navercom', 'yunni901019'],
  ])('%s → %s', (input, out) => expect(blogKey(input)).toBe(out))
  it.each(['https://www.instagram.com/abc', 'abc@gmail.com', 'https://blog.naver.com/'])('%s → 못 읽음', (input) => expect(blogKey(input)).toBeNull())
  it('주소 종류 짐작', () => {
    expect(guessKind('www.instagram. com/j704755')).toBe('ig')
    expect(guessKind('https://m.blog.naver.com/x')).toBe('blog')
    expect(guessKind('@abc')).toBeNull()
  })
  it('같은 아이디는 한 번만 모으고 중복을 센다', () => {
    const p = parseList('blog', linesToApplicants('https://blog.naver.com/a1\nhttps://m.blog.naver.com/A1\n\nnot a url!\nb22'))
    expect([...p.keys.keys()]).toEqual(['a1', 'b22'])
    expect(p.duplicates).toBe(1)
    expect(p.invalid.map((x) => x.raw)).toEqual(['not a url!'])
  })
})

describe('서버: SNS 숫자 읽기', () => {
  it('숫자 표기', () => {
    expect(parseCount('1,205')).toBe(1205)
    expect(parseCount('12.5K')).toBe(12500)
    expect(parseCount('1.2M')).toBe(1200000)
    expect(parseCount('1.5만')).toBe(15000)
  })
  it('인스타그램 프로필 소개 문구', () => {
    const html = '<meta property="og:description" content="1,205 Followers, 2,505 Following, 198 Posts - See Instagram photos and videos from elle haus&#x1f3e1; (&#064;elle__haus)" />'
    expect(parseIgOg(html)).toEqual({ followers: 1205, following: 2505, posts: 198 })
    expect(parseIgOg('<html></html>')).toBeNull()
  })
  it('네이버 방문자 그래프', () => {
    const xml = '<visitorcnts><visitorcnt id="20261004" cnt="709" /><visitorcnt id="20261005" cnt="805" /></visitorcnts>'
    expect(parseVisitors(xml)).toEqual([
      { date: '2026-10-04', cnt: 709 },
      { date: '2026-10-05', cnt: 805 },
    ])
  })
  it('블로그 주소에서 아이디', () => {
    expect(blogIdFromUrl('https://m.blog.naver.com/treetravel?tab=1')).toBe('treetravel')
    expect(blogIdFromUrl('https://blog.naver.com/PostView.naver?blogId=abc&logNo=1')).toBe('abc')
  })
  it('Business Discovery 요약: 최근 10개 평균 반응, 최근 한 달 게시물', () => {
    const now = Date.parse('2026-10-08T00:00:00Z')
    const media = Array.from({ length: 12 }, (_, i) => ({ like_count: 100 + i, comments_count: 10, timestamp: new Date(now - i * 5 * 86400_000).toISOString(), media_product_type: i % 2 ? 'FEED' : 'REELS' }))
    const s = summarizeIg({ name: 'A', followers_count: 5000, follows_count: 10, media_count: 300, media: { data: media } }, now)
    expect(s.postsRead).toBe(10)
    expect(s.avgLikes).toBe(104.5)
    expect(s.avgComments).toBe(10)
    expect(s.avgEngagement).toBe(114.5)
    expect(s.posts30d).toBe(7) // 0,5,…,30일 전
    expect(s.reels).toBe(5)
  })
  it('Graph API 오류 구분', () => {
    expect(classifyGraphError(400, { error: { code: 4 } }).kind).toBe('rate')
    expect(classifyGraphError(400, { error: { code: 190, message: 'expired' } }).kind).toBe('token')
    expect(classifyGraphError(400, { error: { code: 110 } }).kind).toBe('personal')
  })
})

const ig = (followers: number | null, eng: number | null): IgData => ({ source: eng == null ? 'page' : 'api', name: '', followers, following: null, mediaCount: null, postsRead: eng == null ? 0 : 10, avgLikes: eng, avgComments: 0, avgEngagement: eng, hiddenLikes: false, reels: null, posts30d: null, lastPostAt: null })
const blog = (avgVisitors: number | null, neighbors: number | null): BlogData => ({ name: '', nick: '', visitors: [], avgVisitors, neighbors, totalVisitors: null, directory: '', powerBlog: false })

describe('순위', () => {
  it('백분위: 같은 값은 같은 자리', () => {
    expect(percentiles([10, 20, 20, 40])).toEqual([0, 0.5, 0.5, 1])
    expect(percentiles([7])).toEqual([1])
  })
  it('인스타그램: 팔로워 60 + 반응 40, 반응을 못 읽으면 팔로워로 대신', () => {
    const rows = rankIg([
      { key: 'a', data: ig(10000, 50) },
      { key: 'b', data: ig(2000, 400) },
      { key: 'c', data: ig(500, 10) },
      { key: 'd', data: ig(null, null) },
      { key: 'e', data: ig(800, null) },
    ])
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'e', 'c'])
    const a = rows.find((r) => r.key === 'a')!
    expect([a.followerScore, a.engagementScore, a.total]).toEqual([60, 20, 80])
    const e = rows.find((r) => r.key === 'e')!
    expect(e.substituted).toBe(true)
    expect(rows.find((r) => r.key === 'b')!.engagementRate).toBe(20)
  })
  it('블로그: 방문자 70 + 이웃 30', () => {
    const rows = rankBlog([
      { key: 'x', data: blog(500, 100) },
      { key: 'y', data: blog(100, 3000) },
      { key: 'z', data: blog(300, 50) },
    ])
    expect(rows.map((r) => [r.key, r.total])).toEqual([
      ['x', 85],
      ['z', 35],
      ['y', 30],
    ])
  })
})
