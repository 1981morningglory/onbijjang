/** 탭의 주 동작들. 화면(패널)은 설정만 넘기고, 여기서 긴 작업을 돌려 결과 목록에 올린다. */
import { blobToFile, extOf, formatBytes, stripExt } from '@/lib/files'
import { toast } from '@/ui'
import { exportDocxImages, exportDocxText, exportImages, exportPptx, extractSheets, sheetsToXlsx, textToDocx, type ExportContext } from './exporters'
import { outputName, type PaperSettings } from './geometry'
import { createOcr, overlayTextLayer } from './ocr'
import { convertOnServer, officeToPdf, readDocx, readXlsx } from './office'
import { buildPdf, encryptPdf, pdfFile, rasterPdf, savePdf, stampPdf, type BuildContext } from './ops'
import { chunkEvery, groupLabel, parseRanges } from './ranges'
import { renderItem } from './render'
import { clamp, type Settings } from './settings'
import { runJob, setResults, targetPages, useWorkspace, type JobControl, type PageItem } from './store'

const ws = () => useWorkspace.getState()

export const paperOf = (s: Settings): PaperSettings => ({ size: s.paper, marginMm: clamp(s.marginMm, 0, 50, 10) })

function buildCtx(s: Settings, ctl: JobControl, label: string, share = 100, offset = 0): BuildContext & ExportContext {
  return {
    sources: ws().sources,
    paper: paperOf(s),
    imageQuality: s.imageQuality,
    signal: ctl.signal,
    onProgress: (done, total) => ctl.progress(offset + (done / Math.max(1, total)) * share, `${label} (${done}/${total}쪽)`),
  }
}

/** 결과 이름의 바탕: 원본이 하나면 그 이름, 여럿이면 "첫이름 외 N개" */
export function baseNameOf(items: PageItem[]): string {
  const { sources, sourceOrder } = ws()
  const used = new Set(items.map((i) => i.sourceId))
  const ids = sourceOrder.filter((id) => used.has(id))
  if (!ids.length) return '문서'
  const first = stripExt(sources[ids[0]].name)
  return ids.length > 1 ? `${first} 외 ${ids.length - 1}개` : first
}

function rasterNote(count: number): string | null {
  return count ? `원본 그대로 복사할 수 없는 ${count}쪽은 그림으로 바꿔 넣었습니다(그 쪽은 글자 선택이 안 됩니다).` : null
}

function requirePages(): PageItem[] | null {
  const items = targetPages(ws().pages)
  if (!items.length) {
    toast.info('먼저 PDF 나 사진을 올려 주세요.')
    return null
  }
  return items
}

// ── 병합 · 회전 저장 · PDF 만들기 ─────────────────────────
export function actionBuild(s: Settings, suffix: string) {
  const items = requirePages()
  if (!items) return
  void runJob('PDF 만드는 중', async (ctl) => {
    const { doc, rasterized } = await buildPdf(items, buildCtx(s, ctl, 'PDF 만드는 중', 90))
    ctl.progress(95, '저장하는 중')
    const file = pdfFile(await savePdf(doc), outputName(baseNameOf(items), suffix, 'pdf'))
    setResults('PDF', [file], rasterNote(rasterized))
    toast.success(`${items.length}쪽짜리 PDF 를 만들었습니다.`)
  })
}

// ── 분할 ──────────────────────────────────────────────────
export function splitGroups(s: Settings, total: number): { groups: number[][]; error: string | null } {
  if (s.splitMode === 'single') return { groups: chunkEvery(total, 1), error: null }
  if (s.splitMode === 'every') return { groups: chunkEvery(total, clamp(s.splitEvery, 1, 100000, 2)), error: null }
  const r = parseRanges(s.splitRanges, total)
  if (r.error) return { groups: [], error: r.error }
  return { groups: r.groups, error: r.groups.length ? null : '나눌 범위를 적어 주세요. 예: 1-3,4-6' }
}

export function actionSplit(s: Settings) {
  const pages = ws().pages
  if (!pages.length) return void toast.info('먼저 PDF 를 올려 주세요.')
  const { groups, error } = splitGroups(s, pages.length)
  if (error) return void toast.warn(error)
  if (groups.length > 1000) return void toast.warn('한 번에 1,000개까지 나눌 수 있습니다. 범위를 줄여 주세요.')
  void runJob('나누는 중', async (ctl) => {
    const files: File[] = []
    let rasterized = 0
    const base = baseNameOf(pages)
    for (let g = 0; g < groups.length; g++) {
      ctl.signal.throwIfAborted()
      const items = groups[g].map((i) => pages[i])
      const built = await buildPdf(items, { ...buildCtx(s, ctl, ''), onProgress: undefined })
      rasterized += built.rasterized
      files.push(pdfFile(await savePdf(built.doc), outputName(base, groupLabel(groups[g]), 'pdf')))
      ctl.progress(((g + 1) / groups.length) * 100, `나누는 중 (${g + 1}/${groups.length}개)`)
    }
    setResults('나눈 PDF', files, rasterNote(rasterized))
    toast.success(`PDF ${files.length}개로 나눴습니다.`)
  })
}

