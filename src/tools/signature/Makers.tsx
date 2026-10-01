import clsx from 'clsx'
import { BookmarkPlus, Eraser, ImageUp, Plus, Type, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { stripExt } from '@/lib/files'
import { usePersistentState } from '@/lib/hooks'
import { ctx2d, fileToCanvas, makeCanvas } from '@/lib/image'
import { Button, Callout, ColorField, Field, Section, Segmented, Select, Slider, Switch, TextInput, toast } from '@/ui'
import { AssetView } from './AssetView'
import { DrawPad, strokesToCanvas } from './DrawPad'
import { canQueryLocalFonts, ensureFont, FONT_CHOICES, queryLocalFamilies, resolveFont, SEAL_FONT_CHOICES } from './fonts'
import type { InkStyle, Stroke } from './ink'
import { limitCanvas, renderTextCanvas, trimCanvas, whiteToAlpha } from './raster'
import { drawSeal, SEAL_MAX_CHARS, sealChars, type SealShape } from './seal'
import type { Asset, AssetKind } from './types'

type Mode = 'type' | 'draw' | 'image' | 'seal'

interface MakerSettings {
  mode: Mode
  name: string
  font: string
  family: string
  inkColor: string
  penWidth: number
  removeWhite: boolean
  whiteStrength: number
  mono: boolean
  monoColor: string
  sealText: string
  sealShape: SealShape
  sealAppendIn: boolean
  sealFont: string
  sealBorder: number
  sealWorn: boolean
  sealColor: string
}

const DEFAULTS: MakerSettings = {
  mode: 'type',
  name: '',
  font: 'pen',
  family: '',
  inkColor: '#111111',
  penWidth: 5,
  removeWhite: true,
  whiteStrength: 35,
  mono: false,
  monoColor: '#111111',
  sealText: '',
  sealShape: 'round',
  sealAppendIn: true,
  sealFont: 'serif',
  sealBorder: 5,
  sealWorn: false,
  sealColor: '#d0261c',
}

/** 색을 입히기 전의 결과물 */
interface Base {
  src: string
  aspect: number
  name: string
}

const INK_PRESETS = [
  { name: '검정', hex: '#111111' },
  { name: '남색', hex: '#1b2f6e' },
  { name: '파랑', hex: '#1d4ed8' },
  { name: '빨강', hex: '#d0261c' },
]

export function InkColorField({ label, value, onValue }: { label: string; value: string; onValue: (hex: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <ColorField label={label} value={value} onValue={onValue} />
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${label} 빠른 선택`}>
        {INK_PRESETS.map((c) => (
          <button
            key={c.hex}
            type="button"
            onClick={() => onValue(c.hex)}
            aria-pressed={value.toLowerCase() === c.hex}
            className={clsx(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors duration-150',
              value.toLowerCase() === c.hex ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-sunken',
            )}
          >
            <span className="size-3 rounded-full border border-line-strong" style={{ backgroundColor: c.hex }} />
            {c.name}
          </button>
        ))}
      </div>
    </div>
  )
}

const penStyle = (penWidth: number): InkStyle => ({ maxWidth: 0.004 + penWidth * 0.0022, thin: 0.35 })

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export interface MakerSectionProps {
  /** 문서가 열려 있어 바로 넣을 수 있는지 */
  canPlace: boolean
  onPlace: (asset: Asset) => void
  onSaveMine: (asset: Asset, name: string) => void
  /** 지금 만들고 있는 서명(팀 보관함 저장용) */
  onCurrent: (asset: Asset | null) => void
}

export function MakerSection({ canPlace, onPlace, onSaveMine, onCurrent }: MakerSectionProps) {
  const [s, setS] = usePersistentState<MakerSettings>('onbijjang:signature:maker', DEFAULTS)
  const set = (patch: Partial<MakerSettings>) => setS((prev) => ({ ...prev, ...patch }))

  const [typed, setTyped] = useState<Base | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [drawn, setDrawn] = useState<Base | null>(null)
  const [upload, setUpload] = useState<{ canvas: HTMLCanvasElement; name: string } | null>(null)
  const [uploaded, setUploaded] = useState<Base | null>(null)
  const [uploadEmpty, setUploadEmpty] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [seal, setSeal] = useState<Base | null>(null)
  const [families, setFamilies] = useState<string[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // 이름 입력 → 서명 이미지
  useEffect(() => {
    let alive = true
    const timer = setTimeout(async () => {
      const name = s.name.trim()
      if (!name) return setTyped(null)
      const { family, weight } = resolveFont({ font: s.font, family: s.family })
      await ensureFont(family, weight, name)
      if (!alive) return
      const canvas = renderTextCanvas(name, family, weight, true)
      setTyped(canvas ? { src: canvas.toDataURL('image/png'), aspect: canvas.width / canvas.height, name } : null)
    }, 150)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [s.name, s.font, s.family])

  // 직접 쓴 획 → 서명 이미지
  useEffect(() => {
    const timer = setTimeout(() => {
      const canvas = strokesToCanvas(strokes, penStyle(s.penWidth))
      setDrawn(canvas ? { src: canvas.toDataURL('image/png'), aspect: canvas.width / canvas.height, name: '직접 쓴 서명' } : null)
    }, 120)
    return () => clearTimeout(timer)
  }, [strokes, s.penWidth])

  // 올린 이미지 → 배경 지우기
  useEffect(() => {
    if (!upload) {
      setUploaded(null)
      setUploadEmpty(false)
      return
    }
    const timer = setTimeout(() => {
      const copy = makeCanvas(upload.canvas.width, upload.canvas.height)
      const ctx = ctx2d(copy, true)
      ctx.drawImage(upload.canvas, 0, 0)
      if (s.removeWhite) {
        const image = ctx.getImageData(0, 0, copy.width, copy.height)
        whiteToAlpha(image.data, 250 - s.whiteStrength * 1.3)
        ctx.putImageData(image, 0, 0)
      }
      const trimmed = trimCanvas(copy, 2)
      setUploadEmpty(!trimmed)
      setUploaded(trimmed ? { src: trimmed.toDataURL('image/png'), aspect: trimmed.width / trimmed.height, name: upload.name } : null)
    }, 120)
    return () => clearTimeout(timer)
  }, [upload, s.removeWhite, s.whiteStrength])

  // 도장
  useEffect(() => {
    let alive = true
    const timer = setTimeout(async () => {
      const chars = sealChars(s.sealText, s.sealAppendIn)
      if (!chars.length) return setSeal(null)
      const font = SEAL_FONT_CHOICES.find((f) => f.id === s.sealFont) ?? SEAL_FONT_CHOICES[0]
      await ensureFont(font.family, font.weight, chars.join(''))
      if (!alive) return
      const canvas = drawSeal({ text: s.sealText, shape: s.sealShape, appendIn: s.sealAppendIn, fontFamily: font.family, fontWeight: font.weight, border: s.sealBorder / 100, worn: s.sealWorn })
      setSeal(canvas ? { src: canvas.toDataURL('image/png'), aspect: 1, name: `${s.sealText.trim()} 도장` } : null)
    }, 150)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [s.sealText, s.sealShape, s.sealAppendIn, s.sealFont, s.sealBorder, s.sealWorn])

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('이미지 파일(PNG·JPG)을 골라 주세요.')
    if (file.size > MAX_UPLOAD_BYTES) return toast.error('서명 이미지는 20MB 이하로 올려 주세요.')
    setUploadBusy(true)
    try {
      const canvas = limitCanvas(await fileToCanvas(file), 1600)
      setUpload({ canvas, name: stripExt(file.name) })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이미지를 열지 못했습니다.')
    } finally {
      setUploadBusy(false)
    }
  }

  const loadLocalFonts = async () => {
    const list = await queryLocalFamilies()
    if (!list || !list.length) return toast.info('글꼴 목록을 읽을 수 없습니다. 글꼴 이름을 직접 입력해 주세요.')
    setFamilies(list)
    if (!s.family || !list.includes(s.family)) set({ family: list.includes('맑은 고딕') ? '맑은 고딕' : list[0] })
  }

  const current: { base: Base | null; tint: string | null; kind: AssetKind; label: string; empty: string } =
    s.mode === 'type'
      ? { base: typed, tint: s.inkColor, kind: 'sign', label: '서명', empty: '이름을 입력하면 서명이 만들어집니다' }
      : s.mode === 'draw'
        ? { base: drawn, tint: s.inkColor, kind: 'sign', label: '서명', empty: '위 칸에 서명을 쓰면 여기에 보입니다' }
        : s.mode === 'image'
          ? { base: uploaded, tint: s.mono ? s.monoColor : null, kind: 'image', label: '이미지 서명', empty: '종이에 쓴 서명이나 도장 사진을 올려 주세요' }
          : { base: seal, tint: s.sealColor, kind: 'seal', label: '도장', empty: '이름을 입력하면 도장이 만들어집니다' }

  const asset: Asset | null = current.base ? { src: current.base.src, aspect: current.base.aspect, tint: current.tint, kind: current.kind, label: current.label } : null
  const assetKey = asset ? `${asset.tint}|${asset.src.length}|${asset.src.slice(-48)}` : ''
  const latestAsset = useRef(asset)
  latestAsset.current = asset
  useEffect(() => {
    onCurrent(latestAsset.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetKey])

  return (
    <Section title="서명 만들기">
      <Segmented
        label="서명 만드는 방법"
        block
        size="sm"
        value={s.mode}
        onValue={(mode) => set({ mode })}
        options={[
          { value: 'type', label: '이름 입력' },
          { value: 'draw', label: '직접 쓰기' },
          { value: 'image', label: '이미지' },
          { value: 'seal', label: '도장' },
        ]}
      />

      {s.mode === 'type' && (
        <>
          <Field label="이름">{(id) => <TextInput id={id} value={s.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 홍길동" maxLength={40} />}</Field>
          <Field label="글꼴">{(id) => <Select id={id} value={s.font} onValue={(font) => set({ font })} options={FONT_CHOICES.map((f) => ({ value: f.id, label: f.label }))} />}</Field>
          {s.font === 'local' &&
            (families ? (
              <Field label="내 PC 글꼴">{(id) => <Select id={id} value={s.family} onValue={(family) => set({ family })} options={families.map((f) => ({ value: f, label: f }))} />}</Field>
            ) : (
              <Field label="글꼴 이름" hint="PC 에 설치된 글꼴 이름을 그대로 적습니다. 없는 글꼴이면 기본 글꼴로 보입니다.">
                {(id) => (
                  <div className="flex gap-2">
                    <TextInput id={id} value={s.family} onChange={(e) => set({ family: e.target.value })} placeholder="예: 궁서" maxLength={60} />
                    {canQueryLocalFonts() && (
                      <Button icon={Type} onClick={loadLocalFonts} className="shrink-0">
                        목록 불러오기
                      </Button>
                    )}
                  </div>
                )}
              </Field>
            ))}
          <InkColorField label="색" value={s.inkColor} onValue={(inkColor) => set({ inkColor })} />
        </>
      )}

      {s.mode === 'draw' && (
        <>
          <DrawPad strokes={strokes} onChange={setStrokes} style={penStyle(s.penWidth)} color={s.inkColor} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={Undo2} disabled={!strokes.length} onClick={() => setStrokes((prev) => prev.slice(0, -1))}>
              한 획 취소
            </Button>
            <Button size="sm" variant="ghost" icon={Eraser} disabled={!strokes.length} onClick={() => setStrokes([])}>
              모두 지우기
            </Button>
          </div>
          <Field label="펜 굵기" aside={s.penWidth}>
            {(id) => <Slider id={id} min={1} max={10} value={s.penWidth} onValue={(penWidth) => set({ penWidth })} />}
          </Field>
          <InkColorField label="색" value={s.inkColor} onValue={(inkColor) => set({ inkColor })} />
        </>
      )}

      {s.mode === 'image' && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            hidden
            onChange={(e) => {
              void pickImage(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={ImageUp} loading={uploadBusy} onClick={() => fileInput.current?.click()}>
              {upload ? '다른 이미지 선택' : '서명 이미지 선택'}
            </Button>
            {upload && <span className="min-w-0 flex-1 truncate text-sm text-muted">{upload.name}</span>}
          </div>
          <Switch checked={s.removeWhite} onChange={(removeWhite) => set({ removeWhite })} label="흰 배경 투명하게" hint="종이에 쓴 서명 사진에서 종이 부분을 지웁니다." />
          {s.removeWhite && (
            <Field label="지우는 정도" aside={`${s.whiteStrength}%`} hint="배경이 남으면 올리고, 글씨가 흐려지면 내립니다.">
              {(id) => <Slider id={id} min={0} max={100} step={5} value={s.whiteStrength} onValue={(whiteStrength) => set({ whiteStrength })} />}
            </Field>
          )}
          <Switch checked={s.mono} onChange={(mono) => set({ mono })} label="한 가지 색으로 바꾸기" />
          {s.mono && <InkColorField label="색" value={s.monoColor} onValue={(monoColor) => set({ monoColor })} />}
          {uploadEmpty && <Callout tone="warn">배경을 지우고 나니 남은 부분이 없습니다. 지우는 정도를 낮춰 주세요.</Callout>}
        </>
      )}

      {s.mode === 'seal' && (
        <>
          <Field label="도장에 넣을 이름" hint={`최대 ${SEAL_MAX_CHARS}자. 세로로, 오른쪽 줄부터 놓입니다.`}>
            {(id) => <TextInput id={id} value={s.sealText} onChange={(e) => set({ sealText: e.target.value })} placeholder="예: 홍길동" maxLength={SEAL_MAX_CHARS} />}
          </Field>
          <Segmented
            label="도장 모양"
            block
            size="sm"
            value={s.sealShape}
            onValue={(sealShape) => set({ sealShape })}
            options={[
              { value: 'round', label: '원형' },
              { value: 'square', label: '사각' },
            ]}
          />
          <Switch checked={s.sealAppendIn} onChange={(sealAppendIn) => set({ sealAppendIn })} label="끝에 '인' 붙이기" hint="세 글자 이름이 네 글자가 되어 2×2 로 놓입니다." />
          <Field label="글꼴">{(id) => <Select id={id} value={s.sealFont} onValue={(sealFont) => set({ sealFont })} options={SEAL_FONT_CHOICES.map((f) => ({ value: f.id, label: f.label }))} />}</Field>
          <Field label="테두리 굵기" aside={s.sealBorder}>
            {(id) => <Slider id={id} min={2} max={9} value={s.sealBorder} onValue={(sealBorder) => set({ sealBorder })} />}
          </Field>
          <Switch checked={s.sealWorn} onChange={(sealWorn) => set({ sealWorn })} label="인주가 덜 묻은 느낌" />
          <InkColorField label="색" value={s.sealColor} onValue={(sealColor) => set({ sealColor })} />
        </>
      )}

      <div className={clsx('flex h-28 items-center justify-center rounded-md border border-line-strong p-3', asset ? 'checker' : 'bg-sunken')} aria-label="미리보기">
        {asset ? <AssetView src={asset.src} tint={asset.tint} contain /> : <p className="text-center text-sm text-muted">{current.empty}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={Plus} disabled={!asset || !canPlace} onClick={() => asset && onPlace(asset)}>
          문서에 넣기
        </Button>
        <Button variant="ghost" icon={BookmarkPlus} disabled={!asset} onClick={() => asset && current.base && onSaveMine(asset, current.base.name)}>
          내 서명에 저장
        </Button>
      </div>
      {!canPlace && <p className="-mt-1 text-sm text-muted">문서를 열면 바로 넣을 수 있습니다. 미리 만들어 "내 서명"에 저장해 둘 수도 있습니다.</p>}
    </Section>
  )
}
