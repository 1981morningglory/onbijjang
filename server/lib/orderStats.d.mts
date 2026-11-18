// 시험(src/tools/orders/stats.test.ts)에서 서버 함수를 부를 때 쓰는 형태 정보
import type { Stats, Totals } from '../../src/tools/orders/stats'
export const AMOUNT_RE: RegExp
export const REGIONS: string[]
export function region(address: unknown): { sido: string; city: string }
export function addDays(date: string, n: number): string
export function daysBetween(from: string, to: string): number
type Batch = { id: string; date: string; cols: string[]; rows: Record<string, string | number | null>[] }
export function orderStats(batches: Batch[], from: string, to: string, opts?: { detail?: boolean }): Omit<Stats, 'prev' | 'today' | 'firstDate'> & { totals: Totals }
