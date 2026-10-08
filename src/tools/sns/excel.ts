/**
 * 선발 결과 엑셀: 인스타그램·블로그 상위 150명, 전체 순위, 확인이 필요한 지원자, 점수 기준.
 * 상위 150명 시트 오른쪽에는 100점 평가표의 '사람이 보고 매기는 항목' 빈칸을 붙인다(합계는 수식).
 */
import type { Worksheet } from 'exceljs'
import type { Applicant } from './parse'
import { WEIGHTS, type BlogRow, type IgRow } from './score'

export const TOP_N = 150

export interface ProblemRow {
  kind: string
  people: Applicant[]
  raw: string
  reason: string
}

export interface ExportInput {
  title: string
  ig: IgRow[]
  blog: BlogRow[]
  igPeople: Map<string, Applicant[]>
  blogPeople: Map<string, Applicant[]>
  problems: ProblemRow[]
  pending: { ig: number; blog: number }
}

const HEAD_FILL = 'FFEEF4F0'
const RUBRIC_FILL = 'FFFFF6D6'
const LINE = { style: 'thin' as const, color: { argb: 'FFB8C2BC' } }
const BORDER = { top: LINE, left: LINE, bottom: LINE, right: LINE }

const names = (ps: Applicant[] | undefined) => [...new Set((ps ?? []).map((p) => p.name).filter(Boolean))].join(', ')
const phones = (ps: Applicant[] | undefined) => [...new Set((ps ?? []).map((p) => p.phone).filter(Boolean))].join(', ')

interface Col {
  header: string
  width: number
  rubric?: boolean
  numFmt?: string
}

function sheet(ws: Worksheet, cols: Col[], rows: Array<Array<unknown>>, rubricSumCol?: { from: number; to: number; at: number }) {
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width))
  const head = ws.addRow(cols.map((c) => c.header))
  head.height = 34
  head.eachCell((cell, i) => {
    const c = cols[i - 1]
    cell.font = { name: '맑은 고딕', bold: true, size: 9.5 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.rubric ? RUBRIC_FILL : HEAD_FILL } }
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
      if (c.numFmt) cell.numFmt = c.numFmt
      if (c.rubric) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFCF0' } }
    })
    if (rubricSumCol) {
      const r = row.number
      const from = ws.getColumn(rubricSumCol.from).letter
      const to = ws.getColumn(rubricSumCol.to).letter
      row.getCell(rubricSumCol.at).value = { formula: `IF(COUNT(${from}${r}:${to}${r})=0,"",SUM(${from}${r}:${to}${r}))`, result: '' }
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 4 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
}

const link = (text: string, url: string) => ({ text, hyperlink: url })
const igUrl = (k: string) => `https://www.instagram.com/${k}/`
const blogUrl = (k: string) => `https://blog.naver.com/${k}`

const IG_COLS: Col[] = [
  { header: '순위', width: 6 },
  { header: '이름', width: 10 },
  { header: '연락처', width: 14 },
  { header: '아이디', width: 20 },
  { header: '팔로워', width: 10, numFmt: '#,##0' },
  { header: '읽은 게시물', width: 7 },
  { header: '평균 좋아요', width: 9, numFmt: '#,##0.0' },
  { header: '평균 댓글', width: 8, numFmt: '#,##0.0' },
  { header: '평균 반응\n(좋아요+댓글)', width: 11, numFmt: '#,##0.0' },
  { header: '참여율(%)', width: 8, numFmt: '0.00' },
  { header: '최근 30일\n게시물', width: 8 },
  { header: '계정', width: 12 },
  { header: `팔로워 점수\n(${WEIGHTS.ig.followers})`, width: 9, numFmt: '0.0' },
  { header: `반응 점수\n(${WEIGHTS.ig.engagement})`, width: 9, numFmt: '0.0' },
  { header: '총점\n(100)', width: 8, numFmt: '0.0' },
  { header: '비고', width: 22 },
]
const IG_RUBRIC: Col[] = [
  { header: '릴스 평균\n조회수 (30)', width: 10, rubric: true },
  { header: '참여율\n(20)', width: 8, rubric: true },
  { header: '팔로워\n(15)', width: 8, rubric: true },
  { header: '콘텐츠\n품질 (15)', width: 9, rubric: true },
  { header: '타깃\n적합도 (10)', width: 9, rubric: true },
  { header: '최근\n활동성 (5)', width: 8, rubric: true },
  { header: '계정\n진정성 (5)', width: 8, rubric: true },
  { header: '평가표\n합계', width: 8, rubric: true },
]

