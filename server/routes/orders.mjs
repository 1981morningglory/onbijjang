// 주문서 만들기(온비팀 전용) — 사방넷 주문서를 날짜·차수별로 저장하고, 고객·상품·주문으로 찾아본다.
//
// - 화면이 엑셀을 읽어 줄(사방넷 칸 이름 → 값)로 보낸다. 서버는 그대로 저장한다(사방넷에서 칸을 더 받아 오면 그 칸도 담긴다).
// - 같은 날짜는 올린 순서대로 1차, 2차, 3차…
// - 저장: 데이터 폴더 orders/batches/<id>.json(차수 하나), orders/products.json(쇼핑몰 상품명 → 우리 상품코드 기억).
// - 고객 이름·연락처·주소가 들어 있으므로 직원 계정(직원·스탭·관리자) 또는 이름에 ‘온비’가 들어간 팀 코드로 들어온 사람만 쓴다.
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

const ID_RE = /^[a-f0-9]{16}$/
const DATE_RE = /^20\d{2}-\d{2}-\d{2}$/
const MAX_ROWS = 5000
const MAX_RESULTS = 2000

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}
async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(value), 'utf8')
  await fsp.rename(tmp, file)
}

const str = (v) => (v == null ? '' : String(v).trim())
const digits = (v) => str(v).replace(/\D/g, '')

/** 줄 하나를 저장할 모양으로(칸 이름 80자, 값은 글자 1000자·숫자) */
function cleanRow(r) {
  const o = {}
  if (!r || typeof r !== 'object') return o
  for (const [k, v] of Object.entries(r).slice(0, 80)) {
    const key = String(k).slice(0, 80)
    if (v == null || v === '') o[key] = null
    else if (typeof v === 'number' && Number.isFinite(v)) o[key] = v
    else o[key] = String(v).slice(0, 1000)
  }
  return o
}

/** 검색 항목별로 볼 칸 */
const FIELDS = {
  person: ['주문자명', '수취인명'],
  phone: ['전화번호1', '전화번호2'],
  address: ['수취인주소'],
  product: ['상품코드', '상품명', '상품명(수집/삭제)', '옵션', '옵션(수집/삭제)'],
  orderNo: ['주문번호', '사방넷주문번호'],
  mall: ['쇼핑몰'],
  invoice: ['송장번호'],
}

