import { describe, expect, it } from 'vitest'
// 서버 쪽 순수 함수도 여기서 함께 확인한다
import { blogIdFromUrl, classifyGraphError, parseCount, parseIgOg, parseVisitors, summarizeIg } from '../../../server/lib/sns.mjs'
import { blogKey, guessKind, igKey, linesToApplicants, parseList, type Applicant } from './parse'
import { aiPatch, breakdownText, buildCandidate, completedVisitors, followerScore, motiveKeywords, rankCandidates, recommend, suggestMotive, visitorScore, type BlogData, type IgData, type JobItem } from './score'

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
    expect(parseIgOg(html)).toEqual({ followers: 1205, followersRaw: '1,205', followersApprox: false, following: 2505, posts: 198 })
    expect(parseIgOg('<meta property="og:description" content="12.5K Followers, 10 Following, 3 Posts" />')).toMatchObject({ followers: 12500, followersRaw: '12.5K', followersApprox: true })
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
    expect(classifyGraphError(400, { error: { code: 100, error_subcode: 2207013, message: 'x' } }).kind).toBe('personal')
    // 필드 이름이 틀린 것 같은 일반 오류는 '개인 계정'으로 숨기지 않는다
    expect(classifyGraphError(400, { error: { code: 100, message: 'Tried accessing nonexisting field' } }).kind).toBe('fail')
  })
})

const igData = (followers: number | null, raw?: string): IgData => ({ source: 'api', name: '', followers, followersRaw: raw ?? (followers == null ? '' : String(followers)), followersApprox: Boolean(raw && /[kKmM만천]/.test(raw)), following: null, mediaCount: null, lastPostAt: null })
const blogData = (days: Array<[string, number]>): BlogData => ({ name: '', nick: '', visitors: days.map(([date, cnt]) => ({ date, cnt })), avgVisitors: null, neighbors: null, totalVisitors: null, directory: '', powerBlog: false })
const item = (kind: 'ig' | 'blog', key: string, data: IgData | BlogData, at = '2026-10-12T03:00:00Z'): JobItem => ({ kind, key, state: 'done', data, at })
const person = (row: number, at: string, motive = '모닝글로리 화장지 써 보고 싶어요'): Applicant => ({ row, raw: '', name: `지원자${row}`, submittedAt: at, motive })

describe('가이드 점수: 구간', () => {
  it.each([
    [null, null],
    [0, 0],
    [999, 8],
    [1000, 16],
    [2999, 16],
    [3000, 24],
    [4999, 24],
    [5000, 32],
    [9999, 32],
    [10000, 40],
  ])('팔로워 %s → %s점', (n, s) => expect(followerScore(n)).toBe(s))
  it.each([
    [null, null],
    [0, 0],
    [99.9, 6],
    [100, 12],
    [299, 12],
    [300, 18],
    [500, 24],
    [999, 24],
    [1000, 30],
  ])('방문자 평균 %s → %s점', (n, s) => expect(visitorScore(n)).toBe(s))
  it('블로그 방문자: 오늘(읽은 날, 한국 날짜)을 빼고 완료된 날 평균, 공개 안 되면 미공개', () => {
    const d = blogData([
      ['2026-10-08', 100],
      ['2026-10-09', 200],
      ['2026-10-10', 300],
      ['2026-10-11', 400],
      ['2026-10-12', 5],
    ])
    expect(completedVisitors(d, '2026-10-12T03:00:00Z')).toEqual({ days: d.visitors.slice(0, 4), avg: 250 })
    expect(completedVisitors(blogData([]), '2026-10-12T03:00:00Z').avg).toBeNull()
  })
})

