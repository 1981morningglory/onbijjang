/**
 * 회사 자료(공급자 정보·직인·사업자등록증·통장 사본·담당자)를 이 브라우저(IndexedDB)에 보관한다.
 * 직인·통장은 민감한 자료라 온비짱 서버나 공개 저장소에 올리지 않는다. 팀원에게는 '회사 자료 파일'로 나눈다.
 */
import { del, get, set } from 'idb-keyval'
import { api, ApiError } from '@/lib/api'
import { create } from 'zustand'
import { readAsDataURL } from '@/lib/files'
import { canvasToBlob, ctx2d, fileToCanvas, makeCanvas, resizeCanvas } from '@/lib/image'
import { emptyKit, EMPTY_COMPANY, type Attachment, type CompanyKit } from './model'

const KEY = 'onbijjang:quote:kit'
const TEAM_CACHE = 'onbijjang:quote:team-kit'

export interface TeamStatus {
  /** 관리자가 팀 기본 자료를 올려 두었는지 */
  available: boolean
  updatedAt: string | null
  /** 관리자가 팀 코드를 정했는지 */
  codeSet: boolean
  /** 이 사이트가 팀 코드를 요구하는지(사내망 모드면 false) */
  needsCode: boolean
  /** 이 브라우저가 팀 코드를 이미 넣었는지 */
  authorized: boolean
}

interface KitState {
  /** 화면·문서에 쓰는 자료: 이 브라우저 자료가 있으면 그것, 없으면 팀 기본 자료. 담당자는 둘을 합친다. */
  kit: CompanyKit
  /** 이 브라우저에만 저장한 자료 */
  local: CompanyKit
  /** 팀 기본 자료(서버) */
  team: CompanyKit | null
  teamStatus: TeamStatus | null
  loaded: boolean
  load: () => Promise<void>
  refreshTeam: () => Promise<void>
  /** 팀 코드 넣기. 맞으면 팀 자료를 받아 온다. */
  joinTeam: (code: string) => Promise<void>
  update: (fn: (k: CompanyKit) => CompanyKit) => void
  replace: (kit: CompanyKit) => void
  /** 이 브라우저 자료를 지우고 팀 기본 자료로 돌아간다(담당자는 남긴다) */
  useTeamDefaults: () => void
}

/** 이 브라우저 자료에 회사 정보·직인·첨부 중 하나라도 있으면 그것을 쓴다 */
export const hasOwnData = (k: CompanyKit) => Boolean(k.company.name || k.seals.length || k.registration || k.bankbook)

function effective(local: CompanyKit, team: CompanyKit | null): CompanyKit {
  if (!team) return local
  const base = hasOwnData(local) ? local : { ...team, contacts: [] }
  const seen = new Set(local.contacts.map((c) => c.id))
  return { ...base, contacts: [...team.contacts.filter((c) => !seen.has(c.id)), ...local.contacts] }
}

