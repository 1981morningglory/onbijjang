// 시험(src/tools/carrot/carrot.test.ts)에서 서버 함수를 부를 때 쓰는 형태 정보
import type { Model } from '../../src/tools/carrot/logic'
export const KEEP_DAYS: number
export const MAX_COUNT: number
export const SNAPSHOT: Model[]
export const TERMINAL: Set<string>
export function normalizeModel(x: unknown): Model | null
export function normalizeModels(raw: unknown[]): Model[]
export function fit(p: unknown, v: unknown): unknown
export function planRequest(body: unknown, models: Model[]): { model: Model; tool: string; params: Record<string, unknown>; count: number }
export function toolError(result: unknown): string | null
export function koreanToolError(msg: string): string
export function jobIds(result: unknown): string[]
export function jobResult(result: unknown): { status: string; urls: string[]; error: string | null }
export function extFor(contentType: string | null, url: string, kind: string): string
export function typeOfExt(ext: string): string
export function isExpired(job: { createdAt: string }, now?: number): boolean
export function usageByOwner(jobs: unknown[], ledger?: unknown[]): Array<{ owner: string; name: string; jobs: number; images: number; videos: number; audios: number; failed: number; bytes: number; credits: number; credits30: number }>
export function lastSubscriptionGrant(items: unknown): { at: string; credits: number } | null
export function nextRenewal(lastIso: string, now?: number): string | null
export function cleanAccess(v: unknown): { mode: 'own' | 'all' | 'some'; owners: string[] }
export function canView(access: Record<string, { mode: string; owners: string[] }>, viewer: string, owner: string, admin?: boolean): boolean
export function canBrowse(access: Record<string, { mode: string; owners: string[] }>, viewer: string, admin?: boolean): boolean