export default async function ordersRoutes(app, ctx) {
  const { isAdmin, currentUser, DATA_DIR, TRUSTED } = ctx
  const DIR = path.join(DATA_DIR, 'orders')
  const batchFile = (id) => path.join(DIR, 'batches', `${id}.json`)
  const PRODUCTS = path.join(DIR, 'products.json')

  const batches = new Map()
  try {
    for (const f of await fsp.readdir(path.join(DIR, 'batches'))) {
      if (!f.endsWith('.json')) continue
      const b = await readJson(path.join(DIR, 'batches', f), null)
      if (b?.id) batches.set(b.id, b)
    }
  } catch {
    // 아직 없다
  }
  /** 쇼핑몰 상품명|옵션 → { code, name, option, warehouse } */
  let products = await readJson(PRODUCTS, {})

  // 차수 번호를 정할 때 두 사람이 동시에 올려도 겹치지 않게 줄 세운다
  let chain = Promise.resolve()
  const serial = (fn) => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => {})
    return next
  }

  async function allowed(req) {
    if (TRUSTED || isAdmin(req)) return true
    if (['member', 'staff', 'admin'].includes(currentUser?.(req)?.role)) return true
    const team = await ctx.sessionTeam?.(req)
    return Boolean(team && /온비/.test(team.name ?? ''))
  }
  async function requireAllowed(req, res, next) {
    if (await allowed(req)) return next()
    res.status(401).json({ error: '온비팀 전용입니다. 직원 계정으로 로그인하거나 온비팀 팀 코드로 들어와 주세요.' })
  }
  const who = (req) => currentUser?.(req)?.name ?? (isAdmin(req) ? '관리자' : '팀')

  const brief = (b) => ({ id: b.id, date: b.date, seq: b.seq, fileName: b.fileName, sheetName: b.sheetName, uploadedAt: b.uploadedAt, uploadedBy: b.uploadedBy, count: b.rows.length, qty: b.rows.reduce((s, r) => s + (Number(r['수량']) || 0), 0), invoices: b.rows.filter((r) => str(r['송장번호'])).length })
  const nextSeq = (date) => Math.max(0, ...[...batches.values()].filter((b) => b.date === date).map((b) => b.seq)) + 1

  /** 지난 주문서에서 상품코드 → 상품명·옵션(새 코드를 넣을 때 이름을 채워 준다) */
  function catalog() {
    const out = {}
    const list = [...batches.values()].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))
    for (const b of list) for (const r of b.rows) if (str(r['상품코드']) && str(r['상품명'])) out[str(r['상품코드'])] = { name: str(r['상품명']), option: str(r['옵션']) }
    for (const p of Object.values(products)) if (p.code && p.name) out[p.code] ??= { name: p.name, option: p.option ?? '' }
    return out
  }

  app.get('/api/orders/status', async (req, res) => {
    res.json({ allowed: await allowed(req) })
  })

  /** 이 날짜에 올리면 몇 차가 되는지 */
  app.get('/api/orders/next-seq', requireAllowed, (req, res) => {
    const date = String(req.query.date ?? '')
    if (!DATE_RE.test(date)) return res.status(400).json({ error: '날짜를 확인해 주세요.' })
    res.json({ seq: nextSeq(date) })
  })

  app.get('/api/orders/products', requireAllowed, (_req, res) => {
    res.json({ products, catalog: catalog() })
  })

  /** 주문서 한 차수 저장: { date, fileName, sheetName, cols, rows, mappings? } */
  app.post('/api/orders/batches', requireAllowed, async (req, res) => {
    const { date, fileName, sheetName, cols, rows, mappings } = req.body ?? {}
    if (!DATE_RE.test(String(date ?? ''))) return res.status(400).json({ error: '주문서 날짜를 확인해 주세요.' })
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: '주문이 없습니다.' })
    if (rows.length > MAX_ROWS) return res.status(400).json({ error: `한 번에 ${MAX_ROWS}줄까지 올릴 수 있습니다.` })
    try {
      const b = await serial(async () => {
        const batch = {
          id: crypto.randomBytes(8).toString('hex'),
          date,
          seq: nextSeq(date),
          fileName: str(fileName).slice(0, 200),
          sheetName: str(sheetName).slice(0, 100),
          cols: (Array.isArray(cols) ? cols : []).slice(0, 80).map((c) => str(c).slice(0, 80)),
          rows: rows.map(cleanRow),
          uploadedAt: new Date().toISOString(),
          uploadedBy: who(req),
        }
        await writeJson(batchFile(batch.id), batch)
        batches.set(batch.id, batch)
        // 사람이 맞춰 준 상품(쇼핑몰 상품명 → 우리 상품코드)을 기억해 다음에 자동으로 채운다
        if (Array.isArray(mappings) && mappings.length) {
          for (const m of mappings.slice(0, 500)) {
            const key = str(m?.key).slice(0, 600)
            if (!key || !str(m?.code)) continue
            products[key] = { code: str(m.code).slice(0, 60), name: str(m.name).slice(0, 200), option: str(m.option).slice(0, 100), warehouse: str(m.warehouse).slice(0, 60), at: batch.uploadedAt }
          }
          await writeJson(PRODUCTS, products)
        }
        return batch
      })
      res.json({ batch: brief(b) })
    } catch (err) {
      res.status(500).json({ error: `저장하지 못했습니다: ${err.message}` })
    }
  })

  /** 차수 목록: ?from=&to= */
  app.get('/api/orders/batches', requireAllowed, (req, res) => {
    const from = String(req.query.from ?? '')
    const to = String(req.query.to ?? '')
    const list = [...batches.values()]
      .filter((b) => (!DATE_RE.test(from) || b.date >= from) && (!DATE_RE.test(to) || b.date <= to))
      .sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq)
      .slice(0, 500)
      .map(brief)
    res.json({ batches: list })
  })

  app.get('/api/orders/batches/:id', requireAllowed, (req, res) => {
    const b = ID_RE.test(req.params.id) ? batches.get(req.params.id) : null
    if (!b) return res.status(404).json({ error: '없는 주문서입니다.' })
    res.json({ batch: { ...brief(b), cols: b.cols, rows: b.rows } })
  })

  /** 잘못 올린 차수 지우기(차수 번호는 다시 매기지 않는다 — 이미 보낸 파일 이름과 어긋나지 않게) */
  app.delete('/api/orders/batches/:id', requireAllowed, async (req, res) => {
    const b = ID_RE.test(req.params.id) ? batches.get(req.params.id) : null
    if (!b) return res.status(404).json({ error: '없는 주문서입니다.' })
    await serial(async () => {
      batches.delete(b.id)
      await fsp.rm(batchFile(b.id), { force: true })
    })
    res.json({ ok: true })
  })

  /**
   * 주문 찾기: ?q=&field=all|person|phone|address|product|orderNo|mall|invoice&from=&to=&mall=
   * 여러 낱말은 모두 들어간 줄만(띄어쓰기로 나눔). 전화번호는 숫자만 비교.
   */
  app.get('/api/orders/search', requireAllowed, (req, res) => {
    const q = str(req.query.q).slice(0, 200)
    const field = Object.hasOwn(FIELDS, String(req.query.field)) ? String(req.query.field) : 'all'
    const from = String(req.query.from ?? '')
    const to = String(req.query.to ?? '')
    const mall = str(req.query.mall)
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const hits = []
    let total = 0
    const list = [...batches.values()]
      .filter((b) => (!DATE_RE.test(from) || b.date >= from) && (!DATE_RE.test(to) || b.date <= to))
      .sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq)
    for (const b of list) {
      b.rows.forEach((r, i) => {
        if (mall && str(r['쇼핑몰']) !== mall) return
        if (words.length) {
          const keys = field === 'all' ? Object.keys(r) : FIELDS[field]
          const hay = keys.map((k) => str(r[k]).toLowerCase()).join('\n')
          const hayDigits = keys.map((k) => digits(r[k])).join('\n')
          const ok = words.every((w) => hay.includes(w) || (/\d/.test(w) && digits(w).length >= 3 && hayDigits.includes(digits(w))))
          if (!ok) return
        }
        total++
        if (hits.length < MAX_RESULTS) hits.push({ batchId: b.id, date: b.date, seq: b.seq, line: i + 1, row: r })
      })
    }
    const malls = [...new Set([...batches.values()].flatMap((b) => b.rows.map((r) => str(r['쇼핑몰']))).filter(Boolean))].sort()
    res.json({ total, hits, malls, limited: total > hits.length })
  })

  /**
   * 송장번호 넣기: items = [{ sabangNo?, orderNo?, invoice }] — 사방넷주문번호가 있으면 그것으로, 없으면 주문번호로 맞춘다.
   * 같은 주문번호의 여러 줄(상품 여러 개)에는 같은 송장번호가 들어간다.
   */
  app.post('/api/orders/invoices', requireAllowed, async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20000) : []
    const bySabang = new Map()
    const byOrder = new Map()
    for (const it of items) {
      const inv = str(it?.invoice).slice(0, 40)
      if (!inv) continue
      if (digits(it?.sabangNo)) bySabang.set(digits(it.sabangNo), inv)
      if (str(it?.orderNo)) byOrder.set(str(it.orderNo), inv)
    }
    let matched = 0
    const touched = new Set()
    for (const b of batches.values()) {
      for (const r of b.rows) {
        const inv = bySabang.get(digits(r['사방넷주문번호'])) ?? byOrder.get(str(r['주문번호']))
        if (!inv) continue
        if (r['송장번호'] !== inv) {
          r['송장번호'] = inv
          touched.add(b)
        }
        matched++
      }
    }
    await serial(async () => {
      for (const b of touched) {
        if (!b.cols.includes('송장번호')) b.cols.push('송장번호')
        await writeJson(batchFile(b.id), b)
      }
    })
    res.json({ matched, given: items.length })
  })
}
