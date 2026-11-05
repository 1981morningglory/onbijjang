import { describe, expect, it } from 'vitest'
import { diceRanking, ladderResult, makeLadder, spinAngle, spinPick, tracePath } from './games'
import { backtest, chiSquare, comb, matchProb, nextDraw, popularity, recommend, seeded, shapeOf, TOTAL_COMBOS, type Draw } from './lotto'
import { dedupe, drawWinners, guessNameCol, guessPhoneCol, maskName, maskPhone, parsePasted, phoneKey, shuffle, withHeader } from './raffle'

describe('추첨 명단', () => {
  it('엑셀 복사(탭)·머리줄·번호 칸 찾기', () => {
    const r = parsePasted('이름\t연락처\t메모\n홍길동\t010-1234-5678\ta\n김철수\t01022223333\tb\n')
    expect(r.cols).toEqual(['이름', '연락처', '메모'])
    expect(r.rows).toHaveLength(2)
    expect(guessPhoneCol(r)).toBe(1)
    expect(guessNameCol(r, 1)).toBe(0)
  })
  it('머리줄 없이 ‘이름 번호’ 띄어 쓴 줄도', () => {
    const r = parsePasted('홍길동 010-1234-5678\n김철수 010 2222 3333\n이영희')
    expect(r.cols).toEqual(['칸1', '칸2'])
    expect(r.rows[0]).toEqual(['홍길동', '010-1234-5678'])
    expect(r.rows[1]).toEqual(['김철수', '010 2222 3333'])
    expect(r.rows[2]).toEqual(['이영희', ''])
    expect(guessPhoneCol(r)).toBe(1)
  })
  it('겹친 핸드폰번호는 위 줄만 남긴다(형식이 달라도)', () => {
    const r = withHeader([['이름', '휴대폰'], ['가', '010-1111-2222'], ['나', '010-3333-4444'], ['다', '01011112222'], ['라', '+82 10-3333-4444'], ['마', '']])
    const { entries, removed } = dedupe(r, 1)
    expect(entries.map((e) => e.cells[0])).toEqual(['가', '나', '마'])
    expect(removed.map((e) => [e.cells[0], e.keptLine])).toEqual([
      ['다', 1],
      ['라', 2],
    ])
    expect(phoneKey('+82 10-3333-4444')).toBe('01033334444')
  })
  it('등수 순서대로, 한 사람은 한 번만', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ line: i + 1, cells: [`p${i}`] }))
    const w = drawWinners(entries, [
      { name: '1등', count: 1 },
      { name: '2등', count: 3 },
      { name: '3등', count: 5 },
    ])
    expect(w.map((x) => x.prize)).toEqual(['1등', '2등', '2등', '2등', '3등', '3등', '3등', '3등', '3등'])
    expect(new Set(w.map((x) => x.entry.line)).size).toBe(9)
    expect(() => drawWinners(entries.slice(0, 3), [{ name: '1등', count: 4 }])).toThrow()
  })
  it('섞기는 고르게(대략)', () => {
    const first = new Array(4).fill(0)
    for (let i = 0; i < 4000; i++) first[shuffle([0, 1, 2, 3])[0]]++
    for (const c of first) expect(c).toBeGreaterThan(850)
  })
  it('가리기', () => {
    expect(maskPhone('010-1234-5678')).toBe('010-****-5678')
    expect(maskName('홍길동')).toBe('홍*동')
    expect(maskName('김철')).toBe('김*')
  })
})

describe('게임', () => {
  it('사다리: 도착이 겹치지 않고(한 사람씩), 모든 사이에 가로줄', () => {
    for (let n = 2; n <= 10; n++) {
      const l = makeLadder(n)
      expect(new Set(ladderResult(l)).size).toBe(n)
      for (let i = 0; i < n - 1; i++) expect(l.rungs.some((r) => r[i])).toBe(true)
      for (const row of l.rungs) for (let i = 1; i < row.length; i++) expect(row[i] && row[i - 1]).toBe(false)
      expect(tracePath(l, 0)).toHaveLength(l.levels + 1)
    }
  })
  it('룰렛: 무게대로 고르고, 바늘 아래에 그 칸이 오게 각도', () => {
    const slices = [
      { label: 'A', weight: 1 },
      { label: 'B', weight: 3 },
    ]
    const c = [0, 0]
    for (let i = 0; i < 4000; i++) c[spinPick(slices)]++
    expect(c[1] / 4000).toBeGreaterThan(0.7)
    for (const pick of [0, 1]) {
      const a = spinAngle(slices, pick, 123)
      expect(a).toBeGreaterThan(123 + 360 * 5)
      // 돌린 뒤 바늘(위, 0도)에 오는 바퀴 위치 = (360 - a mod 360)
      const at = (360 - (a % 360)) % 360
      const start = pick === 0 ? 0 : 90
      const end = pick === 0 ? 90 : 360
      expect(at).toBeGreaterThanOrEqual(start)
      expect(at).toBeLessThan(end)
    }
  })
  it('주사위: 합이 큰 순서, 동점은 다시 굴려 가린다', () => {
    const seq = [6, 6, 3, 4, 3, 4, 1, 1, 5, 6, 2, 2]
    let i = 0
    const roll = () => seq[i++]
    const r = diceRanking(['가', '나', '다', '라'], roll)
    // 가=12, 나=7, 다=7, 라=2 → 나·다 재굴림(5+6 vs 2+2)
    expect(r.map((x) => [x.name, x.rank])).toEqual([
      ['가', 1],
      ['나', 2],
      ['다', 3],
      ['라', 4],
    ])
    expect(r[1].rolls).toEqual([
      [3, 4],
      [5, 6],
    ])
  })
})

