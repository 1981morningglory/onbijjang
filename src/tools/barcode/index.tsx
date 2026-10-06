import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/ui'

/**
 * 바코드 생성 — EAN-13(평형·롱바) / 쿠팡 R(Code 128) → EPS·AI·PDF·SVG·PNG.
 * 팀이 먼저 써 보고 확정한 화면(public/barcode-tool.html, 서체 윤곽선 포함 단독 페이지)을 그대로 띄운다.
 * 같은 주소에서 열리므로 파일 저장도 그대로 동작하고, 높이는 내용에 맞춰 늘어난다.
 */
export default function BarcodeTool() {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(1200)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = frame.current
    if (!el) return
    let ro: ResizeObserver | null = null
    const onLoad = () => {
      const doc = el.contentDocument
      if (!doc) return
      setReady(true)
      const fit = () => setHeight(Math.max(600, doc.documentElement.scrollHeight))
      fit()
      ro = new ResizeObserver(fit)
      ro.observe(doc.body)
    }
    el.addEventListener('load', onLoad)
    return () => {
      el.removeEventListener('load', onLoad)
      ro?.disconnect()
    }
  }, [])

  return (
    <div className="relative">
      {!ready && (
        <div className="absolute inset-x-0 top-10 flex items-center justify-center gap-2 text-sm text-muted">
          <Spinner /> 바코드 생성기를 여는 중
        </div>
      )}
      <iframe ref={frame} src="/barcode-tool.html?embed=1&theme=light" title="바코드 생성기" className="block w-full border-0" style={{ height }} />
    </div>
  )
}
