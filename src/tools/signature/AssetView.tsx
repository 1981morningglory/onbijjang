import clsx from 'clsx'
import type { CSSProperties } from 'react'

/**
 * 서명 이미지를 보여 준다. tint 가 있으면 이미지의 불투명한 부분을 그 색으로 칠한다(CSS mask).
 * 부모가 크기를 정하고 이 요소는 그 안을 가득 채운다.
 */
export function AssetView({ src, tint, className, style, contain }: { src: string; tint: string | null; className?: string; style?: CSSProperties; contain?: boolean }) {
  if (!tint) {
    return <img src={src} alt="" draggable={false} className={clsx('pointer-events-none block size-full select-none', contain ? 'object-contain' : 'object-fill', className)} style={style} />
  }
  const mask = `url("${src}")`
  const size = contain ? 'contain' : '100% 100%'
  return (
    <div
      aria-hidden
      className={clsx('pointer-events-none size-full select-none', className)}
      style={{
        backgroundColor: tint,
        maskImage: mask,
        WebkitMaskImage: mask,
        maskSize: size,
        WebkitMaskSize: size,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        ...style,
      }}
    />
  )
}
