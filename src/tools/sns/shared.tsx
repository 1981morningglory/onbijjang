import { Button, Callout, Dialog } from '@/ui'
import type { ProblemRow } from './excel'
import type { Applicant } from './parse'

export interface Count {
  total: number
  done: number
  fail: number
}
export interface JobBrief {
  id: string
  title: string
  createdAt: string
  finishedAt: string | null
  status: 'running' | 'done' | 'stopped'
  ig: Count
  blog: Count
}
export interface Lanes {
  ig: { paused: boolean; note: string; gapMs: number }
  blog: { paused: boolean; note: string; gapMs: number }
}
/** 이 브라우저에만 두는 지원자 정보(이름·연락처·지원동기). 서버로 보내지 않는다. */
export interface LocalMeta {
  ig: Array<[string, Applicant[]]>
  blog: Array<[string, Applicant[]]>
  problems: ProblemRow[]
  /** 올린 지원자 엑셀 파일 이름(원본은 metaFileKey 에) */
  fileName?: string
}
export const metaKey = (id: string) => `onbijjang:sns:job:${id}`
/** 원본 지원자 엑셀(엑셀 내려받기 때 이 파일에 평가 시트를 덧붙인다) */
export const metaFileKey = (id: string) => `onbijjang:sns:job:${id}:file`

/** 한 계정에 걸리는 시간(초): 인스타그램은 API 연결 시 Meta 한도(시간당 약 200번) 때문에 19초, 연결 전 6초. 블로그 약 1.2초 */
export const IG_SEC = (connected: boolean) => (connected ? 19 : 6)
export const BLOG_SEC = 1.2
/** 블로그와 인스타그램은 서버에서 동시에 돌므로 둘 중 긴 쪽이 전체 시간 */
export const estimateSec = (ig: number, blog: number, connected: boolean) => Math.max(ig * IG_SEC(connected), blog * BLOG_SEC)
export function fmtDuration(sec: number) {
  const m = Math.max(1, Math.ceil(sec / 60))
  if (m < 60) return `약 ${m}분`
  const h = Math.floor(m / 60)
  return m % 60 ? `약 ${h}시간 ${m % 60}분` : `약 ${h}시간`
}
export const LONG_SEC = 5 * 60

/** AI 채점 한 명당 어림값(사진 몇 장 + 글, Claude Opus 5.5 기준) — 실제 비용은 쌓이는 대로 화면에 보인다 */
export const AI_WON_PER = 90
/** 동시에 2명씩, 한 명 약 25초 → 한 명당 약 13초 */
export const AI_SEC_PER = 13
export const WON_PER_USD = 1400
/** 수집과 AI 채점을 함께 할 때 전체 시간: AI 는 수집이 끝난 계정부터 바로 매기므로 둘 중 긴 쪽 + 마지막 한 명 */
export const estimateWithAiSec = (collectSec: number, n: number) => Math.max(collectSec + AI_SEC_PER * 2, n * AI_SEC_PER)

/** 5분 이상 걸리는 수집을 시작하기 전에 묻는다 */
export function ConfirmLong({ open, seconds, detail, onYes, onNo }: { open: boolean; seconds: number; detail: string; onYes: () => void; onNo: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onNo}
      size="sm"
      title="시간이 오래 걸리는 작업입니다"
      footer={
        <>
          <Button onClick={onNo}>아니오</Button>
          <Button variant="primary" onClick={onYes}>
            예, 진행합니다
          </Button>
        </>
      }
    >
      <Callout tone="warn" title={`예상 소요시간 ${fmtDuration(seconds)}`}>
        {detail}
      </Callout>
      <p className="mt-3 text-sm text-ink-2">수집은 서버에서 진행되므로 이 창을 닫거나 컴퓨터를 꺼도 계속됩니다. 중간에 ‘엑셀 내려받기’로 그때까지 모은 결과를 받을 수 있고, ‘멈추기’로 언제든 멈출 수 있습니다.</p>
      <p className="mt-3 font-semibold text-ink">진행하시겠습니까?</p>
    </Dialog>
  )
}
