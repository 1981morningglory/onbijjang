import { CheckCircle2, FileDown, Link2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Dialog, TextInput, toast } from '@/ui'
import { copyText, exportPdf } from './share'

export interface ShareTarget {
  /** 결과가 들어 있는 상자(id) — 안의 [data-pdf-block] 을 PDF 로 */
  containerId: string
  filename: string
  title: string
  link: string
}

/** PDF 저장·링크 복사 동작(팝업과 결과 화면 버튼이 같이 쓴다) */
export function useShare(target: ShareTarget | null) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const pdf = async () => {
    if (!target) return
    const el = document.getElementById(target.containerId)
    if (!el) return
    setBusy(true)
    try {
      await exportPdf(el, target.filename, target.title)
      toast.success('PDF로 저장했습니다.')
    } catch (err) {
      toast.error(err instanceof Error ? `PDF를 만들지 못했습니다: ${err.message}` : 'PDF를 만들지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  const link = async () => {
    if (!target) return
    const ok = await copyText(target.link)
    setCopied(true)
    if (ok) toast.success('링크를 복사했습니다. 메신저에 붙여 넣어 보내세요.')
    else toast.info('아래 링크를 길게 눌러(또는 드래그해) 복사해 주세요.')
  }
  return { busy, copied, pdf, link }
}

/** 결과 화면 안의 작은 버튼 두 개 */
export function ShareButtons({ share }: { share: ReturnType<typeof useShare> }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-pdf-skip>
      <Button size="sm" icon={FileDown} loading={share.busy} onClick={() => void share.pdf()}>
        PDF 다운로드
      </Button>
      <Button size="sm" icon={Link2} onClick={() => void share.link()}>
        링크 복사
      </Button>
    </div>
  )
}

/** 결과가 나온 뒤 뜨는 팝업 */
export function ShareDialog({ open, onClose, heading, note, target, share }: { open: boolean; onClose: () => void; heading: string; note?: string; target: ShareTarget | null; share: ReturnType<typeof useShare> }) {
  return (
    <Dialog open={open} onClose={onClose} title={heading} size="sm">
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-1.5 text-sm text-ink-2">
          <CheckCircle2 className="size-4 text-brand" aria-hidden /> 결과를 저장하거나 다른 사람에게 보낼 수 있어요.
        </p>
        <Button variant="primary" block icon={FileDown} loading={share.busy} onClick={() => void share.pdf()}>
          결과를 PDF로 다운받기
        </Button>
        <Button block icon={Link2} onClick={() => void share.link()}>
          복사링크로 보내기
        </Button>
        {share.copied && target && <TextInput readOnly value={target.link} onFocus={(e) => e.currentTarget.select()} aria-label="공유 링크" />}
        {note && <p className="text-xs leading-relaxed text-muted">{note}</p>}
        <Button variant="ghost" block onClick={onClose}>
          닫고 결과 보기
        </Button>
      </div>
    </Dialog>
  )
}
