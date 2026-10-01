import { AbortError } from './sinks'

export interface OpenedVideo {
  video: HTMLVideoElement
  duration: number
  width: number
  height: number
  /** 영상 요소와 object URL 을 정리한다 */
  dispose(): void
}

const UNPLAYABLE = '이 브라우저가 재생할 수 없는 영상입니다. MP4(H.264)나 WebM 으로 바꿔서 올려 주세요.'

function once(target: EventTarget, ok: string[], bad: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      ok.forEach((n) => target.removeEventListener(n, onOk))
      bad.forEach((n) => target.removeEventListener(n, onBad))
      signal?.removeEventListener('abort', onAbort)
      clearTimeout(timer)
    }
    const onOk = (e: Event) => {
      cleanup()
      resolve(e.type)
    }
    const onBad = () => {
      cleanup()
      reject(new Error(UNPLAYABLE))
    }
    const onAbort = () => {
      cleanup()
      reject(new AbortError())
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('영상을 읽는 데 너무 오래 걸립니다. 파일이 손상되지 않았는지 확인해 주세요.'))
    }, timeoutMs)
    ok.forEach((n) => target.addEventListener(n, onOk))
    bad.forEach((n) => target.addEventListener(n, onBad))
    signal?.addEventListener('abort', onAbort)
  })
}

/**
 * 녹화 직후의 WebM 처럼 길이가 적혀 있지 않은 파일은 duration 이 Infinity 로 나온다.
 * 끝으로 한 번 보내면 브라우저가 실제 길이를 알아낸다.
 */
async function resolveDuration(video: HTMLVideoElement, signal?: AbortSignal): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration
  video.currentTime = 1e7
  try {
    await once(video, ['durationchange', 'seeked'], ['error'], 15_000, signal)
    if (!Number.isFinite(video.duration)) await once(video, ['durationchange'], ['error'], 5_000, signal)
  } catch (err) {
    if (err instanceof AbortError) throw err
  }
  const d = Number.isFinite(video.duration) ? video.duration : video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0
  video.currentTime = 0
  await once(video, ['seeked'], ['error'], 15_000, signal).catch(() => undefined)
  return d
}

/** 파일을 화면 밖 <video> 로 열어 길이·크기를 알아낸다. 프레임을 뽑는 용도라 소리는 끈다. */
export async function openVideo(file: Blob, signal?: AbortSignal): Promise<OpenedVideo> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  const dispose = () => {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
  try {
    video.src = url
    if (video.readyState < 2) await once(video, ['loadeddata'], ['error'], 30_000, signal)
    const duration = await resolveDuration(video, signal)
    if (!video.videoWidth || !video.videoHeight) throw new Error('화면이 없는 파일입니다(소리만 있는 파일일 수 있습니다).')
    if (!(duration > 0)) throw new Error(UNPLAYABLE)
    return { video, duration, width: video.videoWidth, height: video.videoHeight, dispose }
  } catch (err) {
    dispose()
    throw err
  }
}

/** 지정한 시각의 프레임이 그릴 수 있는 상태가 될 때까지 기다린다. */
export async function seekTo(video: HTMLVideoElement, time: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new AbortError()
  const max = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.001) : time
  const target = Math.min(Math.max(0, time), max)
  if (Math.abs(video.currentTime - target) < 0.0005 && !video.seeking && video.readyState >= 2) return
  const waiting = once(video, ['seeked'], ['error'], 20_000, signal)
  video.currentTime = target
  await waiting
  if (video.readyState < 2) await once(video, ['canplay', 'loadeddata'], ['error'], 20_000, signal)
}
