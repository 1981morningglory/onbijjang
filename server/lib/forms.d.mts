// 시험(src/tools/forms/forms.test.ts)에서 서버 함수를 부를 때 쓰는 형태 정보
import type { Form, Question } from '../../src/tools/forms/logic'
export const TYPES: string[]
export function cleanQuestion(q: unknown): Question
export function cleanForm(f: unknown): Pick<Form, 'title' | 'description' | 'questions' | 'settings'>
export function isOpen(form: Pick<Form, 'settings'>, now?: number): boolean
export function cleanAnswers(form: Pick<Form, 'questions'>, raw: unknown): { answers?: Record<string, unknown>; error?: string }
export function answerText(a: unknown): string
export function responseTable(form: Pick<Form, 'questions'>, responses: Array<{ at: string; answers: Record<string, unknown> }>): { head: string[]; rows: Array<Array<string | number>> }
export function toCsv(form: Pick<Form, 'questions'>, responses: Array<{ at: string; answers: Record<string, unknown> }>): string
export function shortCode(): string