describe('가이드 점수: 미확인·총점·순위', () => {
  it('미확인 항목이 있으면 총점·정식 순위 없이 소계/확인 배점만', () => {
    const c = buildCandidate('ig', 'a', item('ig', 'a', igData(4000)), [person(2, '2026-09-30 10:00:00')], { fit: 20 })
    expect(c.scores).toEqual({ base: 24, fit: 20, review: null, motive: expect.any(Number) })
    expect(c.status).toBe('partial')
    expect(c.total).toBeNull()
    expect(c.confirmedMax).toBe(80)
    expect(c.missing).toEqual(['리뷰 표현력'])
  })
  it('지원동기 칸이 없는 작업이면 동기는 미확인(0점으로 만들지 않음), 비어 있는 동기는 0점', () => {
    expect(buildCandidate('ig', 'a', item('ig', 'a', igData(10)), [{ row: 2, raw: '' }]).scores.motive).toBeNull()
    expect(buildCandidate('ig', 'a', item('ig', 'a', igData(10)), [{ ...person(2, ''), motive: '' }]).scores.motive).toBe(0)
  })
  it('축약 표기는 원문·근사값을 함께 남긴다', () => {
    const c = buildCandidate('ig', 'a', item('ig', 'a', igData(12000, '1.2만')), [])
    expect([c.followers, c.followersRaw, c.followersApprox, c.scores.base]).toEqual([12000, '1.2만', true, 40])
  })
  it('같은 계정 중복 지원: 가장 먼저 접수된 신청서가 대표', () => {
    const c = buildCandidate('ig', 'a', item('ig', 'a', igData(10)), [person(9, '2026-10-01 09:00:00'), person(3, '2026-09-30 18:00:00')])
    expect(c.rep?.row).toBe(3)
    expect(c.dupes.map((d) => d.row)).toEqual([9])
  })
  it('인스타그램 동점: 적합성 → 표현력 → 동기 → 팔로워 → 접수 순서', () => {
    const full = (key: string, followers: number, fit: number, review: number, motive: number, row: number) =>
      buildCandidate('ig', key, item('ig', key, igData(followers)), [person(row, `2026-09-30 1${row}:00:00`)], { fit, review, motive })
    const ranked = rankCandidates([
      full('low', 500, 10, 10, 10, 1), // 8+10+10+10 = 38
      full('b', 3000, 20, 10, 10, 2), // 24+20+10+10 = 64
      full('a', 3000, 25, 5, 10, 3), // 24+25+5+10 = 64 → 적합성이 높아 먼저
      full('c', 4000, 25, 5, 10, 4), // a 와 항목 점수가 같음 → 팔로워가 많아 a 보다 먼저
      full('d', 3000, 25, 5, 10, 0), // a 와 모두 같음 → 접수가 빨라 a 보다 먼저
    ])
    expect(ranked.map((c) => [c.key, c.rank, c.total])).toEqual([
      ['c', 1, 64],
      ['d', 2, 64],
      ['a', 3, 64],
      ['b', 4, 64],
      ['low', 5, 38],
    ])
  })
  it('추천: 평가 완료자만, 부족하면 이유 · 블로그는 방문자 미확인 후보로 조건부 추천', () => {
    const done = buildCandidate('blog', 'ok', item('blog', 'ok', blogData([['2026-10-10', 600], ['2026-10-11', 400]])), [person(2, '2026-09-30 10:00:00')], { fit: 20, review: 20, motive: 10 })
    const hidden = buildCandidate('blog', 'hid', item('blog', 'hid', blogData([])), [person(3, '2026-09-30 11:00:00')], { fit: 25, review: 30, motive: 15 })
    const partial = buildCandidate('blog', 'part', item('blog', 'part', blogData([['2026-10-11', 50]])), [person(4, '2026-09-30 12:00:00')], { fit: 10 })
    expect(done.total).toBe(24 + 20 + 20 + 10)
    expect(hidden.visitorsHidden).toBe(true)
    const ranked = rankCandidates([partial, hidden, done])
    const r = recommend('blog', ranked, 2)
    expect(r.picked.map((c) => c.key)).toEqual(['ok'])
    expect(r.shortfall).toBe(1)
    expect(r.visitorUnknown.map((c) => [c.key, c.subtotal])).toEqual([['hid', 70]])
    expect(r.conditional.map((c) => c.key)).toEqual(['hid'])
  })
  it('보류 표시는 평가 완료로 치지 않는다', () => {
    const c = buildCandidate('ig', 'a', item('ig', 'a', igData(10)), [person(2, 'x')], { fit: 1, review: 1, motive: 1, hold: true })
    expect([c.status, c.total]).toEqual(['hold', null])
  })
})

describe('지원동기', () => {
  it('키워드와 자동 판단(근거만큼 점수)', () => {
    const t = '아이 키우는 엄마라 화장지를 많이 써요. 먼지 안 나는 도톰한 휴지를 찾고 있어서 직접 써 보고 사진과 함께 솔직한 후기를 블로그에 남기겠습니다. 가족 모두 만족하면 계속 쓰고 싶어요.'
    expect(motiveKeywords(t)).toEqual(['화장지', '아이', '사진', '먼지', '엄마', '솔직'])
    expect(suggestMotive(t).score).toBe(15)
    expect(suggestMotive('').score).toBe(0)
    expect(suggestMotive('좋아요').score).toBe(3)
  })
  it('AI 채점이 있으면 적용하지 않아도 그 점수를 쓰고, 담당자 점수가 가장 앞선다', () => {
    const ai = { motive: { score: 11, reason: '', keywords: ['5겹', '육아'], breakdown: { product: 4, life: 3, plan: 2, sincerity: 2 } }, fit: { score: 20, reason: '' } }
    const c = buildCandidate('ig', 'a', item('ig', 'a', igData(10)), [{ ...person(2, ''), motive: '좋아요' }], { ai })
    expect([c.scores.motive, c.motiveSource, c.motiveAuto, c.keywords]).toEqual([11, 'ai', true, ['5겹', '육아']])
    expect(c.scores.fit).toBeNull()
    expect(breakdownText(ai.motive.breakdown)).toBe('제품관심 4/4 · 생활맥락 3/3 · 리뷰계획 2/4 · 진정성 2/4')
    expect(aiPatch(c)).toEqual({ fit: 20, aiApplied: true })
    const s = buildCandidate('ig', 'a', item('ig', 'a', igData(10)), [{ ...person(2, ''), motive: '좋아요' }], { ai, motive: 5 })
    expect([s.scores.motive, s.motiveSource]).toEqual([5, 'staff'])
    const f = buildCandidate('ig', 'a', item('ig', 'a', igData(10)), [{ ...person(2, ''), motive: '좋아요' }], { ai: { error: '실패' } })
    expect([f.scores.motive, f.motiveSource]).toEqual([3, 'auto'])
  })
})

