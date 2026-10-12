// 체험단 AI 평가 자료(JSON)를 Claude Code 대화에서 나눠 평가하기 좋게 푼다.
//   node scripts/sns-ai/prepare.mjs <평가자료.json> [작업폴더] [--chunk 12]
// 결과:
//   작업폴더/GUIDE.md          — 평가 기준(가이드)과 결과 형식
//   작업폴더/chunks/NN.md      — 한 묶음(기본 12명)의 자료: 계정, 공개 게시물 글, 지원동기, 받아 둔 사진 경로
//   작업폴더/images/<id>/N.jpg — 사진(평가할 때 열어 본다)
//   작업폴더/results/          — 묶음마다 NN.json 결과를 여기에 쓴다(merge.mjs 가 합친다)
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const packPath = args.find((a) => !a.startsWith('--'))
if (!packPath) {
  console.error('사용법: node scripts/sns-ai/prepare.mjs <평가자료.json> [작업폴더] [--chunk 12]')
  process.exit(1)
}
const outDir = args.filter((a) => !a.startsWith('--'))[1] ?? path.join(path.dirname(packPath), `${path.basename(packPath, '.json')}_work`)
const chunkSize = Number(args[args.indexOf('--chunk') + 1]) || 12
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'))
if (pack.format !== 'onbijjang-sns-ai-pack') throw new Error('온비짱 평가 자료 파일이 아닙니다.')

fs.mkdirSync(path.join(outDir, 'chunks'), { recursive: true })
fs.mkdirSync(path.join(outDir, 'results'), { recursive: true })
fs.mkdirSync(path.join(outDir, 'images'), { recursive: true })

const safe = (s) => s.replace(/[^\w.-]+/g, '_')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

async function download(url, referer, file) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) }, signal: ctrl.signal })
    clearTimeout(t)
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !/^image\//.test(type)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > 5_000_000) return null
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : 'jpg'
    const f = `${file}.${ext}`
    fs.writeFileSync(f, buf)
    return f
  } catch {
    return null
  }
}

fs.writeFileSync(
  path.join(outDir, 'GUIDE.md'),
  `# 평가 기준\n\n${pack.guide}\n\n# 결과 형식\n\n묶음 NN.md 를 평가하면 results/NN.json 에 아래 모양의 배열로 쓴다(지원자마다 하나).\n\n\`\`\`json\n[{ "kind": "ig|blog", "key": "계정", "fit": { "score": 0~25 또는 null, "reason": "근거" }, "review": { "score": "인스타 0~20 · 블로그 0~30 또는 null", "reason": "근거", "url": "평가한 게시물 주소", "date": "YYYY-MM-DD", "recent": false }, "motive": { "score": 0~15 또는 null, "reason": "근거", "keywords": ["키워드"] }, "note": "" }]\n\`\`\`\n\n- 근거가 없어 판단할 수 없으면 score 는 null(0 이 아님).\n- recent: 제품 리뷰가 없어 최근 30일 게시물로 평가했으면 true.\n- 지원동기가 null 이면 motive.score 도 null.\n`,
)

const items = pack.items.filter((it) => !it.error)
let made = 0
for (let c = 0; c * chunkSize < items.length; c++) {
  const part = items.slice(c * chunkSize, (c + 1) * chunkSize)
  const nn = String(c + 1).padStart(2, '0')
  const lines = [`# 묶음 ${nn} (${part.length}명) — GUIDE.md 기준으로 평가해 results/${nn}.json 에 쓰기`, '']
  for (const it of part) {
    const id = `${it.kind}_${safe(it.key)}`
    const dir = path.join(outDir, 'images', id)
    fs.mkdirSync(dir, { recursive: true })
    const files = []
    for (const [i, img] of (it.images ?? []).entries()) {
      const f = await download(img.url, img.referer, path.join(dir, String(i + 1)))
      if (f) files.push(`${f}  (${img.label})`)
    }
    lines.push(`## ${it.kind} · ${it.key}`, `계정: ${it.account}`, '', it.evidence, '', `[지원동기] ${it.motive == null ? '(없음 — motive.score 는 null)' : it.motive || '(비어 있음)'}`, '', files.length ? `[사진]\n${files.map((f) => `- ${f}`).join('\n')}` : '[사진] 없음', '', '---', '')
    made++
  }
  fs.writeFileSync(path.join(outDir, 'chunks', `${nn}.md`), lines.join('\n'))
  process.stdout.write(`묶음 ${nn} 준비 (${made}/${items.length})\n`)
}
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ jobId: pack.jobId, title: pack.title, total: items.length, chunkSize, errors: pack.items.filter((it) => it.error).map((it) => ({ kind: it.kind, key: it.key, error: it.error })) }, null, 1))
console.log(`완료: ${outDir} (묶음 ${Math.ceil(items.length / chunkSize)}개, 자료 오류 ${pack.items.length - items.length}명)`)
