// 선택 기능: Word·Excel·PPT·한글 문서를 LibreOffice 로 PDF 로 바꾼다.
// 온비짱에서 편집 대상 파일이 서버로 오는 유일한 경로다. 화면에 그 사실을 표시하고, 사용자가 고른 경우에만 호출된다.
//
//   GET  /api/convert/status          → { available, maxBytes, extensions }
//   POST /api/convert/office-to-pdf   → multipart(file) → application/pdf
//
// 안전 장치
// - 업로드는 요청마다 새로 만든 임시 폴더에만 쓰고, 응답이 끝나면(성공·실패·중단 모두) 폴더째 지운다.
// - 디스크에 쓰는 이름은 서버가 정한다(input.<확장자>). 사용자가 보낸 파일 이름은 쓰지 않는다.
// - 확장자 화이트리스트 + 파일 앞머리(ZIP/OLE) 확인, 100MB·파일 1개 제한.
// - LibreOffice 는 execFile 로 인자 배열을 넘겨 실행한다(셸을 거치지 않는다). 시간 제한을 넘으면 강제 종료.
// - 동시에 2건까지만 변환하고 나머지는 잠깐 줄을 세운다.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import multer from 'multer'

export const MAX_BYTES = 100 * 1024 * 1024
export const EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp', 'hwpx', 'odt', 'ods', 'odp']
const ZIP_BASED = new Set(['docx', 'xlsx', 'pptx', 'hwpx', 'odt', 'ods', 'odp'])
const TIMEOUT_MS = Number(process.env.CONVERT_TIMEOUT_MS ?? 120_000)
const MAX_ACTIVE = 2
const MAX_WAITING = 8
const TEMP_PREFIX = 'onbijjang-convert-'

/** soffice 실행 파일을 찾는다. 환경 변수 SOFFICE_PATH → PATH → 흔한 설치 위치 순. 없으면 null. */
export function findSoffice(env = process.env) {
  const candidates = []
  if (env.SOFFICE_PATH) candidates.push(env.SOFFICE_PATH)
  const names = process.platform === 'win32' ? ['soffice.exe', 'soffice.com'] : ['soffice', 'libreoffice']
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (dir) for (const name of names) candidates.push(path.join(dir.replace(/^"|"$/g, ''), name))
  }
  if (process.platform === 'win32') {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]) {
      if (base) candidates.push(path.join(base, 'LibreOffice', 'program', 'soffice.exe'))
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice')
  } else {
    candidates.push('/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice')
  }
  for (const file of candidates) {
    try {
      if (fs.statSync(file).isFile()) return file
    } catch {
      // 없는 경로는 건너뛴다
    }
  }
  return null
}