function igValues(r: IgRow, people: Map<string, Applicant[]>) {
  const d = r.data
  const kind = d.source === 'api' ? '비즈니스·크리에이터' : '개인(팔로워만)'
  const notes = [r.substituted ? '반응을 못 읽어 팔로워 위치로 대신' : '', d.hiddenLikes ? '좋아요 숨김 게시물 있음' : ''].filter(Boolean).join(' · ')
  return [
    r.rank,
    names(people.get(r.key)),
    phones(people.get(r.key)),
    link(r.key, igUrl(r.key)),
    d.followers,
    d.postsRead || null,
    d.avgLikes,
    d.avgComments,
    d.avgEngagement,
    r.engagementRate,
    d.posts30d,
    kind,
    r.followerScore,
    r.engagementScore,
    r.total,
    notes,
  ]
}

const BLOG_COLS = (dates: string[]): Col[] => [
  { header: '순위', width: 6 },
  { header: '이름', width: 10 },
  { header: '연락처', width: 14 },
  { header: '아이디', width: 20 },
  { header: '블로그 이름', width: 22 },
  ...dates.map((d, i) => ({ header: `방문자\n${d.slice(5)}${i === dates.length - 1 ? '\n(오늘·진행중)' : ''}`, width: 9, numFmt: '#,##0' })),
  { header: '평균 방문자\n(5일)', width: 10, numFmt: '#,##0.0' },
  { header: '이웃 수', width: 9, numFmt: '#,##0' },
  { header: '전체 방문자', width: 11, numFmt: '#,##0' },
  { header: '주제', width: 12 },
  { header: `방문자 점수\n(${WEIGHTS.blog.visitors})`, width: 9, numFmt: '0.0' },
  { header: `이웃 점수\n(${WEIGHTS.blog.neighbors})`, width: 9, numFmt: '0.0' },
  { header: '총점\n(100)', width: 8, numFmt: '0.0' },
  { header: '비고', width: 18 },
]
const BLOG_RUBRIC: Col[] = [
  { header: '일 평균\n방문자수 (25)', width: 10, rubric: true },
  { header: '네이버 검색\n노출력 (25)', width: 10, rubric: true },
  { header: '나머지 항목\n(50)', width: 10, rubric: true },
  { header: '평가표\n합계', width: 8, rubric: true },
]

function blogValues(r: BlogRow, people: Map<string, Applicant[]>, days: number) {
  const d = r.data
  const v = d.visitors.slice(-days).map((x) => x.cnt)
  while (v.length < days) v.unshift(null as unknown as number)
  const notes = [d.avgVisitors == null ? '방문자 수 비공개(0으로 계산)' : '', d.neighbors == null ? '이웃 수 비공개' : '', d.powerBlog ? '파워블로그' : ''].filter(Boolean).join(' · ')
  return [r.rank, names(people.get(r.key)), phones(people.get(r.key)), link(r.key, blogUrl(r.key)), d.name, ...v, d.avgVisitors, d.neighbors, d.totalVisitors, d.directory, r.visitorScore, r.neighborScore, r.total, notes]
}

