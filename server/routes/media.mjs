// 선택 기능: SNS 영상 받기 — 링크(유튜브·틱톡·인스타그램 등)에서 영상·소리·대본을 받아
// 원하는 형식·화질·음질로 바꾸고, 구간을 남기거나 잘라낸 파일을 돌려준다.
//
//   GET    /api/media/status           → { ready, installing, error, ytdlp, ffmpeg }
//   POST   /api/media/info             → { url } → 제목·길이·화질 목록·자막 언어
//   POST   /api/media/jobs             → 작업 시작 → { id }
//   GET    /api/media/jobs/:id         → 진행 상태
//   DELETE /api/media/jobs/:id         → 취소
//   GET    /api/media/jobs/:id/file    → 결과 파일
//
// 사용 권한: 로그인한 직원등급·스탭·전체마스터(또는 믿을 수 있는 네트워크). 서버 자원을 쓰는 기능이라 방문자에게 열지 않는다.
// 안전 장치
// - yt-dlp·ffmpeg 는 execFile/spawn 으로 인자 배열을 넘겨 실행한다(셸을 거치지 않는다).
// - 내부망 주소(localhost·사설 IP·*.internal)는 받지 않는다. 시험할 때만 MEDIA_ALLOW_LOCAL=1.
// - 작업마다 임시 폴더를 만들고, 받아 간 뒤 또는 30분이 지나면 폴더째 지운다.
// - 동시에 2건까지만 처리하고 나머지는 줄을 세운다. 길이 3시간·파일 2GB 를 넘는 영상은 받지 않는다.
import { execFile, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { ASR_LANGS, ASR_MAX_SECONDS, asrQueue, segmentsToSrt, transcribePcm } from './asr.mjs'

const require = createRequire(import.meta.url)
const MAX_ACTIVE = 2
const MAX_WAITING = 6
const MAX_DURATION = 3 * 60 * 60
const JOB_TTL_MS = 30 * 60 * 1000
const TEMP_PREFIX = 'onbijjang-media-'
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'

export const VIDEO_FORMATS = ['mp4', 'mov', 'mkv', 'webm', 'avi']
export const AUDIO_FORMATS = ['mp3', 'm4a', 'wav']
export const TEXT_FORMATS = ['txt', 'srt']

// ── 실행 파일 찾기 ───────────────────────────────────────
function onPath(name) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const p = path.join(dir, name)
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return p
    } catch {}
  }
  return null
}
function pkgBin(pkg) {
  try {
    const p = require(pkg).path
    return p && fs.existsSync(p) ? p : null
  } catch {
    return null
  }
}
/** 실행 권한이 빠져 있으면(설치 스크립트를 건너뛴 경우) 붙이고, 안 되면 임시 폴더에 복사해 쓴다 */
function ensureExec(p) {
  if (!p) return null
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return p
  } catch {}
  try {
    fs.chmodSync(p, 0o755)
    return p
  } catch {}
  try {
    const copy = path.join(os.tmpdir(), `onbijjang-${path.basename(p)}`)
    fs.copyFileSync(p, copy)
    fs.chmodSync(copy, 0o755)
    return copy
  } catch {
    return null
  }
}
const FFMPEG = ensureExec(process.env.FFMPEG_PATH || pkgBin('@ffmpeg-installer/ffmpeg') || onPath('ffmpeg'))
const FFPROBE = ensureExec(process.env.FFPROBE_PATH || pkgBin('@ffprobe-installer/ffprobe') || onPath('ffprobe'))

// ── 시간·문자 도우미 (화면 쪽과 같은 규칙) ────────────────
/** 남길 구간 목록(초)으로 바꾼다. mode=keep 이면 그대로, cut 이면 전체에서 뺀 나머지 */
export function keepRanges(mode, ranges, duration) {
  const clean = (ranges ?? [])
    .map((r) => [Math.max(0, Number(r.start)), Math.min(duration || Infinity, Number(r.end))])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e - s >= 0.1)
    .sort((a, b) => a[0] - b[0])
  const merged = []
  for (const [s, e] of clean) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  if (mode !== 'cut') return merged
  if (!duration) return []
  const out = []
  let t = 0
  for (const [s, e] of merged) {
    if (s - t >= 0.1) out.push([t, s])
    t = Math.max(t, e)
  }
  if (duration - t >= 0.1) out.push([t, duration])
  return out
}

