// 시험(src/tools/saju/logic.test.ts)에서 서버 함수를 부를 때 쓰는 형태 정보
export const SECTIONS: Array<[string, string]>
export function cleanChart(c: unknown): null | {
  gender: 'male' | 'female'
  birthYear: number
  age: number
  hourKnown: boolean
  dayMaster: string
  pillars: Array<{ key: string; stem: string; branch: string; stemTenGod: string; branchTenGod: string; stage: string; hidden: string[] }>
  elements: Record<string, number>
  yinYang: { yang: number; yin: number }
  voidBranches: string[]
  luck: { forward: boolean; startAge: number; current: number; list: Array<{ age: number; stem: string; branch: string }> }
  years: Array<{ year: number; stem: string; branch: string }>
}
export function chartText(c: NonNullable<ReturnType<typeof cleanChart>>): string
declare const sajuRoutes: (app: unknown, ctx: unknown) => Promise<void>
export default sajuRoutes
