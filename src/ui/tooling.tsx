import clsx from 'clsx'
import { ClipboardPaste, FolderOpen, Save, Send, Trash2, Upload, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useTeamPresets, useVisibleGroups, type Pos9, type WatermarkSettings } from '@/app/config'
import { useHandoff } from '@/app/handoff'
import { toolPath } from '@/app/registry'
import { fileKind, filterAccepted, readAsDataURL } from '@/lib/files'
import { readClipboardImages, usePasteFiles } from '@/lib/hooks'
import { deleteLibraryItem, listLibrary, loadLibraryItem, saveLibraryItem, type LibraryEntry } from '@/lib/library'
import { Button, Field, IconButton, Segmented, Slider, Switch, TextInput } from './controls'
import { EmptyState, MenuItem, Popover, Spinner, toast } from './surfaces'

/** 낱말 끝 받침에 맞춰 조사를 붙인다: josa('서명', '이', '가') → '서명이', josa('직인', …) → '직인이', josa('템플릿', …) → '템플릿이' */
export function josa(word: string, withBatchim: string, withoutBatchim: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  const hasBatchim = code >= 0 && code <= 11171 ? code % 28 !== 0 : false
  return word + (hasBatchim ? withBatchim : withoutBatchim)
}

// ── 도구 화면 배치 ────────────────────────────────────────
/**
 * 도구의 기본 배치: 왼쪽 넓은 작업 영역 + 오른쪽 설정 패널(360px).
 * 좁은 화면에서는 위아래로 쌓인다. 계산기처럼 작업 영역이 필요 없으면 쓰지 않아도 된다.
 */
export function ToolLayout({ children, panel, panelWidth = 360 }: { children: ReactNode; panel: ReactNode; panelWidth?: number }) {
  return (
    <div className="grid items-start gap-5 lg:[grid-template-columns:minmax(0,1fr)_var(--panel-w)]" style={{ ['--panel-w' as string]: `${panelWidth}px` }}>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      <aside className="rounded-lg border border-line bg-surface shadow-1 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto">{panel}</aside>
    </div>
  )
}

/**
 * 작업 매트 — 이미지·영상·캔버스 미리보기가 놓이는 무대.
 * 안의 내용은 가운데 정렬된다. 투명 이미지는 안쪽 요소에 .checker 클래스를 준다.
 */
export function Stage({ children, className, minHeight = 360 }: { children: ReactNode; className?: string; minHeight?: number }) {
  return (
    <div className={clsx('mat relative flex items-center justify-center overflow-hidden rounded-lg border border-mat-deep p-5', className)} style={{ minHeight }}>
      {children}
    </div>
  )
}

// ── 파일 받기 ─────────────────────────────────────────────
export interface DropzoneProps {
  onFiles: (files: File[]) => void
  /** input accept 형식: 'image/*', 'video/*', '.pdf,.docx' … */
  accept?: string
  multiple?: boolean
  /** "사진을 끌어다 놓으세요" 같은 한 줄 */
  title: string
  /** 제한 안내: "한 장 25MB 이하 · 최대 100장" */
  hint?: ReactNode
  /** Ctrl+V 붙여넣기 받기(기본 true) */
  paste?: boolean
  icon?: LucideIcon
  /** true 면 파일이 이미 있을 때 쓰는 낮은 띠 형태 */
  compact?: boolean
  className?: string
  disabled?: boolean
}

