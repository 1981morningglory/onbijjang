import clsx from 'clsx'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Eye,
  EyeOff,
  FileUp,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  Image as ImageIcon,
  Italic,
  Layers,
  Lock,
  LockOpen,
  Minus,
  MonitorDown,
  Pencil,
  RotateCcw,
  Square,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Type,
  Underline,
  Ungroup,
  type LucideIcon,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Button, ColorField, EmptyState, Field, IconButton, Section, Segmented, Select, Switch, TextInput } from '@/ui'
import type { BrushSettings, CanvasController, Layer, SelKind, Selection, ToolMode } from './controller'
import { FONT_FILE_ACCEPT, type FontOption } from './fonts'
import type { AlignHow } from './geometry'
import type { EntranceEffect, PageDoc } from './model'
import { Num, Range } from './parts'

const KIND_ICON: Record<SelKind, LucideIcon> = { none: Square, text: Type, image: ImageIcon, shape: Square, line: Minus, draw: Pencil, group: Group, multi: Layers, other: Square }
const KIND_NAME: Record<SelKind, string> = { none: '', text: '글자', image: '사진', shape: '도형', line: '선', draw: '손글씨', group: '묶음', multi: '여러 개', other: '객체' }

const ALIGN: Array<{ how: AlignHow; label: string; icon: LucideIcon }> = [
  { how: 'left', label: '왼쪽 맞춤', icon: AlignStartVertical },
  { how: 'hcenter', label: '가로 가운데', icon: AlignCenterVertical },
  { how: 'right', label: '오른쪽 맞춤', icon: AlignEndVertical },
  { how: 'top', label: '위쪽 맞춤', icon: AlignStartHorizontal },
  { how: 'vcenter', label: '세로 가운데', icon: AlignCenterHorizontal },
  { how: 'bottom', label: '아래쪽 맞춤', icon: AlignEndHorizontal },
]

const DASH_OPTIONS = [
  { value: 'solid', label: '실선' },
  { value: 'dash', label: '파선' },
  { value: 'dot', label: '점선' },
] as const

const ANIM_OPTIONS: Array<{ value: EntranceEffect; label: string }> = [
  { value: 'none', label: '없음' },
  { value: 'fade', label: '서서히 나타나기' },
  { value: 'rise', label: '아래에서 올라오기' },
  { value: 'pop', label: '톡 튀어나오기' },
]

export interface PropertiesPanelProps {
  ctl: CanvasController | null
  sel: Selection
  layers: Layer[]
  mode: ToolMode
  brushes: BrushSettings
  onBrush: (mode: 'pen' | 'highlighter', patch: Partial<{ color: string; width: number }>) => void
  page: PageDoc
  pageNumber: number
  docSize: { width: number; height: number }
  onPagePatch: (patch: Partial<Pick<PageDoc, 'background' | 'seconds'>>, coalesce: string) => void
  fonts: FontOption[]
  canQueryFonts: boolean
  onQueryFonts: () => void
  onFontFile: (file: File) => void
}

export function PropertiesPanel(p: PropertiesPanelProps) {
  const { ctl, sel, mode } = p
  if (mode !== 'select') return <BrushSection {...p} mode={mode} />
  if (sel.kind === 'none') return <PageSection {...p} />
  return (
    <>
      <ArrangeSection ctl={ctl} sel={sel} />
      {sel.text && <TextSection {...p} text={sel.text} />}
      {sel.image && <ImageSection ctl={ctl} image={sel.image} />}
      {sel.shape && <ShapeSection ctl={ctl} shape={sel.shape} />}
      {sel.line && <LineSection ctl={ctl} line={sel.line} />}
      {sel.draw && (
        <Section title="손글씨">
          <ColorField label="색" value={sel.draw.color} onValue={(color) => ctl?.setDraw({ color })} />
          <Range label="굵기" value={sel.draw.width} min={1} max={80} format={(v) => `${v}px`} onValue={(width) => ctl?.setDraw({ width })} />
        </Section>
      )}
      <LookSection ctl={ctl} sel={sel} />
    </>
  )
}

function IconRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('flex flex-wrap items-center gap-1', className)}>{children}</div>
}

// ── 아무것도 고르지 않았을 때: 페이지 ─────────────────────
function PageSection({ page, pageNumber, docSize, onPagePatch }: PropertiesPanelProps) {
  const transparent = page.background === null
  return (
    <>
      <Section title={`${pageNumber}페이지`} hint={`${docSize.width} × ${docSize.height}px · 크기는 위쪽 도구 모음에서 바꿉니다.`}>
        <Switch checked={transparent} onChange={(on) => onPagePatch({ background: on ? null : '#ffffff' }, '')} label="배경 비우기" hint="PNG·WebP 로 저장하면 배경이 투명해집니다." />
        {!transparent && <ColorField label="배경색" value={page.background ?? '#ffffff'} onValue={(background) => onPagePatch({ background }, 'bg')} />}
      </Section>
      <Section title="움직이는 파일에서" hint="GIF·MP4 로 저장할 때 이 페이지를 보여 줄 시간입니다. 비워 두면 내보내기의 공통 시간을 씁니다.">
        <Field label="이 페이지 시간">
          {(id) => (
            <div className="relative">
              <TextInput
                id={id}
                inputMode="decimal"
                className="num pr-10"
                placeholder="공통 시간"
                key={`${page.id}:${page.seconds ?? ''}`}
                defaultValue={page.seconds ?? ''}
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  const seconds = e.target.value.trim() && Number.isFinite(v) && v > 0 ? Math.min(60, Math.max(0.2, v)) : null
                  if (seconds !== page.seconds) onPagePatch({ seconds }, '')
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">초</span>
            </div>
          )}
        </Field>
      </Section>
      <Section title="빠른 사용법">
        <ul className="flex flex-col gap-1.5 text-sm text-muted">
          <li>사진은 끌어다 놓거나 Ctrl+V 로 붙여넣습니다.</li>
          <li>글자는 두 번 눌러 고칩니다.</li>
          <li>Ctrl+휠로 확대, 스페이스를 누른 채 끌면 화면이 움직입니다.</li>
          <li>옮길 때 Ctrl 을 누르면 달라붙지 않습니다.</li>
        </ul>
      </Section>
    </>
  )
}

// ── 펜·형광펜 ─────────────────────────────────────────────
function BrushSection({ mode, brushes, onBrush, ctl }: PropertiesPanelProps & { mode: 'pen' | 'highlighter' }) {
  const b = brushes[mode]
  return (
    <Section title={mode === 'pen' ? '펜' : '형광펜'} hint="캔버스 위에서 끌어 그립니다. 끝나면 ‘선택’ 도구로 돌아가세요.">
      <ColorField label="색" value={b.color} onValue={(color) => onBrush(mode, { color })} />
      <Range label="굵기" value={b.width} min={mode === 'pen' ? 1 : 8} max={mode === 'pen' ? 40 : 80} format={(v) => `${v}px`} onValue={(width) => onBrush(mode, { width })} />
      <Button size="sm" onClick={() => ctl?.setMode('select')}>
        그리기 끝내기
      </Button>
    </Section>
  )
}

