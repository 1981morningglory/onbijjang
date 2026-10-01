/**
 * bwip-js 는 타입을 browser·node 조건 아래에만 내보내서, 이 프로젝트의 모듈 해석(bundler)으로는 찾지 못한다.
 * 라벨 도구가 쓰는 부분만 여기서 선언한다.
 */
declare module 'bwip-js' {
  export interface ToSvgOptions {
    bcid: string
    text: string
    scale?: number
    includetext?: boolean
    padding?: number
  }
  export function toSVG(opts: ToSvgOptions): string
  const bwipjs: { toSVG: typeof toSVG }
  export default bwipjs
}
