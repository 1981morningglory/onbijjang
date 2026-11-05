// 시험(src/tools/draw/draw.test.ts)에서 서버 함수를 부를 때 쓰는 형태 정보
type D = { round: number; date: string; numbers: number[]; bonus: number }
export function expectedLatest(now?: number): number
export function cleanDraw(d: unknown): D | null
export function parseNew(payload: unknown): D[]
export function parseOld(payload: unknown): D[]
declare const lottoRoutes: (app: unknown, ctx: unknown) => Promise<void>
export default lottoRoutes
export function koreanError(err: unknown): string
