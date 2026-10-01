import type { StaticCanvas } from 'fabric'
import type { AssetStore } from './assets'
import { loadFabric, type Fabric, type FObject } from './fabricKit'
import { ensureFonts } from './fonts'
import { collectFontUsage, entranceAt, mapImageSources, pageEffects, type EntranceEffect, type PageDoc } from './model'

interface Actor {
  obj: FObject
  effect: EntranceEffect
  /** 효과가 있는 객체들 사이의 순번 */
  order: number
  opacity: number
  scaleX: number
  scaleY: number
  cx: number
  cy: number
}

export interface DrawOptions {
  /** 출력 배율(1 = 문서 크기 그대로) */
  multiplier?: number
  /** true 면 페이지 배경색을 칠하지 않는다 */
  transparent?: boolean
  /** 등장 효과를 적용할 시각(ms). 생략하면 다 나타난 모습 */
  localMs?: number
}

/**
 * 문서의 한 페이지를 화면 밖에서 그리는 무대.
 * 편집 화면과 무관하게 저장된 데이터(JSON)만으로 그리므로 내보내기·미리보기·움직이는 파일이 같은 결과를 낸다.
 */
export class PageStage {
  private constructor(
    private f: Fabric,
    private canvas: StaticCanvas,
    private actors: Actor[],
    private background: string | null,
    private rise: number,
  ) {}

  static async create(page: PageDoc, size: { width: number; height: number }, assets: AssetStore): Promise<PageStage> {
    const f = await loadFabric()
    // 글꼴이 오기 전에 글자를 만들면 줄바꿈이 틀어진다. 먼저 받는다.
    await ensureFonts(collectFontUsage([page]))
    const canvas = new f.StaticCanvas(undefined, { width: size.width, height: size.height, enableRetinaScaling: false, renderOnAddRemove: false })
    const json = mapImageSources(page.objects, (id) => assets.url(id))
    const objects = (await f.util.enlivenObjects(json)) as FObject[]
    canvas.add(...objects)
    const effects = pageEffects(page)
    let order = 0
    const actors = objects.map((obj, i): Actor => {
      const effect = effects[i] ?? 'none'
      const c = obj.getCenterPoint()
      return { obj, effect, order: effect === 'none' ? 0 : order++, opacity: obj.opacity, scaleX: obj.scaleX, scaleY: obj.scaleY, cx: c.x, cy: c.y }
    })
    return new PageStage(f, canvas, actors, page.background, Math.max(24, size.height * 0.04))
  }

  draw({ multiplier = 1, transparent = false, localMs }: DrawOptions = {}): HTMLCanvasElement {
    for (const a of this.actors) {
      if (a.effect === 'none') continue
      const s = localMs == null ? { opacity: 1, offset: 0, scale: 1 } : entranceAt(a.effect, a.order, localMs)
      a.obj.set({ opacity: a.opacity * s.opacity, scaleX: a.scaleX * s.scale, scaleY: a.scaleY * s.scale })
      a.obj.setPositionByOrigin(new this.f.Point(a.cx, a.cy + s.offset * this.rise), 'center', 'center')
      a.obj.setCoords()
    }
    this.canvas.backgroundColor = transparent ? '' : (this.background ?? '')
    return this.canvas.toCanvasElement(multiplier)
  }

  dispose() {
    void this.canvas.dispose()
  }
}

/** 한 페이지를 한 번 그려 캔버스로 돌려준다. */
export async function renderPage(page: PageDoc, size: { width: number; height: number }, assets: AssetStore, options: DrawOptions = {}): Promise<HTMLCanvasElement> {
  const stage = await PageStage.create(page, size, assets)
  try {
    return stage.draw(options)
  } finally {
    stage.dispose()
  }
}

/** 페이지 목록·보관함에 쓰는 작은 미리보기(data URL) */
export async function renderThumb(page: PageDoc, size: { width: number; height: number }, assets: AssetStore, maxSide = 176, opaque = false): Promise<string> {
  const multiplier = Math.min(1, maxSide / Math.max(size.width, size.height))
  const canvas = await renderPage(page, size, assets, { multiplier })
  if (!opaque) return canvas.toDataURL('image/png')
  const flat = document.createElement('canvas')
  flat.width = canvas.width
  flat.height = canvas.height
  const ctx = flat.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, flat.width, flat.height)
  ctx.drawImage(canvas, 0, 0)
  return flat.toDataURL('image/jpeg', 0.8)
}
