import { Callout, ColorField, Field, NumberInput, Section, Segmented, Select, Slider } from '@/ui'
import type { EncodeSupport } from './capabilities'
import { layoutFor } from './convert'
import {
  effectiveSize,
  GIF_FPS_OPTIONS,
  GIF_SIZE_MAX,
  GIF_SIZE_MIN,
  resolveBitrate,
  type AspectMode,
  type BitrateChoice,
  type FitMode,
  type OutputFormat,
  type OutputSettings,
  type QualityLevel,
} from './types'

const VIDEO_SIZES = [1080, 720, 480, 360]
const VIDEO_FPS = [15, 24, 30]

export function formatMbps(bps: number): string {
  const mbps = bps / 1_000_000
  return `${mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)} Mbps`
}

/** MP4 를 골랐을 때 실제로 저장되는 형식 이름 */
export function videoFormatLabel(support: EncodeSupport | null): string {
  return support?.video === 'webm' ? 'WebM' : 'MP4'
}

export interface OutputSectionsProps {
  value: OutputSettings
  onChange: (next: OutputSettings) => void
  /** 브라우저가 만들 수 있는 형식. 확인 전에는 null */
  support: EncodeSupport | null
  /** 원본 크기를 알면 결과 크기·비트레이트를 미리 보여 준다 */
  source?: { width: number; height: number } | null
  disabled?: boolean
}

