/**
 * @pdf-lib/fontkit(1.1.1) 의 TrueType 글꼴 줄이기(서브셋) 오류를 고쳐 쓴다.
 *
 * 문제: 쓰는 글자만 남긴 글꼴을 만들 때 글자 모양 데이터를 짝수 길이로 맞추지 않은 채
 * "주소를 2 로 나눠 적는" 짧은 위치표를 쓴다. 홀수 길이 글자가 하나라도 있으면 그 뒤 글자의
 * 주소가 어긋나 글자가 빠지거나 깨져 보인다(Pretendard 가 그렇다 — 화면에서 확인함).
 * 고침: 글자 하나를 넣을 때마다 홀수 길이면 0 한 바이트를 덧붙여 짝수로 맞춘다.
 *
 * fontkit 내부(_addGlyph·glyf·offset)에 기대므로, 구조가 다르면 손대지 않고 safe=false 를 돌려준다(fontkit-fix.test.ts 가 지킨다).
 * 그때는 호출한 쪽이 글꼴을 통째로 넣어야 한다(파일은 커지지만 글자는 바르게 보인다).
 */

interface SubsetInternals {
  _addGlyph: (gid: number) => number
  glyf: Uint8Array[]
  offset: number
}

interface FontLike {
  createSubset: () => unknown
}

export interface FontkitLike {
  create: (...args: never[]) => unknown
}

/** glyf·offset 은 저장을 시작할 때 생기므로, 여기서는 고칠 함수가 있는지만 본다. */
function isPatchable(subset: unknown): subset is SubsetInternals {
  const s = subset as Partial<SubsetInternals> | null
  return !!s && typeof s._addGlyph === 'function'
}

function padGlyphs(subset: SubsetInternals) {
  const original = subset._addGlyph
  subset._addGlyph = function patched(this: SubsetInternals, gid: number) {
    const result = original.call(this, gid)
    if (!Array.isArray(this.glyf) || typeof this.offset !== 'number') return result
    const last = this.glyf.length - 1
    const data = this.glyf[last]
    if (data && data.length % 2 === 1) {
      const Ctor = data.constructor as new (length: number) => Uint8Array
      const padded = new Ctor(data.length + 1)
      padded.fill(0)
      padded.set(data)
      this.glyf[last] = padded
      this.offset += 1
    }
    return result
  }
}

/**
 * pdf-lib 의 registerFontkit 에 넘길 fontkit 을 돌려준다.
 * safe 가 true 면 { subset: true } 로 넣어도 된다.
 */
export function fixedFontkit<T extends FontkitLike>(fontkit: T, sampleFont: Uint8Array | ArrayBuffer): { fontkit: T; safe: boolean } {
  const create = fontkit.create as unknown as (...args: unknown[]) => FontLike
  let safe = false
  try {
    safe = isPatchable(create(sampleFont instanceof Uint8Array ? sampleFont : new Uint8Array(sampleFont)).createSubset())
  } catch {
    safe = false
  }
  if (!safe) return { fontkit, safe }
  const wrapped = {
    ...fontkit,
    create: (...args: unknown[]) => {
      const font = create(...args)
      const createSubset = font.createSubset.bind(font)
      font.createSubset = () => {
        const subset = createSubset()
        if (isPatchable(subset)) padGlyphs(subset)
        return subset
      }
      return font
    },
  } as unknown as T
  return { fontkit: wrapped, safe }
}
