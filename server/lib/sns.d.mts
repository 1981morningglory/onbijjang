// 시험(src/tools/sns/logic.test.ts)에서 서버 함수를 부를 때 쓰는 형태 정보
export const GRAPH: string
export const BLOG_ID_RE: RegExp
export const IG_USER_RE: RegExp
export function parseCount(text: string): number | null
export function parseIgOg(html: string): { followers: number | null; following: number | null; posts: number | null } | null
export function parseVisitors(xml: string): Array<{ date: string; cnt: number }>
export function summarizeIg(bd: unknown, now?: number): {
  source: 'api'
  name: string
  followers: number | null
  following: number | null
  mediaCount: number | null
  postsRead: number
  avgLikes: number | null
  avgComments: number | null
  avgEngagement: number | null
  hiddenLikes: boolean
  reels: number
  posts30d: number
  lastPostAt: string | null
}
export class SnsError extends Error {
  kind: 'fail' | 'rate' | 'token' | 'personal' | 'retry'
}
export function classifyGraphError(status: number, body: unknown): SnsError
export function blogIdFromUrl(u: string): string | null