/** 출력 형식·크기·화질·출력 틀 설정. clips 와 gif 가 같은 화면을 쓴다. ToolLayout 의 panel 안에 그대로 넣는다. */
export function OutputSections({ value, onChange, support, source, disabled }: OutputSectionsProps) {
  const set = (patch: Partial<OutputSettings>) => onChange({ ...value, ...patch })
  const isVideo = value.format === 'mp4'
  const layout = source ? layoutFor(source.width, source.height, value) : null
  const { fps } = effectiveSize(value)
  const bitrate = isVideo && layout ? resolveBitrate(value, layout.width, layout.height, fps) : null

  return (
    <>
      <Section title="출력 형식">
        <Segmented<OutputFormat>
          label="출력 형식"
          block
          value={value.format}
          onValue={(format) => set({ format })}
          options={[
            { value: 'gif', label: 'GIF', disabled },
            { value: 'mp4', label: videoFormatLabel(support), disabled: disabled || support?.video === null },
            { value: 'webp', label: 'WebP', disabled: disabled || support?.webp === false },
          ]}
        />
        {value.format === 'gif' && <p className="text-sm text-muted">어디서나 바로 움직이지만 용량이 큽니다. 짧은 구간에 알맞습니다.</p>}
        {isVideo && support?.video === 'mp4' && <p className="text-sm text-muted">같은 화질에서 용량이 가장 작습니다. 소리는 담기지 않습니다.</p>}
        {isVideo && support?.video === 'webm' && (
          <Callout tone="info" title="이 브라우저에서는 WebM 으로 저장됩니다">
            MP4(H.264) 인코딩을 지원하지 않는 브라우저입니다. MP4 가 꼭 필요하면 크롬이나 엣지에서 열어 주세요. 소리는 담기지 않습니다.
          </Callout>
        )}
        {isVideo && support?.video === null && (
          <Callout tone="warn" title="이 브라우저는 영상 저장을 지원하지 않습니다">
            GIF 로 바꾸거나 최신 크롬·엣지에서 열어 주세요.
          </Callout>
        )}
        {value.format === 'webp' &&
          (support?.webp === false ? (
            <Callout tone="warn" title="이 브라우저는 WebP 저장을 지원하지 않습니다">
              GIF 나 MP4 로 바꿔 주세요.
            </Callout>
          ) : (
            <p className="text-sm text-muted">GIF 보다 선명하고 용량이 작습니다. 오래된 프로그램에서는 열리지 않을 수 있습니다.</p>
          ))}
      </Section>

      <Section title="크기·화질" hint={layout ? <span className="num">결과 크기 {layout.width} × {layout.height}px</span> : undefined}>
        {isVideo ? (
          <>
            <Field label="해상도(긴 변)" hint="원본보다 크게 만들지는 않습니다.">
              {(id) => (
                <Select
                  id={id}
                  disabled={disabled}
                  value={String(value.videoLongSide)}
                  onValue={(v) => set({ videoLongSide: Number(v) })}
                  options={VIDEO_SIZES.map((s) => ({ value: String(s), label: `${s}px` }))}
                />
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink-2">초당 프레임</span>
              <Segmented
                label="초당 프레임"
                block
                size="sm"
                value={String(value.videoFps)}
                onValue={(v) => set({ videoFps: Number(v) })}
                options={VIDEO_FPS.map((f) => ({ value: String(f), label: `${f}`, disabled }))}
              />
            </div>
            <Field label="비트레이트" aside={bitrate ? formatMbps(bitrate) : undefined} hint="낮을수록 용량이 작고, 높을수록 선명합니다.">
              {(id) => (
                <Select<BitrateChoice>
                  id={id}
                  disabled={disabled}
                  value={value.videoBitrate}
                  onValue={(videoBitrate) => set({ videoBitrate })}
                  options={[
                    { value: 'low', label: '낮음 — 용량 우선' },
                    { value: 'medium', label: '보통' },
                    { value: 'high', label: '높음 — 화질 우선' },
                    { value: 'custom', label: '직접 입력' },
                  ]}
                />
              )}
            </Field>
            {value.videoBitrate === 'custom' && (
              <Field label="비트레이트 직접 입력" hint="0.1–50 Mbps">
                {(id) => (
                  <NumberInput id={id} disabled={disabled} unit="Mbps" min={0.1} max={50} step={0.1} value={value.videoMbps} onValue={(v) => set({ videoMbps: v ?? 2 })} className="pr-16!" />
                )}
              </Field>
            )}
          </>
        ) : (
          <>
            <Field label="긴 변" aside={`${value.gifLongSide}px`}>
              {(id) => <Slider id={id} disabled={disabled} min={GIF_SIZE_MIN} max={GIF_SIZE_MAX} step={40} value={value.gifLongSide} onValue={(gifLongSide) => set({ gifLongSide })} />}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink-2">초당 프레임</span>
              <Segmented
                label="초당 프레임"
                block
                size="sm"
                value={String(value.gifFps)}
                onValue={(v) => set({ gifFps: Number(v) })}
                options={GIF_FPS_OPTIONS.map((f) => ({ value: String(f), label: `${f}`, disabled }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink-2">{value.format === 'gif' ? '색 품질' : '화질'}</span>
              <Segmented<QualityLevel>
                label={value.format === 'gif' ? '색 품질' : '화질'}
                block
                size="sm"
                value={value.gifQuality}
                onValue={(gifQuality) => set({ gifQuality })}
                options={[
                  { value: 'high', label: value.format === 'gif' ? '높음 256색' : '높음', disabled },
                  { value: 'medium', label: value.format === 'gif' ? '보통 128색' : '보통', disabled },
                  { value: 'low', label: value.format === 'gif' ? '작게 64색' : '작게', disabled },
                ]}
              />
            </div>
          </>
        )}
      </Section>

      <Section title="출력 틀">
        <Segmented<AspectMode>
          label="화면 비율"
          block
          size="sm"
          value={value.aspect}
          onValue={(aspect) => set({ aspect })}
          options={[
            { value: 'source', label: '원본', disabled },
            { value: '16:9', label: '16:9', disabled },
            { value: '9:16', label: '9:16', disabled },
            { value: '1:1', label: '1:1', disabled },
          ]}
        />
        {value.aspect !== 'source' && (
          <>
            <Segmented<FitMode>
              label="틀에 맞추는 방법"
              block
              size="sm"
              value={value.fit}
              onValue={(fit) => set({ fit })}
              options={[
                { value: 'pad', label: '여백 추가', disabled },
                { value: 'cover', label: '꽉 채워 자르기', disabled },
              ]}
            />
            {value.fit === 'pad' && <ColorField label="여백 색" value={value.padColor} onValue={(padColor) => set({ padColor })} />}
          </>
        )}
      </Section>
    </>
  )
}
