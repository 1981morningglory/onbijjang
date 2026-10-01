import clsx from 'clsx'
import { ClipboardPaste, Copy, FileDown, NotebookPen, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { downloadBlob, todayStamp } from '@/lib/files'
import { fmt, usePersistentState } from '@/lib/hooks'
import { Button, Callout, Checkbox, EmptyState, Field, NumberInput, Panel, Section, Segmented, Slider, Switch, TextInput, Textarea, toast } from '@/ui'
import {
  DEFAULT_BANNED, DEFAULT_CLEAN, MAX_KEYWORDS, WRAP_MAX, WRAP_MIN, activeBanned, cleanText, countStats, formatReadTime, highlightSegments, keywordReport, parseKeywords, parseWordList, scanBanned,
  toHashtags,
  type BannedWord, type CleanOptions,
} from './logic'

interface Settings extends CleanOptions {
  align: 'center' | 'left'
  /** 키워드 적정 횟수(최소·최대). 최대 0 은 "많음" 검사 안 함 */
  keywordMin: number
  keywordMax: number
  /** 복사·저장할 때 해시태그를 끝에 붙인다 */
  appendTags: boolean
  showKeywords: boolean
  showBanned: boolean
}

const DEFAULT_SETTINGS: Settings = { ...DEFAULT_CLEAN, align: 'center', keywordMin: 3, keywordMax: 10, appendTags: false, showKeywords: true, showBanned: true }
const MAX_SOURCE_CHARS = 200_000
const GROUPS: Array<BannedWord['group']> = ['과장', '의료·효능', '보장']

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-sunken px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="num text-lg font-bold text-ink">{value}</p>
    </div>
  )
}

