// 시험(src/tools/quote/mail.test.ts)에서 서버 함수를 부를 때 쓰는 형태 정보
export interface MailProvider {
  id: string
  label: string
  host: string
  port: number
  domains: string[]
}
export const MAIL_PROVIDERS: MailProvider[]
export function isEmail(v: unknown): boolean
export function providerFor(email: string): MailProvider | null
export function cleanRecipients(list: unknown, max?: number): { list: string[]; bad: string[]; over: boolean }
export function cleanAccount(a: unknown, email?: string): { error: string; account?: undefined } | { account: { host: string; port: number; secure: boolean; user: string }; error?: undefined }
export function sealSecret(plain: string, secret: string): string
export function openSecret(sealed: string, secret: string): string | null
export function senderAddress(acc: { user?: string; host?: string } | null | undefined, contactEmail?: string): string
export function mailErrorText(err: unknown, ctx?: { from?: string }): string