// ── 배치: 정렬·위치·크기·순서 ─────────────────────────────
function ArrangeSection({ ctl, sel }: { ctl: CanvasController | null; sel: Selection }) {
  const [basis, setBasis] = useState<'page' | 'selection'>('page')
  const [keepRatio, setKeepRatio] = useState(true)
  const multi = sel.kind === 'multi'
  const fixedHeight = sel.kind === 'text' || sel.kind === 'line'
  return (
    <Section
      title={multi ? `${sel.count}개 선택` : sel.name}
      action={
        <IconRow>
          <IconButton icon={Copy} label="복제 (Ctrl+D)" size="sm" onClick={() => void ctl?.duplicate()} />
          {multi && <IconButton icon={Group} label="묶기 (Ctrl+G)" size="sm" onClick={() => ctl?.group()} />}
          {sel.kind === 'group' && <IconButton icon={Ungroup} label="묶음 풀기 (Ctrl+Shift+G)" size="sm" onClick={() => ctl?.ungroup()} />}
          {sel.uid && <IconButton icon={sel.locked ? Lock : LockOpen} label={sel.locked ? '잠금 풀기' : '잠그기'} size="sm" active={sel.locked} onClick={() => ctl?.setLocked(sel.uid!, !sel.locked)} />}
          <IconButton icon={Trash2} label="삭제 (Delete)" size="sm" variant="danger" onClick={() => ctl?.deleteSelection()} />
        </IconRow>
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-2">정렬</span>
        <IconRow>
          {ALIGN.map((a) => (
            <IconButton key={a.how} icon={a.icon} label={a.label} size="sm" variant="secondary" onClick={() => ctl?.align(a.how, multi ? basis : 'page')} />
          ))}
          {multi && sel.count >= 3 && (
            <>
              <IconButton icon={AlignHorizontalSpaceAround} label="가로 간격 같게" size="sm" variant="secondary" onClick={() => ctl?.distribute('x')} />
              <IconButton icon={AlignVerticalSpaceAround} label="세로 간격 같게" size="sm" variant="secondary" onClick={() => ctl?.distribute('y')} />
            </>
          )}
        </IconRow>
        {multi && (
          <Segmented
            label="정렬 기준"
            size="sm"
            block
            value={basis}
            onValue={setBasis}
            options={[
              { value: 'page', label: '페이지 기준' },
              { value: 'selection', label: '선택한 것끼리' },
            ]}
          />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Num label="가로 위치" unit="px" value={sel.x} onCommit={(x) => ctl?.setGeometry({ x })} />
        <Num label="세로 위치" unit="px" value={sel.y} onCommit={(y) => ctl?.setGeometry({ y })} />
        <Num label="너비" unit="px" min={1} value={sel.w} onCommit={(w) => ctl?.setGeometry({ w }, keepRatio)} />
        <Num label="높이" unit="px" min={1} value={sel.h} disabled={fixedHeight} onCommit={(h) => ctl?.setGeometry({ h }, keepRatio)} />
        <Num label="회전" unit="°" min={-360} max={360} value={sel.angle} onCommit={(angle) => ctl?.setGeometry({ angle })} />
      </div>
      {!fixedHeight && <Switch checked={keepRatio} onChange={setKeepRatio} label="가로세로 비율 유지" />}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-2">겹치는 순서</span>
        <IconRow>
          <IconButton icon={ChevronsUp} label="맨 앞으로 (Ctrl+Shift+])" size="sm" variant="secondary" onClick={() => ctl?.order('front')} />
          <IconButton icon={ArrowUp} label="한 칸 앞으로 (Ctrl+])" size="sm" variant="secondary" onClick={() => ctl?.order('forward')} />
          <IconButton icon={ArrowDown} label="한 칸 뒤로 (Ctrl+[)" size="sm" variant="secondary" onClick={() => ctl?.order('backward')} />
          <IconButton icon={ChevronsDown} label="맨 뒤로 (Ctrl+Shift+[)" size="sm" variant="secondary" onClick={() => ctl?.order('back')} />
        </IconRow>
      </div>
    </Section>
  )
}

// ── 공통 모양: 불투명도·반전·등장 효과 ────────────────────
function LookSection({ ctl, sel }: { ctl: CanvasController | null; sel: Selection }) {
  return (
    <Section title="보이기">
      <Range label="불투명도" value={sel.opacity} min={0} max={100} format={(v) => `${v}%`} onValue={(opacity) => ctl?.setCommon({ opacity })} />
      <IconRow>
        <Button size="sm" icon={FlipHorizontal2} aria-pressed={sel.flipX} className={clsx(sel.flipX && 'bg-brand-soft! text-brand-ink!')} onClick={() => ctl?.setCommon({ flipX: !sel.flipX })}>
          좌우 반전
        </Button>
        <Button size="sm" icon={FlipVertical2} aria-pressed={sel.flipY} className={clsx(sel.flipY && 'bg-brand-soft! text-brand-ink!')} onClick={() => ctl?.setCommon({ flipY: !sel.flipY })}>
          상하 반전
        </Button>
      </IconRow>
      <Field label="등장 효과" hint="GIF·MP4 로 저장할 때 아래 레이어부터 차례로 나타납니다.">
        {(id) => <Select id={id} value={sel.anim} onValue={(anim) => ctl?.setCommon({ anim })} options={ANIM_OPTIONS} />}
      </Field>
    </Section>
  )
}

// ── 글자 ──────────────────────────────────────────────────
function TextSection({ ctl, text, fonts, canQueryFonts, onQueryFonts, onFontFile }: PropertiesPanelProps & { text: NonNullable<Selection['text']> }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const set = (patch: Parameters<CanvasController['setText']>[0]) => void ctl?.setText(patch)
  const options = fonts.some((f) => f.family === text.fontFamily) ? fonts : [...fonts, { family: text.fontFamily, label: text.fontFamily, source: 'local' as const }]
  return (
    <>
      <Section title="글자">
        <Field label="글꼴">{(id) => <Select id={id} value={text.fontFamily} onValue={(fontFamily) => set({ fontFamily })} options={options.map((f) => ({ value: f.family, label: f.label }))} />}</Field>
        <IconRow>
          <input
            ref={fileInput}
            type="file"
            accept={FONT_FILE_ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) onFontFile(f)
            }}
          />
          {canQueryFonts && (
            <Button size="sm" icon={MonitorDown} onClick={onQueryFonts}>
              내 PC 글꼴
            </Button>
          )}
          <Button size="sm" icon={FileUp} onClick={() => fileInput.current?.click()}>
            글꼴 파일 추가
          </Button>
        </IconRow>
        <div className="grid grid-cols-2 items-end gap-2">
          <Num label="크기" unit="px" min={4} max={2000} value={text.fontSize} onCommit={(fontSize) => set({ fontSize })} />
          <IconRow className="pb-1">
            <IconButton icon={Bold} label="굵게" size="sm" variant="secondary" active={text.bold} onClick={() => set({ bold: !text.bold })} />
            <IconButton icon={Italic} label="기울임" size="sm" variant="secondary" active={text.italic} onClick={() => set({ italic: !text.italic })} />
            <IconButton icon={Underline} label="밑줄" size="sm" variant="secondary" active={text.underline} onClick={() => set({ underline: !text.underline })} />
          </IconRow>
        </div>
        <Segmented
          label="글자 정렬"
          size="sm"
          block
          value={text.align}
          onValue={(align) => set({ align })}
          options={[
            { value: 'left', label: '왼쪽', icon: TextAlignStart },
            { value: 'center', label: '가운데', icon: TextAlignCenter },
            { value: 'right', label: '오른쪽', icon: TextAlignEnd },
          ]}
        />
        <ColorField label="글자 색" value={text.fill} onValue={(fill) => set({ fill })} />
        <Range label="자간" value={text.charSpacing} min={-100} max={600} step={10} onValue={(charSpacing) => set({ charSpacing })} />
        <Range label="행간" value={text.lineHeight} min={0.8} max={2.5} step={0.05} format={(v) => v.toFixed(2)} onValue={(lineHeight) => set({ lineHeight })} />
      </Section>
      <Section title="글자 꾸미기">
        <Switch checked={text.outline} onChange={(outline) => set({ outline })} label="외곽선" />
        {text.outline && (
          <>
            <ColorField label="외곽선 색" value={text.outlineColor} onValue={(outlineColor) => set({ outlineColor })} />
            <Range label="외곽선 굵기" value={text.outlineWidth} min={1} max={40} format={(v) => `${v}px`} onValue={(outlineWidth) => set({ outlineWidth })} />
          </>
        )}
        <Switch checked={text.bg} onChange={(bg) => set({ bg })} label="글자 배경" />
        {text.bg && <ColorField label="배경 색" value={text.bgColor} onValue={(bgColor) => set({ bgColor })} />}
        <Switch checked={text.shadow} onChange={(shadow) => set({ shadow })} label="그림자" />
        {text.shadow && (
          <>
            <ColorField label="그림자 색" value={text.shadowColor} onValue={(shadowColor) => set({ shadowColor })} />
            <Range label="번짐" value={text.shadowBlur} min={0} max={60} onValue={(shadowBlur) => set({ shadowBlur })} />
            <div className="grid grid-cols-2 gap-2">
              <Num label="가로 거리" unit="px" min={-200} max={200} value={text.shadowX} onCommit={(shadowX) => set({ shadowX })} />
              <Num label="세로 거리" unit="px" min={-200} max={200} value={text.shadowY} onCommit={(shadowY) => set({ shadowY })} />
            </div>
          </>
        )}
      </Section>
    </>
  )
}

// ── 사진 ──────────────────────────────────────────────────
function ImageSection({ ctl, image }: { ctl: CanvasController | null; image: NonNullable<Selection['image']> }) {
  const changed = image.brightness !== 0 || image.contrast !== 0 || image.saturation !== 0
  return (
    <Section
      title="사진 보정"
      action={
        <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!changed} onClick={() => ctl?.setImage({ brightness: 0, contrast: 0, saturation: 0 })}>
          처음으로
        </Button>
      }
    >
      <Range label="밝기" value={image.brightness} min={-100} max={100} onValue={(brightness) => ctl?.setImage({ brightness })} />
      <Range label="대비" value={image.contrast} min={-100} max={100} onValue={(contrast) => ctl?.setImage({ contrast })} />
      <Range label="채도" value={image.saturation} min={-100} max={100} onValue={(saturation) => ctl?.setImage({ saturation })} />
    </Section>
  )
}

