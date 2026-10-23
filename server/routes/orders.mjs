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
/** 담당자가 적는 비고(CS내용) 칸 이름 · 마지막으로 적은 사람·시각 · 취소내용 */
const CS_COL = '비고(CS내용)'
const CS_BY = 'CS수정자'
const CS_AT = 'CS수정시각'
const CANCEL_COL = '취소내용'
const CANCEL_STATES = ['', '취소요청', '취소완료']
/** 센터주문서 양식 판 — 화면에 같이 보여 배포가 반영됐는지 알 수 있게 */
const CENTER_FORM = '센터주문서 v12(제주는 핫트랙스·텐바이텐만 [제주도])'
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
/** 결제금액 칸(사방넷에서 받아 올 때 넣었으면): 결제금액·주문금액·총금액·판매금액 */
const AMOUNT_RE = /결제\s*금액|주문\s*금액|총\s*금액|판매\s*금액|결제액/
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(str(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const digits = (v) => str(v).replace(/\D/g, '')

/** 센터주문서 순서 { order: 줄 번호(1부터)를 NO 순서로, pageEnds: 쪽마다 마지막 NO } — 맞지 않으면 null(화면이 다시 계산) */
function cleanCenter(c, n) {
  if (!c || !Array.isArray(c.order) || !Array.isArray(c.pageEnds) || c.order.length !== n) return null
  const order = c.order.map(Number)
  const pageEnds = c.pageEnds.slice(0, n).map(Number)
  if (new Set(order).size !== n || !order.every((x) => Number.isInteger(x) && x >= 1 && x <= n)) return null
  if (pageEnds.at(-1) !== n || !pageEnds.every((x, i) => Number.isInteger(x) && x >= 1 && x > (pageEnds[i - 1] ?? 0))) return null
  return { order, pageEnds }
}

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
  orderNo: ['주문번호', '사방넷주문번호', '원주문번호'],
  mall: ['쇼핑몰'],
  invoice: ['송장번호'],
}

export default async function ordersRoutes(app, ctx) {
  const { isAdmin, isStaff, requireStaff, currentUser, DATA_DIR, TRUSTED } = ctx
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
  /** 일마감한 날짜 → { at, by } */
  const DAYS = path.join(DIR, 'days.json')
  let closedDays = await readJson(DAYS, {})

  // ── CJ대한통운 송장(운송장) — 집화 날짜별 하나: orders/cj/<날짜>.json ──
  // 하루 중간에 올리고 마감 때 다시 올려도 같은 날짜에 합친다(운송장번호가 같으면 나중 것으로).
  const cjFile = (date) => path.join(DIR, 'cj', `${date}.json`)
  /**
   * 날짜 → { date, uploads: [{ fileName, uploadedAt, by, count, added }], waybills: { '운송장번호|상품코드|단품명': 줄 } }
   * CJ 파일은 상품 한 줄마다 한 줄이라 한 상자(같은 운송장번호)에 상품이 여럿이면 여러 줄이 된다.
   */
  const cjDays = new Map()
  try {
    for (const f of await fsp.readdir(path.join(DIR, 'cj'))) {
      if (!f.endsWith('.json')) continue
      const d = await readJson(path.join(DIR, 'cj', f), null)
      if (d?.date) cjDays.set(d.date, d)
    }
  } catch {
    // 아직 없다
  }
  /** 주문번호 → 그 주문의 운송장들 */
  let waybillsByOrder = new Map()
  function reindexCj() {
    const m = new Map()
    for (const d of [...cjDays.values()].sort((a, b) => a.date.localeCompare(b.date))) {
      for (const w of Object.values(d.waybills)) {
        const key = str(w.orderNo)
        if (!key) continue
        const list = m.get(key) ?? new Map()
        list.set(w.invoice, { invoice: w.invoice, date: d.date, pickupDate: w.pickupDate, status: w.status, box: w.box, fare: w.fare, receiver: w.receiver })
        m.set(key, list)
      }
    }
    waybillsByOrder = new Map([...m].map(([k, v]) => [k, [...v.values()]]))
  }
  reindexCj()
  /** 한 줄(주문)의 운송장 — CJ 파일에서 + 예전 방식으로 넣은 송장번호 칸 */
  // 담당자가 고친 송장번호(주문번호 → { invoices, by, at }) — CJ 파일보다 앞선다
  const EDITS = path.join(DIR, 'waybill-edits.json')
  let waybillEdits = await readJson(EDITS, {})
  const waybillsOf = (r) => {
    const orderNo = str(r['주문번호'])
    const cj = waybillsByOrder.get(orderNo) ?? []
    const edit = waybillEdits[orderNo]
    if (edit) return edit.invoices.map((inv) => ({ ...(cj.find((w) => digits(w.invoice) === digits(inv)) ?? {}), invoice: inv, manual: true, editedBy: edit.by, editedAt: edit.at }))
    const legacy = str(r['송장번호'])
    return legacy && !cj.some((w) => digits(w.invoice) === digits(legacy)) ? [...cj, { invoice: legacy }] : cj
  }

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

  const brief = (b) => {
    const amountCol = b.cols.find((c) => AMOUNT_RE.test(c)) ?? null
    return {
      id: b.id,
      date: b.date,
      seq: b.seq,
      fileName: b.fileName,
      sheetName: b.sheetName,
      uploadedAt: b.uploadedAt,
      uploadedBy: b.uploadedBy,
      editedAt: b.editedAt ?? null,
      /** 주문줄수(센터주문서 NO 의 마지막 번호) */
      count: b.rows.length,
      /** 주문건수(주문번호 수) */
      orders: new Set(b.rows.map((r) => `${str(r['쇼핑몰'])}|${str(r['주문번호'])}`)).size,
      qty: b.rows.reduce((s, r) => s + (Number(r['수량']) || 0), 0),
      /** 주문총액(결제금액 칸이 있을 때만) */
      amount: amountCol ? b.rows.reduce((s, r) => s + num(r[amountCol]), 0) : null,
      /** 송장이 붙은 주문 수 · 송장(운송장) 수 */
      invoiceOrders: new Set(b.rows.filter((r) => waybillsOf(r).length).map((r) => `${str(r['쇼핑몰'])}|${str(r['주문번호'])}`)).size,
      waybills: new Set(b.rows.flatMap((r) => waybillsOf(r).map((w) => w.invoice))).size,
      /** 미출고 갯수: 송장이 없는 주문 수. 줄이 모두 [취소요청]·[취소완료]인 주문은 빼고 센다 */
      unshipped: new Set(b.rows.filter((r) => !waybillsOf(r).length && !str(r[CANCEL_COL])).map((r) => `${str(r['쇼핑몰'])}|${str(r['주문번호'])}`)).size,
    }
  }
  /** 검색어에 맞는 줄인지 */
  function matcher(q, field) {
    const words = str(q).slice(0, 200).toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return null
    const f = Object.hasOwn(FIELDS, field) ? field : 'all'
    return (r) => {
      const keys = f === 'all' ? Object.keys(r) : FIELDS[f]
      // 송장번호는 CJ 파일에서 붙은 것까지 함께 본다
      const inv = f === 'all' || f === 'invoice' ? waybillsOf(r).map((w) => w.invoice) : []
      const hay = [...keys.map((k) => str(r[k]).toLowerCase()), ...inv].join('\n')
      const hayDigits = [...keys.map((k) => digits(r[k])), ...inv.map(digits)].join('\n')
      return words.every((w) => hay.includes(w) || (/\d/.test(w) && digits(w).length >= 3 && hayDigits.includes(digits(w))))
    }
  }
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
    // admin: 스탭 이상(스탭·전체마스터) — 주문서 수정·삭제는 스탭 이상만
    // version: 지금 돌고 있는 배포본(Railway 가 넣어 주는 커밋 번호) — 새 버전이 반영됐는지 화면에서 확인용
    // me: CS 내용 고치기·지우기 버튼을 보일지(적은 사람 본인 또는 전체마스터)
    const u = currentUser?.(req)
    res.json({
      allowed: await allowed(req),
      admin: isStaff(req),
      me: { id: u?.id ?? null, name: u?.name ?? null, master: isAdmin(req) },
      version: (process.env.RAILWAY_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'local',
      form: CENTER_FORM,
    })
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
    const { date, fileName, sheetName, cols, rows, mappings, center } = req.body ?? {}
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
          // 센터주문서 NO 순서(주문 조회 NO 를 센터주문서와 같게)
          center: cleanCenter(center, rows.length),
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

  /**
   * 차수 목록: ?from=&to=&q=&field=&mall=
   * 검색어가 있으면 맞는 줄이 있는 차수만, 맞는 줄 번호(lines)와 함께.
   */
  app.get('/api/orders/batches', requireAllowed, (req, res) => {
    const from = String(req.query.from ?? '')
    const to = String(req.query.to ?? '')
    const mall = str(req.query.mall)
    const match = matcher(req.query.q, String(req.query.field ?? 'all'))
    const list = []
    for (const b of [...batches.values()].sort((a, c) => c.date.localeCompare(a.date) || c.seq - a.seq)) {
      if ((DATE_RE.test(from) && b.date < from) || (DATE_RE.test(to) && b.date > to)) continue
      if (!match && !mall) {
        list.push(brief(b))
        continue
      }
      const lines = []
      b.rows.forEach((r, i) => {
        if (mall && str(r['쇼핑몰']) !== mall) return
        if (match && !match(r)) return
        lines.push(i + 1)
      })
      if (lines.length) list.push({ ...brief(b), lines })
      if (list.length >= 500) break
    }
    const malls = [...new Set([...batches.values()].flatMap((b) => b.rows.map((r) => str(r['쇼핑몰']))).filter(Boolean))].sort()
    res.json({ batches: list, malls, hasAmount: [...batches.values()].some((b) => b.cols.some((c) => AMOUNT_RE.test(c))), closed: closedDays })
  })

  /** 차수 하나 전부(줄·운송장·CS 기록·센터주문서 순서) */
  const full = (b) => {
    // 이 주문서의 주문번호마다 붙은 운송장 전부
    const waybills = {}
    for (const r of b.rows) {
      const list = waybillsOf(r)
      if (list.length) waybills[str(r['주문번호'])] = list
    }
    return { ...brief(b), cols: b.cols, rows: b.rows, waybills, csLog: b.csLog ?? {}, center: b.center ?? null }
  }
  app.get('/api/orders/batches/:id', requireAllowed, (req, res) => {
    const b = ID_RE.test(req.params.id) ? batches.get(req.params.id) : null
    if (!b) return res.status(404).json({ error: '없는 주문서입니다.' })
    res.json({ batch: full(b) })
  })

  // ── 일마감: 그날 1차·2차·3차…를 하루 전체 목록으로 묶는다 ──
  const dayBatches = (date) => [...batches.values()].filter((b) => b.date === date).sort((a, b) => a.seq - b.seq)
  /** 하루 전체(차수 순서대로) */
  app.get('/api/orders/days/:date', requireAllowed, (req, res) => {
    const date = req.params.date
    if (!DATE_RE.test(date)) return res.status(400).json({ error: '날짜를 확인해 주세요.' })
    res.json({ date, closed: closedDays[date] ?? null, batches: dayBatches(date).map(full) })
  })
  app.post('/api/orders/days/:date/close', requireAllowed, async (req, res) => {
    const date = req.params.date
    if (!DATE_RE.test(date)) return res.status(400).json({ error: '날짜를 확인해 주세요.' })
    if (!dayBatches(date).length) return res.status(400).json({ error: '이 날짜에 주문서가 없습니다.' })
    await serial(async () => {
      closedDays = { ...closedDays, [date]: { at: new Date().toISOString(), by: who(req) } }
      await writeJson(DAYS, closedDays)
    })
    res.json({ closed: closedDays })
  })
  /** 일마감 풀기(스탭 이상) — 차수들이 다시 따로 보인다 */
  app.delete('/api/orders/days/:date/close', requireStaff, async (req, res) => {
    const date = req.params.date
    if (!DATE_RE.test(date)) return res.status(400).json({ error: '날짜를 확인해 주세요.' })
    await serial(async () => {
      const { [date]: _gone, ...rest } = closedDays
      void _gone
      closedDays = rest
      await writeJson(DAYS, closedDays)
    })
    res.json({ closed: closedDays })
  })

  // ── CJ 송장 파일 ────────────────────────────────────────
  /** 주문번호 → 그 주문이 든 주문서(날짜·차수) */
  function orderHome() {
    const m = new Map()
    for (const b of batches.values()) for (const r of b.rows) if (!m.has(str(r['주문번호']))) m.set(str(r['주문번호']), { batchId: b.id, date: b.date, seq: b.seq, buyer: str(r['주문자명']), mall: str(r['쇼핑몰']) })
    return m
  }
  const cjBrief = (d, home = orderHome()) => {
    const ws = Object.values(d.waybills)
    const orders = new Set(ws.map((w) => str(w.orderNo)).filter(Boolean))
    // 운임은 상자(운송장)마다 한 번 — 같은 운송장의 여러 줄은 한 번만 더한다
    const fareBy = new Map(ws.map((w) => [w.invoice, num(w.fare)]))
    return {
      date: d.date,
      uploads: d.uploads.length,
      lastUploadAt: d.uploads.at(-1)?.uploadedAt ?? null,
      lastBy: d.uploads.at(-1)?.by ?? '',
      fileNames: [...new Set(d.uploads.map((u) => u.fileName))],
      /** 운송장(상자) 수 · 상품 줄 수 */
      waybills: fareBy.size,
      lines: ws.length,
      orders: orders.size,
      matched: [...orders].filter((o) => home.has(o)).length,
      fare: [...fareBy.values()].reduce((s, v) => s + v, 0),
    }
  }

  /**
   * CJ대한통운 송장 파일 올리기: { fileName, rows } — rows 는 CJ 파일 칸 이름 → 값(운송장번호·고객주문번호·집화예정일자…)
   * 집화예정일자(가장 많은 날짜)로 그날 기록에 합친다.
   */
  app.post('/api/orders/cj', requireAllowed, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 20000) : []
    const pick = (r, ...names) => {
      for (const n of names) if (str(r[n])) return str(r[n])
      return ''
    }
    const list = []
    for (const raw of rows) {
      const r = cleanRow(raw)
      const invoice = pick(r, '운송장번호', '송장번호')
      if (!invoice) continue
      const pickup = pick(r, '집화예정일자', '집하예정일자', '집화일자', '발송일자').slice(0, 10)
      list.push({
        invoice,
        orderNo: pick(r, '고객주문번호', '주문번호'),
        // CJ 파일의 기타3 칸에 사방넷주문번호가 들어 있다(우리 CJ택배 파일 순서대로)
        sabangNo: pick(r, '사방넷주문번호', '기타3'),
        mall: pick(r, '쇼핑몰', '기타2'),
        pickupDate: DATE_RE.test(pickup) ? pickup : '',
        status: pick(r, '상태'),
        box: pick(r, '박스타입'),
        fare: num(pick(r, '운임합계')),
        receiver: pick(r, '받는분'),
        phone: pick(r, '받는분전화번호'),
        address: pick(r, '받는분주소'),
        code: pick(r, '상품코드'),
        name: pick(r, '상품명'),
        option: pick(r, '단품명'),
        qty: num(pick(r, '내품수량')),
        message: pick(r, '배송메시지'),
      })
    }
    if (!list.length) return res.status(400).json({ error: '‘운송장번호’가 있는 줄이 없습니다. CJ대한통운에서 받은 송장 파일인지 확인해 주세요.' })
    const count = new Map()
    for (const w of list) if (w.pickupDate) count.set(w.pickupDate, (count.get(w.pickupDate) ?? 0) + 1)
    const date = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const day = await serial(async () => {
      const d = cjDays.get(date) ?? { date, uploads: [], waybills: {} }
      const before = Object.keys(d.waybills).length
      for (const w of list) d.waybills[`${w.invoice}|${w.code || w.name}|${w.option}`] = w
      d.uploads.push({ fileName: str(req.body?.fileName).slice(0, 200), uploadedAt: new Date().toISOString(), by: who(req), count: list.length, added: Object.keys(d.waybills).length - before })
      await writeJson(cjFile(date), d)
      cjDays.set(date, d)
      reindexCj()
      return d
    })
    const home = orderHome()
    const orders = [...new Set(list.map((w) => str(w.orderNo)).filter(Boolean))]
    res.json({ day: cjBrief(day, home), given: new Set(list.map((w) => w.invoice)).size, lines: list.length, added: day.uploads.at(-1).added, unmatched: orders.filter((o) => !home.has(o)) })
  })

  /** CJ 송장 날짜 목록: ?from=&to= */
  app.get('/api/orders/cj', requireAllowed, (req, res) => {
    const from = String(req.query.from ?? '')
    const to = String(req.query.to ?? '')
    const home = orderHome()
    const days = [...cjDays.values()]
      .filter((d) => (!DATE_RE.test(from) || d.date >= from) && (!DATE_RE.test(to) || d.date <= to))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((d) => cjBrief(d, home))
    res.json({ days })
  })

  /** 그날 운송장 전부(주문서 날짜·차수와 함께) */
  app.get('/api/orders/cj/:date', requireAllowed, (req, res) => {
    const d = DATE_RE.test(req.params.date) ? cjDays.get(req.params.date) : null
    if (!d) return res.status(404).json({ error: '그 날짜의 송장 파일이 없습니다.' })
    const home = orderHome()
    const waybills = Object.values(d.waybills).map((w) => ({ ...w, home: home.get(str(w.orderNo)) ?? null }))
    res.json({ day: { ...cjBrief(d, home), uploadsDetail: d.uploads }, waybills })
  })

  /** 그날 송장 기록 지우기(스탭 이상) */
  app.delete('/api/orders/cj/:date', requireStaff, async (req, res) => {
    const d = DATE_RE.test(req.params.date) ? cjDays.get(req.params.date) : null
    if (!d) return res.status(404).json({ error: '그 날짜의 송장 파일이 없습니다.' })
    await serial(async () => {
      cjDays.delete(d.date)
      await fsp.rm(cjFile(d.date), { force: true })
      reindexCj()
    })
    res.json({ ok: true })
  })

  /** 차수 고치기(스탭 이상): { date?, seq? } — 같은 날짜·차수가 이미 있으면 거절 */
  app.patch('/api/orders/batches/:id', requireStaff, async (req, res) => {
    const b = ID_RE.test(req.params.id) ? batches.get(req.params.id) : null
    if (!b) return res.status(404).json({ error: '없는 주문서입니다.' })
    const date = req.body?.date === undefined ? b.date : String(req.body.date)
    const seq = req.body?.seq === undefined ? b.seq : Number(req.body.seq)
    if (!DATE_RE.test(date)) return res.status(400).json({ error: '날짜를 확인해 주세요.' })
    if (!Number.isInteger(seq) || seq < 1 || seq > 99) return res.status(400).json({ error: '차수는 1~99 사이 숫자로 넣어 주세요.' })
    if ([...batches.values()].some((x) => x.id !== b.id && x.date === date && x.seq === seq)) return res.status(400).json({ error: `${date} ${seq}차가 이미 있습니다.` })
    await serial(async () => {
      Object.assign(b, { date, seq, editedAt: new Date().toISOString(), editedBy: who(req) })
      await writeJson(batchFile(b.id), b)
    })
    res.json({ batch: brief(b) })
  })
  /**
   * 송장번호 고치기(담당자 누구나): { orderNo, invoices: [...] } — 그 주문번호의 송장을 이 목록으로 바꾼다(빠진 송장 넣기·잘못된 번호 고치기).
   * reset: true 면 고친 것을 지우고 CJ 파일 값으로 되돌린다.
   */
  app.put('/api/orders/waybills', requireAllowed, async (req, res) => {
    const orderNo = str(req.body?.orderNo).slice(0, 80)
    if (!orderNo) return res.status(400).json({ error: '주문번호가 없습니다.' })
    await serial(async () => {
      if (req.body?.reset) delete waybillEdits[orderNo]
      else {
        const invoices = [...new Set((Array.isArray(req.body?.invoices) ? req.body.invoices : []).map((v) => str(v).slice(0, 40)).filter(Boolean))].slice(0, 50)
        waybillEdits[orderNo] = { invoices, by: who(req), at: new Date().toISOString() }
      }
      await writeJson(EDITS, waybillEdits)
    })
    res.json({ waybills: waybillsOf({ 주문번호: orderNo }) })
  })

  /**
   * 비고(CS내용) 적기(담당자 누구나): { memo } — 주문 한 줄에.
   * 적을 때마다 기록(csLog)에 한 줄씩 쌓고, 표에는 마지막 내용과 마지막으로 적은 사람·시각을 둔다.
   */
  app.patch('/api/orders/batches/:id/rows/:line/memo', requireAllowed, async (req, res) => {
    const b = ID_RE.test(req.params.id) ? batches.get(req.params.id) : null
    const i = Number(req.params.line) - 1
    if (!b || !Number.isInteger(i) || !b.rows[i]) return res.status(404).json({ error: '없는 주문입니다.' })
    const memo = str(req.body?.memo).slice(0, 500)
    // uid: 적은 사람 계정(본인만 고치기·지우기)
    const entry = { text: memo, by: who(req), uid: currentUser?.(req)?.id ?? null, at: new Date().toISOString() }
    await serial(async () => {
      b.rows[i] = { ...b.rows[i], [CS_COL]: memo || null, [CS_BY]: entry.by, [CS_AT]: entry.at }
      for (const c of [CS_COL, CS_BY, CS_AT]) if (!b.cols.includes(c)) b.cols.push(c)
      b.csLog ??= {}
      b.csLog[i + 1] = [...(b.csLog[i + 1] ?? []), entry].slice(-200)
      await writeJson(batchFile(b.id), b)
    })
    res.json({ memo, entry, log: b.csLog[i + 1], row: b.rows[i] })
  })

  // ── CS 기록 한 개 고치기·지우기: 적은 사람 본인과 전체마스터만 ──
  /** 예전 기록(uid 없음)은 적은 사람 이름으로 본인인지 본다 */
  const canEditCs = (req, e) => {
    if (isAdmin(req)) return true
    const u = currentUser?.(req)
    if (!u) return false
    return e.uid ? e.uid === u.id : Boolean(u.name) && e.by === u.name
  }
  /** 줄의 비고(CS내용)·수정자·시각은 남은 기록 중 마지막 것으로 */
  const syncCs = (row, log) => {
    const last = log.at(-1)
    return { ...row, [CS_COL]: last?.text || null, [CS_BY]: last?.by ?? null, [CS_AT]: last ? (last.editedAt ?? last.at) : null }
  }
  /** 기록 찾기: :idx(0부터) + body.at(그 사이 다른 사람이 바꾸지 않았는지) */
  const findCs = (req, res) => {
    const b = ID_RE.test(req.params.id) ? batches.get(req.params.id) : null
    const i = Number(req.params.line) - 1
    const k = Number(req.params.idx)
    if (!b || !Number.isInteger(i) || !b.rows[i]) return res.status(404).json({ error: '없는 주문입니다.' }), null
    const log = b.csLog?.[i + 1] ?? []
    const e = Number.isInteger(k) ? log[k] : null
    if (!e || (req.body?.at && req.body.at !== e.at)) return res.status(409).json({ error: '그 사이 CS 기록이 바뀌었습니다. 창을 닫고 다시 열어 주세요.' }), null
    if (!canEditCs(req, e)) return res.status(403).json({ error: 'CS 내용은 적은 사람과 전체마스터만 고치거나 지울 수 있습니다.' }), null
    return { b, i, k, log }
  }
  app.patch('/api/orders/batches/:id/rows/:line/cs/:idx', requireAllowed, async (req, res) => {
    const text = str(req.body?.text).slice(0, 500)
    if (!text) return res.status(400).json({ error: '내용을 적어 주세요. 없애려면 휴지통을 누르세요.' })
    const f = findCs(req, res)
    if (!f) return
    const { b, i, k } = f
    await serial(async () => {
      const log = [...(b.csLog[i + 1] ?? [])]
      log[k] = { ...log[k], text, editedAt: new Date().toISOString(), editedBy: who(req) }
      b.csLog[i + 1] = log
      b.rows[i] = syncCs(b.rows[i], log)
      await writeJson(batchFile(b.id), b)
    })
    res.json({ log: b.csLog[i + 1], row: b.rows[i] })
  })
  app.delete('/api/orders/batches/:id/rows/:line/cs/:idx', requireAllowed, async (req, res) => {
    const f = findCs(req, res)
    if (!f) return
    const { b, i, k } = f
    await serial(async () => {
      const log = (b.csLog[i + 1] ?? []).filter((_, j) => j !== k)
      b.csLog[i + 1] = log
      b.rows[i] = syncCs(b.rows[i], log)
      await writeJson(batchFile(b.id), b)
    })
    res.json({ log: b.csLog[i + 1], row: b.rows[i] })
  })

  /** 취소내용(담당자 누구나): { status: '' | '취소요청' | '취소완료' } */
  app.patch('/api/orders/batches/:id/rows/:line/cancel', requireAllowed, async (req, res) => {
    const b = ID_RE.test(req.params.id) ? batches.get(req.params.id) : null
    const i = Number(req.params.line) - 1
    if (!b || !Number.isInteger(i) || !b.rows[i]) return res.status(404).json({ error: '없는 주문입니다.' })
    const status = str(req.body?.status)
    if (!CANCEL_STATES.includes(status)) return res.status(400).json({ error: '취소내용은 취소요청·취소완료·빈칸 중 하나입니다.' })
    await serial(async () => {
      b.rows[i] = { ...b.rows[i], [CANCEL_COL]: status || null, 취소처리: status ? `${who(req)} ${new Date().toISOString()}` : null }
      for (const c of [CANCEL_COL, '취소처리']) if (!b.cols.includes(c)) b.cols.push(c)
      await writeJson(batchFile(b.id), b)
    })
    res.json({ row: b.rows[i] })
  })

  /** 주문 한 줄 고치기(스탭 이상): { row } — 칸 이름 → 값 */
  app.patch('/api/orders/batches/:id/rows/:line', requireStaff, async (req, res) => {
    const b = ID_RE.test(req.params.id) ? batches.get(req.params.id) : null
    const i = Number(req.params.line) - 1
    if (!b || !Number.isInteger(i) || !b.rows[i]) return res.status(404).json({ error: '없는 주문입니다.' })
    const next = { ...b.rows[i], ...cleanRow(req.body?.row) }
    await serial(async () => {
      b.rows[i] = next
      for (const k of Object.keys(next)) if (!b.cols.includes(k)) b.cols.push(k)
      b.editedAt = new Date().toISOString()
      b.editedBy = who(req)
      await writeJson(batchFile(b.id), b)
    })
    res.json({ row: next })
  })

  /** 잘못 올린 차수 지우기(스탭 이상). 차수 번호는 다시 매기지 않는다 — 이미 보낸 파일 이름과 어긋나지 않게 */
  app.delete('/api/orders/batches/:id', requireStaff, async (req, res) => {
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
