/** 화면 녹화를 쓸 수 있는 환경인지와, 안 될 때 사용자에게 알려 줄 내용 */

export type CaptureProblem = 'insecure' | 'mobile' | 'unsupported'

export interface CaptureEnv {
  secure: boolean
  hasDisplayMedia: boolean
  userAgent: string
  maxTouchPoints: number
}

export function isMobile(userAgent: string, maxTouchPoints: number): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(userAgent)) return true
  // iPadOS 는 맥으로 표시된다.
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1
}

/** 문제가 없으면 null */
export function captureProblem(env: CaptureEnv): CaptureProblem | null {
  // HTTP 주소에서는 브라우저가 화면 공유 기능 자체를 숨긴다. 그래서 주소 문제를 먼저 본다.
  if (!env.secure) return 'insecure'
  if (isMobile(env.userAgent, env.maxTouchPoints)) return 'mobile'
  if (!env.hasDisplayMedia) return 'unsupported'
  return null
}

export function currentEnv(): CaptureEnv {
  return {
    secure: typeof window !== 'undefined' && window.isSecureContext,
    hasDisplayMedia: typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    maxTouchPoints: typeof navigator !== 'undefined' ? (navigator.maxTouchPoints ?? 0) : 0,
  }
}

export const PROBLEM_TEXT: Record<CaptureProblem, { title: string; body: string }> = {
  insecure: {
    title: '이 주소에서는 화면을 녹화할 수 없습니다',
    body: '브라우저는 보안 연결(https://)이나 내 PC 주소(localhost)에서만 화면 공유를 허용합니다. 주소가 http:// 로 시작한다면 https:// 주소로 접속하거나, 관리자에게 HTTPS 설정을 요청해 주세요.',
  },
  mobile: {
    title: '휴대폰·태블릿에서는 화면을 녹화할 수 없습니다',
    body: '모바일 브라우저는 화면 공유를 지원하지 않습니다. PC 의 크롬이나 엣지에서 이 페이지를 열어 주세요. 휴대폰 화면은 기기에 있는 화면 녹화 기능으로 찍은 뒤 "영상 구간 자르기"에서 다듬을 수 있습니다.',
  },
  unsupported: {
    title: '이 브라우저는 화면 공유를 지원하지 않습니다',
    body: '최신 크롬·엣지·파이어폭스에서 열어 주세요.',
  },
}

/** getDisplayMedia / getUserMedia 가 실패했을 때의 안내 */
export function shareErrorMessage(err: unknown): string | null {
  const name = err instanceof Error ? err.name : ''
  // 사용자가 고르기 창을 닫은 경우는 오류로 다루지 않는다.
  if (name === 'AbortError') return null
  if (name === 'NotAllowedError') return '화면 공유가 취소되었거나 막혀 있습니다. 다시 눌러 공유할 화면을 고르고, 계속 안 되면 주소창 왼쪽의 사이트 설정에서 화면 공유 권한을 확인해 주세요.'
  if (name === 'NotFoundError') return '공유할 수 있는 화면을 찾지 못했습니다.'
  if (name === 'NotReadableError') return '화면을 읽지 못했습니다. 운영체제의 화면 기록 권한이 브라우저에 허용되어 있는지 확인해 주세요.'
  return '화면 공유를 시작하지 못했습니다. 브라우저를 새로고침한 뒤 다시 시도해 주세요.'
}

export function micErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError') return '마이크 권한이 막혀 있습니다. 주소창 왼쪽의 사이트 설정에서 마이크를 허용하거나, 마이크 옵션을 끄고 녹화해 주세요.'
  if (name === 'NotFoundError') return '연결된 마이크를 찾지 못했습니다. 마이크를 연결하거나 마이크 옵션을 끄고 녹화해 주세요.'
  return '마이크를 쓸 수 없습니다. 다른 프로그램이 마이크를 쓰고 있지 않은지 확인하거나, 마이크 옵션을 끄고 녹화해 주세요.'
}

export interface RecorderFormat {
  mimeType: string
  kind: 'mp4' | 'webm'
}

const MP4_VIDEO = ['avc1.640028', 'avc1.4d0028', 'avc1.42E01E', 'avc1']
const WEBM_VIDEO = ['vp9', 'vp8']

function candidates(container: 'mp4' | 'webm', withAudio: boolean): string[] {
  const audio = container === 'mp4' ? 'mp4a.40.2' : 'opus'
  const list = (container === 'mp4' ? MP4_VIDEO : WEBM_VIDEO).map((v) => `video/${container};codecs=${withAudio ? `${v},${audio}` : v}`)
  return [...list, `video/${container}`]
}

/** MediaRecorder 가 만들 수 있는 형식. MP4 가 되면 MP4, 아니면 WebM. 둘 다 안 되면 null. */
export function pickRecorderFormat(isSupported: (type: string) => boolean, withAudio: boolean): RecorderFormat | null {
  for (const kind of ['mp4', 'webm'] as const) {
    for (const mimeType of candidates(kind, withAudio)) if (isSupported(mimeType)) return { mimeType, kind }
  }
  return null
}

export function detectRecorderFormat(withAudio = false): RecorderFormat | null {
  if (typeof MediaRecorder === 'undefined') return null
  return pickRecorderFormat((t) => {
    try {
      return MediaRecorder.isTypeSupported(t)
    } catch {
      return false
    }
  }, withAudio)
}