// ── 도형 ──────────────────────────────────────────────────
function ShapeSection({ ctl, shape }: { ctl: CanvasController | null; shape: NonNullable<Selection['shape']> }) {
  return (
    <Section title="도형">
      <Switch checked={shape.fillOn} onChange={(fillOn) => ctl?.setShape({ fillOn })} label="채우기" />
      {shape.fillOn && <ColorField label="채우기 색" value={shape.fill} onValue={(fill) => ctl?.setShape({ fill })} />}
      <Switch checked={shape.strokeOn} onChange={(strokeOn) => ctl?.setShape({ strokeOn })} label="테두리" />
      {shape.strokeOn && (
        <>
          <ColorField label="테두리 색" value={shape.stroke} onValue={(stroke) => ctl?.setShape({ stroke })} />
          <Range label="테두리 굵기" value={shape.strokeWidth} min={1} max={60} format={(v) => `${v}px`} onValue={(strokeWidth) => ctl?.setShape({ strokeWidth })} />
          <Segmented label="테두리 종류" size="sm" block value={shape.dash} onValue={(dash) => ctl?.setShape({ dash })} options={DASH_OPTIONS} />
        </>
      )}
      {shape.shape === 'rect' && <Range label="모서리 둥글기" value={shape.radius} min={0} max={300} format={(v) => `${v}px`} onValue={(radius) => ctl?.setShape({ radius })} />}
    </Section>
  )
}

