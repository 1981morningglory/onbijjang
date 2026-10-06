import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Download, Eraser, Maximize2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { downloadBlob, downloadZip, type ZipEntry } from '@/lib/files'
import { useDebounced, usePersistentState } from '@/lib/hooks'
import { Badge, Button, Callout, Checkbox, Dialog, Field, IconButton, NumberInput, Panel, Section, Segmented, Select, Slider, Spinner, Stage, TextInput, Textarea, ToolLayout, toast } from '@/ui'
import { buildLabel, type Fonts, type LabelModel } from './layout'
import { COMPANY_PREFIX, MAX_ROWS, eanCheckDigit, fileBase, isEanKind, parseInput, topText, type BarcodeKind, type Row, type TopMode } from './logic'
import { FORMATS, render, toSVG, type OutFormat } from './output'
import { loadFonts } from './fonts'

const K = (name: string) => `onbijjang:barcode:${name}`
const SAMPLE = { ean: '15099-89039\n15099-89040\n15099-89041', r: 'R214508300002' }
const MAGS = [
  { value: '0.8', label: '80% (X 0.264mm)' },
  { value: '0.9', label: '90% (X 0.297mm)' },
  { value: '1', label: '100% (X 0.33mm)' },
  { value: '1.1', label: '110% (X 0.363mm)' },
  { value: '1.2', label: '120% (X 0.396mm)' },
  { value: '1.5', label: '150% (X 0.495mm)' },
  { value: '2', label: '200% (X 0.66mm)' },
] as const
const KIND_NAME: Record<BarcodeKind, string> = { flat: 'EAN13평형', long: 'EAN13롱바', r: '쿠팡R' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function StatusBadge({ r }: { r: Row }) {
  if (r.skip) return <Badge>건너뜀</Badge>
  if (r.err) return <span className="inline-flex rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">{r.err}</span>
  if (r.warn) return <Badge tone="warn">{r.warn}</Badge>
  return <Badge tone="brand">정상</Badge>
}

function CodeCell({ r, ean }: { r: Row; ean: boolean }) {
  if (!r.code) return null
  if (ean && r.code.length === 13)
    return (
      <span className="num">
        <span className="text-muted">{r.code.slice(0, 7)}</span>
        <b className="text-ink">{r.code.slice(7, 12)}</b>
        <b className="text-accent">{r.code[12]}</b>
      </span>
    )
  return <span className="num">{r.code}</span>
}

/** 회사코드 → 바코드 번호 변환을 크게 보여준다 */
function Conversion({ r, ean }: { r: Row; ean: boolean }) {
  if (!ean || r.code.length !== 13) {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="num rounded-md bg-sunken px-3 py-2 text-2xl font-bold tracking-wide text-ink">{r.code}</span>
        <span className="text-xs text-muted">Code 128 · 체크섬 자동 포함</span>
      </div>
    )
  }
  const c = eanCheckDigit(r.code.slice(0, 12))
  const part = (text: string, label: string, cls: string) => (
    <span className="flex flex-col items-center gap-1">
      <span className={clsx('num rounded-md px-3 py-2 text-2xl font-bold tracking-wide', cls)}>{text}</span>
      <span className="text-2xs text-muted">{label}</span>
    </span>
  )
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-1.5">
        {part(r.code.slice(0, 7), '회사고유코드(고정)', 'bg-sunken text-muted')}
        <span className="pt-2.5 text-lg text-faint">+</span>
        {part(r.code.slice(7, 12), '회사코드 뒤 5자리', 'bg-brand-soft text-brand-ink')}
        <span className="pt-2.5 text-lg text-faint">+</span>
        {part(r.code[12], '검증코드', 'bg-accent-soft text-accent')}
      </div>
      <p className="num text-xs text-muted">
        검증코드 계산: 홀수자리 {c.odd} + 짝수자리 {c.even}×3 = {c.sum} → <b className="text-accent">{c.digit}</b>
      </p>
    </div>
  )
}

