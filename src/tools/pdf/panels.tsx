/** 탭마다의 설정 패널. 설정만 다루고, 실제 작업은 actions.ts 가 한다. */
import { FileDown, FileText, Hash, Images, KeyRound, Minimize2, Presentation, Printer, ScanText, Scissors, Search, Table, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTeamPresets } from '@/app/config'
import { extOf, formatBytes } from '@/lib/files'
import { Button, Callout, Checkbox, ColorField, Field, IconButton, NumberInput, Section, Segmented, Select, Slider, Switch, TextInput, toast } from '@/ui'
import { actionBuild, actionCompress, actionExtractSheets, actionImages, actionOcr, actionOffice, actionPpt, actionProtect, actionSaveXlsx, actionSplit, actionStamp, actionWord, splitGroups } from './actions'
import type { PaperSize } from './geometry'
import { OFFICE_BROWSER_EXT, OFFICE_SERVER_EXT } from './intake'
import { ocrDownloadBytes, type OcrLang } from './ocr'
import { ADMIN_ONLY_MESSAGE, fetchConvertStatus, printContent, readDocx, readXlsx, type ConvertStatus } from './office'
import { formatPageNumber, type NumberFormat } from './ranges'
import type { Settings } from './settings'
import { runJob, targetPages, useWorkspace, type TabId } from './store'

export interface PanelProps {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}

/** 지금 작업이 어느 쪽에 적용되는지 한 줄로 알려준다. */
function Target({ whole }: { whole?: boolean }) {
  const pages = useWorkspace((s) => s.pages)
  const picked = pages.filter((p) => p.selected).length
  if (!pages.length) return <p className="text-sm text-muted">왼쪽에 PDF 나 사진을 올리면 시작할 수 있습니다.</p>
  if (whole) return <p className="num text-sm text-ink-2">작업대의 전체 {pages.length}쪽을 지금 순서대로 나눕니다.</p>
  return (
    <p className="num text-sm text-ink-2">
      {picked ? (
        <>
          고른 <strong className="text-ink">{picked}쪽</strong>만 처리합니다.
        </>
      ) : (
        <>
          전체 <strong className="text-ink">{pages.length}쪽</strong>을 처리합니다. 쪽을 고르면 고른 쪽만 처리합니다.
        </>
      )}
    </p>
  )
}

function Action({ icon, children, onClick, disabled, whole }: { icon: typeof FileDown; children: ReactNode; onClick: () => void; disabled?: boolean; whole?: boolean }) {
  const hasPages = useWorkspace((s) => s.pages.length > 0)
  const busy = useWorkspace((s) => s.job !== null)
  return (
    <Section title="실행">
      <Target whole={whole} />
      <Button variant="primary" size="lg" block icon={icon} disabled={!hasPages || busy || disabled} onClick={onClick}>
        {children}
      </Button>
    </Section>
  )
}

function DpiField({ label = '해상도', value, onValue, min = 72, max = 300, hint }: { label?: string; value: number; onValue: (v: number) => void; min?: number; max?: number; hint?: ReactNode }) {
  return (
    <Field label={label} aside={`${value} dpi`} hint={hint}>
      {(id) => <Slider id={id} min={min} max={max} step={2} value={value} onValue={onValue} />}
    </Field>
  )
}

// ── 정리·순서변경 ─────────────────────────────────────────────
function OrganizePanel({ settings }: PanelProps) {
  const sourceCount = useWorkspace((s) => s.sourceOrder.length)
  return (
    <>
      <Section title="정리·순서변경" hint="왼쪽에서 순서를 바꾸고, 돌리고, 필요 없는 쪽을 뺀 뒤 한 파일로 저장합니다.">
        <ul className="prose-ob text-sm">
          <li>PDF 여러 개와 사진을 함께 올려 한 파일로 합칠 수 있습니다.</li>
          <li>돌려 놓은 쪽은 돌린 그대로 저장됩니다.</li>
          <li>글자·링크 같은 원본 내용은 그대로 유지됩니다.</li>
        </ul>
      </Section>
      <Action icon={FileDown} onClick={() => actionBuild(settings, sourceCount > 1 ? '병합' : '정리')}>
        {sourceCount > 1 ? '한 PDF 로 합치기' : 'PDF 로 저장'}
      </Action>
    </>
  )
}

