/**
 * 평가 결과 엑셀. 올린 지원자 엑셀(원본)이 있으면 그 파일을 그대로 두고(데이터·숨김 상태 보존) 평가 시트를 덧붙인다.
 * 덧붙이는 시트: 인스타그램 평가 · 블로그 평가 · 추천 명단 · 블로그 방문자 미확인 후보 · 보류·확인 필요 · 평가 기준
 */
import type { Workbook, Worksheet } from 'exceljs'
import type { Applicant } from './parse'
import { breakdownText, MAX, MOTIVE_SOURCE_LABEL, STATUS_LABEL, type BlogData, type Candidate, type Recommendation } from './score'

export interface ProblemRow {
  kind: string
  people: Applicant[]
  raw: string
  reason: string
}

export interface ExportInput {
  title: string
  ig: Candidate[]
  blog: Candidate[]
  recIg: Recommendation
  recBlog: Recommendation
  problems: ProblemRow[]
  pending: { ig: number; blog: number }
  /** 처음 올린 지원자 엑셀(있으면 이 파일에 시트를 덧붙인다) */
  original?: ArrayBuffer | null
}

const HEAD_FILL = 'FFEEF4F0'
const EDIT_FILL = 'FFFFFCF0'
const LINE = { style: 'thin' as const, color: { argb: 'FFB8C2BC' } }
const BORDER = { top: LINE, left: LINE, bottom: LINE, right: LINE }
const STATUS_FILL: Record<string, string> = { '평가 완료': 'FFE3F2EA', '일부 미확인': 'FFFFF6D6', 보류: 'FFF1F1F1', '확인 실패': 'FFFBE3DE' }

interface Col {
  header: string
  width: number
  numFmt?: string
  /** 사람이 확인해 적는 칸(연한 노랑) */
  edit?: boolean
}

const names = (ps: Applicant[]) => [...new Set(ps.map((p) => p.name).filter(Boolean))].join(', ')
const link = (text: string, url: string) => (url ? { text, hyperlink: url } : text)
const igUrl = (k: string) => `https://www.instagram.com/${k}/`
const blogUrl = (k: string) => `https://blog.naver.com/${k}`
const v = (n: number | null | undefined) => (n == null ? null : n)

function uniqueName(wb: Workbook, name: string) {
  const used = new Set(wb.worksheets.map((w) => w.name))
  if (!used.has(name)) return name
  for (let i = 2; ; i++) if (!used.has(`${name} (${i})`)) return `${name} (${i})`
}

function table(ws: Worksheet, cols: Col[], rows: Array<Array<unknown>>, opts: { statusCol?: number; freezeCols?: number } = {}) {
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width))
  const head = ws.addRow(cols.map((c) => c.header))
  head.height = 32
  head.eachCell((cell) => {
    cell.font = { name: '맑은 고딕', bold: true, size: 9.5 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } }
    cell.border = BORDER
  })
  for (const values of rows) {
    const row = ws.addRow(values)
    row.eachCell({ includeEmpty: true }, (cell, i) => {
      const c = cols[i - 1]
      if (!c) return
      const isLink = Boolean(cell.value && typeof cell.value === 'object' && 'hyperlink' in cell.value)
      cell.font = isLink ? { name: '맑은 고딕', size: 10, color: { argb: 'FF1F5FBF' }, underline: true } : { name: '맑은 고딕', size: 10 }
      cell.border = BORDER
      cell.alignment = { vertical: 'top', wrapText: c.width >= 24 }
      if (c.numFmt) cell.numFmt = c.numFmt
      if (c.edit) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EDIT_FILL } }
    })
    if (opts.statusCol) {
      const cell = row.getCell(opts.statusCol)
      const f = STATUS_FILL[String(cell.value ?? '')]
      if (f) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f } }
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: opts.freezeCols ?? 0 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
}

function note(ws: Worksheet, text: string, bold = false) {
  const r = ws.addRow([text])
  r.getCell(1).font = { name: '맑은 고딕', size: bold ? 11 : 10, bold }
  return r
}

