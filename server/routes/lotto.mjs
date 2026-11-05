// 로또 6/45 당첨번호 — 동행복권에서 1회부터 받아 데이터 폴더(lotto/draws.json)에 쌓는다.
//
// - 화면이 목록을 부르면, 비어 있는 회차가 있을 때 서버가 뒤에서 이어 받는다(이미 받은 회차는 다시 받지 않음).
// - 새 주소(lt645/selectPstLt645InfoNew.do)를 먼저, 안 되면 예전 주소(common.do?method=getLottoNumber)로.
// - 동행복권에 닿지 못하면 스탭이 동행복권 ‘회차별 당첨번호’ 엑셀을 올려 채울 수 있다.
import fsp from 'node:fs/promises'
import path from 'node:path'

const NEW_URL = 'https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do'
const OLD_URL = 'https://www.dhlottery.co.kr/common.do'
const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  referer: 'https://www.dhlottery.co.kr/',
}
/** 1회 추첨: 2002-12-07(토) 20:45 무렵(한국 시간) */
const FIRST_DRAW_KST = Date.UTC(2002, 11, 7, 11, 45)

/** 지금(한국 시간)까지 추첨이 끝났을 마지막 회차(추첨 뒤 1시간 여유) */
export function expectedLatest(now = Date.now()) {
  return Math.max(0, Math.floor((now - FIRST_DRAW_KST - 3600e3) / (7 * 86400e3)) + 1)
}

const ymd = (v) => {
  const s = String(v ?? '').replace(/\D/g, '')
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : String(v ?? '').slice(0, 10)
}
/** 한 회차 값이 맞는지 보고 정리(번호 6개 1~45 서로 다름 + 보너스) */
export function cleanDraw(d) {
  const round = Number(d?.round)
  const numbers = (Array.isArray(d?.numbers) ? d.numbers : []).map(Number).sort((a, b) => a - b)
  const bonus = Number(d?.bonus)
  const ok = Number.isInteger(round) && round > 0 && numbers.length === 6 && new Set([...numbers, bonus]).size === 7 && [...numbers, bonus].every((n) => Number.isInteger(n) && n >= 1 && n <= 45)
  return ok ? { round, date: ymd(d.date), numbers, bonus } : null
}
/** 새 주소 응답(data.list[]) → 회차들 */
export function parseNew(payload) {
  const list = payload?.data?.list
  if (!Array.isArray(list)) return []
  return list
    .map((x) => cleanDraw({ round: x.ltEpsd, date: x.ltRflYmd, numbers: [x.tm1WnNo, x.tm2WnNo, x.tm3WnNo, x.tm4WnNo, x.tm5WnNo, x.tm6WnNo], bonus: x.bnsWnNo }))
    .filter(Boolean)
}
/** 예전 주소 응답 → 회차 하나 */
export function parseOld(payload) {
  if (payload?.returnValue !== 'success') return []
  const d = cleanDraw({ round: payload.drwNo, date: payload.drwNoDate, numbers: [1, 2, 3, 4, 5, 6].map((i) => payload[`drwtNo${i}`]), bonus: payload.bnusNo })
  return d ? [d] : []
}

