import { FONT_FAMILY, PAGE_H, PAGE_W, PT, type Op, type Page } from './layout'

function SvgOp({ op }: { op: Op }) {
  if (op.t === 'rect') return <rect x={op.x} y={op.y} width={op.w} height={op.h} fill={op.fill ?? 'none'} stroke={op.stroke ?? 'none'} strokeWidth={op.lw ?? 0.2} />
  if (op.t === 'line') return <line x1={op.x1} y1={op.y1} x2={op.x2} y2={op.y2} stroke={op.color} strokeWidth={op.lw} strokeDasharray={op.dash?.join(' ')} />
  if (op.t === 'image') return <image href={op.src} x={op.x} y={op.y} width={op.w} height={op.h} preserveAspectRatio={op.top ? 'xMidYMin meet' : 'xMidYMid meet'} opacity={op.opacity} />
  return (
    <text
      // letter-spacing 은 마지막 글자 뒤에도 붙어 가운데 정렬이 왼쪽으로 쏠린다 — 그만큼 되돌린다
      x={op.x + (op.spacing && op.align === 'center' ? op.spacing / 2 : op.spacing && op.align === 'right' ? op.spacing : 0)}
      y={op.y}
      fontSize={op.size * PT}
      fontWeight={op.weight === 'bold' ? 700 : 400}
      fill={op.color}
      textAnchor={op.align === 'center' ? 'middle' : op.align === 'right' ? 'end' : 'start'}
      letterSpacing={op.spacing}
      style={{ fontFamily: FONT_FAMILY, whiteSpace: 'pre' }}
    >
      {op.text}
    </text>
  )
}

/** A4 한 쪽 미리보기. 저장되는 PDF·이미지와 같은 그리기 명령을 그린다. */
export function PagePreview({ page, label }: { page: Page; label: string }) {
  return (
    <svg viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} role="img" aria-label={label} className="block h-auto w-full bg-white shadow-3">
      {page.ops.map((op, i) => (
        <SvgOp key={i} op={op} />
      ))}
    </svg>
  )
}
