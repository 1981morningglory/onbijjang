import clsx from 'clsx'
import { RotateCcw, Shuffle } from 'lucide-react'
import type { TeamPresets, WatermarkSettings } from '@/app/config'
import { Button, Callout, ColorField, Field, NumberInput, Section, Segmented, Select, Slider, Switch, TextInput, WatermarkControls } from '@/ui'
import { MAX_TARGET } from './geometry'
import { outputName } from './output'
import type { BatchSettings, ExportSettings, ResizeMode, ResolvedBatch } from './types'

interface SizePreset {
  label: string
  detail: string
  patch: Partial<BatchSettings>
}

const MARKET_PRESETS: SizePreset[] = [
  { label: '정사각 1000', detail: '1000×1000 · 흰 여백', patch: { resizeMode: 'exact', width: 1000, height: 1000, fit: 'contain', padColor: '#ffffff' } },
  { label: '상세페이지', detail: '가로 860', patch: { resizeMode: 'width', width: 860 } },
  { label: '가로 1200', detail: '세로는 비율대로', patch: { resizeMode: 'width', width: 1200 } },
]

function presetActive(b: ResolvedBatch, patch: Partial<BatchSettings>): boolean {
  if (b.resizeMode !== patch.resizeMode) return false
  if (patch.resizeMode === 'width') return b.width === patch.width
  return b.width === patch.width && b.height === patch.height && b.fit === patch.fit && b.padColor.toLowerCase() === patch.padColor
}

const RESIZE_OPTIONS: Array<{ value: ResizeMode; label: string }> = [
  { value: 'none', label: '변경 없음' },
  { value: 'width', label: '가로 기준' },
  { value: 'height', label: '세로 기준' },
  { value: 'long', label: '긴 변 기준' },
  { value: 'exact', label: '가로×세로 지정' },
]

const sizeError = (v: number | null) => (v == null || v < 1 ? '1 이상의 숫자를 입력하세요.' : v > MAX_TARGET ? `${MAX_TARGET.toLocaleString('ko-KR')}px 까지 됩니다.` : undefined)

export interface BatchPanelProps {
  batch: BatchSettings
  resolved: ResolvedBatch
  onBatch: (patch: Partial<BatchSettings>) => void
  watermark: WatermarkSettings
  onWatermark: (next: WatermarkSettings) => void
  exp: ExportSettings
  onExport: (patch: Partial<ExportSettings>) => void
  onShuffle: () => void
  onResetAll: () => void
  team: TeamPresets
  /** 파일 이름 예시에 쓸 원본 이름 */
  sampleName: string
}

