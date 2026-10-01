import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  BringToFront,
  Copy,
  ImagePlus,
  Maximize,
  ScanBarcode,
  SendToBack,
  Shapes,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Type,
  Image as ImageIcon,
  type LucideIcon,
} from 'lucide-react'
import { Button, ColorField, EmptyState, Field, IconButton, NumberInput, Section, Segmented, Select, Switch, Textarea, TextInput } from '@/ui'
import { SYMBOLOGIES, SYMBOLOGY_BY_ID, makeBarcode } from './barcode'
import { contentOf, withContent } from './factory'
import { FONTS } from './fonts'
import { SERIAL_KEY, clampElement, resolveText, round2, type BarcodeEl, type FontId, type ImageEl, type LabelData, type LabelElement, type ShapeEl, type ShapeKind, type SheetSpec, type Symbology, type TextEl } from './model'

const TYPE_ICON: Record<LabelElement['type'], LucideIcon> = { text: Type, image: ImageIcon, shape: Shapes, barcode: ScanBarcode }
const SHAPE_OPTIONS: Array<{ value: ShapeKind; label: string }> = [
  { value: 'rect', label: '사각형' },
  { value: 'round', label: '둥근 사각형' },
  { value: 'ellipse', label: '원' },
  { value: 'triangle', label: '삼각형' },
  { value: 'line', label: '선' },
]

interface DesignPanelProps {
  sheet: SheetSpec
  design: LabelElement[]
  titles: Record<string, string>
  selected: LabelElement | null
  /** 자리표시로 쓸 수 있는 열 이름 */
  columns: string[]
  /** 미리보기에 쓰는 라벨(바코드 값 검사용) */
  label: LabelData | null
  rev: number
  onSelect: (id: string | null) => void
  onChange: (design: LabelElement[], tag?: string) => void
  onDuplicate: () => void
  onReplaceImage: () => void
}

