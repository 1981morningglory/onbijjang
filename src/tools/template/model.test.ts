import { describe, expect, it } from 'vitest'
import { alignDelta, computeSnap, distributeDeltas, unionBox } from './geometry'
import {
  MAX_PAGES,
  SIZE_PRESETS,
  addPage,
  buildFrames,
  clampSide,
  collectAssetIds,
  collectFontUsage,
  createDoc,
  docFromPack,
  duplicatePage,
  entranceAt,
  entranceTotalMs,
  fitObjectsToSize,
  framesDurationMs,
  historyInit,
  historyPush,
  historyRedo,
  historyReplace,
  historyUndo,
  isDocEmpty,
  isTemplatePack,
  mapImageSources,
  mergePresets,
  movePage,
  outputSize,
  packSize,
  pageFileName,
  parseSizeText,
  removePage,
  rescaleImageRefs,
  resizeDoc,
  searchPresets,
  updatePage,
  type ObjectJSON,
  type TemplatePack,
} from './model'

const img = (assetId: string, extra: ObjectJSON = {}): ObjectJSON => ({ type: 'Image', assetId, src: `blob:x/${assetId}`, left: 100, top: 50, width: 400, height: 200, scaleX: 0.5, scaleY: 0.5, ...extra })
const text = (t: string, extra: ObjectJSON = {}): ObjectJSON => ({ type: 'Textbox', text: t, fontFamily: 'Pretendard Variable', fontWeight: 'bold', fontStyle: 'normal', left: 10, top: 10, ...extra })

describe('문서와 페이지', () => {
  it('새 문서는 흰 배경의 빈 페이지 하나로 시작하고 크기를 한도 안으로 맞춘다', () => {
    const doc = createDoc(1080, 99999)
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].background).toBe('#ffffff')
    expect(doc.height).toBe(8000)
    expect(clampSide(3)).toBe(16)
    expect(clampSide(Number.NaN)).toBe(16)
    expect(isDocEmpty(doc)).toBe(true)
  })

  it('페이지를 현재 페이지 바로 뒤에 추가하고, 원본은 바꾸지 않는다', () => {
    const doc = createDoc(100, 100)
    const two = addPage(doc, 0)
    const three = addPage(two, 0)
    expect(doc.pages).toHaveLength(1)
    expect(three.pages).toHaveLength(3)
    expect(three.pages[0].id).toBe(doc.pages[0].id)
    expect(three.pages[2].id).toBe(two.pages[1].id)
  })

  it('페이지 수 한도를 넘기지 않는다', () => {
    let doc = createDoc(100, 100)
    for (let i = 0; i < MAX_PAGES + 5; i++) doc = addPage(doc, doc.pages.length - 1)
    expect(doc.pages).toHaveLength(MAX_PAGES)
  })

  it('복제한 페이지는 새 id 와 새 객체 uid 를 갖는다(묶음 안까지)', () => {
    let doc = createDoc(100, 100)
    doc = updatePage(doc, doc.pages[0].id, { objects: [{ type: 'Group', uid: 'g', objects: [{ type: 'Rect', uid: 'a' }] }] })
    const dup = duplicatePage(doc, 0)
    expect(dup.pages).toHaveLength(2)
    expect(dup.pages[1].id).not.toBe(dup.pages[0].id)
    const copy = dup.pages[1].objects[0]
    expect(copy.uid).not.toBe('g')
    expect((copy.objects as ObjectJSON[])[0].uid).not.toBe('a')
    expect(dup.pages[0].objects[0].uid).toBe('g')
  })

  it('마지막 한 장은 지우지 않고, 순서 바꾸기는 범위를 벗어나면 그대로 둔다', () => {
    const one = createDoc(100, 100)
    expect(removePage(one, 0)).toBe(one)
    const three = addPage(addPage(one, 0), 1)
    const ids = three.pages.map((p) => p.id)
    expect(movePage(three, 0, 2).pages.map((p) => p.id)).toEqual([ids[1], ids[2], ids[0]])
    expect(movePage(three, 0, 3)).toBe(three)
    expect(movePage(three, 1, 1)).toBe(three)
    expect(removePage(three, 1).pages.map((p) => p.id)).toEqual([ids[0], ids[2]])
  })

  it('없는 페이지를 고치려 하면 같은 문서를 돌려준다', () => {
    const doc = createDoc(100, 100)
    expect(updatePage(doc, 'nope', { background: null })).toBe(doc)
    expect(updatePage(doc, doc.pages[0].id, { background: null }).pages[0].background).toBeNull()
  })
})