// ── 이미지 ────────────────────────────────────────────────
export function actionImages(s: Settings) {
  const items = requirePages()
  if (!items) return
  void runJob('이미지로 바꾸는 중', async (ctl) => {
    const { pages, sources } = ws()
    const position = new Map(pages.map((p, i) => [p.id, i]))
    const digits = String(pages.length).length
    const single = new Set(items.map((i) => i.sourceId)).size === 1
    const files = await exportImages(items, buildCtx(s, ctl, '이미지로 바꾸는 중'), {
      format: s.imgFormat,
      dpi: clamp(s.imgDpi, 72, 300, 150),
      quality: clamp(s.imgQuality, 30, 100, 90) / 100,
      // 원본이 하나면 원본의 쪽 번호, 여러 문서를 섞었으면 작업대 순서 번호
      nameOf: (item, _i, ext) => {
        const n = single ? item.index + 1 : (position.get(item.id) ?? 0) + 1
        return outputName(single ? sources[item.sourceId].name : baseNameOf(items), String(n).padStart(digits, '0'), ext)
      },
    })
    setResults('이미지', files)
    toast.success(`이미지 ${files.length}장을 만들었습니다.`)
  })
}

// ── Word ──────────────────────────────────────────────────
export function actionWord(s: Settings) {
  const items = requirePages()
  if (!items) return
  void runJob('Word 문서 만드는 중', async (ctl) => {
    const ctx = buildCtx(s, ctl, 'Word 문서 만드는 중', 92)
    const name = outputName(baseNameOf(items), '', 'docx')
    if (s.wordMode === 'image') {
      const blob = await exportDocxImages(items, ctx, clamp(s.wordDpi, 72, 300, 150))
      setResults('Word 문서', [blobToFile(blob, name)], '쪽을 그림으로 넣었습니다. 모양은 그대로지만 Word 에서 글자를 고칠 수는 없습니다.')
    } else {
      const { blob, emptyPages } = await exportDocxText(items, ctx)
      if (emptyPages === items.length) throw new Error('글자를 찾지 못했습니다. 스캔한 문서라면 ‘글자 인식’ 탭을 먼저 쓰거나, ‘쪽 그림으로’ 방식을 골라 주세요.')
      setResults('Word 문서', [blobToFile(blob, name)], emptyPages ? `${emptyPages}쪽은 글자가 없어 비어 있습니다(스캔한 쪽은 ‘글자 인식’ 탭에서 먼저 읽어 주세요).` : '글자만 옮겼습니다. 표·그림·글꼴은 원본과 다를 수 있습니다.')
    }
    toast.success('Word 문서를 만들었습니다.')
  })
}

// ── Excel ─────────────────────────────────────────────────
export function actionExtractSheets(s: Settings) {
  const items = requirePages()
  if (!items) return
  void runJob('표 찾는 중', async (ctl) => {
    const position = new Map(ws().pages.map((p, i) => [p.id, i]))
    const sheets = await extractSheets(items, position, buildCtx(s, ctl, '표 찾는 중'))
    if (sheets.every((sh) => !sh.rows.length)) throw new Error('글자를 찾지 못했습니다. 스캔한 문서라면 ‘글자 인식’ 탭에서 검색 가능한 PDF 로 만든 뒤 다시 올려 주세요.')
    useWorkspace.setState({ sheets })
    const tables = sheets.filter((sh) => sh.tableRows > 0).length
    toast.success(tables ? `${tables}쪽에서 표를 찾았습니다. 미리보기에서 고친 뒤 저장하세요.` : '표로 보이는 부분은 없어 글만 줄마다 옮겼습니다.')
  })
}

export function actionSaveXlsx(s: Settings) {
  const sheets = ws().sheets
  if (!sheets?.some((sh) => sh.rows.length)) return void toast.info('먼저 ‘표 찾기’를 눌러 주세요.')
  void runJob('Excel 파일 만드는 중', async () => {
    const blob = await sheetsToXlsx(sheets, { oneSheet: s.excelOneSheet, numeric: s.excelNumeric })
    setResults('Excel 문서', [blobToFile(blob, outputName(baseNameOf(targetPages(ws().pages)), '', 'xlsx'))])
    toast.success('Excel 문서를 만들었습니다.')
  })
}