export function BatchPanel({ batch, resolved, onBatch, watermark, onWatermark, exp, onExport, onShuffle, onResetAll, team, sampleName }: BatchPanelProps) {
  const teamSizes: SizePreset[] = team.canvasSizes
    .filter((s) => s.w <= MAX_TARGET && s.h <= MAX_TARGET && !(s.w === 1000 && s.h === 1000))
    .map((s) => ({ label: s.name, detail: `${s.w}×${s.h}`, patch: { resizeMode: 'exact', width: s.w, height: s.h, fit: 'contain', padColor: '#ffffff' } }))
  const adjusted = batch.brightness !== 100 || batch.contrast !== 100 || batch.saturation !== 100
  const isPng = exp.format === 'image/png'
  const showUpscale = batch.resizeMode !== 'none' && !(batch.resizeMode === 'exact' && batch.fit === 'cover')

  const presetButtons = (list: SizePreset[]) => (
    <div className="grid grid-cols-2 gap-1.5">
      {list.map((p) => {
        const active = presetActive(resolved, p.patch)
        return (
          <button
            key={p.label + p.detail}
            type="button"
            aria-pressed={active}
            onClick={() => onBatch(p.patch)}
            className={clsx(
              'flex min-w-0 flex-col rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150',
              active ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-line-strong bg-surface text-ink hover:bg-sunken',
            )}
          >
            <span className="truncate text-sm font-semibold">{p.label}</span>
            <span className="num truncate text-2xs text-muted">{p.detail}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <>
      <Section title="마켓 규격" hint="누르면 아래 크기 맞춤이 한 번에 바뀝니다.">
        {presetButtons(MARKET_PRESETS)}
        {teamSizes.length > 0 && (
          <>
            <p className="text-xs font-semibold text-muted">팀에서 자주 쓰는 크기</p>
            {presetButtons(teamSizes)}
          </>
        )}
      </Section>

      <Section title="크기 맞춤">
        <Field label="기준">{(id) => <Select id={id} value={batch.resizeMode} onValue={(resizeMode) => onBatch({ resizeMode })} options={RESIZE_OPTIONS} />}</Field>
        {batch.resizeMode === 'width' && (
          <Field label="가로" error={sizeError(batch.width)} hint="세로는 비율에 맞춰 정해집니다.">
            {(id) => <NumberInput id={id} unit="px" min={1} max={MAX_TARGET} value={batch.width} onValue={(width) => onBatch({ width })} />}
          </Field>
        )}
        {batch.resizeMode === 'height' && (
          <Field label="세로" error={sizeError(batch.height)} hint="가로는 비율에 맞춰 정해집니다.">
            {(id) => <NumberInput id={id} unit="px" min={1} max={MAX_TARGET} value={batch.height} onValue={(height) => onBatch({ height })} />}
          </Field>
        )}
        {batch.resizeMode === 'long' && (
          <Field label="긴 변" error={sizeError(batch.long)} hint="가로·세로 중 긴 쪽을 이 길이에 맞춥니다.">
            {(id) => <NumberInput id={id} unit="px" min={1} max={MAX_TARGET} value={batch.long} onValue={(long) => onBatch({ long })} />}
          </Field>
        )}
        {batch.resizeMode === 'exact' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="가로" error={sizeError(batch.width)}>
                {(id) => <NumberInput id={id} unit="px" min={1} max={MAX_TARGET} value={batch.width} onValue={(width) => onBatch({ width })} />}
              </Field>
              <Field label="세로" error={sizeError(batch.height)}>
                {(id) => <NumberInput id={id} unit="px" min={1} max={MAX_TARGET} value={batch.height} onValue={(height) => onBatch({ height })} />}
              </Field>
            </div>
            <Segmented
              label="비율이 다를 때"
              block
              size="sm"
              value={batch.fit}
              onValue={(fit) => onBatch({ fit })}
              options={[
                { value: 'contain', label: '여백 넣기' },
                { value: 'cover', label: '잘라서 채우기' },
              ]}
            />
            {batch.fit === 'contain' && <ColorField label="여백 색" value={resolved.padColor} onValue={(padColor) => onBatch({ padColor })} />}
          </>
        )}
        {showUpscale && <Switch label="작은 사진은 키우지 않기" hint="원본보다 크게 늘리면 흐려질 수 있습니다." checked={batch.noUpscale} onChange={(noUpscale) => onBatch({ noUpscale })} />}
      </Section>

      <Section title="저장 형식">
        <Segmented
          label="저장 형식"
          block
          value={exp.format}
          onValue={(format) => onExport({ format })}
          options={[
            { value: 'image/jpeg', label: 'JPG' },
            { value: 'image/png', label: 'PNG' },
            { value: 'image/webp', label: 'WebP' },
          ]}
        />
        <Field label="품질" aside={isPng ? '원본 그대로' : exp.quality} hint={isPng ? 'PNG 는 화질 손실이 없어 품질을 고르지 않습니다. 투명 배경이 유지됩니다.' : undefined}>
          {(id) => <Slider id={id} min={10} max={100} value={exp.quality} disabled={isPng} onValue={(quality) => onExport({ quality })} />}
        </Field>
        <Switch label="한 장 용량 제한" hint="넘으면 품질을 자동으로 낮춥니다." checked={exp.limitSize} onChange={(limitSize) => onExport({ limitSize })} />
        {exp.limitSize && (
          <>
            <Field label="한 장 최대 용량" error={exp.targetKB == null || exp.targetKB <= 0 ? '용량을 입력하세요.' : undefined}>
              {(id) => <NumberInput id={id} unit="KB" min={10} step={10} value={exp.targetKB} onValue={(targetKB) => onExport({ targetKB })} />}
            </Field>
            <Switch label="그래도 넘으면 크기 줄이기" hint="품질을 낮춰도 안 되는 사진만 조금씩 작게 만듭니다." checked={exp.shrinkToFit} onChange={(shrinkToFit) => onExport({ shrinkToFit })} />
          </>
        )}
      </Section>

      <Section
        title="밝기·대비·채도"
        action={
          adjusted ? (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => onBatch({ brightness: 100, contrast: 100, saturation: 100 })}>
              원래대로
            </Button>
          ) : undefined
        }
      >
        <Field label="밝기" aside={`${resolved.brightness}%`}>{(id) => <Slider id={id} min={50} max={150} value={resolved.brightness} onValue={(brightness) => onBatch({ brightness })} />}</Field>
        <Field label="대비" aside={`${resolved.contrast}%`}>{(id) => <Slider id={id} min={50} max={150} value={resolved.contrast} onValue={(contrast) => onBatch({ contrast })} />}</Field>
        <Field label="채도" aside={`${resolved.saturation}%`}>{(id) => <Slider id={id} min={0} max={200} value={resolved.saturation} onValue={(saturation) => onBatch({ saturation })} />}</Field>
      </Section>

      <Section title="테두리">
        <Field label="두께" hint="사진 안쪽에 그려져 크기는 그대로입니다. 0 이면 없음.">
          {(id) => <NumberInput id={id} unit="px" min={0} max={500} value={batch.borderWidth} onValue={(borderWidth) => onBatch({ borderWidth })} />}
        </Field>
        {resolved.borderWidth > 0 && <ColorField label="테두리 색" value={resolved.borderColor} onValue={(borderColor) => onBatch({ borderColor })} />}
      </Section>

      <Section title="반전·랜덤 자르기">
        <Switch label="좌우 반전" checked={batch.flipH} onChange={(flipH) => onBatch({ flipH })} />
        <Switch label="랜덤 자르기" hint="사진마다 다른 위치에서 가장자리를 조금 잘라냅니다." checked={batch.randomCrop} onChange={(randomCrop) => onBatch({ randomCrop })} />
        {batch.randomCrop && (
          <>
            <Field label="가로에서 잘라낼 양" aside={`${resolved.cropPctW}%`}>
              {(id) => <Slider id={id} min={0} max={30} step={0.5} value={resolved.cropPctW} onValue={(cropPctW) => onBatch({ cropPctW })} />}
            </Field>
            <Field label="세로에서 잘라낼 양" aside={`${resolved.cropPctH}%`}>
              {(id) => <Slider id={id} min={0} max={30} step={0.5} value={resolved.cropPctH} onValue={(cropPctH) => onBatch({ cropPctH })} />}
            </Field>
            <Button size="sm" icon={Shuffle} onClick={onShuffle}>
              다시 섞기
            </Button>
          </>
        )}
      </Section>

      <Section title="워터마크">
        <WatermarkControls value={watermark} onChange={onWatermark} />
        {watermark.enabled && watermark.kind === 'logo' && !watermark.logoDataUrl && <Callout tone="info">로고 이미지를 선택하면 사진에 들어갑니다.</Callout>}
      </Section>

      <Section title="파일 이름">
        <Segmented
          label="파일 이름 규칙"
          block
          size="sm"
          value={exp.naming}
          onValue={(naming) => onExport({ naming })}
          options={[
            { value: 'original', label: '원본 이름' },
            { value: 'sequence', label: '번호 붙이기' },
          ]}
        />
        {exp.naming === 'original' ? (
          <Field label="이름 뒤에 붙일 말" hint="비워 두면 원본 이름 그대로 저장합니다.">
            {(id) => <TextInput id={id} value={exp.suffix} maxLength={30} onChange={(e) => onExport({ suffix: e.target.value })} placeholder="예: _편집" />}
          </Field>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
            <Field label="이름">{(id) => <TextInput id={id} value={exp.seqBase} maxLength={40} onChange={(e) => onExport({ seqBase: e.target.value })} placeholder={team.filename.base} />}</Field>
            <Field label="시작 번호">{(id) => <NumberInput id={id} min={0} value={exp.seqStart} onValue={(seqStart) => onExport({ seqStart })} placeholder={String(team.filename.start)} />}</Field>
          </div>
        )}
        <p className="text-sm text-muted">
          예: <span className="font-semibold text-ink-2">{outputName(sampleName, 0, exp, { team: team.filename })}</span>
        </p>
      </Section>

      <div className="flex justify-end px-4 py-3">
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onResetAll}>
          설정 처음으로
        </Button>
      </div>
    </>
  )
}