describe('크기 바꾸기', () => {
  it('내용 맞추기를 켜면 비율을 유지해 줄이고 가운데로 옮긴다', () => {
    const out = fitObjectsToSize([{ left: 500, top: 500, scaleX: 1, scaleY: 2 }], { width: 1000, height: 1000 }, { width: 500, height: 1000 })
    expect(out[0]).toMatchObject({ left: 250, top: 500, scaleX: 0.5, scaleY: 1 })
  })

  it('크기가 같으면 문서를 그대로 돌려주고, 내용 맞추기를 끄면 객체는 그대로다', () => {
    let doc = createDoc(1000, 1000)
    doc = updatePage(doc, doc.pages[0].id, { objects: [{ left: 10, top: 20 }] })
    expect(resizeDoc(doc, 1000, 1000, true)).toBe(doc)
    const plain = resizeDoc(doc, 500, 500, false)
    expect(plain.width).toBe(500)
    expect(plain.pages[0].objects).toBe(doc.pages[0].objects)
    expect(resizeDoc(doc, 500, 500, true).pages[0].objects[0]).toMatchObject({ left: 5, top: 10, scaleX: 0.5 })
  })
})

describe('크기 프리셋', () => {
  it('스펙에 적힌 기본 크기가 들어 있다', () => {
    const has = (w: number, h: number) => SIZE_PRESETS.some((p) => p.w === w && p.h === h)
    expect(has(860, 3000) && has(1080, 1080) && has(1080, 1350) && has(1280, 720) && has(1080, 1920) && has(1200, 400)).toBe(true)
    expect(SIZE_PRESETS.some((p) => p.name.includes('A4'))).toBe(true)
  })

  it('팀 크기를 앞에 두고 중복과 한도 밖 크기는 뺀다', () => {
    const merged = mergePresets([
      { name: '우리 배너', w: 700, h: 300 },
      { name: '상세페이지', w: 860, h: 3000 },
      { name: '너무 큼', w: 99999, h: 10 },
    ])
    expect(merged[0]).toMatchObject({ name: '우리 배너', team: true })
    expect(merged.filter((p) => p.name === '상세페이지' && p.w === 860)).toHaveLength(1)
    expect(merged.some((p) => p.name === '너무 큼')).toBe(false)
  })

  it('이름과 숫자로 찾는다', () => {
    expect(searchPresets(SIZE_PRESETS, '카드').map((p) => p.name)).toEqual(['카드뉴스'])
    expect(searchPresets(SIZE_PRESETS, '1280')[0].name).toBe('썸네일')
    expect(searchPresets(SIZE_PRESETS, '1080x1350').map((p) => p.name)).toEqual(['카드뉴스'])
    expect(searchPresets(SIZE_PRESETS, 'a4 가로').map((p) => p.name)).toEqual(['A4 가로'])
    expect(searchPresets(SIZE_PRESETS, '없는이름')).toEqual([])
    expect(searchPresets(SIZE_PRESETS, '  ')).toBe(SIZE_PRESETS)
  })

  it('직접 적은 크기를 읽는다', () => {
    expect(parseSizeText('500x700')).toEqual({ w: 500, h: 700 })
    expect(parseSizeText(' 500 × 700 ')).toEqual({ w: 500, h: 700 })
    expect(parseSizeText('500')).toBeNull()
    expect(parseSizeText('5x5')).toBeNull()
    expect(parseSizeText('99999x100')).toBeNull()
  })
})

