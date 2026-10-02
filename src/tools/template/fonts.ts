import { createStore, del, entries, set } from 'idb-keyval'
import { extOf, sanitizeFilename, stripExt } from '@/lib/files'
import type { FontUsage } from './model'

export interface FontOption {
  family: string
  label: string
  source: 'builtin' | 'system' | 'local' | 'file'
}

/** 사이트에 들어 있는 글꼴과, 대부분의 PC 에 깔려 있는 글꼴 */
export const BASE_FONTS: FontOption[] = [
  { family: 'Pretendard Variable', label: '프리텐다드 (기본)', source: 'builtin' },
  { family: 'Black Han Sans', label: '검은고딕', source: 'builtin' },
  { family: 'Nanum Pen Script', label: '나눔손글씨 펜', source: 'builtin' },
  { family: 'Gaegu', label: '개구 손글씨', source: 'builtin' },
  { family: 'Malgun Gothic', label: '맑은 고딕', source: 'system' },
  { family: 'Batang', label: '바탕', source: 'system' },
  { family: 'Gungsuh', label: '궁서', source: 'system' },
  { family: 'Arial', label: 'Arial', source: 'system' },
  { family: 'Georgia', label: 'Georgia', source: 'system' },
  { family: 'Impact', label: 'Impact', source: 'system' },
]

export const DEFAULT_FONT = 'Pretendard Variable'
export const HAND_FONT = 'Nanum Pen Script'
export const FONT_FILE_ACCEPT = '.ttf,.otf,.woff,.woff2'
export const MAX_FONT_BYTES = 30 * 1024 * 1024

const fontDb = createStore('onbijjang-template-fonts', 'files')

const DENIED = '글꼴 접근이 허용되지 않았습니다. 주소창 왼쪽의 사이트 설정에서 글꼴 권한을 허용한 뒤 다시 눌러 주세요. 글꼴 파일을 직접 추가할 수도 있습니다.'

interface LocalFontData {
  family: string
}

export function canQueryLocalFonts(): boolean {
  return typeof window !== 'undefined' && 'queryLocalFonts' in window
}

/** 내 PC 에 설치된 글꼴 이름 목록. 브라우저가 권한을 묻는다. 거절하면 오류를 던진다. */
export async function queryLocalFamilies(): Promise<string[]> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts
  if (!query) throw new Error('이 브라우저는 설치된 글꼴 불러오기를 지원하지 않습니다. 글꼴 파일을 직접 추가해 주세요.')
  let list: LocalFontData[]
  try {
    list = await query.call(window)
  } catch {
    throw new Error(DENIED)
  }
  // 권한이 막혀 있으면 오류 대신 빈 목록이 온다.
  if (!list.length) throw new Error(DENIED)
  return [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b, 'ko'))
}

async function register(family: string, data: ArrayBuffer): Promise<void> {
  const face = new FontFace(family, data)
  await face.load()
  document.fonts.add(face)
}

/** 글꼴 파일을 등록하고 이 브라우저에 보관한다. 돌려주는 값은 글꼴 이름. */
export async function addFontFile(file: File): Promise<string> {
  if (!FONT_FILE_ACCEPT.split(',').includes(`.${extOf(file.name)}`)) throw new Error('글꼴 파일(.ttf, .otf, .woff, .woff2)만 추가할 수 있습니다.')
  if (file.size > MAX_FONT_BYTES) throw new Error('글꼴 파일은 30MB 이하만 추가할 수 있습니다.')
  const family = sanitizeFilename(stripExt(file.name), '추가한 글꼴').replace(/["',]/g, '')
  const data = await file.arrayBuffer()
  try {
    await register(family, data)
  } catch {
    throw new Error('글꼴 파일을 읽지 못했습니다. 손상되었거나 지원하지 않는 형식입니다.')
  }
  try {
    await set(family, new Blob([data]), fontDb)
  } catch {
    // 보관에 실패해도 이번 작업에는 쓸 수 있다.
  }
  return family
}

/** 지난번에 추가한 글꼴 파일을 다시 등록한다. */
export async function restoreFontFiles(): Promise<string[]> {
  const out: string[] = []
  try {
    for (const [key, blob] of await entries<string, Blob>(fontDb)) {
      try {
        await register(key, await blob.arrayBuffer())
        out.push(key)
      } catch {
        await del(key, fontDb)
      }
    }
  } catch {
    // IndexedDB 를 쓸 수 없는 환경
  }
  return out
}

export async function removeFontFile(family: string): Promise<void> {
  await del(family, fontDb)
}

function fontShorthand(u: Pick<FontUsage, 'family' | 'weight' | 'style'>): string {
  return `${u.style === 'italic' ? 'italic ' : ''}${u.weight || 'normal'} 40px "${u.family.replace(/"/g, '')}"`
}

/**
 * 그리기 전에 글꼴을 받아 둔다. 웹 글꼴은 글자 묶음별로 나뉘어 있어, 실제 쓰인 글자를 넘겨야 필요한 조각이 모두 온다.
 * 받지 못한 글꼴이 있어도 멈추지 않는다(브라우저 기본 글꼴로 그려진다).
 */
export async function ensureFonts(usages: FontUsage[], timeoutMs = 6000): Promise<void> {
  if (!usages.length || typeof document === 'undefined' || !document.fonts) return
  const jobs = usages.map((u) => document.fonts.load(fontShorthand(u), u.text || '가A1').catch(() => []))
  await Promise.race([Promise.all(jobs), new Promise((resolve) => setTimeout(resolve, timeoutMs))])
}