export const useKit = create<KitState>((setState, getState) => {
  const commit = (local: CompanyKit, team = getState().team) => {
    setState({ local, team, kit: effective(local, team) })
  }
  return {
    kit: emptyKit(),
    local: emptyKit(),
    team: null,
    teamStatus: null,
    loaded: false,
    async load() {
      if (getState().loaded) return
      try {
        const [saved, cached] = await Promise.all([get(KEY) as Promise<CompanyKit | undefined>, get(TEAM_CACHE) as Promise<{ kit: CompanyKit; updatedAt: string } | undefined>])
        commit(saved ? normalizeKit(saved) : emptyKit(), cached ? normalizeKit(cached.kit) : null)
      } catch {
        // 저장소를 못 열어도 빈 자료로 시작한다
      }
      setState({ loaded: true })
      void getState().refreshTeam()
    },
    async refreshTeam() {
      let status: TeamStatus
      try {
        status = await api<TeamStatus>('/company-kit/status')
      } catch {
        return // 서버가 없으면 이 브라우저 자료만 쓴다
      }
      setState({ teamStatus: status })
      if (!status.available) {
        if (getState().team) {
          await del(TEAM_CACHE).catch(() => {})
          commit(getState().local, null)
        }
        return
      }
      if (!status.authorized) return
      const cached = (await get(TEAM_CACHE).catch(() => undefined)) as { updatedAt: string } | undefined
      if (cached?.updatedAt === status.updatedAt && getState().team) return
      try {
        const res = await api<{ kit: CompanyKit; updatedAt: string }>('/company-kit')
        const team = normalizeKit(res.kit)
        await set(TEAM_CACHE, { kit: team, updatedAt: res.updatedAt }).catch(() => {})
        commit(getState().local, team)
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setState({ teamStatus: { ...status, authorized: false } })
      }
    },
    async joinTeam(code) {
      await api('/team/login', { method: 'POST', body: { code } })
      await getState().refreshTeam()
    },
    update(fn) {
      const { local, team } = getState()
      // 팀 자료를 쓰다가 고치기 시작하면, 팀 자료를 이 브라우저로 옮겨 와 그 위에서 고친다
      const start = !hasOwnData(local) && team ? { ...team, contacts: local.contacts } : local
      const next = fn(start)
      // 담당자 목록에서 팀 담당자는 이 브라우저 자료에 넣지 않는다
      const teamIds = new Set(team?.contacts.map((c) => c.id) ?? [])
      const contacts = next.contacts.filter((c) => !teamIds.has(c.id))
      // 담당자만 고쳤으면 회사 자료는 계속 팀 기본 자료를 따른다
      const onlyContacts = !hasOwnData(local) && team && next.company === team.company && next.seals === team.seals && next.registration === team.registration && next.bankbook === team.bankbook && next.bank === team.bank
      const cleaned = onlyContacts ? { ...emptyKit(), contacts } : { ...next, contacts }
      commit(cleaned)
      void set(KEY, cleaned).catch(() => {})
    },
    replace(kit) {
      const next = normalizeKit(kit)
      commit(next)
      void set(KEY, next).catch(() => {})
    },
    useTeamDefaults() {
      const next = { ...emptyKit(), contacts: getState().local.contacts }
      commit(next)
      void set(KEY, next).catch(() => {})
    },
  }
})

export function normalizeKit(raw: unknown): CompanyKit {
  const base = emptyKit()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<CompanyKit>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const company = { ...EMPTY_COMPANY }
  for (const k of Object.keys(EMPTY_COMPANY) as Array<keyof typeof EMPTY_COMPANY>) company[k] = str(r.company?.[k])
  const isImg = (v: unknown): v is string => typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v)
  const att = (a: unknown): Attachment | null => {
    if (!a || typeof a !== 'object') return null
    const x = a as Partial<Attachment>
    const pages = Array.isArray(x.pages) ? x.pages.filter(isImg) : []
    if (!pages.length) return null
    return { name: str(x.name), pages, pdfDataUrl: typeof x.pdfDataUrl === 'string' && x.pdfDataUrl.startsWith('data:application/pdf;base64,') ? x.pdfDataUrl : undefined }
  }
  return {
    version: 1,
    company,
    seals: Array.isArray(r.seals) ? r.seals.filter((s) => s && isImg(s.dataUrl)).map((s) => ({ id: str(s.id) || Math.random().toString(36).slice(2), name: str(s.name) || '직인', dataUrl: s.dataUrl })) : [],
    registration: att(r.registration),
    bankbook: att(r.bankbook),
    bank: { bankName: str(r.bank?.bankName), account: str(r.bank?.account), holder: str(r.bank?.holder) },
    contacts: Array.isArray(r.contacts)
      ? r.contacts.map((c) => ({
          id: str(c?.id) || Math.random().toString(36).slice(2),
          name: str(c?.name),
          title: str(c?.title),
          phone: str(c?.phone),
          email: str(c?.email),
          extras: Array.isArray(c?.extras) ? c.extras.map((e) => ({ label: str(e?.label), value: str(e?.value) })) : [],
        }))
      : [],
  }
}

