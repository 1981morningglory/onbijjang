/** "내 서명" — 이 브라우저(IndexedDB)에만 저장한다 */
import { get, set } from 'idb-keyval'
import type { Asset, SavedSignature } from './types'

const KEY = 'onbijjang:signature:mine'
export const MY_SIGNATURE_LIMIT = 30

export async function listMySignatures(): Promise<SavedSignature[]> {
  const raw = (await get(KEY)) as unknown
  return Array.isArray(raw) ? raw.filter(isSavedSignature) : []
}

export async function addMySignature(asset: Asset, name: string): Promise<SavedSignature[]> {
  const entry: SavedSignature = {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    name: name.trim().slice(0, 40) || asset.label,
    src: asset.src,
    tint: asset.tint,
    aspect: asset.aspect,
    kind: asset.kind,
    createdAt: new Date().toISOString(),
  }
  const next = [entry, ...(await listMySignatures())].slice(0, MY_SIGNATURE_LIMIT)
  await set(KEY, next)
  return next
}

export async function removeMySignature(id: string): Promise<SavedSignature[]> {
  const next = (await listMySignatures()).filter((s) => s.id !== id)
  await set(KEY, next)
  return next
}

const KINDS = ['sign', 'seal', 'image', 'text', 'mark']

/** 보관함에서 온 내용이 서명 이미지 모양이 맞는지(팀 보관함은 여러 사람이 쓰므로 확인한다) */
export function isAssetLike(v: unknown): v is Pick<SavedSignature, 'src' | 'tint' | 'aspect' | 'kind'> {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.src === 'string' &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(o.src) &&
    o.src.length < 8_000_000 &&
    (o.tint === null || (typeof o.tint === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.tint))) &&
    typeof o.aspect === 'number' &&
    Number.isFinite(o.aspect) &&
    o.aspect > 0.01 &&
    o.aspect < 100 &&
    typeof o.kind === 'string' &&
    KINDS.includes(o.kind)
  )
}

function isSavedSignature(v: unknown): v is SavedSignature {
  return isAssetLike(v) && typeof (v as SavedSignature).id === 'string' && typeof (v as SavedSignature).name === 'string'
}

export const KIND_LABEL: Record<string, string> = { sign: '서명', seal: '도장', image: '이미지', text: '글자', mark: '표시' }