// ── 분할 ──────────────────────────────────────────────────
function SplitPanel({ settings, update }: PanelProps) {
  const total = useWorkspace((s) => s.pages.length)
  const plan = useMemo(() => splitGroups(settings, total), [settings, total])
  const rangeError = settings.splitMode === 'ranges' && settings.splitRanges.trim() && plan.error ? plan.error : null
  return (
    <>
      <Section title="나누는 방법">
        <Segmented
          label="나누는 방법"
          block
          value={settings.splitMode}
          onValue={(splitMode) => update({ splitMode })}
          options={[
            { value: 'ranges', label: '범위별' },
            { value: 'every', label: 'N쪽마다' },
            { value: 'single', label: '한 쪽씩' },
          ]}
        />
        {settings.splitMode === 'ranges' && (
          <Field label="범위" hint="쉼표로 나눈 묶음마다 파일 하나가 됩니다. 예: 1-3,4-6,7-" error={rangeError}>
            {(id) => <TextInput id={id} value={settings.splitRanges} onChange={(e) => update({ splitRanges: e.target.value })} placeholder="1-3,4-6" className="num" aria-invalid={rangeError ? true : undefined} />}
          </Field>
        )}
        {settings.splitMode === 'every' && (
          <Field label="몇 쪽마다 나눌까요">{(id) => <NumberInput id={id} min={1} max={9999} value={settings.splitEvery} onValue={(v) => update({ splitEvery: v ?? 1 })} unit="쪽" />}</Field>
        )}
        {total > 0 && !plan.error && <p className="num text-sm text-muted">PDF {plan.groups.length}개가 만들어집니다.</p>}
      </Section>
      <Action icon={Scissors} whole disabled={Boolean(plan.error)} onClick={() => actionSplit(settings)}>
        PDF 나누기
      </Action>
    </>
  )
}

// ── PDF 만들기(사진 → PDF, Word·Excel → PDF) ──────────────
function PaperFields({ settings, update }: PanelProps) {
  return (
    <>
      <Field label="용지">
        {(id) => (
          <Select<PaperSize>
            id={id}
            value={settings.paper}
            onValue={(paper) => update({ paper })}
            options={[
              { value: 'a4-auto', label: 'A4 (사진 방향에 맞춤)' },
              { value: 'a4-portrait', label: 'A4 세로' },
              { value: 'a4-landscape', label: 'A4 가로' },
              { value: 'fit', label: '사진 크기 그대로' },
            ]}
          />
        )}
      </Field>
      <Field label="여백">{(id) => <NumberInput id={id} min={0} max={50} value={settings.marginMm} onValue={(v) => update({ marginMm: v ?? 0 })} unit="mm" />}</Field>
      <Field label="사진 화질" hint={settings.imageQuality === 'small' ? '긴 변 2400px · JPG 로 줄여 넣습니다.' : 'PNG 는 그대로, JPG 는 높은 품질로 넣습니다.'}>
        {() => (
          <Segmented
            label="사진 화질"
            block
            size="sm"
            value={settings.imageQuality}
            onValue={(imageQuality) => update({ imageQuality })}
            options={[
              { value: 'high', label: '원본에 가깝게' },
              { value: 'small', label: '용량 줄이기' },
            ]}
          />
        )}
      </Field>
    </>
  )
}

function CreatePanel(props: PanelProps) {
  const imageCount = useWorkspace((s) => Object.values(s.sources).filter((x) => x.kind === 'image').length)
  return (
    <>
      <Section title="사진으로 PDF 만들기" hint={imageCount ? `사진 ${imageCount}장이 올라와 있습니다. 한 장이 한 쪽이 됩니다.` : 'JPG·PNG·WebP 사진을 올리면 한 장이 한 쪽이 됩니다(최대 200장).'}>
        <PaperFields {...props} />
      </Section>
      <Action icon={FileDown} onClick={() => actionBuild(props.settings, '')}>
        PDF 만들기
      </Action>
      <OfficeSection {...props} />
    </>
  )
}