export async function buildSelectionWorkbook(input: ExportInput): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = '온비짱'
  wb.created = new Date()
  const blank = (n: number) => Array.from({ length: n }, () => null)

  // 인스타그램
  const igTop = wb.addWorksheet(`인스타그램 TOP${TOP_N}`)
  const igCols = [...IG_COLS, ...IG_RUBRIC]
  const igFrom = IG_COLS.length + 1
  sheet(
    igTop,
    igCols,
    input.ig.slice(0, TOP_N).map((r) => [...igValues(r, input.igPeople), ...blank(IG_RUBRIC.length)]),
    { from: igFrom, to: igFrom + IG_RUBRIC.length - 2, at: igFrom + IG_RUBRIC.length - 1 },
  )

  // 블로그
  const dates = input.blog.find((r) => r.data.visitors.length)?.data.visitors.map((v) => v.date) ?? ['', '', '', '', '']
  const blogCols = BLOG_COLS(dates)
  const blogTop = wb.addWorksheet(`블로그 TOP${TOP_N}`)
  const bFrom = blogCols.length + 1
  sheet(
    blogTop,
    [...blogCols, ...BLOG_RUBRIC],
    input.blog.slice(0, TOP_N).map((r) => [...blogValues(r, input.blogPeople, dates.length), ...blank(BLOG_RUBRIC.length)]),
    { from: bFrom, to: bFrom + BLOG_RUBRIC.length - 2, at: bFrom + BLOG_RUBRIC.length - 1 },
  )

  sheet(wb.addWorksheet('인스타그램 전체'), IG_COLS, input.ig.map((r) => igValues(r, input.igPeople)))
  sheet(wb.addWorksheet('블로그 전체'), blogCols, input.blog.map((r) => blogValues(r, input.blogPeople, dates.length)))

  // 확인 필요
  const prob = wb.addWorksheet('확인 필요')
  sheet(
    prob,
    [
      { header: '구분', width: 12 },
      { header: '이름', width: 10 },
      { header: '연락처', width: 14 },
      { header: '적은 주소', width: 46 },
      { header: '이유', width: 40 },
    ],
    input.problems.map((p) => [p.kind, names(p.people), phones(p.people), p.raw, p.reason]),
  )
  prob.views = [{ state: 'frozen', ySplit: 1 }]

  // 점수 기준
  const info = wb.addWorksheet('점수 기준')
  info.getColumn(1).width = 110
  const lines = [
    input.title || '체험단 SNS 선발',
    `만든 때: ${new Date().toLocaleString('ko-KR')}`,
    input.pending.ig || input.pending.blog ? `※ 아직 수집 중: 인스타그램 ${input.pending.ig}명 · 블로그 ${input.pending.blog}명 (모두 끝난 뒤 다시 내려받으면 순위가 바뀔 수 있습니다)` : '모든 계정 수집 완료',
    '',
    '[인스타그램] 총점 100 = 팔로워 점수 60 + 반응 점수 40',
    '· 팔로워 점수 = 60 × (인스타그램 지원자 중 팔로워 수의 위치, 0~1)',
    '· 반응 점수 = 40 × (최근 게시물 10개 평균 반응(좋아요+댓글)의 위치, 0~1)',
    '· 반응은 Meta 공식 API 로 읽으며, 비즈니스·크리에이터 계정만 읽을 수 있습니다. 개인 계정은 팔로워만 읽고, 반응 점수 자리에 팔로워 위치를 대신 씁니다(비고에 표시).',
    '· 참여율(%) = 평균 반응 ÷ 팔로워 × 100',
    '',
    '[블로그] 총점 100 = 방문자 점수 70 + 이웃 점수 30',
    '· 방문자 점수 = 70 × (블로그 지원자 중 최근 5일 평균 방문자 수의 위치, 0~1). 5일 중 마지막 날은 수집한 날(오늘)이라 하루가 다 차지 않은 숫자입니다.',
    '· 이웃 점수 = 30 × (이웃 수의 위치, 0~1). 네이버는 서로이웃 수를 공개하지 않아 블로그에 보이는 전체 이웃 수를 씁니다.',
    '',
    "· '위치'는 지원자들을 숫자 순으로 줄 세웠을 때의 자리(백분위)입니다. 같은 숫자는 같은 자리입니다.",
    `· 노란 칸(평가표)은 담당자가 직접 보고 점수를 적는 칸입니다. 적으면 '평가표 합계'가 저절로 더해집니다.`,
  ]
  lines.forEach((t, i) => {
    const c = info.getCell(i + 1, 1)
    c.value = t
    c.font = { name: '맑은 고딕', size: i === 0 ? 14 : 10, bold: i === 0 || t.startsWith('[') }
    c.alignment = { wrapText: true, vertical: 'top' }
  })

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
