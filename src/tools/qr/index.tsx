import { Contact, Download, FileArchive, FileSpreadsheet, Link, Mail, MessageSquare, Phone, QrCode, Trash2, Type, Upload, Wifi, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTeamPresets } from '@/app/config'
import { blobToFile, downloadBlob, downloadZip, readAsDataURL, sanitizeFilename, todayStamp } from '@/lib/files'
import { fmt, useAbortable, useDebounced, useObjectUrl, usePersistentState } from '@/lib/hooks'
import { loadImageElement } from '@/lib/image'
import {
  Button, Callout, Checkbox, ColorField, EmptyState, Field, Panel, Progress, Section, Segmented, Select, SendToMenu, Slider, Spinner, Stage, Tabs, TextInput, Textarea, ToolLayout, toast,
} from '@/ui'
import {
  DEFAULT_STYLE, EMPTY_CONTENT, FORMAT_EXT, MAX_BATCH, SIZES, batchFileNames, buildPayload, colorWarnings, densityWarnings, effectiveEcc, lengthProblem, normalizeUrl, parseBatch,
  rowsToBatchText, utf8Length,
  type CornerDotShape, type CornerShape, type DotShape, type Ecc, type QrContent, type QrFormat, type QrKind, type QrStyle,
} from './logic'
import { renderQr } from './render'

const PREVIEW_PX = 640
const MAX_LOGO_BYTES = 2 * 1024 * 1024
const BATCH_PREVIEW_ROWS = 100

const KIND_TABS = [
  { value: 'url', label: '주소', icon: Link },
  { value: 'text', label: '글', icon: Type },
  { value: 'wifi', label: '와이파이', icon: Wifi },
  { value: 'vcard', label: '연락처', icon: Contact },
  { value: 'tel', label: '전화', icon: Phone },
  { value: 'sms', label: '문자', icon: MessageSquare },
  { value: 'email', label: '이메일', icon: Mail },
] as const satisfies ReadonlyArray<{ value: QrKind; label: string; icon: typeof Link }>

interface Prefs {
  format: QrFormat
  size: number
  kind: QrKind
}

