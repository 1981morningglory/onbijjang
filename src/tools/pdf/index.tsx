/**
 * PDF 변환·관리 — 한 작업대, 여러 탭.
 * 올린 문서와 쪽 순서는 탭을 옮겨도 그대로다. 파일은 이 기기 안에서만 처리한다
 * (예외: 'PDF 만들기' 탭의 서버 변환 — 사용자가 고를 때만, 화면에 표시).
 */
import { ClipboardCopy, Download, FileArchive, FilePlus2, FileText, Files, Hash, Image as ImageIcon, Images, KeyRound, Minimize2, PackageOpen, Plus, Presentation, ScanText, Scissors, Table, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useHandoffFiles } from '@/app/handoff'
import { downloadBlob, downloadZip, fileKind, formatBytes, todayStamp } from '@/lib/files'
import { usePersistentState } from '@/lib/hooks'
import { Button, Callout, Dialog, Dropzone, EmptyState, Field, IconButton, Panel, Progress, Section, Select, SendToMenu, Spinner, Tabs, TextInput, Textarea, ToolLayout, toast } from '@/ui'
import { paperOf } from './actions'
import { LIMITS, MAIN_ACCEPT, addFiles } from './intake'
import { Workspace } from './PageGrid'
import { TabPanel } from './panels'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import { cancelJob, clearResults, useWorkspace, type Sheet, type TabId } from './store'

const TABS: ReadonlyArray<{ value: TabId; label: string; icon: typeof Files }> = [
  { value: 'organize', label: '정리·병합', icon: Files },
  { value: 'split', label: '분할', icon: Scissors },
  { value: 'create', label: 'PDF 만들기', icon: FilePlus2 },
  { value: 'image', label: '이미지로', icon: Images },
  { value: 'word', label: 'Word 로', icon: FileText },
  { value: 'excel', label: 'Excel 로', icon: Table },
  { value: 'ppt', label: 'PPT 로', icon: Presentation },
  { value: 'compress', label: '압축', icon: Minimize2 },
  { value: 'stamp', label: '번호·워터마크', icon: Hash },
  { value: 'protect', label: '암호', icon: KeyRound },
  { value: 'ocr', label: '글자 인식', icon: ScanText },
]
const TAB_IDS = new Set(TABS.map((t) => t.value))

export default function PdfTool() {
  const [savedTab, setTab] = usePersistentState<TabId>('onbijjang:pdf:tab', 'organize')
  const tab = TAB_IDS.has(savedTab) ? savedTab : 'organize'
  const [settings, setSettings] = usePersistentState<Settings>('onbijjang:pdf:settings', DEFAULT_SETTINGS)
  const update = (patch: Partial<Settings>) => setSettings((prev) => ({ ...prev, ...patch }))

  const hasPages = useWorkspace((s) => s.pages.length > 0)
  const opening = useWorkspace((s) => s.opening > 0)
  const busy = useWorkspace((s) => s.job !== null)
  const paper = useMemo(() => paperOf(settings), [settings])

  const onFiles = async (files: File[]) => {
    const outcome = await addFiles(files)
    if (outcome.office.length) {
      useWorkspace.setState({ officeFile: outcome.office[0] })
      setTab('create')
      toast.info(outcome.office.length > 1 ? 'Word·Excel 문서는 한 번에 하나씩 바꿉니다. 첫 문서를 ‘PDF 만들기’에 올렸습니다.' : '문서를 ‘PDF 만들기’ 탭에 올렸습니다. 오른쪽에서 변환을 눌러 주세요.')
    }
  }
  useHandoffFiles('pdf', (files) => void onFiles(files))

  return (
    <div className="flex flex-col gap-4">
      <Tabs label="PDF 작업" value={tab} onValue={setTab} tabs={TABS} />
      <ToolLayout
        panel={
          <>
            <TabPanel tab={tab} settings={settings} update={update} />
            <JobSection />
            <ResultSection />
          </>
        }
      >
        <Dropzone
          onFiles={(files) => void onFiles(files)}
          accept={MAIN_ACCEPT}
          title={hasPages ? 'PDF·사진 더 올리기' : 'PDF 나 사진을 끌어다 놓으세요'}
          hint={`PDF 는 한 개 ${formatBytes(LIMITS.pdfBytes)}, 사진(JPG·PNG·WebP)은 ${LIMITS.images}장까지. 이 기기 안에서만 처리합니다.`}
          icon={Files}
          compact={hasPages}
          disabled={busy}
        />
        {opening && (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner /> 파일을 여는 중입니다
          </p>
        )}
        {tab === 'excel' && <SheetPreview />}
        {tab === 'ocr' && <OcrPreview />}
        {hasPages ? (
          <Workspace paper={paper} />
        ) : (
          !opening && (
            <Panel>
              <EmptyState icon={PackageOpen} title="아직 올린 문서가 없습니다">
                PDF 나 사진을 올리면 쪽마다 미리보기가 나타납니다. 한 번 올린 문서는 탭을 옮겨도 그대로 남아, 합치고 나누고 바꾸는 일을 이어서 할 수 있습니다.
              </EmptyState>
            </Panel>
          )
        )}
      </ToolLayout>
      <PasswordDialog />
    </div>
  )
}