describe('사진 자산 참조', () => {
  it('묶음 안까지 훑어 자산 id 를 모은다', () => {
    const pages = [{ id: 'p', background: null, seconds: null, objects: [img('a'), { type: 'Group', objects: [img('b'), img('a')] }, text('안녕')] }]
    expect(collectAssetIds(pages).sort()).toEqual(['a', 'b'])
  })

  it('src 를 바꾸되, 바뀐 것이 없으면 같은 배열을 돌려준다', () => {
    const objs = [img('a'), text('x')]
    const saved = mapImageSources(objs, (id) => `asset:${id}`)
    expect(saved[0].src).toBe('asset:a')
    expect(saved[1]).toBe(objs[1])
    expect(mapImageSources(saved, (id) => `asset:${id}`)).toBe(saved)
    // assetId 가 없어도 저장용 src 에서 id 를 읽는다
    expect(mapImageSources([{ type: 'image', src: 'asset:z' }], (id) => `blob:${id}`)[0]).toMatchObject({ src: 'blob:z', assetId: 'z' })
  })

  it('사진을 줄이면 화면 크기가 그대로이도록 객체를 맞추고 새 id 를 가리킨다', () => {
    const [o, other] = rescaleImageRefs([img('a', { cropX: 40 }), img('b')], 'a', 0.5, 0.25, 'a-200')
    expect(o).toMatchObject({ width: 200, height: 50, cropX: 20, scaleX: 1, scaleY: 2, assetId: 'a-200', src: 'asset:a-200' })
    // 보이는 크기(width × scaleX)는 변하지 않는다
    expect((o.width as number) * (o.scaleX as number)).toBe(400 * 0.5)
    expect(other.assetId).toBe('b')
  })

  it('글꼴별로 쓰인 글자를 모은다', () => {
    const usage = collectFontUsage([{ objects: [text('가나'), text('다'), text('abc', { fontFamily: 'Gaegu', fontWeight: 400 }), { type: 'Group', objects: [text('라')] }] }])
    expect(usage).toHaveLength(2)
    expect(usage[0]).toMatchObject({ family: 'Pretendard Variable', weight: 'bold', text: '가나다라' })
    expect(usage[1]).toMatchObject({ family: 'Gaegu', weight: '400', text: 'abc' })
  })
})

describe('되돌리기', () => {
  it('기록하고, 되돌리고, 다시 실행한다', () => {
    let h = historyInit('a')
    h = historyPush(h, 'b')
    h = historyPush(h, 'c')
    expect(h.past).toEqual(['a', 'b'])
    h = historyUndo(h)
    expect(h.present).toBe('b')
    expect(h.future).toEqual(['c'])
    h = historyRedo(h)
    expect(h.present).toBe('c')
    expect(historyRedo(h)).toBe(h)
  })

  it('되돌린 뒤 새로 바꾸면 다시 실행 목록이 비워진다', () => {
    let h = historyPush(historyPush(historyInit(1), 2), 3)
    h = historyPush(historyUndo(h), 9)
    expect(h.future).toEqual([])
    expect(h.past).toEqual([1, 2])
  })

  it('같은 값은 기록하지 않고, 한도를 넘으면 오래된 것부터 버린다', () => {
    const h0 = historyInit(0)
    expect(historyPush(h0, 0)).toBe(h0)
    let h = h0
    for (let i = 1; i <= 10; i++) h = historyPush(h, i, 3)
    expect(h.past).toEqual([7, 8, 9])
    expect(historyUndo(historyInit('x')).present).toBe('x')
  })

  it('replace 는 기록을 늘리지 않는다', () => {
    const h = historyReplace(historyPush(historyInit('a'), 'b'), 'c')
    expect(h.past).toEqual(['a'])
    expect(h.present).toBe('c')
  })
})

describe('파일 이름', () => {
  it('한 장이면 번호 없이, 여러 장이면 자릿수를 맞춘 번호를 붙인다', () => {
    expect(pageFileName('세일', 0, 1, 'png')).toBe('세일.png')
    expect(pageFileName('세일', 0, 3, 'jpg')).toBe('세일_01.jpg')
    expect(pageFileName('세일', 99, 120, 'png')).toBe('세일_100.png')
  })
})

