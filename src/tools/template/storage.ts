import { createStore, del, get, keys, set } from 'idb-keyval'
import { dataUrlToBlob } from '@/lib/files'
import { assetToDataUrl, type AssetStore } from './assets'
import { SHRINK_STEPS, collectAssetIds, docFromPack, isDocEmpty, packSize, rescaleImageRefs, type CanvasDoc, type PageDoc, type TemplatePack } from './model'
import { renderThumb } from './render'

// ── 자동 저장 ─────────────────────────────────────────────
// 'current' 는 지금 작업, 'previous' 는 지난번에 하던 작업("이어서 하기"용).
// 사진은 'asset:<id>' 로 한 번만 저장하고 두 작업이 함께 쓴다.
const db = createStore('onbijjang-template', 'autosave')
const ASSET_KEY = 'asset:'

export interface SavedWork {
  doc: CanvasDoc
  name: string
  savedAt: number
  assetIds: string[]
}

interface SavedAsset {
  blob: Blob
  width: number
  height: number
}

const savedAssets = new Set<string>()

function isSavedWork(v: unknown): v is SavedWork {
  const w = v as Partial<SavedWork> | undefined
  return !!w && typeof w === 'object' && !!w.doc && Array.isArray(w.doc.pages) && w.doc.pages.length > 0
}

/** 지금 작업을 저장한다. 사진은 처음 한 번만 쓴다. */
export async function saveWork(doc: CanvasDoc, name: string, assets: AssetStore): Promise<void> {
  const assetIds = collectAssetIds(doc.pages)
  for (const id of assetIds) {
    if (savedAssets.has(id)) continue
    const a = assets.get(id)
    if (!a) continue
    await set(ASSET_KEY + id, { blob: a.blob, width: a.width, height: a.height } satisfies SavedAsset, db)
    savedAssets.add(id)
  }
  await set('current', { doc, name, savedAt: Date.now(), assetIds } satisfies SavedWork, db)
}

export async function clearCurrentWork(): Promise<void> {
  await del('current', db)
}

/**
 * 도구를 열 때 한 번 부른다. 지난번 작업이 남아 있으면 '이전 작업' 자리로 옮기고 돌려준다.
 * 내용이 없는 작업은 버린다.
 */
export async function takePreviousWork(): Promise<SavedWork | null> {
  try {
    const current = await get('current', db)
    if (isSavedWork(current) && !isDocEmpty(current.doc)) {
      await set('previous', current, db)
    }
    await del('current', db)
    const previous = await get('previous', db)
    const work = isSavedWork(previous) ? previous : null
    await pruneAssets(work ? work.assetIds : [])
    return work
  } catch {
    return null
  }
}

export async function discardPreviousWork(): Promise<void> {
  try {
    await del('previous', db)
  } catch {
    // 지우지 못해도 다음에 덮어쓴다.
  }
}

/** 저장해 둔 작업의 사진을 다시 올린다. 찾지 못한 사진 수를 돌려준다. */
export async function restoreAssets(work: SavedWork, assets: AssetStore): Promise<number> {
  let missing = 0
  for (const id of work.assetIds) {
    if (assets.has(id)) continue
    const saved = (await get(ASSET_KEY + id, db)) as SavedAsset | undefined
    if (saved?.blob) {
      assets.add(saved.blob, saved.width, saved.height, id)
      savedAssets.add(id)
    } else {
      missing++
    }
  }
  return missing
}

async function pruneAssets(keep: string[]): Promise<void> {
  const wanted = new Set(keep.map((id) => ASSET_KEY + id))
  for (const key of await keys(db)) {
    if (typeof key === 'string' && key.startsWith(ASSET_KEY) && !wanted.has(key)) {
      await del(key, db)
      savedAssets.delete(key.slice(ASSET_KEY.length))
    }
  }
}

// ── 팀 보관함 ─────────────────────────────────────────────
/** 보관함 저장 한도(바이트). 서버는 25MB 까지 받지만 여유를 둔다. */
export const PACK_LIMIT = 18 * 1024 * 1024

export interface PackResult {
  pack: TemplatePack
  thumb: string
  /** 용량을 맞추려고 사진을 줄였다면 그때의 긴 변 크기(px) */
  shrunkTo: number | null
}

/** 현재 문서를 보관함에 담을 묶음으로 만든다. 한도를 넘으면 사진을 단계적으로 줄인다. */
export async function buildPack(doc: CanvasDoc, name: string, assets: AssetStore, limit = PACK_LIMIT): Promise<PackResult> {
  const ids = collectAssetIds(doc.pages).filter((id) => assets.has(id))
  const encode = async (shrink?: { maxSide: number; quality: number }) => {
    let pages: PageDoc[] = doc.pages
    const out: TemplatePack['assets'] = {}
    for (const id of ids) {
      const a = assets.get(id)!
      const needsShrink = shrink && (Math.max(a.width, a.height) > shrink.maxSide || a.blob.size > 300 * 1024)
      const enc = await assetToDataUrl(a, needsShrink ? shrink : undefined)
      if (enc.width !== a.width || enc.height !== a.height) {
        // 줄인 사진은 다른 이름으로 담는다. 같은 이름이면 불러올 때 원본과 뒤섞인다.
        const smallId = `${id}-${enc.width}`
        out[smallId] = enc
        pages = pages.map((p) => {
          const objects = rescaleImageRefs(p.objects, id, enc.width / a.width, enc.height / a.height, smallId)
          return objects === p.objects ? p : { ...p, objects }
        })
      } else {
        out[id] = enc
      }
    }
    return { pages, assets: out }
  }

  let body = await encode()
  let shrunkTo: number | null = null
  if (packSize(body) > limit) {
    for (const step of SHRINK_STEPS) {
      body = await encode(step)
      shrunkTo = step.maxSide
      if (packSize(body) <= limit) break
    }
    if (packSize(body) > limit) {
      throw new Error('사진이 너무 많아 보관함 한도(약 18MB)를 넘습니다. 페이지를 나눠 저장하거나 사진 수를 줄여 주세요.')
    }
  }
  const thumb = await renderThumb(doc.pages[0], doc, assets, 160, true)
  return {
    pack: { format: 'onbijjang-canvas', version: 1, name, width: doc.width, height: doc.height, pages: body.pages, assets: body.assets },
    thumb,
    shrunkTo,
  }
}

/** 보관함에서 꺼낸 묶음을 문서로 되돌리고 사진을 올린다. */
export async function openPack(pack: TemplatePack, assets: AssetStore): Promise<CanvasDoc> {
  for (const [id, a] of Object.entries(pack.assets)) {
    if (assets.has(id) || typeof a?.dataUrl !== 'string' || !a.dataUrl.startsWith('data:image/')) continue
    const blob = await dataUrlToBlob(a.dataUrl)
    assets.add(blob, a.width, a.height, id)
  }
  return docFromPack(pack)
}