/** 끌어놓기·파일 선택·붙여넣기를 한곳에서 받는다. accept 에 맞지 않는 파일은 걸러 알려준다. */
export function Dropzone({ onFiles, accept, multiple = true, title, hint, paste = true, icon: Icon = Upload, compact, className, disabled }: DropzoneProps) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const pasteable = paste && (!accept || accept.includes('image'))

  const deliver = (incoming: File[]) => {
    if (disabled) return
    const ok = filterAccepted(incoming, accept)
    if (ok.length < incoming.length) toast.warn(`지원하지 않는 형식 ${incoming.length - ok.length}개는 제외했습니다.`)
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1))
  }
  usePasteFiles(deliver, pasteable && !disabled)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    deliver(Array.from(e.dataTransfer.files))
  }
  const pasteFromButton = async () => {
    const files = await readClipboardImages()
    if (files === null) toast.info('클립보드 접근이 막혀 있습니다. Ctrl+V 로 붙여넣어 주세요.')
    else if (!files.length) toast.info('클립보드에 이미지가 없습니다.')
    else deliver(files)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={clsx(
        'rounded-lg border-2 border-dashed transition-colors duration-150',
        over ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface',
        compact ? 'flex flex-wrap items-center gap-3 px-4 py-3' : 'flex flex-col items-center gap-3 px-6 py-10 text-center',
        disabled && 'opacity-50',
        className,
      )}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          deliver(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      {!compact && <Icon className="size-8 text-brand" aria-hidden />}
      <div className={clsx('min-w-0', compact && 'flex-1')}>
        <p className={clsx('font-semibold text-ink', !compact && 'text-lg')}>{title}</p>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" size={compact ? 'sm' : 'md'} icon={Upload} disabled={disabled} onClick={() => input.current?.click()}>
          파일 선택
        </Button>
        {pasteable && (
          <Button size={compact ? 'sm' : 'md'} icon={ClipboardPaste} disabled={disabled} onClick={pasteFromButton}>
            붙여넣기
          </Button>
        )}
      </div>
    </div>
  )
}