describe('움직이는 파일 시간표', () => {
  it('효과가 없으면 페이지마다 그림 한 장 + 전환 그림만 만든다', () => {
    const frames = buildFrames({ pageMs: [2000, 2000], entranceMs: [0, 0], fadeMs: 500, fps: 10 })
    const holds = frames.filter((f) => !f.blend)
    expect(holds).toHaveLength(2)
    expect(holds[0].durationMs).toBe(2000)
    const fades = frames.filter((f) => f.blend)
    expect(fades).toHaveLength(5)
    expect(fades.every((f) => f.page === 0 && f.blend!.page === 1)).toBe(true)
    expect(fades.map((f) => f.blend!.alpha)).toEqual([...fades.map((f) => f.blend!.alpha)].sort((a, b) => a - b))
    expect(fades[0].blend!.alpha).toBeGreaterThan(0)
    expect(fades[fades.length - 1].blend!.alpha).toBeLessThan(1)
    expect(framesDurationMs(frames)).toBeCloseTo(4500, 5)
  })

  it('전환이 없으면 마지막 페이지 뒤에도, 페이지 사이에도 전환 그림이 없다', () => {
    const frames = buildFrames({ pageMs: [1000, 1000, 1000], entranceMs: [0, 0, 0], fadeMs: 0, fps: 30 })
    expect(frames).toHaveLength(3)
    expect(framesDurationMs(frames)).toBeCloseTo(3000, 5)
  })

  it('등장 효과가 있으면 그 시간만큼은 프레임 단위로 그리고 나머지는 한 장으로 둔다', () => {
    const frames = buildFrames({ pageMs: [2000], entranceMs: [500], fadeMs: 300, fps: 10 })
    expect(frames).toHaveLength(6)
    expect(frames.slice(0, 5).map((f) => f.localMs)).toEqual([0, 100, 200, 300, 400])
    expect(frames[5]).toMatchObject({ localMs: 2000, durationMs: 1500 })
    expect(framesDurationMs(frames)).toBeCloseTo(2000, 5)
  })

  it('등장 효과 시간과 진행 상태', () => {
    expect(entranceTotalMs(['none', 'none'])).toBe(0)
    expect(entranceTotalMs(['fade'])).toBe(450)
    expect(entranceTotalMs(['fade', 'none', 'pop'])).toBe(140 + 450)
    expect(entranceAt('none', 0, 0)).toEqual({ opacity: 1, offset: 0, scale: 1 })
    expect(entranceAt('fade', 0, 0).opacity).toBe(0)
    expect(entranceAt('fade', 1, 100).opacity).toBe(0)
    expect(entranceAt('rise', 0, 0).offset).toBe(1)
    expect(entranceAt('pop', 0, 0).scale).toBeCloseTo(0.6, 5)
    for (const e of ['fade', 'rise', 'pop'] as const) expect(entranceAt(e, 2, 99999)).toEqual({ opacity: 1, offset: 0, scale: 1 })
  })

  it('출력 크기: 긴 변을 맞추고 MP4 용은 짝수로', () => {
    expect(outputSize(1080, 1350, 720)).toEqual({ width: 576, height: 720 })
    expect(outputSize(1080, 1350, null)).toEqual({ width: 1080, height: 1350 })
    expect(outputSize(500, 300, 720)).toEqual({ width: 500, height: 300 })
    const even = outputSize(861, 3001, 1920, true)
    expect(even.width % 2).toBe(0)
    expect(even.height % 2).toBe(0)
    expect(even.height).toBeLessThanOrEqual(1920)
  })
})

describe('팀 보관함 묶음', () => {
  const pack: TemplatePack = {
    format: 'onbijjang-canvas',
    version: 1,
    name: '세일',
    width: 1080,
    height: 1350,
    pages: [{ id: 'old', background: '#fff000', seconds: 3, objects: [{ type: 'Rect', uid: 'r' }] }],
    assets: { a: { dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 } },
  }

  it('모양이 맞는 묶음만 받아들인다', () => {
    expect(isTemplatePack(pack)).toBe(true)
    expect(isTemplatePack({ ...pack, format: 'other' })).toBe(false)
    expect(isTemplatePack({ ...pack, pages: [] })).toBe(false)
    expect(isTemplatePack(null)).toBe(false)
    expect(isTemplatePack('x')).toBe(false)
  })

  it('불러올 때 id 를 새로 매기고 이상한 값은 기본값으로 바꾼다', () => {
    const doc = docFromPack({ ...pack, width: 5, pages: [...pack.pages, { id: 'x', background: 5 as unknown as string, seconds: -1, objects: 'bad' as unknown as ObjectJSON[] }] })
    expect(doc.width).toBe(16)
    expect(doc.pages[0].id).not.toBe('old')
    expect(doc.pages[0].objects[0].uid).not.toBe('r')
    expect(doc.pages[0]).toMatchObject({ background: '#fff000', seconds: 3 })
    expect(doc.pages[1]).toMatchObject({ background: null, seconds: null, objects: [] })
  })

  it('크기 어림은 사진 data URL 길이를 반영한다', () => {
    const small = packSize(pack)
    const big = packSize({ ...pack, assets: { a: { dataUrl: 'x'.repeat(1_000_000), width: 1, height: 1 } } })
    expect(big - small).toBeGreaterThan(999_000)
  })
})