// ── 파일 → 첨부 ───────────────────────────────────────────
/** 사업자등록증·통장 사본: PDF 면 원본과 쪽 그림을 함께, 그림이면 그대로(너무 크면 줄여서) 보관한다. */
export async function fileToAttachment(file: File): Promise<Attachment> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { loadPdfjs } = await import('@/tools/pdf/pdfjs')
    const pdfjs = await loadPdfjs()
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise
    const pages: string[] = []
    for (let i = 1; i <= Math.min(pdf.numPages, 6); i++) {
      const page = await pdf.getPage(i)
      const vp = page.getViewport({ scale: 150 / 72 })
      const canvas = makeCanvas(vp.width, vp.height)
      const ctx = ctx2d(canvas)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport: vp, canvas } as never).promise
      pages.push(await readAsDataURL(await canvasToBlob(canvas, 'image/jpeg', 0.9)))
    }
    void pdf.loadingTask.destroy()
    return { name: file.name, pdfDataUrl: await readAsDataURL(new Blob([bytes], { type: 'application/pdf' })), pages }
  }
  const canvas = await fileToCanvas(file)
  const scale = Math.min(1, 2400 / Math.max(canvas.width, canvas.height))
  const out = scale < 1 ? resizeCanvas(canvas, Math.round(canvas.width * scale), Math.round(canvas.height * scale)) : canvas
  return { name: file.name, pages: [await readAsDataURL(await canvasToBlob(out, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92))] }
}

/**
 * 직인 사진에서 인주만 남기고 배경을 투명하게 만든다(종이의 흰색·하늘색 번짐은 지운다).
 * 결과는 붉은 인주색 한 가지로 다시 칠해 흐릿한 스캔도 또렷하게 보이게 한다.
 */
export async function cleanSeal(file: Blob, recolor = true): Promise<string> {
  const src = await fileToCanvas(file)
  const scale = Math.max(1, Math.min(4, 600 / Math.max(src.width, src.height)))
  const up = resizeCanvas(src, Math.round(src.width * scale), Math.round(src.height * scale))
  const ctx = ctx2d(up, true)
  const img = ctx.getImageData(0, 0, up.width, up.height)
  const d = img.data
  let minX = up.width
  let minY = up.height
  let maxX = 0
  let maxY = 0
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]
    const g = d[i + 1]
    // 인주는 초록 성분이 낮다. 청록 번짐(빨강이 낮음)은 약하게 본다.
    const ink = (255 - g) * Math.min(1, Math.max(0, (r - g) / 60 + 0.35))
    let a = Math.min(1, Math.max(0, (ink - 45) / 85))
    a = Math.min(1, Math.max(0, (a - 0.2) / 0.5))
    a = a * a * (3 - 2 * a)
    if (recolor) {
      d[i] = 200
      d[i + 1] = 22
      d[i + 2] = 40
    }
    d[i + 3] = Math.round(a * 255)
    if (a > 0.3) {
      const p = i / 4
      const x = p % up.width
      const y = (p / up.width) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  ctx.putImageData(img, 0, 0)
  if (maxX <= minX || maxY <= minY) throw new Error('직인을 찾지 못했습니다. 붉은 인주가 잘 보이는 사진을 올려 주세요.')
  const side = Math.max(maxX - minX, maxY - minY) + 16
  const out = makeCanvas(side, side)
  ctx2d(out).drawImage(up, minX - (side - (maxX - minX)) / 2, minY - (side - (maxY - minY)) / 2)
  return readAsDataURL(await canvasToBlob(out, 'image/png'))
}

/** 회사 자료 파일(.json) 내보내기·불러오기 */
export function kitToBlob(kit: CompanyKit): Blob {
  return new Blob([JSON.stringify({ format: 'onbijjang-company-kit', ...kit })], { type: 'application/json' })
}

export async function kitFromFile(file: File): Promise<CompanyKit> {
  if (file.size > 40 * 1024 * 1024) throw new Error('파일이 너무 큽니다(40MB 이하).')
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    throw new Error('회사 자료 파일이 아닙니다. 온비짱에서 내보낸 .json 파일을 골라 주세요.')
  }
  if (!raw || typeof raw !== 'object' || (raw as { format?: string }).format !== 'onbijjang-company-kit') {
    throw new Error('회사 자료 파일이 아닙니다. 온비짱에서 내보낸 .json 파일을 골라 주세요.')
  }
  return normalizeKit(raw)
}