/** 자막(SRT) → 읽기 좋은 대본. 자동 자막에서 겹쳐 반복되는 줄을 정리한다 */
export function srtToText(srt) {
  const lines = []
  for (const block of srt.replace(/\r/g, '').split(/\n\n+/)) {
    const rows = block.split('\n').filter((l) => l && !/^\d+$/.test(l) && !/-->/.test(l))
    for (const row of rows) {
      const t = row.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
      if (t && lines[lines.length - 1] !== t) lines.push(t)
    }
  }
  return lines.join('\n') + '\n'
}

/** SRT 에서 남길 구간에 걸치는 자막만 남긴다 */
export function filterSrt(srt, keep) {
  if (!keep) return srt
  const toSec = (s) => {
    const m = s.match(/(\d+):(\d+):(\d+)[,.](\d+)/)
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : 0
  }
  let n = 0
  const out = []
  for (const block of srt.replace(/\r/g, '').split(/\n\n+/)) {
    const tl = block.split('\n').find((l) => l.includes('-->'))
    if (!tl) continue
    const [a, b] = tl.split('-->').map((x) => toSec(x.trim()))
    if (keep.some(([s, e]) => b > s && a < e)) out.push(`${++n}\n${block.split('\n').filter((l) => !/^\d+$/.test(l)).join('\n')}`)
  }
  return out.join('\n\n') + '\n'
}

export function safeName(s) {
  return (String(s || '영상').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '영상')
}

// ── 주소 검사 ─────────────────────────────────────────────
function isPrivateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true
  if (net.isIP(h) === 4) {
    const [a, b] = h.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  if (net.isIP(h) === 6) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')
  return false
}
export function checkUrl(raw, allowLocal = false) {
  const s = String(raw ?? '').trim()
  if (!s || s.length > 2000) return { error: '링크를 붙여넣으세요.' }
  let u
  try {
    u = new URL(s)
  } catch {
    return { error: '링크 형식이 아닙니다. https:// 로 시작하는 주소를 붙여넣으세요.' }
  }
  if (!/^https?:$/.test(u.protocol)) return { error: 'https:// 로 시작하는 주소만 받을 수 있습니다.' }
  if (!allowLocal && isPrivateHost(u.hostname)) return { error: '이 주소는 받을 수 없습니다.' }
  return { url: u.toString() }
}

/** yt-dlp 오류를 사용자 말로 */
export function friendlyError(stderr) {
  const t = String(stderr ?? '')
  if (/Sign in to confirm|not a bot|confirm you.re not/i.test(t)) return '유튜브가 이 서버에서의 요청을 막았습니다(로봇 확인). 잠시 뒤 다시 해 보거나 다른 영상으로 시도하세요.'
  if (/login required|rate-limit|requires authentication|Requested content is not available|use --cookies/i.test(t)) return '이 영상은 로그인해야 볼 수 있어 받을 수 없습니다(인스타그램·비공개 영상 등).'
  if (/Private video|This video is private/i.test(t)) return '비공개 영상이라 받을 수 없습니다.'
  if (/Unsupported URL/i.test(t)) return '지원하지 않는 주소입니다. 영상 페이지 주소를 그대로 붙여넣었는지 확인하세요.'
  if (/Video unavailable|has been removed|not available in your country|geo/i.test(t)) return '영상을 볼 수 없습니다(삭제·지역 제한 등).'
  if (/live event|is live|premieres in/i.test(t)) return '진행 중인 라이브·예정된 영상은 받을 수 없습니다.'
  if (/HTTP Error 429|Too Many Requests/i.test(t)) return '사이트가 요청을 잠시 막았습니다. 몇 분 뒤 다시 시도하세요.'
  if (/no subtitles|There are no subtitles/i.test(t)) return '이 영상에는 자막(대본)이 없습니다.'
  const last = t.trim().split('\n').filter((l) => /ERROR/.test(l)).pop()
  return last ? `받지 못했습니다: ${last.replace(/^.*?ERROR:\s*/, '').slice(0, 200)}` : '받지 못했습니다. 링크를 확인하고 다시 시도하세요.'
}