function OfficeSection({ settings, update }: PanelProps) {
  const file = useWorkspace((s) => s.officeFile)
  const busy = useWorkspace((s) => s.job !== null)
  const input = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<ConvertStatus | null>(null)
  useEffect(() => {
    let alive = true
    void fetchConvertStatus().then((s) => alive && setStatus(s))
    return () => {
      alive = false
    }
  }, [])

  // 서버에 변환 프로그램이 없으면(Railway 배포 등) 서버 변환은 아예 보이지 않는다.
  const server = status?.available === true && status.allowed
  const adminOnly = status?.available === true && !status.allowed
  const ext = file ? extOf(file.name) : ''
  const browserOk = OFFICE_BROWSER_EXT.includes(ext)
  const serverOk = server && status.extensions.includes(ext)
  const method: 'browser' | 'server' = !file ? settings.officeMethod : !browserOk ? 'server' : !serverOk ? 'browser' : settings.officeMethod
  const useServer = server && method === 'server'
  const accept = (server ? OFFICE_SERVER_EXT : OFFICE_BROWSER_EXT).map((e) => `.${e}`).join(',')
  const tooBig = file ? (useServer ? file.size > status!.maxBytes : file.size > 50 * 1024 * 1024) : false
  const unsupported = file !== null && !browserOk && !serverOk

  const pick = (f: File | undefined) => {
    if (!f) return
    useWorkspace.setState({ officeFile: f })
  }
  const print = () => {
    if (!file) return
    void runJob('인쇄 화면 준비 중', async () => {
      const content = extOf(file.name) === 'docx' ? await readDocx(file) : await readXlsx(file)
      printContent(content, file.name)
      toast.info('인쇄 창에서 대상 프린터를 ‘PDF 로 저장’으로 고르세요.')
    })
  }

  return (
    <Section title="Word·Excel 문서를 PDF 로" hint={server ? 'Word·Excel·PPT·한글 문서를 PDF 로 바꿉니다.' : 'Word(.docx)·Excel(.xlsx) 문서를 이 기기에서 PDF 로 바꿉니다.'}>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {file ? (
        <div className="flex items-center gap-2 rounded-md border border-line bg-sunken py-1.5 pl-3 pr-1.5">
          <FileText className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={file.name}>
            {file.name}
          </span>
          <span className="num shrink-0 text-xs text-muted">{formatBytes(file.size)}</span>
          <IconButton icon={X} label="문서 빼기" size="sm" disabled={busy} onClick={() => useWorkspace.setState({ officeFile: null })} />
        </div>
      ) : (
        <Button icon={Upload} onClick={() => input.current?.click()}>
          문서 선택
        </Button>
      )}

      {file && server && browserOk && serverOk && (
        <Segmented
          label="변환 방법"
          block
          size="sm"
          value={method}
          onValue={(officeMethod) => update({ officeMethod })}
          options={[
            { value: 'browser', label: '이 기기에서' },
            { value: 'server', label: '서버에서 정확히' },
          ]}
        />
      )}

      {unsupported ? (
        <Callout tone="warn" title={`.${ext} 문서는 지금 바꿀 수 없습니다`}>
          이 기기에서는 .docx 와 .xlsx 만 바꿀 수 있습니다. Word·Excel 에서 ‘다른 이름으로 저장’으로 형식을 바꾼 뒤 다시 올려 주세요.
          {adminOnly && ` ${ADMIN_ONLY_MESSAGE}`}
        </Callout>
      ) : useServer ? (
        <Callout tone="warn" title="이 기능은 파일을 온비짱 서버로 보냅니다">
          사내 서버에서 변환하고, 변환이 끝나면 서버에서 바로 지웁니다. 원본 모양 그대로 바뀝니다. 서버로 보내고 싶지 않으면 ‘이 기기에서’를 고르세요.
        </Callout>
      ) : (
        <Callout tone="info" title="원본과 모양이 완전히 같지는 않습니다">
          글·제목·목록·표·그림만 옮겨 A4 에 다시 앉힙니다. 글꼴·색·단 나눔·머리말은 옮기지 않습니다. 파일은 이 기기 밖으로 나가지 않습니다.
        </Callout>
      )}
      {tooBig && (
        <p className="text-sm text-danger" role="alert">
          문서가 너무 큽니다. {useServer ? formatBytes(status!.maxBytes) : '50 MB'} 이하만 바꿀 수 있습니다.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button icon={FileDown} disabled={!file || busy || tooBig || unsupported} onClick={() => file && actionOffice(file, useServer ? 'server' : 'browser')}>
          {useServer ? '서버로 보내 PDF 로 변환' : 'PDF 로 변환'}
        </Button>
        {file && browserOk && !useServer && (
          <Button variant="ghost" icon={Printer} disabled={busy || tooBig} onClick={print}>
            브라우저 인쇄로 저장
          </Button>
        )}
      </div>
    </Section>
  )
}

// ── 이미지로 ──────────────────────────────────────────────
function ImagePanel({ settings, update }: PanelProps) {
  return (
    <>
      <Section title="이미지 설정">
        <Segmented
          label="이미지 형식"
          block
          value={settings.imgFormat}
          onValue={(imgFormat) => update({ imgFormat })}
          options={[
            { value: 'image/png', label: 'PNG (선명)' },
            { value: 'image/jpeg', label: 'JPG (가벼움)' },
          ]}
        />
        <DpiField value={settings.imgDpi} onValue={(imgDpi) => update({ imgDpi })} hint={`A4 한 쪽이 약 ${Math.round((210 / 25.4) * settings.imgDpi)} × ${Math.round((297 / 25.4) * settings.imgDpi)}px 이 됩니다.`} />
        {settings.imgFormat === 'image/jpeg' && (
          <Field label="품질" aside={`${settings.imgQuality}%`}>
            {(id) => <Slider id={id} min={30} max={100} step={5} value={settings.imgQuality} onValue={(imgQuality) => update({ imgQuality })} />}
          </Field>
        )}
      </Section>
      <Action icon={Images} onClick={() => actionImages(settings)}>
        이미지로 바꾸기
      </Action>
    </>
  )
}

// ── Word ──────────────────────────────────────────────────
function WordPanel({ settings, update }: PanelProps) {
  return (
    <>
      <Section title="옮기는 방법">
        <Segmented
          label="옮기는 방법"
          block
          value={settings.wordMode}
          onValue={(wordMode) => update({ wordMode })}
          options={[
            { value: 'text', label: '글자로' },
            { value: 'image', label: '쪽 그림으로' },
          ]}
        />
        {settings.wordMode === 'text' ? (
          <Callout tone="info">글자를 뽑아 문단으로 옮깁니다. Word 에서 바로 고칠 수 있지만 표·그림·배치는 옮기지 않습니다. 스캔한 문서는 글자가 없어 ‘글자 인식’이 먼저 필요합니다.</Callout>
        ) : (
          <>
            <Callout tone="info">쪽을 그림 한 장으로 넣습니다. 모양은 그대로지만 글자를 고칠 수 없습니다.</Callout>
            <DpiField value={settings.wordDpi} onValue={(wordDpi) => update({ wordDpi })} />
          </>
        )}
      </Section>
      <Action icon={FileText} onClick={() => actionWord(settings)}>
        Word 문서 만들기
      </Action>
    </>
  )
}

// ── Excel ─────────────────────────────────────────────────
function ExcelPanel({ settings, update }: PanelProps) {
  const sheets = useWorkspace((s) => s.sheets)
  const busy = useWorkspace((s) => s.job !== null)
  const hasPages = useWorkspace((s) => s.pages.length > 0)
  const ready = Boolean(sheets?.some((sh) => sh.rows.length))
  return (
    <>
      <Section title="표 찾기" hint="글자 위치를 보고 행과 열을 추정합니다. 왼쪽 미리보기에서 틀린 칸을 고친 뒤 저장하세요.">
        <Target />
        <Button variant={ready ? 'secondary' : 'primary'} size={ready ? 'md' : 'lg'} block icon={Search} disabled={!hasPages || busy} onClick={() => actionExtractSheets(settings)}>
          {ready ? '표 다시 찾기' : '표 찾기'}
        </Button>
      </Section>
      <Section title="저장 설정">
        <Switch checked={settings.excelOneSheet} onChange={(excelOneSheet) => update({ excelOneSheet })} label="한 시트에 모으기" hint="끄면 쪽마다 시트를 나눕니다." />
        <Switch checked={settings.excelNumeric} onChange={(excelNumeric) => update({ excelNumeric })} label="숫자는 숫자로 저장" hint="1,200 이나 3,000원은 계산할 수 있는 숫자가 됩니다. 0 으로 시작하는 번호는 글자로 둡니다." />
        <Button variant={ready ? 'primary' : 'secondary'} size="lg" block icon={Table} disabled={!ready || busy} onClick={() => actionSaveXlsx(settings)}>
          Excel 문서 만들기
        </Button>
        {!ready && <p className="text-sm text-muted">‘표 찾기’를 누르면 저장할 수 있습니다.</p>}
      </Section>
    </>
  )
}

// ── PPT ───────────────────────────────────────────────────
function PptPanel({ settings, update }: PanelProps) {
  return (
    <>
      <Section title="슬라이드 설정" hint="쪽마다 그림 한 장을 꽉 채운 슬라이드를 만듭니다. 슬라이드 크기는 첫 쪽에 맞춥니다.">
        <DpiField value={settings.pptDpi} onValue={(pptDpi) => update({ pptDpi })} hint="높을수록 선명하지만 파일이 커집니다." />
      </Section>
      <Action icon={Presentation} onClick={() => actionPpt(settings)}>
        PPT 만들기
      </Action>
    </>
  )
}

// ── 압축 ──────────────────────────────────────────────────
function CompressPanel({ settings, update }: PanelProps) {
  return (
    <>
      <Section title="줄이는 방법">
        <Segmented
          label="줄이는 방법"
          block
          value={settings.compressMode}
          onValue={(compressMode) => update({ compressMode })}
          options={[
            { value: 'raster', label: '쪽을 그림으로' },
            { value: 'structure', label: '원본 유지' },
          ]}
        />
        {settings.compressMode === 'raster' ? (
          <>
            <Callout tone="warn" title="글자를 선택·검색할 수 없게 됩니다">
              쪽 전체를 사진처럼 다시 만들어 크게 줄입니다. 스캔 문서·사진이 많은 문서에 알맞습니다.
            </Callout>
            <DpiField min={50} max={200} value={Math.min(200, settings.compressDpi)} onValue={(compressDpi) => update({ compressDpi })} hint="화면으로 볼 문서는 100–120, 인쇄할 문서는 150 이상을 권합니다." />
            <Field label="품질" aside={`${settings.compressQuality}%`}>
              {(id) => <Slider id={id} min={20} max={95} step={5} value={settings.compressQuality} onValue={(compressQuality) => update({ compressQuality })} />}
            </Field>
          </>
        ) : (
          <Callout tone="info">글자·그림은 그대로 두고 파일 구조만 다시 정리해 저장합니다. 화질 손실이 없지만 조금만 줄어들거나 그대로일 수 있습니다.</Callout>
        )}
      </Section>
      <Action icon={Minimize2} onClick={() => actionCompress(settings)}>
        용량 줄이기
      </Action>
    </>
  )
}

// ── 번호·워터마크 ─────────────────────────────────────────
const NUMBER_FORMATS: NumberFormat[] = ['n', 'n/total', '-n-', 'n쪽', 'page n']

function StampPanel({ settings, update }: PanelProps) {
  const team = useTeamPresets().watermark
  const n = settings.numbers
  const m = settings.mark
  const setN = (patch: Partial<Settings['numbers']>) => update({ numbers: { ...n, ...patch } })
  const setM = (patch: Partial<Settings['mark']>) => update({ mark: { ...m, ...patch } })
  const teamText = team.kind === 'text' ? team.text.trim() : ''
  return (
    <>
      <Section title="쪽 번호">
        <Switch checked={n.enabled} onChange={(enabled) => setN({ enabled })} label="쪽 번호 넣기" />
        {n.enabled && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="위·아래">
                {() => (
                  <Segmented
                    label="번호 세로 위치"
                    block
                    size="sm"
                    value={n.vertical}
                    onValue={(vertical) => setN({ vertical })}
                    options={[
                      { value: 'top', label: '위' },
                      { value: 'bottom', label: '아래' },
                    ]}
                  />
                )}
              </Field>
              <Field label="좌우">
                {() => (
                  <Segmented
                    label="번호 가로 위치"
                    block
                    size="sm"
                    value={n.horizontal}
                    onValue={(horizontal) => setN({ horizontal })}
                    options={[
                      { value: 'left', label: '왼쪽' },
                      { value: 'center', label: '가운데' },
                      { value: 'right', label: '오른쪽' },
                    ]}
                  />
                )}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="형식">
                {(id) => <Select<NumberFormat> id={id} value={n.format} onValue={(format) => setN({ format })} options={NUMBER_FORMATS.map((f) => ({ value: f, label: formatPageNumber(f, 3, 12) }))} />}
              </Field>
              <Field label="시작 번호">{(id) => <NumberInput id={id} min={0} max={99999} value={n.start} onValue={(v) => setN({ start: v ?? 1 })} />}</Field>
              <Field label="글자 크기">{(id) => <NumberInput id={id} min={6} max={36} value={n.size} onValue={(v) => setN({ size: v ?? 10 })} unit="pt" />}</Field>
              <Field label="가장자리에서">{(id) => <NumberInput id={id} min={0} max={50} value={n.marginMm} onValue={(v) => setN({ marginMm: v ?? 10 })} unit="mm" />}</Field>
            </div>
            <Checkbox checked={n.skipFirst} onChange={(skipFirst) => setN({ skipFirst })} label="첫 쪽(표지)에는 넣지 않기" />
          </>
        )}
      </Section>
      <Section title="워터마크 글자">
        <Switch checked={m.enabled} onChange={(enabled) => setM({ enabled })} label="워터마크 넣기" hint="모든 쪽 한가운데에 흐린 글자를 겹칩니다." />
        {m.enabled && (
          <>
            <Field label="글자">{(id) => <TextInput id={id} value={m.text} maxLength={40} onChange={(e) => setM({ text: e.target.value })} placeholder="예: 대외비" />}</Field>
            {teamText && teamText !== m.text && (
              <Button size="sm" onClick={() => setM({ text: teamText })}>
                팀 워터마크 글자 쓰기
              </Button>
            )}
            <Segmented
              label="워터마크 방향"
              block
              size="sm"
              value={m.diagonal ? 'diagonal' : 'flat'}
              onValue={(v) => setM({ diagonal: v === 'diagonal' })}
              options={[
                { value: 'diagonal', label: '대각선' },
                { value: 'flat', label: '가로' },
              ]}
            />
            <Field label="농도" aside={`${m.opacity}%`}>
              {(id) => <Slider id={id} min={5} max={100} step={5} value={m.opacity} onValue={(opacity) => setM({ opacity })} />}
            </Field>
            <Field label="크기" aside={`${m.widthPct}%`}>
              {(id) => <Slider id={id} min={20} max={90} step={5} value={m.widthPct} onValue={(widthPct) => setM({ widthPct })} />}
            </Field>
            <ColorField label="글자 색" value={m.color} onValue={(color) => setM({ color })} />
          </>
        )}
      </Section>
      <Action icon={Hash} disabled={!n.enabled && !m.enabled} onClick={() => actionStamp(settings)}>
        찍어서 PDF 로 저장
      </Action>
    </>
  )
}

// ── 암호 ──────────────────────────────────────────────────
function ProtectPanel({ settings, update }: PanelProps) {
  // 암호는 화면에만 두고 저장하지 않는다.
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const mismatch = confirm !== '' && password !== confirm
  const tooShort = password !== '' && password.length < 4
  const ok = password.length >= 4 && password === confirm
  return (
    <>
      <Section title="열기 암호 걸기" hint="암호를 아는 사람만 열 수 있는 PDF 로 저장합니다.">
        <Field label="암호" error={tooShort ? '4자 이상으로 정해 주세요.' : null} hint="잊어버리면 되찾을 방법이 없습니다.">
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} aria-invalid={tooShort || undefined} />}
        </Field>
        <Field label="암호 다시 입력" error={mismatch ? '두 암호가 다릅니다.' : null}>
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" value={confirm} maxLength={64} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch || undefined} />}
        </Field>
      </Section>
      <Section title="받는 사람이 할 수 있는 일">
        <Switch checked={settings.allowPrint} onChange={(allowPrint) => update({ allowPrint })} label="인쇄 허용" />
        <Switch checked={settings.allowCopy} onChange={(allowCopy) => update({ allowCopy })} label="글자 복사 허용" />
        <Field label="암호화 방식" hint="아주 오래된 뷰어에서 열리지 않으면 AES-128 을 고르세요.">
          {(id) => (
            <Select
              id={id}
              value={settings.algorithm}
              onValue={(algorithm) => update({ algorithm })}
              options={[
                { value: 'AES-256', label: 'AES-256 (권장)' },
                { value: 'AES-128', label: 'AES-128 (호환)' },
              ]}
            />
          )}
        </Field>
      </Section>
      <Action icon={KeyRound} disabled={!ok} onClick={() => actionProtect(settings, password)}>
        암호 걸어 저장
      </Action>
    </>
  )
}

