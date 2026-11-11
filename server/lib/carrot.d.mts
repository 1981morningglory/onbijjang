// 시험(src/tools/carrot/carrot.test.ts)에서 서버 함수를 부를 때 쓰는 형태 정보
import type { Model } from '../../src/tools/carrot/logic'
export const CATALOG: { models: Model[] }
export const MODEL_BY_KEY: Record<string, Model>
export const KEEP_DAYS: number
export const MAX_COUNT: number
export function pickEndpoint(model: Model, x?: { refs?: string[]; start?: string | null; end?: string | null }): string
export function buildInput(model: Model, endpoint: string, x?: { prompt?: string; refs?: string[]; start?: string | null; end?: string | null; options?: Record<string, unknown> }): Record<string, unknown>
export function planRequest(body: unknown): { model: Model; endpoint: string; input: Record<string, unknown>; count: number }
export function outputUrls(status: unknown): Array<{ url: string; type: string }>
export function extFor(contentType: string | null, url: string, type: string): string
export function isExpired(job: { createdAt: string }, now?: number): boolean
export function usageByOwner(jobs: unknown[]): Array<{ owner: string; name: string; jobs: number; images: number; videos: number; failed: number; bytes: number; usd: number }>
export function hfError(status: number, detail: unknown): string