describe('신청서의 리뷰 게시물 링크', () => {
  it('리뷰 링크 칸을 SNS 주소 칸으로 잘못 고르지 않고 따로 읽는다', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('설문')
    ws.addRow(['응답일시', '성함', '최근 제품 리뷰 게시물 링크', 'SNS주소', '지원동기'])
    ws.addRow(['2026-10-01 10:00:00', '가', 'https://www.instagram.com/p/DAbc123xyz/', 'https://www.instagram.com/aaa_1', '써 보고 싶어요'])
    ws.addRow(['2026-10-01 11:00:00', '나', '', 'https://blog.naver.com/bbb', ''])
    const buf = await wb.xlsx.writeBuffer()
    const { readApplicantsXlsx } = await import('./parse')
    const r = await readApplicantsXlsx(new File([buf], 'a.xlsx'))
    expect(r.ig.map((p) => [p.raw, p.reviewLink, p.motive])).toEqual([['https://www.instagram.com/aaa_1', 'https://www.instagram.com/p/DAbc123xyz/', '써 보고 싶어요']])
    expect(r.blog.map((p) => [p.raw, p.reviewLink])).toEqual([['https://blog.naver.com/bbb', '']])
  })
  it('게시물 주소만 읽고, 이미 본 게시물이나 다른 주소는 다시 읽지 않는다', async () => {
    const { igPostUrl, withReviewLink } = await import('../../../server/lib/ai.mjs' as string)
    expect(igPostUrl('instagram.com/reel/Cxyz12345?igsh=1')).toBe('https://www.instagram.com/reel/Cxyz12345/')
    expect(igPostUrl('https://www.instagram.com/someone/p/ABCDE12/')).toBe('https://www.instagram.com/p/ABCDE12/')
    expect(igPostUrl('https://www.instagram.com/someone')).toBeNull()
    const ev = { text: '1. 2026-10-01 IMAGE https://www.instagram.com/p/ABCDE12/', images: [], imageUrls: [] }
    expect(await withReviewLink(ev, 'https://instagram.com/p/ABCDE12')).toBe(ev)
    expect(await withReviewLink(ev, '')).toBe(ev)
    const other = await withReviewLink(ev, 'https://blog.naver.com/x/1')
    expect(other.text).toContain('인스타그램 게시물 주소가 아니라 읽지 않음')
  })
})

describe('이상한 주소 보정', () => {
  it.each([
    ['https://www.instagram.com/p/DBgbPZZTbnZ/?igsh=bTI2emNxMDN4em44', 'igpost:DBgbPZZTbnZ'],
    ['https://www.instagram.com/someone/reel/Dd5udkIpH-W/', 'igpost:Dd5udkIpH-W'],
    ['https://www.threads.com/@_choi.mimi?igshid=NTc4MTIwNjQ2YQ==', '_choi.mimi'],
    ['baby,jiwon_0', 'baby.jiwon_0'],
    ['https://www.instagram.com/10001001.0', '10001001.0'],
    ['https://instagram.com/21.3.30', '21.3.30'],
    ['https://www.instagram.com/elle__haus', 'elle__haus'],
  ])('%s → %s', async (input, out) => {
    const { igKeyInfo } = await import('./parse')
    expect(igKeyInfo(input)?.key).toBe(out)
  })
  it.each(['https://www.instagram.com/', 'kitttkk@naver.com', '혀ㅕㅠㅍ', '12345', 'https://youtube.com/@happything11'])('%s → 못 읽음', async (input) => {
    const { igKeyInfo } = await import('./parse')
    expect(igKeyInfo(input)).toBeNull()
  })
  it('스레드는 인스타그램으로, 고친 내용과 게시물 링크를 남긴다', () => {
    expect(guessKind('https://www.threads.com/@seonwoo.im')).toBe('ig')
    const r = parseList('ig', [{ row: 2, raw: 'https://www.instagram.com/p/DTeiev6D1A4/?igsh=x' }, { row: 3, raw: 'baby,jiwon_0' }])
    const post = r.keys.get('igpost:DTeiev6D1A4')?.[0]
    expect([post?.fixed?.startsWith('계정 대신 게시물'), post?.reviewLink]).toEqual([true, 'https://www.instagram.com/p/DTeiev6D1A4/'])
    expect(r.keys.get('baby.jiwon_0')?.[0].fixed).toContain('쉼표')
  })
  it('게시물 미리보기에서 주인 아이디를 찾는다', async () => {
    const { igPostOwner } = await import('../../../server/lib/sns.mjs')
    expect(igPostOwner('<meta property="og:description" content="12 likes, 3 comments - Baby.Jiwon_0 on October 1, 2026: &quot;휴지&quot;" />')).toBe('baby.jiwon_0')
    expect(igPostOwner('<html></html>')).toBeNull()
  })
})