describe('정렬과 스냅', () => {
  const page = { left: 0, top: 0, width: 1000, height: 800 }
  const box = { left: 100, top: 50, width: 200, height: 100 }

  it('페이지 기준 여섯 방향 정렬', () => {
    expect(alignDelta(box, page, 'left')).toEqual({ dx: -100, dy: 0 })
    expect(alignDelta(box, page, 'hcenter')).toEqual({ dx: 300, dy: 0 })
    expect(alignDelta(box, page, 'right')).toEqual({ dx: 700, dy: 0 })
    expect(alignDelta(box, page, 'top')).toEqual({ dx: 0, dy: -50 })
    expect(alignDelta(box, page, 'vcenter')).toEqual({ dx: 0, dy: 300 })
    expect(alignDelta(box, page, 'bottom')).toEqual({ dx: 0, dy: 650 })
  })

  it('여러 상자를 감싸는 상자', () => {
    expect(unionBox([box, { left: 0, top: 100, width: 50, height: 300 }])).toEqual({ left: 0, top: 50, width: 300, height: 350 })
    expect(unionBox([])).toEqual({ left: 0, top: 0, width: 0, height: 0 })
  })

  it('간격 같게: 양 끝은 두고 가운데만 옮긴다', () => {
    const boxes = [
      { left: 0, top: 0, width: 100, height: 10 },
      { left: 120, top: 0, width: 100, height: 10 },
      { left: 400, top: 0, width: 100, height: 10 },
    ]
    expect(distributeDeltas(boxes, 'x')).toEqual([0, 80, 0])
    expect(distributeDeltas(boxes.slice(0, 2), 'x')).toEqual([0, 0])
    // 넘겨준 순서가 뒤섞여 있어도 각 상자의 자리에 맞는 값을 돌려준다
    expect(distributeDeltas([boxes[2], boxes[0], boxes[1]], 'x')).toEqual([0, 0, 80])
  })

  it('페이지 가운데에 가까우면 달라붙고 안내선을 준다', () => {
    const r = computeSnap({ left: 397, top: 120, width: 200, height: 100 }, [], { width: 1000, height: 800 }, 6)
    expect(r.dx).toBe(3)
    expect(r.dy).toBe(0)
    expect(r.guides).toHaveLength(1)
    expect(r.guides[0]).toMatchObject({ axis: 'x', pos: 500 })
  })

  it('멀면 달라붙지 않는다', () => {
    const r = computeSnap({ left: 380, top: 120, width: 200, height: 100 }, [], { width: 1000, height: 800 }, 6)
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] })
  })

  it('다른 객체의 가장자리에 붙고, 가장 가까운 선을 고른다', () => {
    const other = { left: 600, top: 100, width: 100, height: 100 }
    const r = computeSnap({ left: 404, top: 204, width: 200, height: 50 }, [other], { width: 2000, height: 2000 }, 6)
    // 오른쪽 끝 604 → 다른 객체 왼쪽 600, 위 204 → 다른 객체 아래 200
    expect(r.dx).toBe(-4)
    expect(r.dy).toBe(-4)
    const xGuide = r.guides.find((g) => g.axis === 'x')!
    expect(xGuide.pos).toBe(600)
    expect(xGuide.from).toBe(100)
    expect(xGuide.to).toBe(250)
    expect(r.guides.find((g) => g.axis === 'y')!.pos).toBe(200)
  })

  it('페이지 왼쪽 위 모서리에 두 축이 함께 붙는다', () => {
    const r = computeSnap({ left: 2, top: -3, width: 100, height: 100 }, [], { width: 1000, height: 800 }, 5)
    expect(r.dx).toBe(-2)
    expect(r.dy).toBe(3)
    expect(r.guides).toHaveLength(2)
  })
})