// ── 글자 인식 ─────────────────────────────────────────────
function OcrPanel({ settings, update }: PanelProps) {
  return (
    <>
      <Section title="글자 인식" hint="스캔한 PDF 나 사진 속 글자를 읽습니다. 읽는 일은 모두 이 기기에서 합니다.">
        <Field label="언어">
          {(id) => (
            <Select<OcrLang>
              id={id}
              value={settings.ocrLang}
              onValue={(ocrLang) => update({ ocrLang })}
              options={[
                { value: 'kor+eng', label: '한국어 + 영어' },
                { value: 'kor', label: '한국어' },
                { value: 'eng', label: '영어' },
              ]}
            />
          )}
        </Field>
        <Field label="결과">
          {() => (
            <Segmented
              label="결과 형식"
              block
              size="sm"
              value={settings.ocrOutput}
              onValue={(ocrOutput) => update({ ocrOutput })}
              options={[
                { value: 'pdf', label: '검색되는 PDF' },
                { value: 'txt', label: '텍스트' },
                { value: 'docx', label: 'Word' },
              ]}
            />
          )}
        </Field>
        <DpiField label="읽는 해상도" min={100} max={300} value={Math.max(100, settings.ocrDpi)} onValue={(ocrDpi) => update({ ocrDpi })} hint="글자가 작으면 높이세요. 높을수록 느려집니다." />
        <Callout tone="info" title={`처음 한 번 언어 데이터 약 ${formatBytes(ocrDownloadBytes(settings.ocrLang))} 를 내려받습니다`}>
          인터넷(jsDelivr)에서 받아 이 브라우저에 보관하므로 다음부터는 받지 않습니다. 문서는 어디로도 보내지 않습니다. 한 쪽에 몇 초에서 수십 초가 걸립니다.
        </Callout>
      </Section>
      <Action icon={ScanText} onClick={() => actionOcr(settings)}>
        글자 읽기
      </Action>
    </>
  )
}

export function TabPanel({ tab, ...props }: PanelProps & { tab: TabId }) {
  switch (tab) {
    case 'organize':
      return <OrganizePanel {...props} />
    case 'split':
      return <SplitPanel {...props} />
    case 'create':
      return <CreatePanel {...props} />
    case 'image':
      return <ImagePanel {...props} />
    case 'word':
      return <WordPanel {...props} />
    case 'excel':
      return <ExcelPanel {...props} />
    case 'ppt':
      return <PptPanel {...props} />
    case 'compress':
      return <CompressPanel {...props} />
    case 'stamp':
      return <StampPanel {...props} />
    case 'protect':
      return <ProtectPanel {...props} />
    case 'ocr':
      return <OcrPanel {...props} />
  }
}

/** 고른 쪽 수 등 화면 곳곳에서 쓰는 요약 */
export function useTargetCount(): number {
  return useWorkspace((s) => targetPages(s.pages).length)
}