const commonHead = (c: Candidate) => [c.rank ?? '', STATUS_LABEL[c.status], c.rep?.name ?? '', c.rep?.phone ?? '', c.rep?.submittedAt ?? '', c.rep?.row ?? '']
const tail = (c: Candidate) => [
  c.total,
  c.subtotal,
  c.confirmedMax,
  c.missing.join(', '),
  c.dupes.length ? c.dupes.map((d) => `${d.name ?? ''}${d.row ? `(${d.row}행)` : ''}`).join(', ') : '',
  c.notes.join(' / '),
  c.ev.aiApplied ? 'AI 초안 확인·적용' : c.subtotal || c.scores.base != null ? '담당자·자동' : '',
  aiScore(c.ev.ai, 'fit'),
  aiScore(c.ev.ai, 'review'),
  aiScore(c.ev.ai, 'motive'),
  aiReasons(c),
]
/** AI 초안 점수 한 칸(없으면 빈칸, 판단 못 하면 '판단 못 함') */
const aiScore = (a: Candidate['ev']['ai'], k: 'fit' | 'review' | 'motive') => (!a || a.error || !a[k] ? '' : a[k].score ?? '판단 못 함')
/** AI 초안 근거(있으면) */
const aiReasons = (c: Candidate) => {
  const a = c.ev.ai
  if (!a) return ''
  if (a.error) return `AI 실패: ${a.error}`
  return [
    a.fit && `적합성 ${a.fit.score ?? '판단 못 함'}: ${a.fit.reason}`,
    a.review && `리뷰 ${a.review.score ?? '판단 못 함'}${a.review.date ? `(${a.review.date})` : ''}: ${a.review.reason}`,
    a.motive && `동기 ${a.motive.score ?? '판단 못 함'}: ${a.motive.reason}`,
  ]
    .filter(Boolean)
    .join(' / ')
}
const TAIL_COLS: Col[] = [
  { header: '총점\n(100)', width: 8 },
  { header: '확인 항목\n소계', width: 8 },
  { header: '확인된\n배점 합계', width: 8 },
  { header: '미확인 항목', width: 16 },
  { header: '중복 지원\n(대표 외)', width: 16 },
  { header: '특이사항', width: 36 },
  { header: '점수 출처', width: 12 },
  { header: 'AI 적합성\n(25)', width: 9 },
  { header: 'AI 리뷰', width: 8 },
  { header: 'AI 지원동기\n(15)', width: 9 },
  { header: 'AI 초안 근거', width: 48 },
]
const HEAD_COLS: Col[] = [
  { header: '정식\n순위', width: 6 },
  { header: '상태', width: 10 },
  { header: '이름', width: 9 },
  { header: '연락처', width: 14 },
  { header: '접수 일시', width: 17 },
  { header: '신청\n행', width: 6 },
]

