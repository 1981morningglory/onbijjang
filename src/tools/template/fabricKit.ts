import type * as FabricNS from 'fabric'

export type Fabric = typeof FabricNS
export type FObject = FabricNS.FabricObject

let cached: Promise<Fabric> | null = null

/** fabric 은 무겁다. 도구를 처음 열 때 한 번만 불러온다. */
export function loadFabric(): Promise<Fabric> {
  cached ??= import('fabric').catch((err) => {
    cached = null
    throw err
  })
  return cached
}

/** 직렬화할 때 함께 담는, 이 도구가 객체에 붙여 쓰는 속성 */
export const EXTRA_PROPS = ['uid', 'name', 'locked', 'assetId', 'kind', 'arrow', 'anim'] as const

/** 이 도구가 붙여 쓰는 속성을 읽고 쓰기 위한 느슨한 형태 */
export interface Extra {
  uid?: string
  name?: string
  locked?: boolean
  assetId?: string
  /** rect | ellipse | triangle | line | pen | highlighter | text | image | group */
  kind?: string
  /** 선의 화살표: none | end | both */
  arrow?: string
  /** 움직이는 파일로 내보낼 때의 등장 효과 */
  anim?: string
}

export function extra(o: FObject): Extra {
  return o as unknown as Extra
}
