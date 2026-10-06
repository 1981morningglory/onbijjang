// SNS 영상 받기 — 자막이 없는 영상의 말소리를 글로 바꾼다(음성 인식).
// 서버에 이미 들어 있는 @huggingface/transformers(onnxruntime-node)로 Whisper 모델을 돌린다.
// - 모델은 처음 쓸 때 한 번 huggingface.co 에서 받아 DATA_DIR/models 에 저장한다(재배포해도 남는다).
// - 무거운 작업이라 한 번에 한 건만 처리하고, 나머지는 차례를 기다린다.
// - 이 파일은 route 플러그인이 아니다(server/routes 로더가 건너뛰도록 기본 내보내기를 두지 않는다).
import path from 'node:path'

export const ASR_MODEL = process.env.MEDIA_ASR_MODEL || 'onnx-community/whisper-small'
export const ASR_MAX_SECONDS = 60 * 60
const WINDOW_S = 5 * 60 // 이 길이씩 끊어 인식하며 진행률을 알린다

export const ASR_LANGS = { auto: null, ko: 'korean', en: 'english', ja: 'japanese', zh: 'chinese' }

let pipePromise = null
let chain = Promise.resolve()

/** 한 번에 한 건만 돌린다 */
export function asrQueue(fn) {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}

function loadPipe(DATA_DIR, onDownload) {
  if (!pipePromise) {
    pipePromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = path.join(DATA_DIR, 'models')
      env.allowLocalModels = false
      const files = new Map()
      return pipeline('automatic-speech-recognition', ASR_MODEL, {
        device: 'cpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
        progress_callback: (p) => {
          if (p.status !== 'progress' || !p.total) return
          files.set(p.file, [p.loaded, p.total])
          let a = 0
          let b = 0
          for (const [l, t] of files.values()) (a += l), (b += t)
          onDownload?.(b ? (a / b) * 100 : 0)
        },
      })
    })()
    pipePromise.catch(() => (pipePromise = null))
  }
  return pipePromise
}

/**
 * 16kHz 모노 PCM(Float32Array) → [{ start, end, text }] (초, offset 만큼 밀어서)
 * onDownload(퍼센트): 모델을 처음 받는 동안, onProgress(0~1): 인식 진행
 */
export async function transcribePcm(pcm, { DATA_DIR, language = 'ko', offset = 0, onDownload, onProgress, isCanceled, transcriber }) {
  const pipe = transcriber ?? (await loadPipe(DATA_DIR, onDownload))
  const rate = 16000
  const win = WINDOW_S * rate
  const segs = []
  for (let at = 0; at < pcm.length; at += win) {
    if (isCanceled?.()) throw Object.assign(new Error('canceled'), { canceled: true })
    const part = pcm.subarray(at, Math.min(pcm.length, at + win))
    if (part.length < rate * 0.3) break
    const base = offset + at / rate
    const partLen = part.length / rate
    const r = await pipe(part, {
      language: ASR_LANGS[language] ?? null,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    })
    const chunks = Array.isArray(r?.chunks) && r.chunks.length ? r.chunks : [{ timestamp: [0, partLen], text: r?.text ?? '' }]
    for (const c of chunks) {
      const text = String(c.text ?? '').trim()
      if (!text) continue
      const s = Number(c.timestamp?.[0]) || 0
      const e = c.timestamp?.[1] == null ? partLen : Number(c.timestamp[1])
      segs.push({ start: base + Math.min(s, partLen), end: base + Math.min(Math.max(e, s + 0.5), partLen), text })
    }
    onProgress?.(Math.min(1, (at + part.length) / pcm.length))
  }
  return cleanSegments(segs)
}

/** 무음·음악 구간에서 같은 문장이 되풀이되는 것을 정리한다 */
export function cleanSegments(segs) {
  const out = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (last && last.text === s.text) {
      last.end = Math.max(last.end, s.end)
      continue
    }
    out.push({ ...s })
  }
  return out
}

function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

export function segmentsToSrt(segs) {
  return segs.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}`).join('\n\n') + '\n'
}