/** LibreOffice 실행. 인자 배열로 직접 실행하며 셸을 쓰지 않는다. */
function runSoffice(soffice, { input, outDir, profileDir, signal }) {
  const args = [
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--headless',
    '--invisible',
    '--norestore',
    '--nologo',
    '--nodefault',
    '--nolockcheck',
    '--nofirststartwizard',
    '--convert-to',
    'pdf',
    '--outdir',
    outDir,
    input,
  ]
  return new Promise((resolve, reject) => {
    execFile(soffice, args, { timeout: TIMEOUT_MS, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 4 * 1024 * 1024, shell: false, signal }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function looksLikeOffice(head, ext) {
  if (ZIP_BASED.has(ext)) return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05) // PK
  // doc·xls·ppt·hwp: OLE 복합 문서
  return head.length >= 8 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0 && head[4] === 0xa1 && head[5] === 0xb1 && head[6] === 0x1a && head[7] === 0xe1
}

const extOf = (name) => {
  const i = String(name ?? '').lastIndexOf('.')
  return i >= 0 ? String(name).slice(i + 1).toLowerCase() : ''
}

/**
 * @param {import('express').Express} app
 * @param {object} _ctx 서버가 넘겨주는 도우미(requireAdmin 등) — 이 기능은 팀원 누구나 쓸 수 있어 쓰지 않는다.
 * @param {{ soffice?: string | null, run?: typeof runSoffice, tmpRoot?: string }} [overrides] 시험용: 실행 파일 위치·실행 함수·임시 폴더 바꿔치기
 */
export default function convertRoutes(app, _ctx, overrides = {}) {
  const soffice = overrides.soffice !== undefined ? overrides.soffice : findSoffice()
  const run = overrides.run ?? runSoffice
  const tmpRoot = overrides.tmpRoot ?? os.tmpdir()

  // 서버가 비정상 종료해 남은 임시 폴더가 있으면 시작할 때 치운다.
  try {
    for (const name of fs.readdirSync(tmpRoot)) {
      if (name.startsWith(TEMP_PREFIX)) fs.rmSync(path.join(tmpRoot, name), { recursive: true, force: true })
    }
  } catch {
    // 임시 폴더를 읽지 못해도 기능에는 영향 없다
  }

  let active = 0
  const waiting = []
  const acquire = () =>
    new Promise((resolve, reject) => {
      if (active < MAX_ACTIVE) {
        active++
        resolve()
      } else if (waiting.length >= MAX_WAITING) {
        reject(Object.assign(new Error('busy'), { code: 'BUSY' }))
      } else {
        waiting.push(resolve)
      }
    })
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => cb(null, req.convertDir),
      filename: (req, file, cb) => cb(null, `input.${extOf(file.originalname)}`),
    }),
    limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 2 },
    fileFilter: (_req, file, cb) => {
      if (EXTENSIONS.includes(extOf(file.originalname))) cb(null, true)
      else cb(Object.assign(new Error('unsupported'), { code: 'UNSUPPORTED_TYPE' }))
    },
  }).single('file')

  app.get('/api/convert/status', (_req, res) => {
    res.json({ available: Boolean(soffice), maxBytes: MAX_BYTES, extensions: soffice ? EXTENSIONS : [] })
  })

  app.post('/api/convert/office-to-pdf', async (req, res) => {
    if (!soffice) return res.status(503).json({ error: '이 서버에는 문서 변환 프로그램(LibreOffice)이 없어 서버 변환을 쓸 수 없습니다.' })
    if (!String(req.headers['content-type'] ?? '').startsWith('multipart/form-data')) {
      return res.status(400).json({ error: '변환할 파일을 보내 주세요.' })
    }
    const declared = Number(req.headers['content-length'] ?? 0)
    if (declared > MAX_BYTES + 1024 * 1024) return res.status(413).json({ error: '파일이 너무 큽니다. 100MB 이하만 변환할 수 있습니다.' })

    let dir = null
    let held = false
    // 요청한 쪽이 기다리다 끊으면 변환도 멈춘다.
    const gone = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) gone.abort()
    })
    const fail = (status, error) => ({ status, error })

    /** 변환을 끝까지 해 보고 보낼 내용을 돌려준다: { pdf } 또는 { status, error }, 요청이 끊겼으면 null */
    const work = async () => {
      try {
        await acquire()
        held = true
      } catch {
        return fail(503, '지금 변환 요청이 많습니다. 잠시 후 다시 시도해 주세요.')
      }
      dir = await fsp.mkdtemp(path.join(tmpRoot, TEMP_PREFIX))
      req.convertDir = dir

      try {
        await new Promise((resolve, reject) => upload(req, res, (err) => (err ? reject(err) : resolve())))
      } catch (err) {
        if (err?.code === 'LIMIT_FILE_SIZE') return fail(413, '파일이 너무 큽니다. 100MB 이하만 변환할 수 있습니다.')
        if (err?.code === 'UNSUPPORTED_TYPE') return fail(415, `변환할 수 없는 형식입니다. 가능한 형식: ${EXTENSIONS.join(', ')}`)
        return fail(400, '파일을 받지 못했습니다. 파일 하나만 다시 보내 주세요.')
      }
      if (!req.file) return fail(400, '변환할 파일을 보내 주세요.')

      const ext = extOf(req.file.filename)
      const input = path.join(dir, `input.${ext}`)
      const handle = await fsp.open(input, 'r')
      const head = Buffer.alloc(8)
      const { bytesRead } = await handle.read(head, 0, 8, 0)
      await handle.close()
      if (!looksLikeOffice(head.subarray(0, bytesRead), ext)) return fail(415, '파일 내용이 확장자와 맞지 않습니다. 문서 파일이 맞는지 확인해 주세요.')

      const outDir = path.join(dir, 'out')
      const profileDir = path.join(dir, 'profile')
      await fsp.mkdir(outDir)
      await fsp.mkdir(profileDir)
      try {
        await run(soffice, { input, outDir, profileDir, signal: gone.signal })
      } catch (err) {
        if (gone.signal.aborted) return null
        if (err?.killed || err?.signal) return fail(504, '변환이 너무 오래 걸려 중단했습니다. 문서를 나눠서 다시 시도해 주세요.')
        console.error('[온비짱] 문서 변환 실패:', String(err?.code ?? ''), String(err?.message ?? err).split('\n')[0].slice(0, 200))
        return fail(422, '문서를 변환하지 못했습니다. 문서가 손상되었거나 암호가 걸려 있을 수 있습니다.')
      }
      try {
        return { pdf: await fsp.readFile(path.join(outDir, 'input.pdf')) }
      } catch {
        const hint = ext === 'hwp' || ext === 'hwpx' ? ' 한글 문서는 서버의 LibreOffice 에 한글 확장(H2Orestart)이 있어야 변환됩니다.' : ''
        return fail(422, `문서를 변환하지 못했습니다.${hint}`)
      }
    }

    let reply
    try {
      reply = await work()
    } catch (err) {
      console.error('[온비짱] 문서 변환 오류:', err?.message ?? err)
      reply = fail(500, '서버에서 문제가 생겼습니다.')
    } finally {
      // 성공·실패·중단 어느 경우에도 올린 파일과 결과를 남기지 않는다. 응답을 보내기 전에 지운다.
      if (dir) await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch((err) => console.error('[온비짱] 임시 폴더 삭제 실패:', dir, err?.message))
      if (held) release()
    }
    if (!reply || gone.signal.aborted || res.headersSent) return
    if (!reply.pdf) return res.status(reply.status).json({ error: reply.error })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="converted.pdf"')
    res.setHeader('Cache-Control', 'no-store')
    res.send(reply.pdf)
  })
}