export default async function mediaRoutes(app, { DATA_DIR, TRUSTED, currentUser, isAdmin }) {
  const allowLocal = process.env.MEDIA_ALLOW_LOCAL === '1'
  const BIN_DIR = path.join(DATA_DIR, 'bin')
  const LOCAL_YTDLP = path.join(BIN_DIR, 'yt-dlp')

  // ── 권한 ──
  const requireStaff = (req, res, next) => {
    const role = currentUser?.(req)?.role
    if (TRUSTED || isAdmin(req) || role === 'member' || role === 'staff' || role === 'admin') return next()
    res.status(401).json({ error: '직원등급 이상 계정으로 로그인해야 쓸 수 있습니다.' })
  }

  // ── yt-dlp 준비(없으면 받고, 하루에 한 번 업데이트) ──
  const tool = { ytdlp: process.env.YTDLP_PATH || onPath('yt-dlp') || (fs.existsSync(LOCAL_YTDLP) ? LOCAL_YTDLP : null), installing: null, error: null }
  async function ensureYtdlp() {
    if (tool.ytdlp) return tool.ytdlp
    if (process.platform !== 'linux' || process.arch !== 'x64') {
      tool.error = '이 서버에서는 yt-dlp 를 자동으로 설치할 수 없습니다. YTDLP_PATH 를 지정하세요.'
      throw new Error(tool.error)
    }
    tool.installing ??= (async () => {
      await fsp.mkdir(BIN_DIR, { recursive: true })
      const res = await fetch(YTDLP_URL, { redirect: 'follow' })
      if (!res.ok) throw new Error(`yt-dlp 내려받기 실패 (${res.status})`)
      const tmp = `${LOCAL_YTDLP}.${process.pid}.tmp`
      await fsp.writeFile(tmp, Buffer.from(await res.arrayBuffer()))
      await fsp.chmod(tmp, 0o755)
      await fsp.rename(tmp, LOCAL_YTDLP)
      tool.ytdlp = LOCAL_YTDLP
      tool.error = null
      console.log('[온비짱] yt-dlp 를 설치했습니다.')
    })()
      .catch((err) => {
        tool.error = `내려받기 도구를 준비하지 못했습니다: ${err.message}`
        throw err
      })
      .finally(() => {
        tool.installing = null
      })
    await tool.installing
    return tool.ytdlp
  }
  // 자체 설치본은 하루에 한 번 최신으로(사이트가 자주 바뀌어 오래된 yt-dlp 는 실패한다)
  setInterval(() => {
    if (tool.ytdlp === LOCAL_YTDLP) execFile(LOCAL_YTDLP, ['-U'], { timeout: 120_000 }, () => {})
  }, 24 * 60 * 60 * 1000).unref()
  if (tool.ytdlp === LOCAL_YTDLP) execFile(LOCAL_YTDLP, ['-U'], { timeout: 120_000 }, () => {})

  const run = (bin, args, { timeout = 90_000 } = {}) =>
    new Promise((resolve, reject) => {
      execFile(bin, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stderr: String(stderr) }))
        else resolve(String(stdout))
      })
    })
  const baseArgs = () => ['--no-playlist', '--no-warnings', '--ignore-config', ...(FFMPEG ? ['--ffmpeg-location', path.dirname(FFMPEG)] : [])]

  app.get('/api/media/status', requireStaff, (_req, res) => {
    if (!tool.ytdlp && !tool.installing) ensureYtdlp().catch(() => {})
    res.json({ ready: Boolean(tool.ytdlp && FFMPEG), installing: Boolean(tool.installing), error: tool.error, ffmpeg: Boolean(FFMPEG) })
  })

  // ── 영상 정보 ──
  app.post('/api/media/info', requireStaff, async (req, res) => {
    const chk = checkUrl(req.body?.url, allowLocal)
    if (chk.error) return res.status(400).json({ error: chk.error })
    try {
      const bin = await ensureYtdlp()
      const out = await run(bin, [...baseArgs(), '-J', '--skip-download', chk.url])
      const j = JSON.parse(out)
      const formats = Array.isArray(j.formats) ? j.formats : []
      const heights = [...new Set(formats.filter((f) => f.vcodec && f.vcodec !== 'none' && f.height).map((f) => f.height))].sort((a, b) => b - a)
      const hasVideo = formats.some((f) => f.vcodec && f.vcodec !== 'none') || Boolean(j.width)
      const subs = Object.keys(j.subtitles ?? {}).filter((k) => k !== 'live_chat')
      const autos = Object.keys(j.automatic_captions ?? {})
      // 파일 주소를 바로 넣은 경우 사이트가 길이를 알려 주지 않는다 → 직접 재 본다(같은 주소만)
      let probed = null
      if (!Number(j.duration) && j.direct && FFPROBE) {
        try {
          const pj = JSON.parse(await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,height', '-of', 'json', chk.url], { timeout: 20_000 }))
          const v = (pj.streams ?? []).filter((x) => x.codec_type === 'video' && x.height)
          probed = { duration: Number(pj.format?.duration) || 0, heights: v.map((x) => Number(x.height)) }
        } catch {}
      }
      if (probed?.heights.length) for (const h of probed.heights) if (!heights.includes(h)) heights.push(h)
      res.json({
        url: chk.url,
        id: j.id,
        site: j.extractor_key || j.extractor || '',
        title: j.title || '',
        uploader: j.uploader || j.channel || '',
        duration: Number(j.duration) || probed?.duration || 0,
        thumbnail: j.thumbnail || '',
        webpage: j.webpage_url || chk.url,
        isLive: Boolean(j.is_live),
        hasVideo: hasVideo || Boolean(probed?.heights.length),
        heights,
        subtitles: subs.slice(0, 40),
        autoCaptions: autos.filter((k) => /^(ko|en|ja|zh)/.test(k)).slice(0, 20),
      })
    } catch (err) {
      if (err instanceof SyntaxError) return res.status(502).json({ error: '영상 정보를 읽지 못했습니다.' })
      res.status(422).json({ error: err.stderr ? friendlyError(err.stderr) : tool.error || '영상 정보를 읽지 못했습니다.' })
    }
  })

  // ── 작업 ──
  const jobs = new Map()
  let active = 0
  const queue = []
  const ownerOf = (req) => currentUser?.(req)?.id ?? (isAdmin(req) ? 'admin' : req.ip)

  function publicJob(j) {
    return { id: j.id, status: j.status, stage: j.stage, progress: Math.round(j.progress), error: j.error, filename: j.filename, size: j.size, position: j.status === 'queued' ? queue.indexOf(j) + 1 : 0 }
  }
  async function cleanup(j) {
    if (j.dir) await fsp.rm(j.dir, { recursive: true, force: true }).catch(() => {})
    j.dir = null
  }
  setInterval(() => {
    const now = Date.now()
    for (const j of jobs.values()) {
      if (now - j.createdAt > JOB_TTL_MS) {
        j.child?.kill('SIGKILL')
        void cleanup(j)
        jobs.delete(j.id)
      }
    }
  }, 60_000).unref()

  function spawnTracked(j, bin, args, onLine) {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      j.child = child
      let err = ''
      let buf = ''
      const feed = (chunk) => {
        buf += chunk
        const parts = buf.split(/[\r\n]+/)
        buf = parts.pop() ?? ''
        for (const p of parts) onLine?.(p)
      }
      child.stdout.on('data', (d) => feed(String(d)))
      child.stderr.on('data', (d) => {
        const s = String(d)
        err = (err + s).slice(-20000)
        feed(s)
      })
      child.on('error', reject)
      child.on('close', (code, signal) => {
        j.child = null
        if (j.status === 'canceled') return reject(Object.assign(new Error('canceled'), { canceled: true }))
        if (code === 0) resolve()
        else reject(Object.assign(new Error(`exit ${code ?? signal}`), { stderr: err }))
      })
    })
  }

  const probe = async (file) => {
    if (!FFPROBE) return { duration: 0, v: null, a: null }
    const out = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', file], { timeout: 60_000 })
    const j = JSON.parse(out)
    const streams = j.streams ?? []
    return {
      duration: Number(j.format?.duration) || 0,
      v: streams.find((s) => s.codec_type === 'video')?.codec_name ?? null,
      a: streams.find((s) => s.codec_type === 'audio')?.codec_name ?? null,
    }
  }

  function videoSelector(container, height) {
    const h = height ? `[height<=${height}]` : ''
    if (container === 'webm') return `bv*[ext=webm]${h}+ba[ext=webm]/bv*${h}+ba/b${h}/b`
    // AV1 은 이 서버의 ffmpeg 가 풀지 못하므로 피한다. H.264 + AAC 를 먼저 찾는다
    return `bv*[vcodec^=avc1]${h}+ba[ext=m4a]/bv*[vcodec!^=av01]${h}+ba/b[vcodec!^=av01]${h}/bv*${h}+ba/b${h}/b`
  }

  function encodeArgs(container, abr) {
    const a = `${abr}k`
    switch (container) {
      case 'avi': return ['-c:v', 'mpeg4', '-q:v', '2', '-c:a', 'libmp3lame', '-b:a', a]
      case 'webm': return ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-c:a', 'libopus', '-b:a', a]
      default: return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', a, ...(container === 'mp4' || container === 'mov' ? ['-movflags', '+faststart'] : [])]
    }
  }
  const audioEncode = (fmt, abr) => (fmt === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', `${abr}k`] : fmt === 'm4a' ? ['-c:a', 'aac', '-b:a', `${abr}k`] : ['-c:a', 'pcm_s16le'])

  async function ffmpegRun(j, args, outDuration, from, to) {
    await spawnTracked(j, FFMPEG, ['-hide_banner', '-y', ...args], (line) => {
      const m = line.match(/time=(\d+):(\d+):(\d+\.?\d*)/)
      if (m && outDuration > 0) j.progress = from + Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / outDuration) * (to - from)
    })
  }

  /** 소리를 받아 16kHz 모노로 바꾼 뒤 음성 인식 → SRT. 남길 구간만 인식하고 시간은 원본 기준으로 둔다 */
  async function speechToSrt(j, bin, o, edited) {
    if (!FFMPEG) throw new Error('이 서버에 영상 변환 프로그램(ffmpeg)이 없습니다.')
    j.stage = '소리를 받는 중'
    await spawnTracked(j, bin, [...baseArgs(), '--newline', '--no-part', '--max-filesize', '1G', '--match-filter', `duration <? ${MAX_DURATION}`, '-f', 'ba/b', '-o', path.join(j.dir, 'asr.%(ext)s'), o.url], (line) => {
      const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
      if (m) j.progress = Math.min(20, Number(m[1]) * 0.2)
    })
    const src = (await fsp.readdir(j.dir)).filter((f) => f.startsWith('asr.')).map((f) => path.join(j.dir, f))[0]
    if (!src) throw Object.assign(new Error('no file'), { stderr: 'ERROR: 소리 파일을 받지 못했습니다.' })
    const info = await probe(src)
    if (!info.a) throw new Error('이 영상에는 소리가 없습니다.')
    const dur = info.duration || o.duration
    const ranges = edited ? keepRanges(o.edit.mode, o.edit.ranges, dur) : [[0, dur || ASR_MAX_SECONDS]]
    if (!ranges.length) throw new Error('남는 구간이 없습니다. 구간 시간을 확인하세요.')
    const total = ranges.reduce((a, [s, e]) => a + (e - s), 0)
    if (total > ASR_MAX_SECONDS + 1) throw new Error(`음성 인식은 한 번에 ${ASR_MAX_SECONDS / 60}분까지 할 수 있습니다. [구간 편집]으로 나눠서 받으세요.`)
    j.stage = '음성 인식 차례를 기다리는 중'
    j.progress = 20
    return asrQueue(async () => {
      const segs = []
      let done = 0
      for (const [s, e] of ranges) {
        if (j.status === 'canceled') throw Object.assign(new Error('canceled'), { canceled: true })
        const pcmFile = path.join(j.dir, 'asr.pcm')
        await run(FFMPEG, ['-v', 'error', '-y', '-ss', String(s), '-to', String(e), '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', pcmFile], { timeout: 10 * 60_000 })
        const buf = await fsp.readFile(pcmFile)
        await fsp.rm(pcmFile, { force: true })
        const pcm = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4))
        const len = e - s
        j.stage = '음성을 글로 바꾸는 중'
        segs.push(
          ...(await transcribePcm(pcm.byteOffset % 4 ? new Float32Array(pcm) : pcm, {
            DATA_DIR,
            language: ASR_LANGS[o.asrLang] !== undefined ? o.asrLang : 'ko',
            offset: s,
            isCanceled: () => j.status === 'canceled',
            onDownload: (pct) => {
              j.stage = `음성 인식 모델을 처음 한 번 받는 중 (${Math.round(pct)}%)`
            },
            onProgress: (f) => {
              j.stage = '음성을 글로 바꾸는 중'
              j.progress = 20 + ((done + f * len) / total) * 79
            },
          })),
        )
        done += len
      }
      return segmentsToSrt(segs)
    })
  }

  async function runJob(j) {
    const o = j.opts
    j.dir = await fsp.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX))
    const bin = await ensureYtdlp()
    // 화면에서 정한 파일 이름이 있으면 그대로(확장자만 붙인다), 없으면 제목 + 편집 표시
    const custom = typeof o.name === 'string' && o.name.trim() !== ''
    const base = safeName(custom ? o.name.replace(/\.(mp4|mov|mkv|webm|avi|mp3|m4a|wav|txt|srt)$/i, '') : o.title)
    const edited = o.edit?.enabled && Array.isArray(o.edit.ranges) && o.edit.ranges.length > 0
    const tag = edited && !custom ? (o.edit.mode === 'cut' ? '_잘라냄' : '_구간') : ''
    const dlProgress = (line) => {
      const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
      if (m) j.progress = Math.min(60, Number(m[1]) * 0.6)
    }

    if (o.kind === 'transcript') {
      let srt = null
      let how = '자막'
      if (o.asr !== 'always') {
        j.stage = '자막을 받는 중'
        const langs = o.subLang ? [o.subLang] : ['ko', 'ko-KR', 'en']
        await spawnTracked(j, bin, [...baseArgs(), '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', langs.join(','), '--sub-format', 'srt/vtt/best', '--convert-subs', 'srt', '-o', path.join(j.dir, 'sub.%(ext)s'), o.url]).catch((e) => {
          if (e.canceled || o.asr === 'never') throw e
        })
        const files = (await fsp.readdir(j.dir)).filter((f) => f.endsWith('.srt'))
        if (files.length) srt = await fsp.readFile(path.join(j.dir, files[0]), 'utf8')
        else if (o.asr === 'never') throw Object.assign(new Error('no subs'), { stderr: 'There are no subtitles' })
      }
      if (srt == null) {
        srt = await speechToSrt(j, bin, o, edited)
        how = '음성인식'
      } else if (edited) srt = filterSrt(srt, keepRanges(o.edit.mode, o.edit.ranges, o.duration))
      const text = o.format === 'srt' ? srt : srtToText(srt)
      if (!text.trim()) throw new Error('알아들을 수 있는 말소리가 없습니다(음악만 있거나 소리가 작을 수 있습니다).')
      const outName = `${base}${tag}_${how === '음성인식' ? '대본(음성인식)' : '대본'}.${o.format}`
      const out = path.join(j.dir, 'out.' + o.format)
      await fsp.writeFile(out, '\ufeff' + text, 'utf8')
      return { out, outName }
    }

    j.stage = '영상을 받는 중'
    const fmt = o.kind === 'audio' ? 'ba/b' : videoSelector(o.format, o.height)
    await spawnTracked(j, bin, [...baseArgs(), '--newline', '--no-part', '--max-filesize', '2G', '--match-filter', `duration <? ${MAX_DURATION}`, '-f', fmt, ...(o.kind === 'audio' ? [] : ['--merge-output-format', 'mkv']), '-o', path.join(j.dir, 'src.%(ext)s'), o.url], dlProgress)
    const src = (await fsp.readdir(j.dir)).filter((f) => f.startsWith('src.')).map((f) => path.join(j.dir, f))[0]
    if (!src) throw Object.assign(new Error('no file'), { stderr: 'ERROR: 받은 파일이 없습니다(길이 3시간·2GB 제한을 넘었을 수 있습니다).' })
    if (!FFMPEG) throw new Error('이 서버에 영상 변환 프로그램(ffmpeg)이 없습니다.')
    const info = await probe(src)
    const keep = edited ? keepRanges(o.edit.mode, o.edit.ranges, info.duration || o.duration) : null
    if (edited && !keep.length) throw new Error('남는 구간이 없습니다. 구간 시간을 확인하세요.')
    const outDur = keep ? keep.reduce((s, [a, b]) => s + (b - a), 0) : info.duration
    j.stage = edited ? '구간을 편집하는 중' : '파일 형식을 맞추는 중'
    j.progress = Math.max(j.progress, 60)
    const out = path.join(j.dir, `out.${o.format}`)

    if (o.kind === 'audio') {
      if (!info.a) throw new Error('이 영상에는 소리가 없습니다.')
      const args = ['-i', src]
      if (keep) {
        const parts = keep.map(([s, e], i) => `[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`)
        args.push('-filter_complex', `${parts.join(';')};${keep.map((_, i) => `[a${i}]`).join('')}concat=n=${keep.length}:v=0:a=1[a]`, '-map', '[a]')
      } else args.push('-vn', '-map', '0:a:0')
      args.push(...audioEncode(o.format, o.abr), out)
      await ffmpegRun(j, args, outDur, 60, 99)
      return { out, outName: `${base}${tag}.${o.format}` }
    }

    if (!info.v) throw new Error('이 링크에는 영상이 없습니다. [소리만]이나 [대본]으로 받아 보세요.')
    const h264aac = info.v === 'h264' && (!info.a || info.a === 'aac')
    const webmOk = /^(vp8|vp9)$/.test(info.v) && (!info.a || /^(opus|vorbis)$/.test(info.a))
    const canCopy = !keep && (o.format === 'mkv' || ((o.format === 'mp4' || o.format === 'mov') && h264aac) || (o.format === 'webm' && webmOk))
    const args = ['-i', src]
    if (keep) {
      const hasA = Boolean(info.a)
      const parts = keep.map(([s, e], i) => `[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]` + (hasA ? `;[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]` : ''))
      const ins = keep.map((_, i) => `[v${i}]` + (hasA ? `[a${i}]` : '')).join('')
      args.push('-filter_complex', `${parts.join(';')};${ins}concat=n=${keep.length}:v=1:a=${hasA ? 1 : 0}[v]${hasA ? '[a]' : ''}`, '-map', '[v]', ...(hasA ? ['-map', '[a]'] : []))
      args.push(...encodeArgs(o.format, o.abr))
    } else if (canCopy) {
      args.push('-map', '0:v:0', ...(info.a ? ['-map', '0:a:0'] : []), '-c', 'copy', ...(o.format === 'mp4' || o.format === 'mov' ? ['-movflags', '+faststart'] : []))
    } else {
      args.push('-map', '0:v:0', ...(info.a ? ['-map', '0:a:0'] : []), ...encodeArgs(o.format, o.abr))
    }
    args.push(out)
    await ffmpegRun(j, args, outDur, 60, 99)
    return { out, outName: `${base}${tag}.${o.format}` }
  }

  function pump() {
    while (active < MAX_ACTIVE && queue.length) {
      const j = queue.shift()
      if (j.status === 'canceled') continue
      active++
      j.status = 'running'
      j.stage = '준비 중'
      runJob(j)
        .then(async ({ out, outName }) => {
          const st = await fsp.stat(out)
          j.file = out
          j.filename = outName
          j.size = st.size
          j.progress = 100
          j.status = 'done'
          j.stage = '완료'
        })
        .catch(async (err) => {
          if (j.status === 'canceled') return cleanup(j)
          j.status = 'error'
          j.error = err.stderr ? friendlyError(err.stderr) : err.message && !/^exit /.test(err.message) ? err.message : '처리하지 못했습니다.'
          await cleanup(j)
        })
        .finally(() => {
          active--
          pump()
        })
    }
  }

  app.post('/api/media/jobs', requireStaff, (req, res) => {
    const b = req.body ?? {}
    const chk = checkUrl(b.url, allowLocal)
    if (chk.error) return res.status(400).json({ error: chk.error })
    const kind = ['video', 'audio', 'transcript'].includes(b.kind) ? b.kind : null
    if (!kind) return res.status(400).json({ error: '받을 내용을 고르세요.' })
    const allowed = kind === 'video' ? VIDEO_FORMATS : kind === 'audio' ? AUDIO_FORMATS : TEXT_FORMATS
    if (!allowed.includes(b.format)) return res.status(400).json({ error: '파일 형식을 고르세요.' })
    const height = Number(b.height) || 0
    const abr = [320, 256, 192, 128, 96].includes(Number(b.abr)) ? Number(b.abr) : 192
    const ranges = Array.isArray(b.edit?.ranges) ? b.edit.ranges.slice(0, 20).map((r) => ({ start: Number(r?.start), end: Number(r?.end) })) : []
    if (queue.length >= MAX_WAITING) return res.status(429).json({ error: '지금 받는 사람이 많습니다. 잠시 뒤 다시 시도하세요.' })
    const j = {
      id: crypto.randomBytes(8).toString('hex'),
      owner: ownerOf(req),
      createdAt: Date.now(),
      status: 'queued',
      stage: '차례를 기다리는 중',
      progress: 0,
      error: null,
      opts: {
        url: chk.url, kind, format: b.format, height: height > 0 && height <= 4320 ? height : 0, abr,
        subLang: typeof b.subLang === 'string' && /^[\w-]{1,20}$/.test(b.subLang) ? b.subLang : '',
        title: typeof b.title === 'string' ? b.title.slice(0, 200) : '',
        name: typeof b.name === 'string' ? b.name.slice(0, 120) : '',
        asr: ['auto', 'always', 'never'].includes(b.asr) ? b.asr : 'auto',
        asrLang: typeof b.asrLang === 'string' && b.asrLang in ASR_LANGS ? b.asrLang : 'ko',
        duration: Number(b.duration) || 0,
        edit: { enabled: Boolean(b.edit?.enabled) && ranges.length > 0, mode: b.edit?.mode === 'cut' ? 'cut' : 'keep', ranges },
      },
    }
    jobs.set(j.id, j)
    queue.push(j)
    pump()
    res.json({ id: j.id })
  })

  const own = (req, res) => {
    const j = jobs.get(req.params.jid)
    if (!j || j.owner !== ownerOf(req)) {
      res.status(404).json({ error: '작업을 찾을 수 없습니다. 30분이 지나 정리되었을 수 있습니다.' })
      return null
    }
    return j
  }
  app.get('/api/media/jobs/:jid', requireStaff, (req, res) => {
    const j = own(req, res)
    if (j) res.json(publicJob(j))
  })
  app.delete('/api/media/jobs/:jid', requireStaff, async (req, res) => {
    const j = own(req, res)
    if (!j) return
    j.status = 'canceled'
    j.child?.kill('SIGKILL')
    const qi = queue.indexOf(j)
    if (qi >= 0) queue.splice(qi, 1)
    if (!j.child) await cleanup(j)
    jobs.delete(j.id)
    res.json({ ok: true })
  })
  app.get('/api/media/jobs/:jid/file', requireStaff, (req, res) => {
    const j = own(req, res)
    if (!j) return
    if (j.status !== 'done' || !j.file) return res.status(409).json({ error: '아직 준비되지 않았습니다.' })
    res.setHeader('Content-Disposition', `attachment; filename="download.${path.extname(j.filename).slice(1)}"; filename*=UTF-8''${encodeURIComponent(j.filename)}`)
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(j.file, (err) => {
      if (err && !res.headersSent) res.status(500).end()
    })
  })
}