export function DesignPanel({ sheet, design, titles, selected, columns, label, onSelect, onChange, onDuplicate, onReplaceImage }: DesignPanelProps) {
  if (!selected) {
    return (
      <Section title="라벨에 놓인 것" hint={design.length ? '눌러서 고르면 여기서 내용과 모양을 바꿉니다.' : undefined}>
        {design.length === 0 ? (
          <EmptyState icon={Type} title="아직 아무것도 없습니다" className="px-2! py-6!">
            왼쪽 위의 글자·이미지·도형·바코드 버튼으로 라벨을 꾸며 보세요.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-1">
            {[...design].reverse().map((el) => {
              const Icon = TYPE_ICON[el.type]
              return (
                <li key={el.id}>
                  <button type="button" onClick={() => onSelect(el.id)} className="flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm transition-colors duration-150 hover:bg-sunken">
                    <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                    <span className="shrink-0 font-semibold text-ink">{titles[el.id]}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{contentOf(el) ?? ''}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    )
  }

  const W = sheet.labelW
  const H = sheet.labelH
  const apply = (next: LabelElement, key: string) => onChange(design.map((el) => (el.id === next.id ? next : el)), `prop:${next.id}:${key}`)
  const setBox = (patch: Partial<Pick<LabelElement, 'x' | 'y' | 'w' | 'h'>>, key: string) => apply(clampElement({ ...selected, ...patch }, W, H), key)
  const reorder = (toFront: boolean) => {
    const rest = design.filter((el) => el.id !== selected.id)
    onChange(toFront ? [...rest, selected] : [selected, ...rest])
  }
  const remove = () => {
    onChange(design.filter((el) => el.id !== selected.id))
    onSelect(null)
  }
  const insertChips = (el: TextEl | BarcodeEl) => {
    const names = [...columns, SERIAL_KEY]
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm text-muted">넣기</span>
        {names.map((name) => (
          <button
            key={name}
            type="button"
            title={name === SERIAL_KEY ? '라벨마다 001, 002 … 로 바뀝니다' : `표의 ‘${name}’ 열 값으로 바뀝니다`}
            onClick={() => {
              // 처음 넣어 준 견본 값 그대로라면 덧붙이지 않고 바꾼다.
              const current = contentOf(el) ?? ''
              const untouched = el.type === 'barcode' ? current === SYMBOLOGY_BY_ID[el.symbology].sample : current === '새 글자'
              apply(withContent(el, `${untouched ? '' : current}{${name}}`), 'content')
            }}
            className="num inline-flex h-7 items-center rounded-full border border-line-strong bg-surface px-2.5 text-xs font-semibold text-ink-2 transition-colors duration-150 hover:border-brand hover:bg-brand-soft hover:text-brand-ink"
          >
            {`{${name}}`}
          </button>
        ))}
      </div>
    )
  }

  return (
    <>
      <Section
        title={titles[selected.id]}
        action={
          <div className="flex items-center gap-1">
            <IconButton icon={Copy} label="복제 (Ctrl+D)" size="sm" onClick={onDuplicate} />
            <IconButton icon={Trash2} label="삭제 (Delete)" size="sm" variant="danger" onClick={remove} />
          </div>
        }
      >
        {selected.type === 'text' && <TextProps el={selected} apply={apply} chips={insertChips(selected)} />}
        {selected.type === 'image' && <ImageProps el={selected} apply={apply} onReplace={onReplaceImage} />}
        {selected.type === 'shape' && <ShapeProps el={selected} apply={apply} />}
        {selected.type === 'barcode' && <BarcodeProps el={selected} apply={apply} chips={insertChips(selected)} label={label} />}
      </Section>

      <Section title="위치와 크기">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="왼쪽에서">{(id) => <NumberInput id={id} value={round2(selected.x)} onValue={(v) => v !== null && setBox({ x: v }, 'x')} step={0.5} unit="mm" />}</Field>
          <Field label="위에서">{(id) => <NumberInput id={id} value={round2(selected.y)} onValue={(v) => v !== null && setBox({ y: v }, 'y')} step={0.5} unit="mm" />}</Field>
          <Field label="너비">{(id) => <NumberInput id={id} value={round2(selected.w)} onValue={(v) => v !== null && v > 0 && setBox({ w: v }, 'w')} min={1} step={0.5} unit="mm" />}</Field>
          <Field label="높이">{(id) => <NumberInput id={id} value={round2(selected.h)} onValue={(v) => v !== null && v > 0 && setBox({ h: v }, 'h')} min={1} step={0.5} unit="mm" />}</Field>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <IconButton icon={AlignHorizontalJustifyStart} label="왼쪽에 붙이기" size="sm" variant="secondary" onClick={() => setBox({ x: 0 }, 'align')} />
          <IconButton icon={AlignHorizontalJustifyCenter} label="가로 가운데" size="sm" variant="secondary" onClick={() => setBox({ x: (W - selected.w) / 2 }, 'align')} />
          <IconButton icon={AlignHorizontalJustifyEnd} label="오른쪽에 붙이기" size="sm" variant="secondary" onClick={() => setBox({ x: W - selected.w }, 'align')} />
          <IconButton icon={AlignVerticalJustifyStart} label="위에 붙이기" size="sm" variant="secondary" onClick={() => setBox({ y: 0 }, 'align')} />
          <IconButton icon={AlignVerticalJustifyCenter} label="세로 가운데" size="sm" variant="secondary" onClick={() => setBox({ y: (H - selected.h) / 2 }, 'align')} />
          <IconButton icon={AlignVerticalJustifyEnd} label="아래에 붙이기" size="sm" variant="secondary" onClick={() => setBox({ y: H - selected.h }, 'align')} />
          <IconButton icon={Maximize} label="칸 가득 채우기" size="sm" variant="secondary" onClick={() => setBox({ x: 0, y: 0, w: W, h: H }, 'align')} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={BringToFront} onClick={() => reorder(true)} disabled={design[design.length - 1]?.id === selected.id}>
            맨 앞으로
          </Button>
          <Button size="sm" icon={SendToBack} onClick={() => reorder(false)} disabled={design[0]?.id === selected.id}>
            맨 뒤로
          </Button>
        </div>
      </Section>
    </>
  )
}

type Apply = (next: LabelElement, key: string) => void

function TextProps({ el, apply, chips }: { el: TextEl; apply: Apply; chips: React.ReactNode }) {
  return (
    <>
      <Field label="내용" hint="{열이름} 은 표의 값으로, {연번} 은 001, 002 … 로 바뀝니다.">
        {(id) => <Textarea id={id} value={el.text} onChange={(e) => apply({ ...el, text: e.target.value }, 'content')} rows={3} className="min-h-20!" placeholder="라벨에 적을 글" />}
      </Field>
      {chips}
      <Field label="글꼴">{(id) => <Select<FontId> id={id} value={el.font} onValue={(font) => apply({ ...el, font }, 'font')} options={FONTS.map((f) => ({ value: f.id, label: f.name }))} />}</Field>
      <div className="flex items-end gap-2">
        <Field label="크기" className="w-28">
          {(id) => <NumberInput id={id} value={el.size} onValue={(v) => v !== null && v >= 4 && v <= 400 && apply({ ...el, size: v }, 'size')} min={4} max={400} step={0.5} unit="pt" />}
        </Field>
        <IconButton icon={Bold} label="굵게" variant="secondary" active={el.bold} onClick={() => apply({ ...el, bold: !el.bold }, 'bold')} />
        <Segmented
          label="가로 정렬"
          value={el.align}
          onValue={(align) => apply({ ...el, align }, 'align')}
          options={[
            { value: 'left', label: <span className="sr-only">왼쪽</span>, icon: TextAlignStart },
            { value: 'center', label: <span className="sr-only">가운데</span>, icon: TextAlignCenter },
            { value: 'right', label: <span className="sr-only">오른쪽</span>, icon: TextAlignEnd },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-2">세로 정렬</span>
        <Segmented
          label="세로 정렬"
          block
          size="sm"
          value={el.valign}
          onValue={(valign) => apply({ ...el, valign }, 'valign')}
          options={[
            { value: 'top', label: '위' },
            { value: 'middle', label: '가운데' },
            { value: 'bottom', label: '아래' },
          ]}
        />
      </div>
      <ColorField label="글자 색" value={el.color} onValue={(color) => apply({ ...el, color }, 'color')} />
      <Switch checked={el.shrink} onChange={(shrink) => apply({ ...el, shrink }, 'shrink')} label="넘치면 글자 줄이기" hint="내용이 길어 상자를 넘칠 때 자동으로 작게 맞춥니다." />
    </>
  )
}

function ImageProps({ el, apply, onReplace }: { el: ImageEl; apply: Apply; onReplace: () => void }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <div className="checker flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-strong">
          <img src={el.src} alt="고른 이미지" className="max-h-full max-w-full" />
        </div>
        <Button size="sm" icon={ImagePlus} onClick={onReplace}>
          다른 이미지로
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-2">상자에 맞추는 방법</span>
        <Segmented
          label="상자에 맞추는 방법"
          block
          size="sm"
          value={el.fit}
          onValue={(fit) => apply({ ...el, fit }, 'fit')}
          options={[
            { value: 'contain', label: '다 보이게' },
            { value: 'cover', label: '가득 채우기' },
            { value: 'fill', label: '늘리기' },
          ]}
        />
      </div>
    </>
  )
}

function ShapeProps({ el, apply }: { el: ShapeEl; apply: Apply }) {
  const line = el.shape === 'line'
  return (
    <>
      <Field label="모양">{(id) => <Select<ShapeKind> id={id} value={el.shape} onValue={(shape) => apply({ ...el, shape }, 'shape')} options={SHAPE_OPTIONS} />}</Field>
      {!line && <Switch checked={el.fill !== null} onChange={(on) => apply({ ...el, fill: on ? '#ffe55c' : null }, 'fill-on')} label="안쪽 채우기" />}
      {!line && el.fill !== null && <ColorField label="채우는 색" value={el.fill} onValue={(fill) => apply({ ...el, fill }, 'fill')} />}
      {!line && <Switch checked={el.stroke !== null} onChange={(on) => apply({ ...el, stroke: on ? '#14201a' : null }, 'stroke-on')} label="테두리" />}
      {el.stroke !== null && (
        <>
          <ColorField label={line ? '선 색' : '테두리 색'} value={el.stroke} onValue={(stroke) => apply({ ...el, stroke }, 'stroke')} />
          <Field label={line ? '선 굵기' : '테두리 굵기'}>
            {(id) => <NumberInput id={id} value={el.strokeWidth} onValue={(v) => v !== null && v >= 0 && v <= 10 && apply({ ...el, strokeWidth: v }, 'sw')} min={0.1} max={10} step={0.1} unit="mm" />}
          </Field>
        </>
      )}
      {el.shape === 'round' && (
        <Field label="모서리 둥글기">{(id) => <NumberInput id={id} value={el.radius} onValue={(v) => v !== null && v >= 0 && apply({ ...el, radius: v }, 'radius')} min={0} step={0.5} unit="mm" />}</Field>
      )}
      {line && el.stroke === null && (
        <Button size="sm" onClick={() => apply({ ...el, stroke: '#14201a' }, 'stroke-on')}>
          선 보이기
        </Button>
      )}
    </>
  )
}

function BarcodeProps({ el, apply, chips, label }: { el: BarcodeEl; apply: Apply; chips: React.ReactNode; label: LabelData | null }) {
  const def = SYMBOLOGY_BY_ID[el.symbology]
  const resolved = resolveText(el.value, label)
  const result = makeBarcode(el.symbology, resolved)
  const error = !result.ok && !result.pending ? `${resolved !== el.value ? `‘${resolved}’ — ` : ''}${result.message}` : undefined
  return (
    <>
      <Field label="종류">
        {(id) => (
          <Select<Symbology>
            id={id}
            value={el.symbology}
            onValue={(symbology) => {
              const next = SYMBOLOGY_BY_ID[symbology]
              // 견본 값을 그대로 두고 있었다면 새 종류의 견본으로 바꿔 준다.
              apply({ ...el, symbology, value: el.value === def.sample ? next.sample : el.value, showText: next.kind === 'linear' ? el.showText : false }, 'symbology')
            }}
            options={SYMBOLOGIES.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
      </Field>
      <Field label="값" hint={def.hint} error={error}>
        {(id) => <TextInput id={id} value={el.value} onChange={(e) => apply({ ...el, value: e.target.value }, 'content')} aria-invalid={error ? true : undefined} spellCheck={false} className="num" />}
      </Field>
      {chips}
      {def.kind === 'linear' && <Switch checked={el.showText} onChange={(showText) => apply({ ...el, showText }, 'showText')} label="막대 아래에 값 적기" />}
      {def.kind === 'linear' && el.showText && (
        <Field label="값 글자 크기" className="w-32">
          {(id) => <NumberInput id={id} value={el.textSize} onValue={(v) => v !== null && v >= 4 && v <= 40 && apply({ ...el, textSize: v }, 'textSize')} min={4} max={40} step={0.5} unit="pt" />}
        </Field>
      )}
      <ColorField label="바코드 색" value={el.color} onValue={(color) => apply({ ...el, color }, 'color')} />
      <p className="text-sm text-muted">읽히려면 바코드 둘레에 흰 여백을 2–3mm 남기고, 어두운 색으로 찍으세요.</p>
    </>
  )
}