export async function buildSelectionWorkbook(input: ExportInput): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  if (input.original) {
    // 원본 그대로(값·서식·숨김 행/열/시트) 불러와 뒤에 시트만 더한다
    await wb.xlsx.load(input.original)
  }
  wb.creator = wb.creator || '온비짱'
  wb.modified = new Date()

  // ── 인스타그램 평가 ──
  const igCols: Col[] = [
    ...HEAD_COLS,
    { header: '계정', width: 18 },
    { header: '팔로워 수\n(확인값)', width: 10, numFmt: '#,##0' },
    { header: '원문 표기', width: 9 },
    { header: '근사값\n여부', width: 7 },
    { header: `팔로워 점수\n(${MAX.ig.followers})`, width: 9 },
    { header: `콘텐츠 적합성\n(${MAX.ig.fit})`, width: 10, edit: true },
    { header: `리뷰 표현력\n(${MAX.ig.review})`, width: 10, edit: true },
    { header: '리뷰 게시일', width: 11, edit: true },
    { header: '리뷰 링크', width: 18, edit: true },
    { header: `지원동기\n(${MAX.ig.motive})`, width: 9, edit: true },
    { header: '지원동기\n판단', width: 8 },
    { header: '지원동기 키워드', width: 22 },
    { header: 'AI 지원동기 기준별 점수\n(제품관심·생활맥락·리뷰계획·진정성)', width: 34 },
    ...TAIL_COLS,
  ]
  table(
    wb.addWorksheet(uniqueName(wb, '인스타그램 평가')),
    igCols,
    input.ig.map((c) => [
      ...commonHead(c),
      link(c.key, igUrl(c.key)),
      v(c.followers),
      c.followersRaw,
      c.followers == null ? '' : c.followersApprox ? '근사값' : '정확',
      v(c.scores.base),
      v(c.scores.fit),
      v(c.scores.review),
      c.ev.reviewDate ?? '',
      c.ev.reviewUrl ? link('리뷰 보기', c.ev.reviewUrl) : '',
      v(c.scores.motive),
      c.motiveSource ? MOTIVE_SOURCE_LABEL[c.motiveSource] : '',
      c.keywords.join(', '),
      breakdownText(c.ev.ai?.motive?.breakdown),
      ...tail(c),
    ]),
    { statusCol: 2, freezeCols: 3 },
  )

  // ── 블로그 평가 ──
  const blogCols: Col[] = [
    ...HEAD_COLS,
    { header: '블로그', width: 18 },
    { header: '블로그 이름', width: 18 },
    { header: '날짜별 방문자\n(오늘 제외)', width: 26 },
    { header: '일평균\n방문자', width: 9, numFmt: '#,##0.0' },
    { header: `방문자 점수\n(${MAX.blog.visitors})`, width: 10 },
    { header: `리뷰 품질\n(${MAX.blog.review})`, width: 9, edit: true },
    { header: '리뷰 게시일', width: 11, edit: true },
    { header: '리뷰 링크', width: 18, edit: true },
    { header: `콘텐츠 적합성\n(${MAX.blog.fit})`, width: 10, edit: true },
    { header: `지원동기\n(${MAX.blog.motive})`, width: 9, edit: true },
    { header: '지원동기\n판단', width: 8 },
    { header: '지원동기 키워드', width: 22 },
    { header: 'AI 지원동기 기준별 점수\n(제품관심·생활맥락·리뷰계획·진정성)', width: 34 },
    ...TAIL_COLS,
  ]
  table(
    wb.addWorksheet(uniqueName(wb, '블로그 평가')),
    blogCols,
    input.blog.map((c) => [
      ...commonHead(c),
      link(c.key, blogUrl(c.key)),
      (c.data as BlogData | undefined)?.name ?? '',
      c.visitorsHidden ? '방문자 통계 미공개' : c.visitorDays.map((d) => `${d.date.slice(5)} ${d.cnt.toLocaleString('ko-KR')}`).join(' · '),
      v(c.visitorsAvg),
      c.visitorsHidden ? '방문자 통계 미공개' : v(c.scores.base),
      v(c.scores.review),
      c.ev.reviewDate ?? '',
      c.ev.reviewUrl ? link('리뷰 보기', c.ev.reviewUrl) : '',
      v(c.scores.fit),
      v(c.scores.motive),
      c.motiveSource ? MOTIVE_SOURCE_LABEL[c.motiveSource] : '',
      c.keywords.join(', '),
      breakdownText(c.ev.ai?.motive?.breakdown),
      ...tail(c),
    ]),
    { statusCol: 2, freezeCols: 3 },
  )

  // ── 추천 명단 ──
  const rec = wb.addWorksheet(uniqueName(wb, '추천 명단'))
  ;[6, 7, 10, 14, 22, 9, 40].forEach((w, i) => (rec.getColumn(i + 1).width = w))
  const recSection = (title: string, r: Recommendation, url: (k: string) => string) => {
    note(rec, `${title} 추천 ${r.picked.length} / 목표 ${r.target}명`, true)
    const head = rec.addRow(['추천', '정식 순위', '이름', '연락처', '계정', '총점', '비고'])
    head.eachCell((c) => {
      c.font = { name: '맑은 고딕', bold: true, size: 9.5 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } }
      c.border = BORDER
    })
    r.picked.forEach((c, i) => rec.addRow([i + 1, c.rank, c.rep?.name ?? '', c.rep?.phone ?? '', link(c.key, url(c.key)), c.total, c.notes.join(' / ')]))
    if (r.shortfall) note(rec, `※ 부족 ${r.shortfall}명: ${r.shortfallReason}`)
    r.conditional.forEach((c, i) =>
      rec.addRow([`조건부 ${i + 1}`, '', c.rep?.name ?? '', c.rep?.phone ?? '', link(c.key, url(c.key)), `${c.subtotal}/70`, '조건부 추천—방문자 미확인(최종 포함 여부는 담당자가 결정)']),
    )
    rec.addRow([])
  }
  recSection('[인스타그램]', input.recIg, igUrl)
  recSection('[네이버 블로그]', input.recBlog, blogUrl)
  note(rec, '※ 모든 항목이 확인된 후보만 정식 추천합니다. 미확인 수치는 추정하지 않았습니다.')
  if (input.pending.ig || input.pending.blog) note(rec, `※ 아직 자동 확인 중: 인스타그램 ${input.pending.ig}명 · 블로그 ${input.pending.blog}명`)

  // ── 블로그 방문자 미확인 후보 ──
  const vu = wb.addWorksheet(uniqueName(wb, '블로그 방문자 미확인 후보'))
  note(vu, '방문자 수만 확인되지 않은 블로그 후보 — 리뷰 품질 + 콘텐츠 적합성 + 지원동기 소계(70점) 순. 방문자 확인 후보와 총점으로 비교하지 않습니다.', true)
  vu.addRow([])
  const vuStart = vu.rowCount + 1
  table(
    vu,
    [
      { header: '순번', width: 6 },
      { header: '이름', width: 10 },
      { header: '연락처', width: 14 },
      { header: '블로그', width: 18 },
      { header: `리뷰 품질\n(${MAX.blog.review})`, width: 9 },
      { header: `콘텐츠 적합성\n(${MAX.blog.fit})`, width: 10 },
      { header: `지원동기\n(${MAX.blog.motive})`, width: 9 },
      { header: '소계\n(70)', width: 8 },
      { header: '조건부 추천', width: 18 },
      { header: '특이사항', width: 36 },
    ],
    input.recBlog.visitorUnknown.map((c, i) => [i + 1, c.rep?.name ?? '', c.rep?.phone ?? '', link(c.key, blogUrl(c.key)), c.scores.review, c.scores.fit, c.scores.motive, c.subtotal, input.recBlog.conditional.includes(c) ? '조건부 추천—방문자 미확인' : '', c.notes.join(' / ')]),
  )
  vu.views = [{ state: 'frozen', ySplit: vuStart }]
  vu.autoFilter = { from: { row: vuStart, column: 1 }, to: { row: vuStart, column: 10 } }

  // ── 보류·확인 필요 ──
  const holdRows: Array<Array<unknown>> = [
    ...input.problems.map((p) => [p.kind, '보류', names(p.people), p.people[0]?.phone ?? '', p.people[0]?.row ?? '', p.raw, p.reason]),
    ...[...input.ig, ...input.blog]
      .filter((c) => c.status === 'hold' || c.status === 'failed')
      .map((c) => [c.kind === 'ig' ? '인스타그램' : '블로그', STATUS_LABEL[c.status], c.rep?.name ?? '', c.rep?.phone ?? '', c.rep?.row ?? '', c.key, c.notes.join(' / ') || c.error || (c.status === 'hold' ? '담당자가 평가 보류로 표시' : '')]),
    ...[...input.ig, ...input.blog].flatMap((c) =>
      c.dupes.map((d) => [c.kind === 'ig' ? '인스타그램' : '블로그', '중복 지원', d.name ?? '', d.phone ?? '', d.row ?? '', c.key, `같은 계정 중복 — 대표 신청서 ${c.rep?.row ? `${c.rep.row}행` : ''}(${c.rep?.name ?? ''}, 먼저 접수)만 평가`]),
    ),
  ]
  table(
    wb.addWorksheet(uniqueName(wb, '보류·확인 필요')),
    [
      { header: '채널', width: 11 },
      { header: '처리', width: 10 },
      { header: '이름', width: 10 },
      { header: '연락처', width: 14 },
      { header: '신청 행', width: 7 },
      { header: '적은 주소·계정', width: 40 },
      { header: '이유', width: 50 },
    ],
    holdRows,
  )

  // ── 평가 기준 ──
  const info = wb.addWorksheet(uniqueName(wb, '평가 기준'))
  info.getColumn(1).width = 120
  const lines = [
    `${input.title || '체험단'} 평가 — ${new Date().toLocaleString('ko-KR')}`,
    '[인스타그램 100] 팔로워 수 40 · 살림·리빙·육아 콘텐츠 적합성 25 · 제품 리뷰 표현력 20 · 지원동기 15',
    '· 팔로워: 1,000명 미만 8 / 1,000~2,999 16 / 3,000~4,999 24 / 5,000~9,999 32 / 10,000 이상 40 / 확인된 0명 0 / 미확인 빈칸',
    '· 축약 표기(1.2만·12.5K)는 환산값·원문·근사값 여부를 함께 적었습니다.',
    '[네이버 블로그 100] 공개된 기간 일평균 방문자 30 · 제품 리뷰 품질 30 · 콘텐츠 적합성 25 · 지원동기 15',
    '· 방문자: 오늘을 뺀 완료된 날짜 평균. 100 미만 6 / 100~299 12 / 300~499 18 / 500~999 24 / 1,000 이상 30 / 확인된 0명 0 / 미공개는 ‘방문자 통계 미공개’',
    '· 리뷰: 최근 90일 내 최신 제품 리뷰 1개(없으면 확인 가능한 이전 리뷰 1개, 게시일 기록). 고정 게시물은 최신 리뷰로 보지 않음. 리뷰가 없으면 최근 30일 게시물 하나로 평가.',
    '· 근거가 없으면 0, 일부 충족하면 중간, 충분히 충족하면 만점. 협찬이라는 이유만으로 감점하지 않음. 직접 촬영·실사용 여부가 불명확하면 단정하지 않음.',
    '· 콘텐츠 적합성: 프로필 소개·카테고리·게시물 사진과 캡션으로 판단. 계정에 접근하지 못하면 0점이 아니라 미확인. 이름·성별·나이·추정 가족관계로 판단하지 않음.',
    '· 지원동기: 신청서 글을 근거로 점수화. 담당자 점수 > AI 채점 > 자동 판단 순으로 씀(‘지원동기 판단’ 칸에 출처). 주요 키워드 기입.',
    '  - AI 채점 기준(Claude, 합 15): 제품관심 4(제품 특징·지금 쓰는 화장지와의 차이를 구체적으로) · 생활맥락 3(가족 수·육아·사용량 등 실제 쓰는 상황) · 리뷰계획 4(사진·영상·비교·사용 기간 등 리뷰 방법) · 진정성 4(본인 경험·성의, 상투적 문구·복붙은 낮게)',
    '  - 자동 판단(AI 초안이 없을 때): 내용 3 + 제품 언급 3 + 생활 맥락 3 + 리뷰 계획 3 + 구체성(60자 이상) 3',
    '[점수·순위] 같은 채널 안에서만 총점 내림차순. 모든 항목이 확인된 지원자만 100점 총점·정식 순위. 일부 미확인자는 확인 항목 소계와 확인된 배점 합계만 표시(0점 처리·환산 없음).',
    '· 인스타그램 동점: 콘텐츠 적합성 → 리뷰 표현력 → 지원동기 → 팔로워 수 → 접수 순서',
    '· 블로그 동점: 방문자 평균 → 리뷰 품질 → 콘텐츠 적합성 → 지원동기 → 접수 순서',
    '[중복·보류] 같은 계정 중복 지원은 가장 먼저 접수된 신청서만 평가하고 중복을 기록. 계정 주소가 불분명하면 보류.',
    `[추천] 평가 완료자 우선 인스타그램 ${input.recIg.target}명, 블로그 ${input.recBlog.target}명. 부족하면 부족 인원과 이유를 적고, 블로그는 방문자 미확인 후보(70점 소계 순) 상위를 ‘조건부 추천—방문자 미확인’으로 제시(최종 결정은 담당자).`,
    '※ 팔로워 구간은 빠른 선발을 위한 운영 기준이며, 팔로워 수만으로 실제 도달력이나 판매 효과를 보장하지 않습니다.',
    '※ 노란 칸은 담당자가 확인해 적는 칸입니다(온비짱 화면에서 적으면 함께 들어갑니다).',
    '※ AI 초안(Claude) 중 콘텐츠 적합성·리뷰는 담당자가 확인하고 적용한 것만 점수로 썼습니다(‘점수 출처’가 ‘AI 초안 확인·적용’). 지원동기는 AI 채점을 바로 반영했습니다. ‘AI 적합성·AI 리뷰·AI 지원동기’ 칸은 AI 가 매긴 점수 그대로입니다.',
  ]
  lines.forEach((t, i) => {
    const c = info.getCell(i + 1, 1)
    c.value = t
    c.font = { name: '맑은 고딕', size: i === 0 ? 13 : 10, bold: i === 0 || t.startsWith('[') }
    c.alignment = { wrapText: true, vertical: 'top' }
  })

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