// ── 색상 ──────────────────────────────────────────────────
/** 색 고르기 + 팀 브랜드 색 빠른 선택 */
export function ColorField({ label, value, onValue, className }: { label: ReactNode; value: string; onValue: (hex: string) => void; className?: string }) {
  const { brandColors } = useTeamPresets()
  const id = useId()
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="relative inline-flex size-10 overflow-hidden rounded-md border border-line-strong shadow-1">
          <input id={id} type="color" value={value} onChange={(e) => onValue(e.target.value)} className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 p-0" />
        </span>
        <TextInput
          onChange={(e) => {
            const v = e.target.value.trim()
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onValue(v.toLowerCase())
          }}
          key={value}
          defaultValue={value}
          aria-label="색상 코드"
          className="num w-24! uppercase"
          spellCheck={false}
        />
        {brandColors.map((c) => (
          <button
            key={c.hex + c.name}
            type="button"
            title={`${c.name} ${c.hex}`}
            aria-label={`${c.name} 색으로`}
            onClick={() => onValue(c.hex.toLowerCase())}
            className={clsx('size-7 rounded-full border shadow-1 transition-transform duration-150 hover:scale-110', value.toLowerCase() === c.hex.toLowerCase() ? 'border-ink ring-2 ring-brand/40' : 'border-line-strong')}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
    </div>
  )
}

// ── 워터마크 ──────────────────────────────────────────────
const POSITIONS: Pos9[] = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']
const POSITION_NAME: Record<Pos9, string> = { tl: '왼쪽 위', tc: '가운데 위', tr: '오른쪽 위', ml: '왼쪽 가운데', mc: '정가운데', mr: '오른쪽 가운데', bl: '왼쪽 아래', bc: '가운데 아래', br: '오른쪽 아래' }

/** 3×3 위치 고르기 */
export function PositionGrid({ value, onValue, label = '위치' }: { value: Pos9; onValue: (p: Pos9) => void; label?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink-2">{label}</span>
      <div role="radiogroup" aria-label={label} className="grid w-fit grid-cols-3 gap-1 rounded-md border border-line-strong bg-sunken p-1">
        {POSITIONS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={p === value}
            aria-label={POSITION_NAME[p]}
            title={POSITION_NAME[p]}
            onClick={() => onValue(p)}
            className={clsx('flex size-7 items-center justify-center rounded-xs transition-colors duration-100', p === value ? 'bg-brand' : 'hover:bg-line')}
          >
            <span className={clsx('size-1.5 rounded-full', p === value ? 'bg-on-brand' : 'bg-faint')} />
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * 워터마크 설정 묶음. 이미지·모자이크·영상·녹화 도구가 같은 UI 를 쓴다.
 * 그릴 때는 lib/watermark 의 prepareWatermark(settings) 를 쓴다.
 */
export function WatermarkControls({ value, onChange }: { value: WatermarkSettings; onChange: (next: WatermarkSettings) => void }) {
  const team = useTeamPresets().watermark
  const fileInput = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<WatermarkSettings>) => onChange({ ...value, ...patch })
  const hasTeamPreset = Boolean(team.logoDataUrl || team.text.trim())
  return (
    <div className="flex flex-col gap-3">
      <Switch checked={value.enabled} onChange={(enabled) => set({ enabled })} label="워터마크 넣기" />
      {value.enabled && (
        <div className="flex flex-col gap-3">
          {hasTeamPreset && (
            <Button size="sm" onClick={() => onChange({ ...team, enabled: true })}>
              팀 워터마크 불러오기
            </Button>
          )}
          <Segmented
            label="워터마크 종류"
            block
            size="sm"
            value={value.kind}
            onValue={(kind) => set({ kind })}
            options={[
              { value: 'text', label: '문자' },
              { value: 'logo', label: '로고 이미지' },
            ]}
          />
          {value.kind === 'text' ? (
            <>
              <Field label="문구">{(id) => <TextInput id={id} value={value.text} onChange={(e) => set({ text: e.target.value })} placeholder="예: ⓒ 우리팀" maxLength={60} />}</Field>
              <ColorField label="글자 색" value={value.color} onValue={(color) => set({ color })} />
            </>
          ) : (
            <div className="flex items-center gap-3">
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  if (f.size > 2 * 1024 * 1024) return toast.error('로고는 2MB 이하 이미지로 올려 주세요.')
                  set({ logoDataUrl: await readAsDataURL(f) })
                }}
              />
              <div className="checker flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-strong">
                {value.logoDataUrl ? <img src={value.logoDataUrl} alt="워터마크 로고 미리보기" className="max-h-full max-w-full" /> : <span className="text-2xs text-muted">없음</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={Upload} onClick={() => fileInput.current?.click()}>
                  로고 선택
                </Button>
                {value.logoDataUrl && (
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => set({ logoDataUrl: null })}>
                    지우기
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="flex gap-4">
            <PositionGrid value={value.position} onValue={(position) => set({ position })} />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <Field label="크기" aside={`${value.sizePct}%`}>{(id) => <Slider id={id} min={1} max={25} value={value.sizePct} onValue={(sizePct) => set({ sizePct })} />}</Field>
              <Field label="농도" aside={`${value.opacity}%`}>{(id) => <Slider id={id} min={5} max={100} step={5} value={value.opacity} onValue={(opacity) => set({ opacity })} />}</Field>
              <Field label="가장자리 여백" aside={`${value.margin}px`}>{(id) => <Slider id={id} min={0} max={120} step={4} value={value.margin} onValue={(margin) => set({ margin })} />}</Field>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 다른 도구로 보내기 ────────────────────────────────────
/**
 * 결과 파일을 내려받지 않고 다음 도구로 넘긴다.
 * files 는 호출 시점에 만들어도 된다(함수 전달). 현재 도구 id 를 exclude 로 준다.
 */
export function SendToMenu({ files, exclude, label = '다른 도구로 보내기', size = 'md', disabled }: { files: File[] | (() => Promise<File[]> | File[]); exclude?: string; label?: string; size?: 'sm' | 'md'; disabled?: boolean }) {
  const groups = useVisibleGroups()
  const send = useHandoff((s) => s.send)
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const go = async (toolId: string, close: () => void) => {
    setBusy(true)
    try {
      const list = typeof files === 'function' ? await files() : files
      if (!list.length) return toast.info('보낼 파일이 없습니다.')
      send(toolId, list)
      close()
      navigate(toolPath(toolId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일을 준비하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover
      align="end"
      trigger={({ ref, ...props }) => (
        <span ref={ref} className="inline-flex">
          <Button size={size} icon={Send} disabled={disabled} loading={busy} {...props}>
            {label}
          </Button>
        </span>
      )}
    >
      {(close) => {
        const sample = typeof files === 'function' ? null : files[0]
        const kind = sample ? fileKind(sample) : 'image'
        const targets = groups.flatMap((g) => g.tools).filter((t) => t.id !== exclude && t.accepts?.includes(kind as 'image' | 'video' | 'pdf'))
        if (!targets.length) return <p className="px-2.5 py-2 text-sm text-muted">이 파일을 받을 수 있는 도구가 없습니다.</p>
        return targets.map((t) => (
          <MenuItem key={t.id} icon={t.icon} onClick={() => go(t.id, close)}>
            {t.title}
          </MenuItem>
        ))
      }}
    </Popover>
  )
}

// ── 팀 보관함 ─────────────────────────────────────────────
export interface LibraryMenuProps<T> {
  /** 보관함 종류(영문 소문자·숫자·하이픈): 'canvas-template', 'label-template', 'signature' … */
  kind: string
  /** 버튼에 보이는 이름: "템플릿", "서명" */
  noun: string
  /** 현재 작업을 저장할 내용으로 만든다. 저장할 것이 없으면 null. */
  getData: () => Promise<{ data: T; thumb?: string } | null> | { data: T; thumb?: string } | null
  onLoad: (data: T, entry: LibraryEntry) => void
  size?: 'sm' | 'md'
}

/** 팀 보관함 열기·저장. 서버가 있으면 팀 전체가, 없으면 이 브라우저에서만 본다. */
export function LibraryMenu<T>({ kind, noun, getData, onLoad, size = 'md' }: LibraryMenuProps<T>) {
  const [items, setItems] = useState<LibraryEntry[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState(0)

  useEffect(() => {
    if (!opened) return
    let alive = true
    listLibrary(kind)
      .then((list) => alive && setItems(list))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [kind, opened])

  const save = async () => {
    if (!name.trim()) return toast.info(`${noun} 이름을 입력하세요.`)
    setBusy(true)
    try {
      const payload = await getData()
      if (!payload) return toast.info(`저장할 ${josa(noun, '이', '가')} 아직 없습니다.`)
      const entry = await saveLibraryItem(kind, name.trim(), payload.data, payload.thumb)
      setItems((prev) => [entry, ...(prev ?? [])])
      setName('')
      if (entry.local) toast.info('이 브라우저에만 저장했습니다. 팀 전체와 나누려면 관리자로 로그인한 뒤 저장하세요.')
      else toast.success('팀 보관함에 저장했습니다.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  const load = async (entry: LibraryEntry, close: () => void) => {
    try {
      onLoad(await loadLibraryItem<T>(kind, entry), entry)
      close()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '불러오지 못했습니다.')
    }
  }
  const remove = async (entry: LibraryEntry) => {
    try {
      await deleteLibraryItem(kind, entry)
      setItems((prev) => (prev ?? []).filter((i) => i.id !== entry.id))
    } catch (err) {
      toast.error(err instanceof Error && 'status' in err && err.status === 401 ? '팀 보관함 항목은 관리자만 삭제할 수 있습니다.' : '삭제하지 못했습니다.')
    }
  }

  return (
    <Popover
      align="end"
      className="w-80 p-0!"
      trigger={({ ref, onClick, ...props }) => (
        <span ref={ref} className="inline-flex">
          <Button
            size={size}
            icon={FolderOpen}
            onClick={() => {
              setOpened((n) => n + 1)
              onClick()
            }}
            {...props}
          >
            팀 보관함
          </Button>
        </span>
      )}
    >
      {(close) => (
        <div className="flex flex-col">
          <div className="flex items-end gap-2 border-b border-line p-3">
            <Field label={`지금 ${noun} 저장`} className="flex-1">
              {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" maxLength={80} onKeyDown={(e) => e.key === 'Enter' && save()} />}
            </Field>
            <Button variant="primary" icon={Save} loading={busy} onClick={save}>
              저장
            </Button>
          </div>
          <div className="max-h-72 overflow-auto p-1.5">
            {items === null ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted">
                <Spinner /> 불러오는 중
              </div>
            ) : items.length === 0 ? (
              <EmptyState title={`저장된 ${josa(noun, '이', '가')} 없습니다`} className="py-6!">
                위에서 이름을 붙여 저장하면 다음에 바로 불러올 수 있습니다.
              </EmptyState>
            ) : (
              items.map((entry) => (
                <div key={(entry.local ? 'l' : 's') + entry.id} className="group flex items-center gap-2 rounded-sm px-1.5 py-1.5 hover:bg-sunken">
                  <button type="button" onClick={() => load(entry, close)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                    {entry.thumb ? (
                      <img src={entry.thumb} alt="" className="size-10 shrink-0 rounded-xs border border-line bg-surface object-contain" />
                    ) : (
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xs border border-line bg-surface">
                        <FolderOpen className="size-4 text-faint" aria-hidden />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{entry.name}</span>
                      <span className="block text-2xs text-muted">
                        {new Date(entry.createdAt).toLocaleDateString('ko-KR')}
                        {entry.local && ' · 이 브라우저'}
                      </span>
                    </span>
                  </button>
                  <IconButton icon={Trash2} label={`${entry.name} 삭제`} size="sm" onClick={() => remove(entry)} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Popover>
  )
}
