/**
 * 온비짱 캡처 확장 프로그램 묶기.
 *   node scripts/build-extension.mjs
 * 1) public/favicon.svg 로 확장 아이콘 PNG(16/48/128)를 만든다.
 * 2) extension/capture 를 public/downloads/onbijjang-capture.zip 으로 묶는다.
 * 확장 프로그램 자체에는 빌드 단계가 없다(폴더 그대로 브라우저에 올릴 수 있다).
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'extension', 'capture')
const OUT_DIR = path.join(ROOT, 'public', 'downloads')
const OUT = path.join(OUT_DIR, 'onbijjang-capture.zip')
const ICON_SIZES = [16, 48, 128]

/** ZIP 에 넣지 않는 파일: 타입 선언(사이트·테스트 전용), 숨김 파일 */
const skip = (name) => name.endsWith('.d.ts') || name.startsWith('.') || name === 'Thumbs.db'

async function makeIcons() {
  const svg = await readFile(path.join(ROOT, 'public', 'favicon.svg'))
  await mkdir(path.join(SRC, 'icons'), { recursive: true })
  for (const size of ICON_SIZES) {
    // 작은 크기에서도 선이 뭉개지지 않도록 SVG 를 크게 그린 뒤 줄인다.
    const png = await sharp(svg, { density: 72 * (512 / 32) })
      .resize(size, size, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toBuffer()
    await writeFile(path.join(SRC, 'icons', `icon${size}.png`), png)
  }
}

async function collect(dir, base = '') {
  const out = []
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (skip(entry.name)) continue
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await collect(path.join(dir, entry.name), rel)))
    else out.push(rel)
  }
  return out
}

async function main() {
  await makeIcons()
  const manifest = JSON.parse(await readFile(path.join(SRC, 'manifest.json'), 'utf8'))
  const files = await collect(SRC)
  if (!files.includes('manifest.json')) throw new Error('manifest.json 이 없습니다.')

  const zip = new JSZip()
  // manifest.json 을 ZIP 맨 위에 둔다. Windows 의 "압축 풀기"가 ZIP 이름으로 폴더를 만들어 주므로
  // 그 폴더를 브라우저에서 고르면 된다.
  // 같은 내용이면 같은 ZIP 이 나오도록 날짜를 고정한다.
  const date = new Date(Date.UTC(2026, 0, 1))
  for (const rel of files) zip.file(rel, await readFile(path.join(SRC, rel)), { date })

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT, buf)
  console.log(`온비짱 캡처 v${manifest.version} — 파일 ${files.length}개, ${(buf.length / 1024).toFixed(1)} KB`)
  console.log(path.relative(ROOT, OUT))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