export default function BlogTool() {
  const [source, setSource] = usePersistentState('onbijjang:blog:source', '')
  const [settings, setSettings] = usePersistentState<Settings>('onbijjang:blog:settings', DEFAULT_SETTINGS)
  const [keywordInput, setKeywordInput] = usePersistentState('onbijjang:blog:keywords', '')
  const [userWords, setUserWords] = usePersistentState<string[]>('onbijjang:blog:banned-user', [])
  const [disabledDefaults, setDisabledDefaults] = usePersistentState<string[]>('onbijjang:blog:banned-off', [])
  const [newWord, setNewWord] = useState('')
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))

  const deferredSource = useDeferredValue(source)
  const cleaned = useMemo(() => cleanText(deferredSource, settings), [deferredSource, settings])
  const stats = useMemo(() => countStats(cleaned), [cleaned])
  const sourceStats = useMemo(() => countStats(deferredSource), [deferredSource])
  const { keywords, dropped } = useMemo(() => parseKeywords(keywordInput), [keywordInput])
  const report = useMemo(() => keywordReport(cleaned, keywords, settings.keywordMin, settings.keywordMax), [cleaned, keywords, settings.keywordMin, settings.keywordMax])
  const banned = useMemo(() => activeBanned(disabledDefaults, userWords), [disabledDefaults, userWords])
  const scan = useMemo(() => scanBanned(cleaned, banned), [cleaned, banned])
  const segments = useMemo(
    () => highlightSegments(cleaned, settings.showKeywords ? keywords : [], settings.showBanned ? scan.ranges : []),
    [cleaned, keywords, scan, settings.showKeywords, settings.showBanned],
  )
  const hashtags = toHashtags(keywords)
  const output = settings.appendTags && hashtags ? `${cleaned}\n\n${hashtags}` : cleaned
  const hitWords = useMemo(() => new Set(scan.hits.map((h) => h.word)), [scan])
  const hasText = cleaned.trim().length > 0
  const lowCount = report.filter((r) => r.status === 'low').length
  const highCount = report.filter((r) => r.status === 'high').length

  const copy = async (text: string, done: string) => {
    if (await copyText(text)) toast.success(done)
    else toast.error('복사하지 못했습니다. 글을 직접 선택해 Ctrl+C 로 복사해 주세요.')
  }
  const pasteSource = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) return toast.info('클립보드에 글이 없습니다.')
      setSource(text.slice(0, MAX_SOURCE_CHARS))
    } catch {
      toast.info('클립보드 접근이 막혀 있습니다. 원문 칸을 누르고 Ctrl+V 로 붙여넣어 주세요.')
    }
  }
  const addWords = () => {
    const words = parseWordList(newWord)
    if (!words.length) return
    const known = new Set([...userWords, ...DEFAULT_BANNED.map((b) => b.word)].map((w) => w.toLowerCase()))
    const fresh = words.filter((w) => !known.has(w.toLowerCase()))
    if (fresh.length) setUserWords([...userWords, ...fresh].slice(0, 300))
    if (fresh.length < words.length) toast.info('이미 목록에 있는 낱말은 넣지 않았습니다.')
    // 꺼 둔 기본 낱말을 다시 입력하면 켠다.
    const reEnable = words.filter((w) => disabledDefaults.includes(w))
    if (reEnable.length) setDisabledDefaults(disabledDefaults.filter((w) => !reEnable.includes(w)))
    setNewWord('')
  }
  const toggleDefault = (word: string) => setDisabledDefaults(disabledDefaults.includes(word) ? disabledDefaults.filter((w) => w !== word) : [...disabledDefaults, word])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* ── 왼쪽: 원문과 정리 옵션 ── */}
        <Panel className="min-w-0">
          <Section
            title="원문"
            hint="원문은 그대로 두고, 오른쪽에 정리한 결과를 보여 줍니다."
            action={
              <div className="flex gap-1">
                <Button size="sm" icon={ClipboardPaste} onClick={pasteSource}>
                  붙여넣기
                </Button>
                <Button size="sm" variant="ghost" icon={Trash2} disabled={!source} onClick={() => setSource('')}>
                  비우기
                </Button>
              </div>
            }
          >
            <Field
              label="본문"
              aside={`${fmt.format(sourceStats.withSpaces)}자`}
              error={source.length >= MAX_SOURCE_CHARS ? `한 번에 ${fmt.format(MAX_SOURCE_CHARS)}자까지 정리합니다. 넘는 부분은 잘렸으니 나눠서 붙여넣어 주세요.` : undefined}
            >
              {(id) => (
                <Textarea
                  id={id}
                  value={source}
                  onChange={(e) => setSource(e.target.value.slice(0, MAX_SOURCE_CHARS))}
                  rows={14}
                  placeholder="블로그에 올릴 글을 여기에 붙여넣으세요."
                  className="min-h-72"
                />
              )}
            </Field>
          </Section>
          <Section title="줄바꿈 정리">
            <Switch checked={settings.mergeShortLines} onChange={(mergeShortLines) => set({ mergeShortLines })} label="짧은 줄 정리" hint="문단 안에서 끊긴 줄을 한 줄로 잇습니다. 빈 줄은 문단 구분으로 남습니다." />
            <Switch checked={settings.wrap} onChange={(wrap) => set({ wrap })} label="줄 너비에 맞춰 나누기" hint="낱말 중간을 자르지 않고 띄어쓰기에서만 줄을 바꿉니다." />
            {settings.wrap && (
              <Field label="줄 너비" aside={`한글 ${settings.wrapWidth}자`} hint="모바일에서 읽기 좋은 너비는 한글 15–20자입니다.">
                {(id) => <Slider id={id} min={WRAP_MIN} max={WRAP_MAX} value={settings.wrapWidth} onValue={(wrapWidth) => set({ wrapWidth })} />}
              </Field>
            )}
          </Section>
          <Section
            title="그 밖의 정리"
            action={
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => set(DEFAULT_CLEAN)}>
                처음 설정으로
              </Button>
            }
          >
            <Switch checked={settings.collapseBlankLines} onChange={(collapseBlankLines) => set({ collapseBlankLines })} label="연속 빈 줄 줄이기" hint="빈 줄이 여러 개 이어지면 하나만 남깁니다." />
            <Switch checked={settings.trimLineEnds} onChange={(trimLineEnds) => set({ trimLineEnds })} label="줄 끝 공백 제거" />
            <Switch checked={settings.normalizeSpaces} onChange={(normalizeSpaces) => set({ normalizeSpaces })} label="전각 공백 변환" hint="넓은 공백과 보이지 않는 특수 공백을 일반 공백으로 바꿉니다." />
            <Switch checked={settings.removeEmoji} onChange={(removeEmoji) => set({ removeEmoji })} label="이모지 제거" />
          </Section>
        </Panel>

        {/* ── 오른쪽: 정리된 본문 ── */}
        <Panel className="min-w-0 lg:sticky lg:top-20">
          <Section
            title="정리된 본문"
            action={
              <Segmented
                label="미리보기 정렬"
                size="sm"
                value={settings.align}
                onValue={(align) => set({ align })}
                options={[
                  { value: 'center', label: '가운데' },
                  { value: 'left', label: '왼쪽' },
                ]}
              />
            }
          >
            {hasText ? (
              <div className="max-h-[60dvh] overflow-y-auto rounded-md border border-line bg-paper px-3 py-5">
                <p className={clsx('mx-auto w-full max-w-[400px] whitespace-pre-wrap leading-loose text-ink', settings.align === 'center' ? 'text-center' : 'text-left')}>
                  {segments.map((s, i) =>
                    s.kind === 'plain' ? (
                      s.text
                    ) : s.kind === 'keyword' ? (
                      <mark key={i} className="rounded-xs bg-mark px-0.5 text-ink">
                        {s.text}
                      </mark>
                    ) : (
                      <mark key={i} className="rounded-xs bg-danger-soft px-0.5 font-semibold text-danger underline decoration-2 underline-offset-4">
                        {s.text}
                      </mark>
                    ),
                  )}
                </p>
              </div>
            ) : (
              <EmptyState icon={NotebookPen} title="아직 정리할 글이 없습니다" className="rounded-md border border-line bg-paper">
                왼쪽 원문 칸에 글을 붙여넣으면 정리된 본문이 여기에 가운데 정렬로 나옵니다.
              </EmptyState>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-2">
              <Checkbox checked={settings.showKeywords} onChange={(showKeywords) => set({ showKeywords })} label={<span className="rounded-xs bg-mark px-1 text-ink">키워드 표시</span>} />
              <Checkbox checked={settings.showBanned} onChange={(showBanned) => set({ showBanned })} label={<span className="rounded-xs bg-danger-soft px-1 font-semibold text-danger">금칙어 표시</span>} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={Copy} disabled={!hasText} onClick={() => copy(output, '정리된 본문을 복사했습니다.')}>
                결과 복사
              </Button>
              <Button icon={FileDown} disabled={!hasText} onClick={() => downloadBlob(new Blob([output], { type: 'text/plain;charset=utf-8' }), `블로그본문_${todayStamp()}.txt`)}>
                TXT 로 저장
              </Button>
              <Checkbox checked={settings.appendTags} onChange={(appendTags) => set({ appendTags })} label="끝에 해시태그 붙이기" disabled={!keywords.length} />
            </div>
          </Section>
          <Section title="글자 수" hint="정리된 본문 기준입니다.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="공백 포함" value={`${fmt.format(stats.withSpaces)}자`} />
              <Stat label="공백 제외" value={`${fmt.format(stats.withoutSpaces)}자`} />
              <Stat label="줄 수" value={`${fmt.format(stats.lines)}줄`} />
              <Stat label="문단 수" value={`${fmt.format(stats.paragraphs)}개`} />
              <Stat label="예상 읽기 시간" value={formatReadTime(stats.readSeconds)} />
            </div>
          </Section>
        </Panel>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* ── 키워드·해시태그 ── */}
        <Panel className="min-w-0">
          <Section title="키워드·해시태그" hint="입력한 키워드가 본문에 몇 번 나오는지 세고, 해시태그로도 만들어 줍니다.">
            <Field
              label="키워드"
              aside={`${keywords.length}/${MAX_KEYWORDS}개`}
              hint="띄어쓰기·쉼표·# 로 구분합니다. 겹치는 것은 한 번만 남깁니다."
              error={dropped > 0 ? `키워드는 ${MAX_KEYWORDS}개까지입니다. 뒤의 ${fmt.format(dropped)}개는 빠졌습니다.` : undefined}
            >
              {(id) => <Textarea id={id} value={keywordInput} onChange={(e) => setKeywordInput(e.target.value.slice(0, 5000))} rows={3} placeholder="예: #봄원피스 신상, 데일리룩" className="min-h-20" />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="적정 횟수 최소">{(id) => <NumberInput id={id} min={0} step={1} value={settings.keywordMin} onValue={(v) => set({ keywordMin: Math.max(0, Math.floor(v ?? 0)) })} unit="회" />}</Field>
              <Field label="적정 횟수 최대">{(id) => <NumberInput id={id} min={0} step={1} value={settings.keywordMax} onValue={(v) => set({ keywordMax: Math.max(0, Math.floor(v ?? 0)) })} unit="회" />}</Field>
              <p className="col-span-2 -mt-1 text-sm text-muted">이 범위를 벗어난 키워드를 표시합니다. 최대를 0 으로 두면 ‘많음’은 보지 않습니다.</p>
            </div>
            {keywords.length === 0 ? (
              <EmptyState title="키워드를 입력하면 횟수를 셉니다" className="py-6!">
                본문에서 키워드가 나온 자리는 노란색으로 표시됩니다.
              </EmptyState>
            ) : (
              <>
                {hasText && (lowCount > 0 || highCount > 0) && (
                  <p className="text-sm text-ink-2">
                    {lowCount > 0 && <span className="font-semibold text-info">적게 쓰인 키워드 {lowCount}개</span>}
                    {lowCount > 0 && highCount > 0 && ' · '}
                    {highCount > 0 && <span className="font-semibold text-warn">많이 쓰인 키워드 {highCount}개</span>}
                  </p>
                )}
                <div className="max-h-72 overflow-auto rounded-md border border-line">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-paper text-left text-muted">
                      <tr>
                        <th className="px-3 py-2 font-semibold">키워드</th>
                        <th className="w-20 px-3 py-2 text-right font-semibold">횟수</th>
                        <th className="w-20 px-3 py-2 font-semibold">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.map((r) => (
                        <tr key={r.keyword} className="border-t border-line">
                          <td className="break-all px-3 py-1.5 text-ink">{r.keyword}</td>
                          <td className="num px-3 py-1.5 text-right font-semibold text-ink">{fmt.format(r.count)}회</td>
                          <td className="px-3 py-1.5">
                            <span className={clsx('inline-flex h-5 items-center rounded-full px-2 text-2xs font-bold', r.status === 'low' ? 'bg-info-soft text-info' : r.status === 'high' ? 'bg-warn-soft text-warn' : 'bg-sunken text-muted')}>
                              {r.status === 'low' ? '적음' : r.status === 'high' ? '많음' : '적정'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold text-ink-2">해시태그</p>
                  <p className="max-h-32 overflow-y-auto break-all rounded-md bg-sunken px-3 py-2 text-sm leading-relaxed text-ink">{hashtags}</p>
                  <Button size="sm" icon={Copy} className="self-start" onClick={() => copy(hashtags, `해시태그 ${keywords.length}개를 복사했습니다.`)}>
                    해시태그 복사
                  </Button>
                </div>
              </>
            )}
          </Section>
        </Panel>

        {/* ── 금칙어 ── */}
        <Panel className="min-w-0">
          <Section title="금칙어 검사" hint="과장·의료·보장 표현처럼 광고 글에서 문제가 되기 쉬운 낱말을 찾습니다. 맥락에 따라 괜찮을 수 있으니 확인용으로 쓰세요.">
            {!hasText ? (
              <EmptyState title="본문을 넣으면 검사합니다" className="py-6!">
                걸린 낱말은 본문에서 붉은색으로 표시됩니다.
              </EmptyState>
            ) : scan.total === 0 ? (
              <Callout tone="success" title="걸린 낱말이 없습니다">
                검사 목록 {banned.length}개 가운데 본문에 나온 것이 없습니다.
              </Callout>
            ) : (
              <>
                <Callout tone="warn" title={`주의할 낱말 ${scan.hits.length}개, 모두 ${fmt.format(scan.total)}번 나옵니다`}>
                  본문에서 붉게 표시된 자리를 확인하고 다른 표현으로 바꿔 보세요.
                </Callout>
                <ul className="flex flex-wrap gap-1.5">
                  {scan.hits.map((h) => (
                    <li key={h.word} className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-sm font-semibold text-danger" title={h.group}>
                      {h.word}
                      <span className="num text-xs font-bold">{h.count}번</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>
          <Section
            title="검사할 낱말"
            hint="기본 낱말은 눌러서 끄거나 켤 수 있습니다. 설정은 이 브라우저에 남습니다."
            action={
              disabledDefaults.length > 0 ? (
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setDisabledDefaults([])}>
                  기본 낱말 모두 켜기
                </Button>
              ) : undefined
            }
          >
            {GROUPS.map((group) => (
              <div key={group} className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold text-muted">{group}</p>
                <div className="flex flex-wrap gap-1.5">
                  {DEFAULT_BANNED.filter((b) => b.group === group).map((b) => {
                    const off = disabledDefaults.includes(b.word)
                    return (
                      <button
                        key={b.word}
                        type="button"
                        aria-pressed={!off}
                        title={off ? '눌러서 다시 검사' : '눌러서 검사에서 빼기'}
                        onClick={() => toggleDefault(b.word)}
                        className={clsx(
                          'inline-flex h-7 items-center rounded-full border px-2.5 text-sm transition-colors duration-150',
                          off ? 'border-line bg-sunken text-faint line-through hover:text-muted' : hitWords.has(b.word) ? 'border-danger/40 bg-danger-soft font-semibold text-danger hover:border-danger' : 'border-line-strong bg-surface text-ink-2 hover:bg-sunken',
                        )}
                      >
                        {b.word}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-muted">내 목록</p>
              {userWords.length === 0 ? (
                <p className="text-sm text-muted">아직 없습니다. 팀에서 쓰지 않기로 한 표현을 아래에 추가하세요.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {userWords.map((w) => (
                    <span key={w} className={clsx('inline-flex h-7 items-center gap-0.5 rounded-full border pl-2.5 pr-1 text-sm', hitWords.has(w) ? 'border-danger/40 bg-danger-soft font-semibold text-danger' : 'border-line-strong bg-surface text-ink-2')}>
                      {w}
                      <button type="button" aria-label={`${w} 삭제`} title="삭제" onClick={() => setUserWords(userWords.filter((x) => x !== w))} className="flex size-5 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-line hover:text-ink">
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-end gap-2">
              <Field label="낱말 추가" hint="쉼표로 여러 개를 한 번에 넣을 수 있습니다." className="min-w-0 flex-1">
                {(id) => <TextInput id={id} value={newWord} onChange={(e) => setNewWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && addWords()} placeholder="예: 강력 추천, 인생템" maxLength={200} />}
              </Field>
            </div>
            <Button size="sm" icon={Plus} className="self-start" disabled={!newWord.trim()} onClick={addWords}>
              내 목록에 추가
            </Button>
          </Section>
        </Panel>
      </div>
    </div>
  )
}