export default async function lottoRoutes(app, ctx) {
  const { requireStaff, DATA_DIR } = ctx
  const FILE = path.join(DATA_DIR, 'lotto', 'draws.json')
  /** 회차 → { round, date, numbers, bonus } */
  const draws = new Map()
  let meta = { lastSyncAt: null, lastError: null, source: null }
  try {
    const saved = JSON.parse(await fsp.readFile(FILE, 'utf8'))
    for (const d of saved.draws ?? []) {
      const c = cleanDraw(d)
      if (c) draws.set(c.round, c)
    }
    meta = { ...meta, ...(saved.meta ?? {}) }
  } catch {
    // 아직 없다
  }
  const save = async () => {
    await fsp.mkdir(path.dirname(FILE), { recursive: true })
    const tmp = `${FILE}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify({ meta, draws: [...draws.values()].sort((a, b) => a.round - b.round) }), 'utf8')
    await fsp.rename(tmp, FILE)
  }

  const getJson = async (url) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    try {
      const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const text = await r.text()
      try {
        return JSON.parse(text)
      } catch {
        throw new Error('JSON 이 아닌 응답(점검·차단 화면일 수 있음)')
      }
    } finally {
      clearTimeout(t)
    }
  }
  /** 한 회차 받기(새 주소 → 예전 주소). 함께 온 이웃 회차도 돌려준다 */
  const fetchRound = async (round) => {
    let err
    try {
      const got = parseNew(await getJson(`${NEW_URL}?srchDir=center&srchLtEpsd=${round}`))
      if (got.some((d) => d.round === round)) return { got, source: 'new' }
    } catch (e) {
      err = e
    }
    try {
      const got = parseOld(await getJson(`${OLD_URL}?method=getLottoNumber&drwNo=${round}`))
      if (got.length) return { got, source: 'old' }
    } catch (e) {
      err = e
    }
    throw err ?? new Error(`${round}회 결과가 없습니다`)
  }

  let syncing = null
  const missing = () => {
    const out = []
    for (let r = 1; r <= expectedLatest(); r++) if (!draws.has(r)) out.push(r)
    return out
  }
  /** 비어 있는 회차를 이어 받는다(동시에 한 번만) */
  function sync() {
    if (syncing) return syncing
    syncing = (async () => {
      const todo = missing()
      let fails = 0
      let n = 0
      for (let i = 0; i < todo.length && fails < 5; ) {
        // 세 개씩 함께, 이미 이웃으로 받은 회차는 건너뛴다
        const batch = todo.slice(i, i + 3).filter((r) => !draws.has(r))
        i += 3
        const results = await Promise.allSettled(batch.map(fetchRound))
        for (const r of results) {
          if (r.status === 'fulfilled') {
            for (const d of r.value.got) draws.set(d.round, d)
            meta.source = r.value.source
            fails = 0
          } else {
            fails++
            meta.lastError = String(r.reason?.message ?? r.reason).slice(0, 200)
          }
        }
        if (++n % 15 === 0) await save()
        await new Promise((res) => setTimeout(res, 120))
      }
      if (fails < 5) meta.lastError = null
      meta.lastSyncAt = new Date().toISOString()
      await save()
    })().finally(() => {
      syncing = null
    })
    return syncing
  }
  const needSync = () => !syncing && missing().length > 0 && (!meta.lastSyncAt || Date.now() - new Date(meta.lastSyncAt).getTime() > 10 * 60e3)
  // 서버가 켜지면 한 번 이어 받는다
  if (process.env.NODE_ENV !== 'test') setTimeout(() => needSync() && sync().catch(() => {}), 5000)

  const body = () => ({
    draws: [...draws.values()].sort((a, b) => a.round - b.round),
    expectedLatest: expectedLatest(),
    missing: missing().length,
    syncing: Boolean(syncing),
    lastSyncAt: meta.lastSyncAt,
    lastError: meta.lastError,
  })

  app.get('/api/lotto', (_req, res) => {
    if (needSync()) sync().catch(() => {})
    res.json(body())
  })
  /** 지금 다시 받기(스탭 이상) */
  app.post('/api/lotto/sync', requireStaff, async (_req, res) => {
    meta.lastSyncAt = null
    sync().catch(() => {})
    res.json(body())
  })
  /** 엑셀에서 읽은 회차 넣기(스탭 이상): { draws: [{ round, date, numbers, bonus }] } */
  app.post('/api/lotto/import', requireStaff, async (req, res) => {
    const list = (Array.isArray(req.body?.draws) ? req.body.draws : []).slice(0, 5000).map(cleanDraw).filter(Boolean)
    if (!list.length) return res.status(400).json({ error: '회차·번호 6개·보너스를 읽지 못했습니다.' })
    for (const d of list) draws.set(d.round, d)
    meta.source = meta.source ?? 'excel'
    await save()
    res.json({ added: list.length, ...body() })
  })
}
