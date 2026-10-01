/// <reference lib="webworker" />
// 일정한 간격으로 신호만 보내는 워커.
// 녹화 중에는 다른 창을 보고 있어 이 탭이 가려지는데, 그러면 화면 쪽 타이머는 1초에 한 번으로 느려진다.
// 워커의 타이머는 느려지지 않으므로 프레임을 그리는 박자를 여기서 만든다.
const scope = self as unknown as DedicatedWorkerGlobalScope
let timer: ReturnType<typeof setInterval> | null = null

scope.onmessage = (e: MessageEvent<{ interval: number } | 'stop'>) => {
  if (timer != null) clearInterval(timer)
  timer = null
  if (e.data === 'stop') return
  timer = setInterval(() => scope.postMessage(0), Math.max(4, e.data.interval))
}