// ── 내용 입력 ─────────────────────────────────────────────
function ContentForm({ content, onChange }: { content: QrContent; onChange: (next: QrContent) => void }) {
  const set = <K extends keyof QrContent>(key: K, value: QrContent[K]) => onChange({ ...content, [key]: value })
  switch (content.kind) {
    case 'url': {
      const fixed = normalizeUrl(content.url)
      return (
        <Field label="연결할 주소" hint={fixed && fixed !== content.url.trim() ? `${fixed} 로 저장됩니다.` : '휴대폰으로 찍으면 이 주소가 열립니다.'}>
          {(id) => <TextInput id={id} value={content.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" inputMode="url" spellCheck={false} autoComplete="off" />}
        </Field>
      )
    }
    case 'text':
      return (
        <Field label="담을 글" hint="짧을수록 잘 읽힙니다.">
          {(id) => <Textarea id={id} value={content.text} onChange={(e) => set('text', e.target.value)} rows={5} placeholder="예: 3층 회의실 예약은 총무팀으로" />}
        </Field>
      )
    case 'wifi': {
      const w = content.wifi
      const setW = (patch: Partial<typeof w>) => set('wifi', { ...w, ...patch })
      return (
        <>
          <Field label="와이파이 이름" hint="공유기에 적힌 이름과 대소문자까지 똑같이 적어야 합니다.">
            {(id) => <TextInput id={id} value={w.ssid} onChange={(e) => setW({ ssid: e.target.value })} placeholder="예: OurStore_5G" spellCheck={false} autoComplete="off" />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-ink-2">보안 방식</span>
            <Segmented
              label="보안 방식"
              size="sm"
              value={w.security}
              onValue={(security) => setW({ security })}
              options={[
                { value: 'WPA', label: 'WPA·WPA2·WPA3' },
                { value: 'WEP', label: 'WEP' },
                { value: 'nopass', label: '비밀번호 없음' },
              ]}
            />
          </div>
          {w.security !== 'nopass' && (
            <Field label="비밀번호" hint="QR 을 찍는 사람은 누구나 접속할 수 있습니다. 이 값은 저장되지 않습니다.">
              {(id) => <TextInput id={id} value={w.password} onChange={(e) => setW({ password: e.target.value })} spellCheck={false} autoComplete="off" />}
            </Field>
          )}
          <Checkbox checked={w.hidden} onChange={(hidden) => setW({ hidden })} label="이름을 숨긴 와이파이입니다" />
        </>
      )
    }
    case 'vcard': {
      const v = content.vcard
      const setV = (patch: Partial<typeof v>) => set('vcard', { ...v, ...patch })
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="이름">{(id) => <TextInput id={id} value={v.name} onChange={(e) => setV({ name: e.target.value })} placeholder="홍길동" autoComplete="off" />}</Field>
          <Field label="휴대폰">{(id) => <TextInput id={id} value={v.phone} onChange={(e) => setV({ phone: e.target.value })} placeholder="010-0000-0000" inputMode="tel" autoComplete="off" />}</Field>
          <Field label="회사">{(id) => <TextInput id={id} value={v.org} onChange={(e) => setV({ org: e.target.value })} autoComplete="off" />}</Field>
          <Field label="직함">{(id) => <TextInput id={id} value={v.title} onChange={(e) => setV({ title: e.target.value })} autoComplete="off" />}</Field>
          <Field label="이메일">{(id) => <TextInput id={id} value={v.email} onChange={(e) => setV({ email: e.target.value })} placeholder="name@company.co.kr" inputMode="email" spellCheck={false} autoComplete="off" />}</Field>
          <Field label="홈페이지">{(id) => <TextInput id={id} value={v.url} onChange={(e) => setV({ url: e.target.value })} placeholder="https://" inputMode="url" spellCheck={false} autoComplete="off" />}</Field>
          <Field label="주소" className="sm:col-span-2">{(id) => <TextInput id={id} value={v.address} onChange={(e) => setV({ address: e.target.value })} autoComplete="off" />}</Field>
          <Field label="메모" className="sm:col-span-2" hint="항목이 많을수록 QR 이 촘촘해집니다. 꼭 필요한 것만 채우세요.">
            {(id) => <TextInput id={id} value={v.note} onChange={(e) => setV({ note: e.target.value })} autoComplete="off" />}
          </Field>
        </div>
      )
    }
    case 'tel':
      return (
        <Field label="전화번호" hint="찍으면 바로 전화 걸기 화면이 뜹니다.">
          {(id) => <TextInput id={id} value={content.tel} onChange={(e) => set('tel', e.target.value)} placeholder="02-000-0000" inputMode="tel" autoComplete="off" />}
        </Field>
      )
    case 'sms': {
      const s = content.sms
      return (
        <>
          <Field label="받는 전화번호">{(id) => <TextInput id={id} value={s.phone} onChange={(e) => set('sms', { ...s, phone: e.target.value })} placeholder="010-0000-0000" inputMode="tel" autoComplete="off" />}</Field>
          <Field label="미리 채울 문자 내용" hint="비워 두어도 됩니다.">
            {(id) => <Textarea id={id} value={s.message} onChange={(e) => set('sms', { ...s, message: e.target.value })} rows={3} />}
          </Field>
        </>
      )
    }
    case 'email': {
      const m = content.email
      return (
        <>
          <Field label="받는 사람">{(id) => <TextInput id={id} value={m.to} onChange={(e) => set('email', { ...m, to: e.target.value })} placeholder="name@company.co.kr" inputMode="email" spellCheck={false} autoComplete="off" />}</Field>
          <Field label="제목">{(id) => <TextInput id={id} value={m.subject} onChange={(e) => set('email', { ...m, subject: e.target.value })} />}</Field>
          <Field label="본문" hint="비워 두어도 됩니다.">
            {(id) => <Textarea id={id} value={m.body} onChange={(e) => set('email', { ...m, body: e.target.value })} rows={3} />}
          </Field>
        </>
      )
    }
  }
}

// ── 도구 ──────────────────────────────────────────────────
export default function QrTool() {
  const team = useTeamPresets()
  const [style, setStyle] = usePersistentState<QrStyle>('onbijjang:qr:style', DEFAULT_STYLE)
  const [prefs, setPrefs] = usePersistentState<Prefs>('onbijjang:qr:prefs', { format: 'png', size: 1024, kind: 'url' })
  const setS = (patch: Partial<QrStyle>) => setStyle((s) => ({ ...s, ...patch }))
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [content, setContent] = useState<QrContent>(() => ({ ...EMPTY_CONTENT, kind: prefs.kind }))
  const [logo, setLogo] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [batchText, setBatchText] = useState('')
  const [sheetBusy, setSheetBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)
  const sheetInput = useRef<HTMLInputElement>(null)
  const { start, abort } = useAbortable()

  const ecc = effectiveEcc(style.ecc, Boolean(logo))
  const batch = useMemo(() => parseBatch(batchText), [batchText])
  const batchFiles = useMemo(() => batchFileNames(batch.rows, FORMAT_EXT[prefs.format]), [batch, prefs.format])
  const batchProblems = batch.rows.length - batchFiles.length

  // 미리보기에 쓸 내용: 한 개 모드는 입력한 내용, 여러 개 모드는 첫 번째 줄
  const payload = useMemo(() => {
    if (mode === 'single') return buildPayload(content)
    const first = batchFiles[0]
    return first ? { data: first.row.content, problem: null } : { data: '', problem: '표를 붙여넣으면 첫 번째 줄로 모양을 미리 보여 줍니다.' }
  }, [mode, content, batchFiles])
  const tooLong = payload.data ? lengthProblem(payload.data, ecc) : null

  // ── 미리보기 ──
  const job = useMemo(() => ({ data: tooLong ? '' : payload.data, style, logo }), [payload.data, tooLong, style, logo])
  const settled = useDebounced(job, 160)
  const [preview, setPreview] = useState<{ blob: Blob; modules: number } | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  useEffect(() => {
    if (!settled.data) {
      setPreview(null)
      setRenderError(null)
      setRendering(false)
      return
    }
    let alive = true
    setRendering(true)
    renderQr(settled.data, settled.style, PREVIEW_PX, settled.logo, 'png')
      .then((r) => {
        if (!alive) return
        setPreview(r)
        setRenderError(null)
      })
      .catch((err) => {
        if (!alive) return
        setPreview(null)
        setRenderError(err instanceof Error ? err.message : 'QR 을 그리지 못했습니다.')
      })
      .finally(() => alive && setRendering(false))
    return () => {
      alive = false
    }
  }, [settled])
  const previewUrl = useObjectUrl(preview?.blob)

  const warnings = useMemo(
    () => [...colorWarnings(style.fg, style.bg), ...(preview ? densityWarnings(preview.modules, prefs.size, style.marginPct) : [])],
    [style.fg, style.bg, style.marginPct, preview, prefs.size],
  )

  // ── 로고 ──
  const pickLogo = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast.error('로고는 PNG·JPG·SVG 같은 이미지 파일로 올려 주세요.')
    if (file.size > MAX_LOGO_BYTES) return toast.error('로고는 2MB 이하 이미지로 올려 주세요.')
    try {
      const url = await readAsDataURL(file)
      await loadImageElement(url)
      setLogo(url)
    } catch {
      toast.error('로고 이미지를 열 수 없습니다. 다른 파일로 시도해 주세요.')
    }
  }

  // ── 엑셀 ──
  const readSheet = async (file: File) => {
    setSheetBusy(true)
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer())
      const sheet = book.Sheets[book.SheetNames[0]]
      const rows = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' }) : []
      const text = rowsToBatchText(rows)
      if (!text) return toast.warn('첫 번째 시트에서 내용을 찾지 못했습니다. A열에 이름, B열에 내용을 적어 주세요.')
      setBatchText(text)
      toast.success(`엑셀에서 ${fmt.format(text.split('\n').length)}줄을 읽었습니다.`)
    } catch {
      toast.error('엑셀 파일을 읽지 못했습니다. xlsx·xls·csv 파일인지 확인해 주세요.')
    } finally {
      setSheetBusy(false)
    }
  }

  // ── 저장 ──
  const singleName = `${sanitizeFilename(fileName, 'QR')}.${FORMAT_EXT[prefs.format]}`
  const canSaveSingle = mode === 'single' && Boolean(payload.data) && !tooLong && !renderError
  const saveSingle = async () => {
    if (!canSaveSingle) return
    setSaving(true)
    setSaveError(null)
    try {
      const { blob } = await renderQr(payload.data, style, prefs.size, logo, prefs.format)
      downloadBlob(blob, singleName)
      toast.success(`${singleName} 을 저장했습니다.`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'QR 을 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }
  const sendFiles = async () => {
    const format = prefs.format === 'svg' ? 'png' : prefs.format
    const { blob } = await renderQr(payload.data, style, prefs.size, logo, format)
    return [blobToFile(blob, `${sanitizeFilename(fileName, 'QR')}.${FORMAT_EXT[format]}`)]
  }
  const saveBatch = async () => {
    if (!batchFiles.length) return
    const signal = start()
    setSaveError(null)
    setProgress({ done: 0, total: batchFiles.length })
    try {
      const entries: Array<{ name: string; data: Blob }> = []
      const failed: string[] = []
      for (const { row, filename } of batchFiles) {
        if (signal.aborted) return void toast.info('QR 만들기를 취소했습니다.')
        try {
          entries.push({ name: filename, data: (await renderQr(row.content, style, prefs.size, logo, prefs.format)).blob })
        } catch {
          failed.push(row.name)
        }
        setProgress({ done: entries.length + failed.length, total: batchFiles.length })
      }
      if (signal.aborted) return void toast.info('QR 만들기를 취소했습니다.')
      if (!entries.length) throw new Error('만들 수 있는 QR 이 없습니다. 내용이 너무 길지 않은지 확인해 주세요.')
      await downloadZip(entries, `QR_${todayStamp()}`)
      if (failed.length) setSaveError(`${fmt.format(failed.length)}개는 내용이 너무 길어 만들지 못했습니다: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ' 등' : ''}`)
      toast.success(`QR ${fmt.format(entries.length)}개를 ZIP 으로 저장했습니다.`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'QR 을 저장하지 못했습니다.')
    } finally {
      setProgress(null)
    }
  }
  const busy = saving || progress !== null

  const panel = (
    <>
      <Section title="색">
        <ColorField label="점 색" value={style.fg} onValue={(fg) => setS({ fg })} />
        <ColorField label="배경 색" value={style.bg} onValue={(bg) => setS({ bg })} />
      </Section>

      <Section title="모양">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-2">점 모양</span>
          <Segmented<DotShape>
            label="점 모양"
            block
            size="sm"
            value={style.dots}
            onValue={(dots) => setS({ dots })}
            options={[
              { value: 'square', label: '사각' },
              { value: 'rounded', label: '둥근' },
              { value: 'dots', label: '원' },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-2">모서리 모양</span>
          <Segmented<CornerShape>
            label="모서리 모양"
            block
            size="sm"
            value={style.corner}
            onValue={(corner) => setS({ corner })}
            options={[
              { value: 'square', label: '사각' },
              { value: 'extra-rounded', label: '둥근' },
              { value: 'dot', label: '원' },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-2">모서리 안쪽 점</span>
          <Segmented<CornerDotShape>
            label="모서리 안쪽 점"
            block
            size="sm"
            value={style.cornerDot}
            onValue={(cornerDot) => setS({ cornerDot })}
            options={[
              { value: 'square', label: '사각' },
              { value: 'dot', label: '원' },
            ]}
          />
        </div>
        <Field label="바깥 여백" aside={`${style.marginPct}%`} hint="여백이 너무 좁으면 인식이 잘 안 됩니다.">
          {(id) => <Slider id={id} min={0} max={12} value={style.marginPct} onValue={(marginPct) => setS({ marginPct })} />}
        </Field>
      </Section>

      <Section title="가운데 로고" hint="로고를 넣으면 가려진 부분을 되살릴 수 있게 오류 복구 수준을 가장 높게 맞춥니다.">
        <input
          ref={logoInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void pickLogo(f)
          }}
        />
        <div className="flex items-center gap-3">
          <div className="checker flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-strong">
            {logo ? <img src={logo} alt="로고 미리보기" className="max-h-full max-w-full" /> : <span className="text-2xs text-muted">없음</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={Upload} onClick={() => logoInput.current?.click()}>
              로고 선택
            </Button>
            {team.watermark.logoDataUrl && team.watermark.logoDataUrl !== logo && (
              <Button size="sm" onClick={() => setLogo(team.watermark.logoDataUrl)}>
                팀 로고 쓰기
              </Button>
            )}
            {logo && (
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setLogo(null)}>
                빼기
              </Button>
            )}
          </div>
        </div>
        {logo && (
          <>
            <Field label="로고 크기" aside={`${style.logoSizePct}%`} hint="읽을 수 있는 범위 안에서만 커집니다.">
              {(id) => <Slider id={id} min={10} max={50} step={5} value={style.logoSizePct} onValue={(logoSizePct) => setS({ logoSizePct })} />}
            </Field>
            <Field label="로고 둘레 여백" aside={`${style.logoMargin}`}>
              {(id) => <Slider id={id} min={0} max={30} step={2} value={style.logoMargin} onValue={(logoMargin) => setS({ logoMargin })} />}
            </Field>
          </>
        )}
        <Field label="오류 복구 수준" hint={logo ? '로고가 있어 ‘가장 높게’로 고정됩니다.' : '높을수록 일부가 가려지거나 구겨져도 읽히지만 점이 촘촘해집니다.'}>
          {(id) => (
            <Select<Ecc>
              id={id}
              value={ecc}
              disabled={Boolean(logo)}
              onValue={(v) => setS({ ecc: v })}
              options={[
                { value: 'L', label: '낮게 (약 7%)' },
                { value: 'M', label: '보통 (약 15%)' },
                { value: 'Q', label: '높게 (약 25%)' },
                { value: 'H', label: '가장 높게 (약 30%)' },
              ]}
            />
          )}
        </Field>
      </Section>

      <Section title="저장">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-2">형식</span>
          <Segmented<QrFormat>
            label="저장 형식"
            block
            value={prefs.format}
            onValue={(format) => setPrefs((p) => ({ ...p, format }))}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPG' },
              { value: 'svg', label: 'SVG' },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-2">크기</span>
          <Segmented
            label="저장 크기"
            block
            value={String(prefs.size)}
            onValue={(v) => setPrefs((p) => ({ ...p, size: Number(v) }))}
            options={SIZES.map((s) => ({ value: String(s), label: `${fmt.format(s)}px` }))}
          />
          {prefs.format === 'svg' && <p className="text-sm text-muted">SVG 는 인쇄소에 넘기기 좋은 형식으로, 키워도 깨지지 않습니다.</p>}
        </div>
        {mode === 'single' && (
          <Field label="파일 이름" hint={<span className="num">{singleName}</span>}>
            {(id) => <TextInput id={id} value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="QR" maxLength={80} />}
          </Field>
        )}
        {saveError && (
          <Callout tone="danger" title="확인이 필요합니다">
            {saveError}
          </Callout>
        )}
        {progress ? (
          <div className="flex flex-col gap-2">
            <Progress value={(progress.done / Math.max(1, progress.total)) * 100} label={`QR 만드는 중 ${fmt.format(progress.done)}/${fmt.format(progress.total)}`} />
            <Button icon={X} onClick={abort}>
              취소
            </Button>
          </div>
        ) : mode === 'single' ? (
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="lg" block icon={Download} disabled={!canSaveSingle} loading={saving} onClick={saveSingle}>
              {FORMAT_EXT[prefs.format].toUpperCase()} 로 저장
            </Button>
            <SendToMenu label="다른 도구로 보내기" disabled={!canSaveSingle || busy} files={sendFiles} />
          </div>
        ) : (
          <Button variant="primary" size="lg" block icon={FileArchive} disabled={!batchFiles.length} onClick={saveBatch}>
            ZIP 으로 저장{batchFiles.length ? ` (${fmt.format(batchFiles.length)}개)` : ''}
          </Button>
        )}
      </Section>
    </>
  )

  return (
    <ToolLayout panel={panel}>
      <Tabs
        className="pb-px"
        label="만드는 방식"
        value={mode}
        onValue={(m) => {
          setMode(m)
          setSaveError(null)
        }}
        tabs={[
          { value: 'single', label: '한 개 만들기', icon: QrCode },
          { value: 'batch', label: '여러 개 한 번에', icon: FileSpreadsheet },
        ]}
      />
      <div className="@container">
      <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        {mode === 'single' ? (
          <Panel className="flex min-w-0 flex-col gap-4 p-4">
            <Tabs
              className="pb-px"
              label="내용 종류"
              value={content.kind}
              onValue={(kind) => {
                setContent((c) => ({ ...c, kind }))
                setPrefs((p) => ({ ...p, kind }))
              }}
              tabs={KIND_TABS}
            />
            <ContentForm content={content} onChange={setContent} />
          </Panel>
        ) : (
          <Panel className="flex min-w-0 flex-col gap-3 p-4">
            <Field label="이름과 내용" hint={`엑셀에서 두 열(이름, 내용)을 복사해 붙여넣으세요. 이름이 파일 이름이 됩니다. 최대 ${fmt.format(MAX_BATCH)}개.`}>
              {(id) => (
                <Textarea
                  id={id}
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  rows={7}
                  spellCheck={false}
                  placeholder={'강남점\thttps://example.com/gangnam\n홍대점\thttps://example.com/hongdae'}
                  className="font-mono text-sm! whitespace-pre"
                />
              )}
            </Field>
            <input
              ref={sheetInput}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void readSheet(f)
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" icon={FileSpreadsheet} loading={sheetBusy} onClick={() => sheetInput.current?.click()}>
                엑셀 파일에서 불러오기
              </Button>
              {batchText && (
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setBatchText('')}>
                  비우기
                </Button>
              )}
            </div>
            {batch.overflow > 0 && (
              <Callout tone="warn" title={`${fmt.format(MAX_BATCH)}개까지만 만듭니다`}>
                뒤쪽 {fmt.format(batch.overflow)}줄은 빠졌습니다. 나눠서 만들어 주세요.
              </Callout>
            )}
            {batch.rows.length === 0 ? (
              <EmptyState icon={FileSpreadsheet} title="아직 표가 없습니다" className="py-6!">
                위 칸에 붙여넣거나 엑셀 파일을 불러오면 만들 QR 목록이 나옵니다.
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-ink-2">
                  <span className="num font-bold">만들 QR {fmt.format(batchFiles.length)}개</span>
                  {batchProblems > 0 && <span className="num text-danger"> · 만들 수 없는 줄 {fmt.format(batchProblems)}개</span>}
                </p>
                <div className="max-h-72 overflow-auto rounded-md border border-line">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead className="sticky top-0 bg-paper text-left text-muted">
                      <tr>
                        <th className="w-12 px-3 py-2 text-right font-semibold">줄</th>
                        <th className="px-2 py-2 font-semibold">이름</th>
                        <th className="px-2 py-2 font-semibold">내용</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.rows.slice(0, BATCH_PREVIEW_ROWS).map((r) => (
                        <tr key={r.line} className="border-t border-line align-top">
                          <td className="num px-3 py-1.5 text-right text-muted">{r.line}</td>
                          <td className="break-all px-2 py-1.5 text-ink">{r.name}</td>
                          <td className="break-all px-2 py-1.5 text-ink-2">{r.problem ? <span className="font-semibold text-danger">{r.problem}</span> : r.content}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {batch.rows.length > BATCH_PREVIEW_ROWS && <p className="num text-sm text-muted">앞의 {BATCH_PREVIEW_ROWS}줄만 보여 줍니다. 저장할 때는 모두 만듭니다.</p>}
              </div>
            )}
          </Panel>
        )}

        <div className="flex min-w-0 flex-col gap-3">
          <Stage minHeight={340}>
            {previewUrl ? (
              <div className="relative">
                <img src={previewUrl} alt="QR 코드 미리보기" className="block size-[min(300px,70vw)] rounded-sm shadow-2" />
                {rendering && (
                  <span className="absolute right-2 top-2 rounded-full bg-ink/70 p-1 text-paper">
                    <Spinner />
                  </span>
                )}
              </div>
            ) : rendering ? (
              <Spinner className="size-6" />
            ) : (
              <div className="flex max-w-[36ch] flex-col items-center gap-2 text-center">
                <QrCode className="size-8 opacity-70" aria-hidden />
                <p className="text-sm">{tooLong ? '내용이 너무 길어 만들 수 없습니다.' : (renderError ?? payload.problem ?? '내용을 입력하면 QR 이 여기에 나옵니다.')}</p>
              </div>
            )}
          </Stage>
          {preview && !tooLong && (
            <p className="num text-sm text-muted">
              {mode === 'batch' && batchFiles[0] ? `‘${batchFiles[0].row.name}’ 미리보기 · ` : ''}
              담긴 내용 {fmt.format(utf8Length(payload.data))}바이트 · 한 변 {preview.modules}칸 · 오류 복구 {ecc}
            </p>
          )}
          {tooLong && (
            <Callout tone="danger" title="내용이 너무 깁니다">
              {tooLong}
            </Callout>
          )}
          {warnings.map((w) => (
            <Callout key={w.code} tone="warn" title={w.code === 'dense' || w.code === 'tiny-dots' ? '인식이 어려울 수 있습니다' : '색을 확인해 주세요'}>
              {w.message}
            </Callout>
          ))}
          {preview && (
            <Callout tone="info" title="인쇄 전에 꼭 찍어 보세요">
              휴대폰 카메라로 이 화면의 QR 을 찍어 내용이 맞는지 확인하세요. 색·모양·로고를 바꾼 뒤에는 다시 확인하는 것이 안전합니다.
            </Callout>
          )}
        </div>
      </div>
      </div>
    </ToolLayout>
  )
}
