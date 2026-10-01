import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { labelsOnPage, planDoc, type LabelDoc } from './model'
import { SheetSvg } from './render'

/**
 * 인쇄 전용 배치. 앱 뼈대와 상관없이 동작하도록 body 바로 아래에 따로 붙이고,
 * 인쇄할 때는 body 의 다른 자식을 모두 숨긴다. 이 컴포넌트가 떠 있는 동안에만 규칙이 적용된다.
 * 한 쪽이 정확히 210×297mm 이고 SVG 좌표가 mm 라서 배율 100% 로 뽑으면 실제 크기다.
 */
const PRINT_CSS = `
.lm-print-root { display: none; }
@media print {
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
  body > *:not(.lm-print-root) { display: none !important; }
  .lm-print-root { display: block !important; }
  .lm-print-page { width: 210mm; height: 297mm; overflow: hidden; break-after: page; page-break-after: always; break-inside: avoid; }
  .lm-print-page:last-child { break-after: auto; page-break-after: auto; }
  .lm-print-page > svg { display: block; width: 210mm; height: 297mm; }
}
`

export function PrintSheets({ doc, rev }: { doc: LabelDoc; rev: number }) {
  const plan = useMemo(() => planDoc(doc), [doc])
  return createPortal(
    <div className="lm-print-root" aria-hidden>
      <style>{PRINT_CSS}</style>
      {Array.from({ length: plan.pages }, (_, page) => (
        <div key={page} className="lm-print-page">
          <SheetSvg sheet={doc.sheet} design={doc.design} items={labelsOnPage(plan, page)} mode="print" cutLines={doc.print.cutLines} offsetX={doc.print.offsetX} offsetY={doc.print.offsetY} rev={rev} />
        </div>
      ))}
    </div>,
    document.body,
  )
}
