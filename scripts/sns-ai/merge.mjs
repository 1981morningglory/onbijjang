// 묶음별 결과(results/NN.json)를 합쳐 온비짱 ‘AI 초안 가져오기’용 파일을 만든다.
//   node scripts/sns-ai/merge.mjs <작업폴더> [결과파일.json]
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('사용법: node scripts/sns-ai/merge.mjs <작업폴더> [결과파일.json]')
  process.exit(1)
}
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
const out = process.argv[3] ?? path.join(dir, '..', `체험단_AI초안결과_${(meta.title || 'SNS').replace(/[\\/:*?"<>|]/g, '')}.json`)
const seen = new Map()
const problems = []
const inRange = (v, max) => v === null || (typeof v === 'number' && v >= 0 && v <= max)
for (const f of fs.readdirSync(path.join(dir, 'results')).filter((x) => x.endsWith('.json')).sort()) {
  let arr
  try {
    arr = JSON.parse(fs.readFileSync(path.join(dir, 'results', f), 'utf8'))
  } catch (err) {
    problems.push(`${f}: JSON 아님 (${err.message})`)
    continue
  }
  for (const r of Array.isArray(arr) ? arr : arr.items ?? []) {
    const reviewMax = r.kind === 'ig' ? 20 : 30
    if (!['ig', 'blog'].includes(r.kind) || typeof r.key !== 'string') {
      problems.push(`${f}: kind/key 이상 ${JSON.stringify(r).slice(0, 80)}`)
      continue
    }
    if (!inRange(r.fit?.score ?? null, 25) || !inRange(r.review?.score ?? null, reviewMax) || !inRange(r.motive?.score ?? null, 15)) problems.push(`${f}: ${r.kind}:${r.key} 점수 범위 밖(가져올 때 잘라 넣음)`)
    seen.set(`${r.kind}:${r.key}`, r)
  }
}
fs.writeFileSync(out, JSON.stringify({ format: 'onbijjang-sns-ai-drafts', jobId: meta.jobId, title: meta.title, createdAt: new Date().toISOString(), items: [...seen.values()] }, null, 1))
console.log(`합침: ${seen.size} / ${meta.total}명 → ${out}`)
if (seen.size < meta.total) console.log(`아직 결과 없는 지원자 ${meta.total - seen.size}명(묶음 결과를 더 쓰고 다시 합치면 됩니다)`)
for (const p of problems) console.log('확인:', p)