export default function BarcodeTool() {
  const [kind, setKind] = usePersistentState<BarcodeKind>(K('kind'), 'flat')
  const [textEan, setTextEan] = usePersistentState(K('textEan'), SAMPLE.ean)
  const [textR, setTextR] = usePersistentState(K('textR'), SAMPLE.r)
  const [top, setTop] = usePersistentState<TopMode>(K('top'), 'no')
  const [commonName, setCommonName] = usePersistentState(K('name'), '')
  const [noEan, setNoEan] = usePersistentState(K('noEan'), '')
  const [noR, setNoR] = usePersistentState(K('noR'), '77000-20562')
  const [originOn, setOriginOn] = usePersistentState(K('originOn'), false)
  const [origin, setOrigin] = usePersistentState(K('origin'), 'MADE IN KOREA')
  const [mag, setMag] = usePersistentState(K('mag'), '1')
  const [xr, setXr] = usePersistentState<number | null>(K('xr'), 0.33)
  const [barH, setBarH] = usePersistentState<number | null>(K('barH'), 15)
  const [textPct, setTextPct] = usePersistentState(K('textPct'), 100)
  const [quiet, setQuiet] = usePersistentState(K('quiet'), true)
  const [formats, setFormats] = usePersistentState<OutFormat[]>(K('formats'), ['eps'])
  const [mode, setMode] = usePersistentState<'zip' | 'each'>(K('mode'), 'zip')

  const [fonts, setFonts] = useState<Fonts | null>(null)
  const [fontErr, setFontErr] = useState('')
  const [sel, setSel] = useState(0)
  const [zoom, setZoom] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    loadFonts().then(setFonts, () => setFontErr('글꼴을 불러오지 못했습니다. 새로고침해 주세요.'))
  }, [])

  const ean = isEanKind(kind)
  const text = ean ? textEan : textR
  const setText = ean ? setTextEan : setTextR
  const commonNo = ean ? noEan : noR
  const setCommonNo = ean ? setNoEan : setNoR
  const debounced = useDebounced(text, 120)
  const rows = useMemo(() => parseInput(debounced, kind), [debounced, kind])
  const valid = rows.filter((r) => !r.err && !r.skip)
  const X = ean ? 0.33 * Number(mag) : (xr ?? 0)
  const optErr = !(X >= 0.19 && X <= 1) ? '바 굵기는 0.19 ~ 1mm 사이로 입력하세요.' : !((barH ?? 0) >= 4 && (barH ?? 0) <= 80) ? '바 높이는 4 ~ 80mm 사이로 입력하세요.' : ''
  const opts = { X, barH: barH ?? 15, textScale: textPct / 100, quiet }

  useEffect(() => {
    if (sel >= rows.length) setSel(Math.max(0, rows.length - 1))
  }, [rows.length, sel])
  const cur: Row | undefined = rows[sel]

  const itemOf = (r: Row) => ({ kind, code: r.code, top: topText(r, kind, top, commonName, commonNo), origin: originOn ? origin.trim() : '' })
  const model: LabelModel | null = useMemo(() => {
    if (!fonts || optErr || !cur || cur.err || cur.skip) return null
    try {
      return buildLabel(itemOf(cur), opts, fonts)
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonts, cur, kind, top, commonName, commonNo, originOn, origin, X, barH, textPct, quiet, optErr])
  const svg = useMemo(() => (model ? toSVG(model, cur?.code ?? '').replace(/^<\?xml[^>]*>\n/, '').replace(/ width="[^"]*mm" height="[^"]*mm"/, ' width="100%"') : ''), [model, cur])

  const total = valid.length * formats.length
  const each = total > 1 && mode === 'each'
  const okCount = valid.length
  const errCount = rows.filter((r) => r.err && !r.skip).length
  const skipCount = rows.filter((r) => r.skip).length

  const toggleFormat = (fmt: OutFormat, on: boolean) => setFormats((prev) => (on ? FORMATS.map((x) => x.value).filter((v) => v === fmt || prev.includes(v)) : prev.filter((v) => v !== fmt)))

  async function save() {
    if (!fonts || !valid.length || !formats.length || optErr) return
    try {
      const folders = total > 1 && !each && formats.length > 1
      const entries: ZipEntry[] = []
      let n = 0
      for (const r of valid) {
        const m = buildLabel(itemOf(r), opts, fonts)
        for (const fmt of formats) {
          setSaving(`만드는 중 ${++n}/${total}`)
          const blob = await render(m, fmt, r.code)
          entries.push({ name: `${folders ? fmt.toUpperCase() + '/' : ''}${fileBase(r)}.${fmt}`, data: blob })
        }
      }
      if (total === 1) downloadBlob(entries[0].data as Blob, entries[0].name)
      else if (!each) {
        setSaving('ZIP 묶는 중')
        await downloadZip(entries, `바코드_${KIND_NAME[kind]}_${valid.length}개${formats.length === 1 ? '_' + formats[0].toUpperCase() : ''}`)
      } else {
        const used = new Set<string>()
        for (let i = 0; i < entries.length; i++) {
          setSaving(`저장 중 ${i + 1}/${entries.length}`)
          let name = entries[i].name
          for (let k = 2; used.has(name); k++) name = entries[i].name.replace(/(\.[^.]+)$/, `_${k}$1`)
          used.add(name)
          downloadBlob(entries[i].data as Blob, name)
          await sleep(250)
        }
      }
      toast.success(total === 1 ? `${entries[0].name} 저장됨` : each ? `${total}개 파일을 저장했습니다.` : 'ZIP 으로 저장했습니다.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setSaving(null)
    }
  }

  const stageMsg = fontErr || (!fonts ? '' : optErr || (!cur ? '오른쪽 칸에 회사코드를 입력하세요.' : cur.err ? `${sel + 1}번 줄: ${cur.err}` : ''))

  const panel = (
    <>
      <Section title="바코드 형태">
        <Segmented
          label="바코드 형태"
          block
          value={kind}
          onValue={(k) => {
            setKind(k)
            setSel(0)
          }}
          options={[
            { value: 'flat', label: 'EAN-13 평형' },
            { value: 'long', label: 'EAN-13 롱바' },
            { value: 'r', label: '쿠팡 R' },
          ]}
        />
        <p className="-mt-1 text-xs text-muted">
          {kind === 'flat' ? '모든 바 높이가 같고 숫자는 아래에 놓입니다.' : kind === 'long' ? '왼쪽 바만 길고 숫자는 오른쪽에 몰아 씁니다.' : 'Code 128. 쿠팡에서 받은 값을 그대로 넣습니다.'}
        </p>
      </Section>

      <Section
        title={ean ? '회사코드 입력' : 'R 바코드 값 입력'}
        action={
          <Button size="sm" variant="ghost" icon={Eraser} onClick={() => setText('')} disabled={!text}>
            지우기
          </Button>
        }
      >
        <Field
          label="한 줄에 하나씩, 또는 엑셀에서 복사해 붙여넣기"
          hint={
            ean ? (
              <>
                <span className="num">15099-89039</span> 를 넣으면 <span className="num">{COMPANY_PREFIX}</span> + <span className="num">89039</span> + 검증코드로 자동 생성됩니다. 뒤 5자리나 13자리도 됩니다. 최대 {MAX_ROWS}줄.
              </>
            ) : (
              <>
                예: <span className="num">R214508300002</span>. 엑셀에서 여러 줄·여러 칸을 그대로 붙여넣어도 됩니다.
              </>
            )
          }
        >
          {(id) => <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={6} wrap="off" spellCheck={false} className="num" placeholder={ean ? '15099-89039\n15099-89040' : 'R214508300002'} />}
        </Field>
      </Section>

      <Section title="표기 문구">
        <Segmented label="맨 위 문구" block size="sm" value={top} onValue={setTop} options={[{ value: 'none', label: '없음' }, { value: 'name', label: '제품명' }, { value: 'no', label: '회사코드 NO.' }]} />
        <Field label="제품명 (공통)" hint="붙여넣은 줄에 제품명이 있으면 그 값이 먼저 쓰입니다.">
          {(id) => <TextInput id={id} value={commonName} onChange={(e) => setCommonName(e.target.value)} placeholder="예: 하드커버스프링노트 소(블랙)" />}
        </Field>
        <Field label="회사코드 (공통)" hint={ean ? '앞 5자리(15099)만 넣으면 뒤에 각 줄의 5자리가 붙습니다.' : undefined}>
          {(id) => <TextInput id={id} value={commonNo} onChange={(e) => setCommonNo(e.target.value)} placeholder={ean ? '예: 15099' : '예: 77000-20562'} className="num" />}
        </Field>
        <Checkbox checked={originOn} onChange={setOriginOn} label="바코드 아래에 원산지 넣기" />
        {originOn && <TextInput value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="원산지 문구" />}
      </Section>

      <Section title="크기">
        {ean ? (
          <Field label="배율">{(id) => <Select id={id} value={mag} onValue={setMag} options={MAGS} />}</Field>
        ) : (
          <Field label="바 굵기 X">{(id) => <NumberInput id={id} value={xr} onValue={setXr} unit="mm" step={0.01} min={0.19} max={1} />}</Field>
        )}
        <Field label="바 높이" aside={<span className="num">{barH ?? '-'}mm</span>}>
          {(id) => (
            <div className="flex flex-col gap-2">
              <Slider id={id} value={barH ?? 15} onValue={setBarH} min={4} max={40} step={0.5} />
              <NumberInput value={barH} onValue={setBarH} unit="mm" step={0.5} min={4} max={80} aria-label="바 높이 직접 입력" />
            </div>
          )}
        </Field>
        <Field label="글자 크기" aside={<span className="num">{textPct}%</span>}>
          {(id) => <Slider id={id} value={textPct} onValue={setTextPct} min={70} max={140} step={5} />}
        </Field>
        <Checkbox checked={quiet} onChange={setQuiet} label="좌우 여백(Quiet zone) 포함 · 스캔 인식에 필요" />
      </Section>

      <Section title="저장">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-2">파일 형식 (여러 개 선택 가능)</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {FORMATS.map((fm) => (
              <Checkbox key={fm.value} checked={formats.includes(fm.value)} onChange={(on) => toggleFormat(fm.value, on)} label={<span className="num font-semibold">{fm.label}</span>} />
            ))}
          </div>
        </div>
        {total > 1 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-ink-2">받는 방법</span>
            <Segmented label="받는 방법" block size="sm" value={mode} onValue={setMode} options={[{ value: 'zip', label: 'ZIP 하나로' }, { value: 'each', label: '낱개 파일로' }]} />
            {each && <p className="text-xs text-muted">브라우저가 "여러 파일 다운로드 허용"을 물으면 허용을 누르세요.</p>}
          </div>
        )}
        <p className="text-sm text-muted">
          {!okCount ? '저장할 바코드가 없습니다.' : !formats.length ? '파일 형식을 하나 이상 고르세요.' : (
            <>
              바코드 <b className="num text-ink">{okCount}</b>개 × 형식 <b className="num text-ink">{formats.length}</b>개 = 파일 <b className="num text-ink">{total}</b>개
            </>
          )}
        </p>
        <Button variant="primary" icon={Download} block loading={!!saving} disabled={!fonts || !!optErr || !okCount || !formats.length} onClick={save}>
          {saving ?? (total <= 1 ? '저장' : each ? `${total}개 파일 저장` : 'ZIP 으로 저장')}
        </Button>
        <p className="text-xs text-muted">AI 파일은 PDF 호환 형식이라 일러스트레이터에서 바로 열립니다. 글자는 윤곽선, 색은 K100입니다.</p>
      </Section>
    </>
  )

  return (
    <ToolLayout panel={panel}>
      <Panel className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base">미리보기</h2>
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} label="이전 바코드" size="sm" disabled={sel <= 0} onClick={() => setSel(sel - 1)} />
            <span className="num min-w-14 text-center text-sm text-ink-2">{rows.length ? `${sel + 1} / ${rows.length}` : '-'}</span>
            <IconButton icon={ChevronRight} label="다음 바코드" size="sm" disabled={sel >= rows.length - 1} onClick={() => setSel(sel + 1)} />
            <Button size="sm" icon={Maximize2} disabled={!model} onClick={() => setZoom(true)}>
              크게 보기
            </Button>
          </div>
        </div>
        {cur && !cur.skip && cur.code && (
          <>
            <p className="text-sm text-muted">
              입력값 <b className="num text-ink">{cur.src}</b>
              {cur.name && <> · {cur.name}</>}
            </p>
            <Conversion r={cur} ean={ean} />
          </>
        )}
        <Stage minHeight={280}>
          {!fonts && !fontErr ? (
            <span className="flex items-center gap-2 rounded-md bg-surface px-3 py-2 text-sm text-ink-2 shadow-1">
              <Spinner /> 글꼴을 불러오는 중
            </span>
          ) : model ? (
            <div className="rounded-sm bg-white p-2 shadow-2" style={{ width: `min(100%, ${Math.round(model.w * 9.5)}px)` }} dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <span className="rounded-md bg-surface px-3 py-2 text-sm text-ink-2 shadow-1">{stageMsg || '미리보기를 만들 수 없습니다.'}</span>
          )}
        </Stage>
        {model && (
          <p className="num flex justify-between text-xs text-muted">
            <span>{cur?.code}</span>
            <span>
              실제 크기 {model.w.toFixed(2)} × {model.h.toFixed(2)} mm
            </span>
          </p>
        )}
      </Panel>

      <Panel className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base">생성 목록</h2>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="brand">생성 {okCount}개</Badge>
            {errCount > 0 && <span className="inline-flex rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">오류 {errCount}개</span>}
            {skipCount > 0 && <Badge>건너뜀 {skipCount}개</Badge>}
          </div>
        </div>
        {rows.length ? (
          <div className="max-h-80 overflow-auto rounded-md border border-line">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">입력값</th>
                  <th className="px-3 py-2 font-semibold">바코드 번호</th>
                  <th className="px-3 py-2 font-semibold">맨 위 문구</th>
                  <th className="px-3 py-2 font-semibold">상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    onClick={() => setSel(i)}
                    aria-selected={i === sel}
                    className={clsx('cursor-pointer border-b border-line last:border-b-0 transition-colors duration-150', i === sel ? 'bg-brand-soft' : 'hover:bg-sunken')}
                  >
                    <td className="num px-3 py-2 text-muted">{i + 1}</td>
                    <td className="num px-3 py-2 text-ink-2">{r.src}</td>
                    <td className="px-3 py-2">
                      <CodeCell r={r} ean={ean} />
                    </td>
                    <td className="px-3 py-2 text-ink-2">{r.skip ? '' : topText(r, kind, top, commonName, commonNo)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge r={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Callout tone="info">오른쪽 칸에 회사코드를 입력하거나 엑셀에서 붙여넣으면 여기에 목록이 나옵니다.</Callout>
        )}
      </Panel>

      <Dialog open={zoom} onClose={() => setZoom(false)} title={`${cur?.code ?? ''} 크게 보기`} size="xl">
        <div className="flex flex-col items-center gap-3">
          <div className="w-full max-w-[900px] rounded-sm bg-white p-4 shadow-2" dangerouslySetInnerHTML={{ __html: svg }} />
          {model && <p className="num text-xs text-muted">실제 크기 {model.w.toFixed(2)} × {model.h.toFixed(2)} mm</p>}
        </div>
      </Dialog>
    </ToolLayout>
  )
}