function LineSection({ ctl, line }: { ctl: CanvasController | null; line: NonNullable<Selection['line']> }) {
  return (
    <Section title="선">
      <ColorField label="색" value={line.color} onValue={(color) => ctl?.setLine({ color })} />
      <Range label="굵기" value={line.width} min={1} max={60} format={(v) => `${v}px`} onValue={(width) => ctl?.setLine({ width })} />
      <Segmented label="선 종류" size="sm" block value={line.dash} onValue={(dash) => ctl?.setLine({ dash })} options={DASH_OPTIONS} />
      <Segmented
        label="화살표"
        size="sm"
        block
        value={line.arrow}
        onValue={(arrow) => ctl?.setLine({ arrow })}
        options={[
          { value: 'none', label: '없음' },
          { value: 'end', label: '한쪽' },
          { value: 'both', label: '양쪽' },
        ]}
      />
    </Section>
  )
}

// ── 레이어 목록 ───────────────────────────────────────────
export function LayerList({ ctl, layers }: { ctl: CanvasController | null; layers: Layer[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const selected = layers.filter((l) => l.selected)
  const one = selected.length === 1 ? selected[0] : null
  if (!layers.length) {
    return (
      <EmptyState icon={Layers} title="이 페이지는 비어 있습니다">
        왼쪽에서 사진·글자·도형을 추가하면 여기에 쌓인 순서대로 나타납니다.
      </EmptyState>
    )
  }
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <span className="text-sm text-muted">
          위에 있을수록 앞에 보입니다 · <span className="num">{layers.length}</span>개
        </span>
        <IconRow>
          <IconButton icon={ArrowUp} label="선택한 레이어 한 칸 위로" size="sm" disabled={!one || layers[0] === one} onClick={() => one && ctl?.moveLayer(one.uid, 'up')} />
          <IconButton icon={ArrowDown} label="선택한 레이어 한 칸 아래로" size="sm" disabled={!one || layers[layers.length - 1] === one} onClick={() => one && ctl?.moveLayer(one.uid, 'down')} />
        </IconRow>
      </div>
      <ul className="flex flex-col p-1.5">
        {layers.map((l) => {
          const Icon = KIND_ICON[l.kind]
          return (
            <li key={l.uid} className={clsx('flex items-center gap-1 rounded-sm pl-2 pr-1 transition-colors duration-100', l.selected ? 'bg-brand-soft' : 'hover:bg-sunken')}>
              <Icon className={clsx('size-4 shrink-0', l.selected ? 'text-brand-ink' : 'text-muted')} aria-hidden />
              {editing === l.uid ? (
                <TextInput
                  autoFocus
                  aria-label="레이어 이름"
                  defaultValue={l.name}
                  maxLength={40}
                  className="h-8! flex-1 px-2! text-sm!"
                  onBlur={(e) => {
                    ctl?.rename(l.uid, e.target.value)
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  title="한 번 누르면 선택, 두 번 누르면 이름 바꾸기"
                  onClick={(e) => ctl?.selectByUid(l.uid, e.shiftKey || e.ctrlKey || e.metaKey)}
                  onDoubleClick={() => setEditing(l.uid)}
                  className={clsx('min-w-0 flex-1 truncate py-2 text-left text-sm', l.selected ? 'font-semibold text-brand-ink' : 'text-ink-2', !l.visible && 'opacity-50')}
                >
                  {l.name}
                  <span className="sr-only"> ({KIND_NAME[l.kind]})</span>
                </button>
              )}
              <IconButton icon={l.visible ? Eye : EyeOff} label={l.visible ? `${l.name} 숨기기` : `${l.name} 보이기`} size="sm" active={!l.visible} onClick={() => ctl?.setVisible(l.uid, !l.visible)} />
              <IconButton icon={l.locked ? Lock : LockOpen} label={l.locked ? `${l.name} 잠금 풀기` : `${l.name} 잠그기`} size="sm" active={l.locked} onClick={() => ctl?.setLocked(l.uid, !l.locked)} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