// ── 진행·오류 ─────────────────────────────────────────────
function JobSection() {
  const job = useWorkspace((s) => s.job)
  const error = useWorkspace((s) => s.error)
  if (!job && !error) return null
  return (
    <Section title={job ? '진행 중' : '문제가 생겼습니다'}>
      {job ? (
        <>
          <Progress value={job.progress} label={job.label} />
          <Button size="sm" icon={X} onClick={cancelJob} className="self-start">
            취소
          </Button>
        </>
      ) : (
        <Callout tone="danger">{error}</Callout>
      )}
    </Section>
  )
}

// ── 결과 ──────────────────────────────────────────────────
function ResultSection() {
  const results = useWorkspace((s) => s.results)
  const title = useWorkspace((s) => s.resultsTitle)
  const note = useWorkspace((s) => s.resultsNote)
  const busy = useWorkspace((s) => s.job !== null)
  if (!results.length) return null
  const files = results.map((r) => r.file)
  const sendable = files.filter((f) => fileKind(f) === 'pdf' || fileKind(f) === 'image')
  const total = files.reduce((sum, f) => sum + f.size, 0)
  const putBack = async (file: File) => {
    const outcome = await addFiles([file])
    if (outcome.added) toast.success('작업대에 넣었습니다.')
  }
  return (
    <Section
      title={`결과 · ${title} ${results.length > 1 ? `${results.length}개` : ''}`}
      action={<IconButton icon={Trash2} label="결과 지우기" size="sm" onClick={clearResults} />}
    >
      {note && <Callout tone="info">{note}</Callout>}
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {results.map(({ id, file }) => {
          const kind = fileKind(file)
          const Icon = kind === 'image' ? ImageIcon : FileText
          return (
            <li key={id} className="flex items-center gap-2 rounded-md border border-line bg-paper py-1 pl-2.5 pr-1">
              <Icon className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={file.name}>
                {file.name}
              </span>
              <span className="num shrink-0 text-xs text-muted">{formatBytes(file.size)}</span>
              {kind === 'pdf' && <IconButton icon={Plus} label={`${file.name} 작업대에 넣기`} size="sm" disabled={busy} onClick={() => void putBack(file)} />}
              <IconButton icon={Download} label={`${file.name} 저장`} size="sm" onClick={() => downloadBlob(file, file.name)} />
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {results.length === 1 ? (
          <Button variant="secondary" icon={Download} onClick={() => downloadBlob(files[0], files[0].name)}>
            저장
          </Button>
        ) : (
          <Button
            icon={FileArchive}
            onClick={() =>
              void downloadZip(
                files.map((f) => ({ name: f.name, data: f })),
                `PDF도구_${title.replace(/\s+/g, '')}_${todayStamp()}`,
              ).catch(() => toast.error('ZIP 을 만들지 못했습니다. 파일이 너무 많거나 크면 나눠서 저장해 주세요.'))
            }
          >
            ZIP 으로 저장 ({formatBytes(total)})
          </Button>
        )}
        {sendable.length > 0 && <SendToMenu files={sendable} exclude="pdf" />}
      </div>
    </Section>
  )
}

// ── 암호 묻기 ─────────────────────────────────────────────
function PasswordDialog() {
  const prompt = useWorkspace((s) => s.passwordPrompt)
  const [value, setValue] = useState('')
  useEffect(() => setValue(''), [prompt])
  const submit = () => {
    if (value) prompt?.resolve(value)
  }
  return (
    <Dialog
      open={prompt !== null}
      onClose={() => prompt?.resolve(null)}
      title="암호가 걸린 PDF 입니다"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => prompt?.resolve(null)}>
            이 파일 건너뛰기
          </Button>
          <Button variant="primary" icon={KeyRound} disabled={!value} onClick={submit}>
            열기
          </Button>
        </>
      }
    >
      {prompt && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <p className="break-all text-sm text-ink-2">
            <strong className="text-ink">{prompt.name}</strong> 을(를) 열려면 암호가 필요합니다. 암호는 이 기기에서 문서를 여는 데만 쓰고 저장하지 않습니다.
          </p>
          <Field label="문서 암호" error={prompt.wrong ? '암호가 맞지 않습니다. 다시 입력해 주세요.' : null}>
            {(id) => <TextInput id={id} type="password" autoComplete="off" autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={prompt.wrong || undefined} />}
          </Field>
        </form>
      )}
    </Dialog>
  )
}

// ── Excel 미리보기(고칠 수 있는 표) ───────────────────────
const MAX_PREVIEW_ROWS = 200

function SheetPreview() {
  const sheets = useWorkspace((s) => s.sheets)
  const [current, setCurrent] = useState(0)
  useEffect(() => setCurrent(0), [sheets?.length])
  if (!sheets) return null
  const index = Math.min(current, sheets.length - 1)
  const sheet = sheets[index]
  if (!sheet) return null
  const cols = Math.max(1, ...sheet.rows.map((r) => r.length))

  const patch = (fn: (rows: string[][]) => string[][]) => {
    useWorkspace.setState((s) => ({ sheets: (s.sheets ?? []).map((sh, i): Sheet => (i === index ? { ...sh, rows: fn(sh.rows) } : sh)) }))
  }
  const setCell = (r: number, c: number, value: string) =>
    patch((rows) =>
      rows.map((row, ri) => {
        if (ri !== r) return row
        const next = [...row]
        while (next.length <= c) next.push('')
        next[c] = value
        return next
      }),
    )

  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-bold text-ink">표 미리보기</h3>
        {sheets.length > 1 && (
          <Select
            aria-label="미리 볼 쪽"
            className="h-8! w-auto! text-sm!"
            value={String(index)}
            onValue={(v) => setCurrent(Number(v))}
            options={sheets.map((sh, i) => ({ value: String(i), label: `${sh.name}${sh.rows.length ? (sh.tableRows ? '' : ' (표 없음)') : ' (글자 없음)'}` }))}
          />
        )}
        <Button size="sm" icon={Plus} onClick={() => patch((rows) => [...rows, new Array<string>(cols).fill('')])}>
          행 추가
        </Button>
        <IconButton icon={X} label="미리보기 닫기" size="sm" onClick={() => useWorkspace.setState({ sheets: null })} />
      </div>
      {sheet.rows.length === 0 ? (
        <p className="text-sm text-muted">이 쪽에서는 글자를 찾지 못했습니다. 스캔한 쪽이면 ‘글자 인식’ 탭에서 검색되는 PDF 로 만든 뒤 다시 올려 주세요.</p>
      ) : (
        <>
          {sheet.tableRows === 0 && <p className="text-sm text-muted">표로 보이는 부분이 없어 줄마다 한 칸에 넣었습니다.</p>}
          <div className="max-h-[420px] overflow-auto rounded-md border border-line">
            <table className="w-max min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-sunken">
                <tr>
                  <th className="w-9 border-b border-line px-1 py-1 text-2xs font-bold text-muted" scope="col">
                    행
                  </th>
                  {Array.from({ length: cols }, (_, c) => (
                    <th key={c} scope="col" className="border-b border-l border-line px-1 py-0.5 text-left text-2xs font-bold text-muted">
                      <span className="flex items-center justify-between gap-1">
                        {c + 1}열
                        <IconButton icon={X} label={`${c + 1}열 지우기`} size="sm" className="size-6!" disabled={cols <= 1} onClick={() => patch((rows) => rows.map((row) => row.filter((_v, i) => i !== c)))} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(0, MAX_PREVIEW_ROWS).map((row, r) => (
                  <tr key={r} className="group">
                    <td className="border-b border-line bg-sunken px-0.5 text-center">
                      <IconButton icon={X} label={`${r + 1}행 지우기`} size="sm" className="size-6!" onClick={() => patch((rows) => rows.filter((_row, i) => i !== r))} />
                    </td>
                    {Array.from({ length: cols }, (_, c) => (
                      <td key={c} className="border-b border-l border-line p-0">
                        <input
                          value={row[c] ?? ''}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          aria-label={`${r + 1}행 ${c + 1}열`}
                          size={Math.max(4, Math.min(40, (row[c] ?? '').length + 2))}
                          className="h-8 w-full min-w-16 bg-surface px-2 text-sm text-ink hover:bg-paper focus:bg-brand-soft focus:outline-none"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sheet.rows.length > MAX_PREVIEW_ROWS && <p className="num text-sm text-muted">앞의 {MAX_PREVIEW_ROWS}행만 보여 줍니다. 나머지 {sheet.rows.length - MAX_PREVIEW_ROWS}행도 저장에는 들어갑니다.</p>}
        </>
      )}
    </Panel>
  )
}

// ── 글자 인식 결과 ────────────────────────────────────────
function OcrPreview() {
  const text = useWorkspace((s) => s.ocrText)
  if (text === null) return null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('인식한 글자를 복사했습니다.')
    } catch {
      toast.info('복사하지 못했습니다. 글자를 직접 골라 Ctrl+C 로 복사해 주세요.')
    }
  }
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-bold text-ink">읽은 글자</h3>
        <Button size="sm" icon={ClipboardCopy} onClick={() => void copy()} disabled={!text}>
          복사
        </Button>
        <IconButton icon={X} label="읽은 글자 닫기" size="sm" onClick={() => useWorkspace.setState({ ocrText: null })} />
      </div>
      <Textarea readOnly value={text || '읽은 글자가 없습니다.'} aria-label="읽은 글자" className="max-h-80 min-h-40 text-sm" />
    </Panel>
  )
}