describe('로또', () => {
  // 시험용 가짜 회차(무작위)
  const rnd = seeded(7)
  const draws: Draw[] = Array.from({ length: 300 }, (_, i) => {
    const pool = Array.from({ length: 45 }, (_, k) => k + 1)
    const nums: number[] = []
    for (let k = 0; k < 7; k++) nums.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0])
    return { round: i + 1, date: '2020-01-01', numbers: nums.slice(0, 6).sort((a, b) => a - b), bonus: nums[6] }
  })
  it('조합 수·맞힐 확률', () => {
    expect(TOTAL_COMBOS).toBe(8145060)
    expect(comb(6, 3)).toBe(20)
    expect([0, 1, 2, 3, 4, 5, 6].reduce((s, k) => s + matchProb(k), 0)).toBeCloseTo(1, 10)
    expect(matchProb(6)).toBeCloseTo(1 / 8145060, 15)
  })
  it('모양: 합·홀짝·고저·AC·연속', () => {
    const s = shapeOf([1, 2, 3, 10, 30, 45])
    expect(s.sum).toBe(91)
    expect(s.odd).toBe(3)
    expect(s.high).toBe(2)
    expect(s.run).toBe(3)
    expect(s.consecutive).toBe(2)
    expect(shapeOf([1, 2, 3, 4, 5, 6]).ac).toBe(0)
  })
  it('무작위 자료는 카이제곱 검정에서 고르게 나온다', () => {
    expect(chiSquare(draws).p).toBeGreaterThan(0.01)
  })
  it('추천: 5게임, 서로 3개 이상 안 겹치고, 정해진 모양 안, 같은 씨앗이면 같은 결과', () => {
    const a = recommend(draws, { seed: 42, samples: 6000 })
    expect(a).toHaveLength(5)
    for (const p of a) {
      expect(new Set(p.numbers).size).toBe(6)
      expect(p.shape.odd).toBeGreaterThanOrEqual(2)
      expect(p.shape.odd).toBeLessThanOrEqual(4)
      expect(p.shape.ac).toBeGreaterThanOrEqual(7)
    }
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) expect(a[i].numbers.filter((n) => a[j].numbers.includes(n)).length).toBeLessThanOrEqual(2)
    for (let n = 1; n <= 45; n++) expect(a.filter((p) => p.numbers.includes(n)).length).toBeLessThanOrEqual(2)
    expect(recommend(draws, { seed: 42, samples: 6000 }).map((p) => p.numbers)).toEqual(a.map((p) => p.numbers))
  })
  it('인기 꼴 벌점', () => {
    expect(popularity([1, 5, 12, 18, 25, 31]).reasons).toContain('모두 31 이하(생일 번호)')
    expect(popularity([5, 10, 15, 20, 25, 30]).reasons).toContain('일정한 간격(등차)')
    expect(popularity([3, 14, 22, 33, 38, 44]).penalty).toBe(0)
  })
  it('되짚어 보기는 돌아가고, 다음 회차 날짜는 토요일', () => {
    const b = backtest(draws, 5)
    expect(b.games).toBe(25)
    expect(b.hits.reduce((s, v) => s + v, 0)).toBe(25)
    const n = nextDraw({ round: 1196, date: '', numbers: [], bonus: 0 })
    expect(n.round).toBe(1197)
    expect(new Date(n.date).getUTCDay()).toBe(6)
  })
})

describe('서버: 동행복권 응답 읽기', () => {
  it('새 주소·예전 주소·회차 계산', async () => {
    const { parseNew, parseOld, cleanDraw, expectedLatest } = await import('../../../server/routes/lotto.mjs')
    expect(parseNew({ data: { list: [{ ltEpsd: 1, ltRflYmd: '20021207', tm1WnNo: 10, tm2WnNo: 23, tm3WnNo: 29, tm4WnNo: 33, tm5WnNo: 37, tm6WnNo: 40, bnsWnNo: 16 }] } })).toEqual([
      { round: 1, date: '2002-12-07', numbers: [10, 23, 29, 33, 37, 40], bonus: 16 },
    ])
    expect(parseOld({ returnValue: 'success', drwNo: 1, drwNoDate: '2002-12-07', drwtNo1: 10, drwtNo2: 23, drwtNo3: 29, drwtNo4: 33, drwtNo5: 37, drwtNo6: 40, bnusNo: 16 })).toHaveLength(1)
    expect(parseOld({ returnValue: 'fail' })).toEqual([])
    expect(cleanDraw({ round: 2, numbers: [1, 1, 2, 3, 4, 5], bonus: 6 })).toBeNull()
    // 2026-11-05(목) 무렵 → 2026-10-31(토) 회차까지
    const r = expectedLatest(Date.UTC(2026, 10, 5))
    expect(r).toBe(Math.floor((Date.UTC(2026, 10, 5) - Date.UTC(2002, 11, 7, 11, 45) - 3600e3) / (7 * 86400e3)) + 1)
    expect(expectedLatest(Date.UTC(2002, 11, 7, 13, 0))).toBe(1)
    expect(expectedLatest(Date.UTC(2002, 11, 7, 11, 0))).toBe(0)
  })
})