// ── PPT ───────────────────────────────────────────────────
export function actionPpt(s: Settings) {
  const items = requirePages()
  if (!items) return
  void runJob('PPT 만드는 중', async (ctl) => {
    const blob = await exportPptx(items, buildCtx(s, ctl, 'PPT 만드는 중', 92), clamp(s.pptDpi, 72, 300, 150))
    setResults('PPT 문서', [blobToFile(blob, outputName(baseNameOf(items), '', 'pptx'))], '쪽마다 그림 한 장으로 넣었습니다. PowerPoint 에서 글자를 고칠 수는 없습니다.')
    toast.success(`슬라이드 ${items.length}장을 만들었습니다.`)
  })
}

// ── 압축 ──────────────────────────────────────────────────
export function actionCompress(s: Settings) {
  const items = requirePages()
  if (!items) return
  void runJob('용량 줄이는 중', async (ctl) => {
    const { pages, sources, sourceOrder } = ws()
    const ctx = buildCtx(s, ctl, '용량 줄이는 중', 92)
    let bytes: Uint8Array
    let note: string | null = null
    if (s.compressMode === 'raster') {
      bytes = await savePdf(await rasterPdf(items, ctx, clamp(s.compressDpi, 50, 300, 120), clamp(s.compressQuality, 20, 95, 70) / 100))
    } else {
      const built = await buildPdf(items, ctx)
      bytes = await savePdf(built.doc)
      note = rasterNote(built.rasterized)
    }
    // 작업대 전체를 그대로 줄였을 때만 원본 크기와 견줄 수 있다.
    const whole = items.length === pages.length && sourceOrder.every((id) => sources[id].kind === 'pdf')
    const before = whole ? sourceOrder.reduce((sum, id) => sum + sources[id].size, 0) : 0
    const sizeNote = !before
      ? `결과 ${formatBytes(bytes.length)}`
      : bytes.length < before
        ? `${formatBytes(before)} → ${formatBytes(bytes.length)} (${Math.round((1 - bytes.length / before) * 100)}% 줄었습니다)`
        : `${formatBytes(before)} → ${formatBytes(bytes.length)}. 더 줄어들지 않았습니다. ${s.compressMode === 'raster' ? '해상도나 품질을 낮춰 보세요.' : '‘쪽을 그림으로’ 방식을 써 보세요.'}`
    setResults('줄인 PDF', [pdfFile(bytes, outputName(baseNameOf(items), '용량줄임', 'pdf'))], [sizeNote, note].filter(Boolean).join(' '))
    toast.success('용량을 줄인 PDF 를 만들었습니다.')
  })
}

// ── 쪽 번호 · 워터마크 ────────────────────────────────────
export function actionStamp(s: Settings) {
  const items = requirePages()
  if (!items) return
  if (!s.numbers.enabled && !s.mark.enabled) return void toast.info('쪽 번호나 워터마크 중 하나는 켜 주세요.')
  if (s.mark.enabled && !s.mark.text.trim()) return void toast.info('워터마크 글자를 입력해 주세요.')
  void runJob('찍는 중', async (ctl) => {
    const { doc, rasterized } = await buildPdf(items, buildCtx(s, ctl, '쪽 모으는 중', 70))
    ctl.progress(75, '글자 찍는 중')
    await stampPdf(
      doc,
      { ...s.numbers, start: Math.round(clamp(s.numbers.start, 0, 99999, 1)), size: clamp(s.numbers.size, 6, 36, 10), marginMm: clamp(s.numbers.marginMm, 0, 50, 10) },
      { ...s.mark, opacity: clamp(s.mark.opacity, 5, 100, 20), widthPct: clamp(s.mark.widthPct, 20, 90, 60) },
      ctl.signal,
    )
    ctl.progress(92, '저장하는 중')
    const suffix = s.numbers.enabled && s.mark.enabled ? '번호·워터마크' : s.numbers.enabled ? '번호' : '워터마크'
    setResults('PDF', [pdfFile(await savePdf(doc), outputName(baseNameOf(items), suffix, 'pdf'))], rasterNote(rasterized))
    toast.success('PDF 를 만들었습니다.')
  })
}

// ── 암호 걸기 ─────────────────────────────────────────────
export function actionProtect(s: Settings, password: string) {
  const items = requirePages()
  if (!items) return
  void runJob('암호 거는 중', async (ctl) => {
    const { doc, rasterized } = await buildPdf(items, buildCtx(s, ctl, '쪽 모으는 중', 70))
    ctl.progress(75, '암호 거는 중')
    const locked = await encryptPdf(await savePdf(doc), { password, allowPrint: s.allowPrint, allowCopy: s.allowCopy, algorithm: s.algorithm })
    setResults('암호 건 PDF', [pdfFile(locked, outputName(baseNameOf(items), '암호', 'pdf'))], rasterNote(rasterized))
    toast.success('암호를 건 PDF 를 만들었습니다. 암호를 잊으면 열 수 없으니 따로 적어 두세요.')
  })
}

