import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Callout, Spinner } from '@/ui'
import { Editor } from './Editor'
import { loadFabric, type Fabric } from './fabricKit'

/** 템플릿 캔버스 — 여러 페이지 디자인 편집기. 편집 엔진(fabric)은 열 때 불러온다. */
export default function TemplateTool() {
  const [fabric, setFabric] = useState<Fabric | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setFailed(false)
    loadFabric()
      .then((f) => alive && setFabric(() => f))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [attempt])

  if (failed) {
    return (
      <Callout tone="danger" title="캔버스를 불러오지 못했습니다">
        <p>네트워크가 잠시 끊겼을 수 있습니다. 다시 시도해도 안 되면 새로고침해 주세요.</p>
        <Button size="sm" icon={RotateCcw} className="mt-2" onClick={() => setAttempt((n) => n + 1)}>
          다시 시도
        </Button>
      </Callout>
    )
  }
  if (!fabric) {
    return (
      <div className="mat flex h-[58dvh] min-h-[320px] items-center justify-center gap-2 rounded-lg border border-mat-deep text-sm font-medium" aria-busy="true">
        <Spinner /> 캔버스를 준비하는 중
      </div>
    )
  }
  return <Editor fabric={fabric} />
}