// ── 글자 인식 ─────────────────────────────────────────────
export function actionOcr(s: Settings) {
  const items = requirePages()
  if (!items) return
  void runJob('글자 인식 준비 중', async (ctl) => {
    const dpi = clamp(s.ocrDpi, 100, 300, 200)
    const paper = paperOf(s)
    const { sources } = ws()
    let current = 0
    const total = items.length
    const share = s.ocrOutput === 'pdf' ? 92 : 98
    const engine = await createOcr(
      s.ocrLang,
      dpi,
      (label, fraction) => ctl.progress(current === 0 && fraction === null ? null : ((Math.max(0, current - 1) + (current ? (fraction ?? 0) : 0)) / total) * share, current ? `${label} (${current}/${total}쪽)` : label),
      ctl.signal,
    )
    try {
      const texts: string[] = []
      const layers: Array<Uint8Array | null> = []
      for (let i = 0; i < total; i++) {
        ctl.signal.throwIfAborted()
        current = i + 1
        ctl.progress((i / total) * share, `글자 읽는 중 (${current}/${total}쪽)`)
        const canvas = await renderItem(items[i], sources[items[i].sourceId], { dpi, paper, signal: ctl.signal })
        const page = await engine.recognize(canvas, s.ocrOutput === 'pdf')
        texts.push(page.text.trim())
        layers.push(page.textPdf)
      }
      const joined = texts.map((t, i) => (total > 1 ? `[${i + 1}쪽]\n${t}` : t)).join('\n\n')
      useWorkspace.setState({ ocrText: joined })
      const found = texts.filter(Boolean).length
      if (!found) throw new Error('읽을 수 있는 글자를 찾지 못했습니다. 해상도를 높이거나, 글자가 똑바로 보이도록 쪽을 돌린 뒤 다시 해 보세요.')
      const base = baseNameOf(items)
      if (s.ocrOutput === 'pdf') {
        ctl.progress(93, '검색 가능한 PDF 만드는 중')
        const { doc, rasterized } = await buildPdf(items, { ...buildCtx(s, ctl, ''), onProgress: undefined })
        for (let i = 0; i < total; i++) {
          const layer = layers[i]
          if (layer) await overlayTextLayer(doc, i, layer)
        }
        setResults('검색 가능한 PDF', [pdfFile(await savePdf(doc), outputName(base, '글자인식', 'pdf'))], [`${found}쪽에서 글자를 읽었습니다. 쪽 모양은 그대로이고, 검색·복사만 되게 보이지 않는 글자를 겹쳤습니다.`, rasterNote(rasterized)].filter(Boolean).join(' '))
      } else if (s.ocrOutput === 'txt') {
        setResults('인식한 글자', [new File([`﻿${joined.replace(/\n/g, '\r\n')}`], outputName(base, '글자인식', 'txt'), { type: 'text/plain' })])
      } else {
        setResults('인식한 글자', [blobToFile(await textToDocx(texts), outputName(base, '글자인식', 'docx'))])
      }
      toast.success(`${found}쪽에서 글자를 읽었습니다.`)
    } finally {
      await engine.terminate()
    }
  })
}

// ── Word·Excel → PDF ──────────────────────────────────────
export function actionOffice(file: File, method: 'browser' | 'server', onDone?: () => void) {
  void runJob(method === 'server' ? '서버에서 변환하는 중' : '문서 읽는 중', async (ctl) => {
    const name = outputName(file.name, '', 'pdf')
    if (method === 'server') {
      const blob = await convertOnServer(file, ctl.signal)
      setResults('변환한 PDF', [blobToFile(blob, name)], '온비짱 서버에서 변환했습니다. 올린 파일은 변환 직후 서버에서 지워졌습니다.')
    } else {
      const ext = extOf(file.name)
      if (ext !== 'docx' && ext !== 'xlsx') throw new Error(`.${ext} 문서는 이 기기에서 바꿀 수 없습니다. .docx 나 .xlsx 로 저장한 뒤 다시 올려 주세요.`)
      const content = ext === 'docx' ? await readDocx(file) : await readXlsx(file)
      ctl.signal.throwIfAborted()
      ctl.progress(20, 'PDF 로 옮기는 중')
      const { doc, pages, notes } = await officeToPdf(content, ctl.signal, (f) => ctl.progress(20 + f * 75, 'PDF 로 옮기는 중'))
      setResults('변환한 PDF', [pdfFile(await savePdf(doc), name)], [`${pages}쪽으로 옮겼습니다. 글·표·그림만 옮기므로 글꼴·색·배치는 원본과 다릅니다.`, ...notes].join(' '))
    }
    toast.success('PDF 로 바꿨습니다.')
    onDone?.()
  })
}
