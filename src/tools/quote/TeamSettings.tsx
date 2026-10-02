import { Building2, Download, FileUp, KeyRound, Plus, RotateCcw, Save, Stamp, Trash2, Upload, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { downloadBlob } from '@/lib/files'
import { Badge, Button, Callout, Checkbox, EmptyState, Field, IconButton, Panel, Spinner, Tabs, TextInput, toast } from '@/ui'
import { cleanSeal, fileToAttachment, kitFromFile, kitToBlob } from './kit'
import { uid, type Company, type CompanyKit, type Contact } from './model'
import { useTeam } from './team'

export type SettingsSection = 'code' | 'contacts' | 'company'
type KitTab = 'info' | 'seal' | 'docs' | 'share'

const COMPANY_FIELDS: Array<[keyof Company, string, string?]> = [
  ['name', '상호', '예: (주)우리회사'],
  ['ceo', '대표자'],
  ['bizNo', '사업자등록번호', '000-00-00000'],
  ['address', '주소'],
  ['bizType', '업태', '예: 제조·도매'],
  ['bizItem', '종목', '예: 문구류·팬시'],
  ['tel', '전화'],
  ['fax', '팩스'],
  ['email', '대표 이메일'],
  ['slogan', '문서 아래 문구', '예: 믿음이 있는 사회 - 모닝글로리'],
]

function FilePick({ accept, onFile, children, icon = Upload }: { accept: string; onFile: (f: File) => void; children: string; icon?: typeof Upload }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onFile(f)
        }}
      />
      <Button size="sm" icon={icon} onClick={() => ref.current?.click()}>
        {children}
      </Button>
    </>
  )
}

async function attempt(fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '처리하지 못했습니다.')
  }
}

export function TeamSettings({ section, setSection }: { section: SettingsSection; setSection: (s: SettingsSection) => void }) {
  const admin = useTeam((s) => s.admin)
  return (
    <div className="flex flex-col gap-4">
      <Tabs
          label="팀 설정"
          value={section}
          onValue={setSection}
          tabs={[
            { value: 'company', label: '회사 자료' },
            { value: 'contacts', label: '담당자' },
            { value: 'code', label: '팀 코드' },
          ]}
      />
      {section === 'code' && <CodeSection admin={admin} />}
      {section === 'contacts' && <ContactsSection />}
      {section === 'company' && <CompanySection />}
    </div>
  )
}

// ── 팀 코드 ───────────────────────────────────────────────
function CodeSection({ admin }: { admin: boolean }) {
  const team = useTeam((s) => s.team)
  const changeCode = useTeam((s) => s.changeCode)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const mismatch = again !== '' && next !== again
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (next.trim().length < 4) return toast.error('새 팀 코드는 4자 이상으로 정해 주세요.')
    if (next !== again) return toast.error('새 팀 코드 두 번이 서로 다릅니다.')
    setBusy(true)
    void attempt(async () => {
      await changeCode(current, next.trim())
      setCurrent('')
      setNext('')
      setAgain('')
      toast.success('팀 코드를 바꿨습니다. 팀원에게 새 코드를 알려 주세요.')
    }).finally(() => setBusy(false))
  }
  return (
    <Panel className="max-w-xl p-5">
      <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
        <KeyRound className="size-5 text-brand" aria-hidden /> {team?.name} 팀 코드 바꾸기
      </h3>
      <p className="mt-1 text-sm text-ink-2">
        관리자에게 받은 처음 코드를 우리 팀만 아는 코드로 바꾸세요. 바꾸면 <b>다른 브라우저에 들어와 있던 팀원은 모두 나가게 되고</b>, 새 코드로 다시 들어와야 합니다.
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        {admin ? (
          <Callout tone="info">관리자로 들어와 있어 지금 코드 없이 바꿀 수 있습니다.</Callout>
        ) : (
          <Field label="지금 팀 코드">{(id) => <TextInput id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}</Field>
        )}
        <Field label="새 팀 코드" hint="4~40자. 다른 팀과 같은 코드는 쓸 수 없습니다.">
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" minLength={4} maxLength={40} value={next} onChange={(e) => setNext(e.target.value)} required />}
        </Field>
        <Field label="새 팀 코드 한 번 더" error={mismatch ? '위와 다릅니다' : undefined}>
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" maxLength={40} value={again} onChange={(e) => setAgain(e.target.value)} required />}
        </Field>
        <Button type="submit" variant="primary" icon={KeyRound} loading={busy} className="self-start">
          팀 코드 바꾸기
        </Button>
      </form>
    </Panel>
  )
}

// ── 담당자 ────────────────────────────────────────────────
function ContactEditor({ contact, onChange, onRemove }: { contact: Contact; onChange: (c: Contact) => void; onRemove: () => void }) {
  const set = (patch: Partial<Contact>) => onChange({ ...contact, ...patch })
  return (
    <div className="rounded-lg border border-line bg-paper p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-semibold text-ink">{contact.name || '이름 없는 담당자'}</p>
        <IconButton icon={Trash2} label={`${contact.name || '담당자'} 삭제`} size="sm" onClick={onRemove} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="성명">{(id) => <TextInput id={id} value={contact.name} onChange={(e) => set({ name: e.target.value })} maxLength={30} />}</Field>
        <Field label="직함">{(id) => <TextInput id={id} value={contact.title} onChange={(e) => set({ title: e.target.value })} placeholder="예: 과장" maxLength={20} />}</Field>
        <Field label="직통번호">{(id) => <TextInput id={id} value={contact.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" maxLength={30} />}</Field>
        <Field label="이메일">{(id) => <TextInput id={id} value={contact.email} onChange={(e) => set({ email: e.target.value })} inputMode="email" maxLength={80} />}</Field>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {contact.extras.map((x, i) => (
          <div key={i} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-2">
            <TextInput aria-label="항목 이름" value={x.label} placeholder="항목 (예: 휴대폰)" maxLength={12} onChange={(e) => set({ extras: contact.extras.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} />
            <TextInput aria-label="내용" value={x.value} maxLength={60} onChange={(e) => set({ extras: contact.extras.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) })} />
            <IconButton icon={Trash2} label="항목 삭제" size="sm" onClick={() => set({ extras: contact.extras.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={Plus} className="self-start" disabled={contact.extras.length >= 6} onClick={() => set({ extras: [...contact.extras, { label: '', value: '' }] })}>
          기타 항목 추가 (휴대폰·팩스·카톡 등)
        </Button>
      </div>
    </div>
  )
}

function ContactsSection() {
  const saved = useTeam((s) => s.contacts)
  const saveContacts = useTeam((s) => s.saveContacts)
  const [list, setList] = useState<Contact[]>(saved)
  const [busy, setBusy] = useState(false)
  useEffect(() => setList(saved), [saved])
  const dirty = JSON.stringify(list) !== JSON.stringify(saved)
  const save = () => {
    setBusy(true)
    void attempt(async () => {
      await saveContacts(list.filter((c) => c.name.trim() || c.phone.trim() || c.email.trim()))
      toast.success('팀 담당자를 저장했습니다.')
    }).finally(() => setBusy(false))
  }
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-sm text-ink-2">팀원 모두가 같은 담당자 목록을 씁니다. 문서를 만들 때 담당자를 골라 한 번에 넣고 뺄 수 있고, 고른 담당자가 문서함의 ‘작성자’로 남습니다.</p>
      {list.length === 0 && <EmptyState icon={UserPlus} title="등록된 담당자가 없습니다">성명·직통번호·이메일과 휴대폰 같은 기타 항목을 넣어 두세요.</EmptyState>}
      {list.map((c) => (
        <ContactEditor key={c.id} contact={c} onChange={(next) => setList((l) => l.map((x) => (x.id === c.id ? next : x)))} onRemove={() => setList((l) => l.filter((x) => x.id !== c.id))} />
      ))}
      <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/95 p-2 shadow-sm backdrop-blur">
        <Button icon={UserPlus} disabled={list.length >= 30} onClick={() => setList((l) => [...l, { id: uid(), name: '', title: '', phone: '', email: '', extras: [] }])}>
          담당자 추가
        </Button>
        <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>
          팀 담당자 저장
        </Button>
        {dirty && <Badge tone="warn">저장 전</Badge>}
      </div>
    </div>
  )
}

// ── 회사 자료 ─────────────────────────────────────────────
function CompanySection() {
  const team = useTeam((s) => s.team)
  const savedKit = useTeam((s) => s.kit)
  const source = useTeam((s) => s.kitSource)
  const saveTeamKit = useTeam((s) => s.saveTeamKit)
  const useCommonKit = useTeam((s) => s.useCommonKit)
  const [kit, setKit] = useState<CompanyKit>(savedKit)
  const [tab, setTab] = useState<KitTab>('info')
  const [busy, setBusy] = useState<string | null>(null)
  const [recolor, setRecolor] = useState(true)
  useEffect(() => setKit(savedKit), [savedKit])
  const strip = (k: CompanyKit) => JSON.stringify({ ...k, contacts: [] })
  const dirty = strip(kit) !== strip(savedKit)
  const update = (fn: (k: CompanyKit) => CompanyKit) => setKit(fn)
  const setCompany = (patch: Partial<Company>) => update((k) => ({ ...k, company: { ...k.company, ...patch } }))

  const run = (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    void attempt(fn).finally(() => setBusy(null))
  }
  const addSeal = (file: File, clean: boolean) =>
    run('seal', async () => {
      if (file.size > 15 * 1024 * 1024) throw new Error('15MB 이하 이미지를 올려 주세요.')
      const { readAsDataURL } = await import('@/lib/files')
      const dataUrl = clean ? await cleanSeal(file, recolor) : await readAsDataURL(file)
      update((k) => ({ ...k, seals: [...k.seals, { id: uid(), name: `직인 ${k.seals.length + 1}`, dataUrl }] }))
      toast.success(clean ? '배경을 지운 직인을 추가했습니다. 아래에서 저장하세요.' : '직인 이미지를 추가했습니다. 아래에서 저장하세요.')
    })
  const setAttachment = (kind: 'registration' | 'bankbook', file: File) =>
    run(kind, async () => {
      if (file.size > 20 * 1024 * 1024) throw new Error('20MB 이하 파일을 올려 주세요.')
      const a = await fileToAttachment(file)
      update((k) => ({ ...k, [kind]: a }))
    })

  return (
    <div className="flex flex-col gap-4">
      {source === 'team' ? (
        <Callout tone="info" title={`${team?.name} 팀 전용 회사 자료를 쓰고 있습니다`}>
          이 팀의 문서에는 아래 자료가 들어갑니다. 회사 공통 자료(관리자가 올린 자료)로 돌아가려면 되돌리기를 누르세요.
          <div className="mt-2">
            <Button
              size="sm"
              icon={RotateCcw}
              loading={busy === 'common'}
              onClick={() => {
                if (confirm('팀 전용 회사 자료를 지우고 회사 공통 자료를 쓸까요?')) run('common', async () => (await useCommonKit(), toast.success('회사 공통 자료로 되돌렸습니다.')))
              }}
            >
              회사 공통 자료로 되돌리기
            </Button>
          </div>
        </Callout>
      ) : source === 'common' ? (
        <Callout tone="success" title="회사 공통 자료를 쓰고 있습니다">
          관리자가 올린 자료가 모든 팀 문서에 들어갑니다. 여기서 고쳐 저장하면 <b>이 팀에만</b> 따로 적용됩니다.
        </Callout>
      ) : (
        <Callout tone="warn" title="아직 회사 자료가 없습니다">
          상호·직인·사업자등록증·통장 사본을 넣고 저장하면 이 팀 문서에 자동으로 들어갑니다. 받은 ‘회사 자료 파일’이 있으면 ‘파일로 주고받기’에서 불러오세요.
        </Callout>
      )}

      <Tabs
        label="회사 자료"
        value={tab}
        onValue={setTab}
        tabs={[
          { value: 'info', label: '회사 정보' },
          { value: 'seal', label: '직인' },
          { value: 'docs', label: '사업자등록증·통장' },
          { value: 'share', label: '파일로 주고받기' },
        ]}
      />

      <Panel className="p-4">
        {tab === 'info' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {COMPANY_FIELDS.map(([key, label, ph]) => (
              <Field key={key} label={label} className={key === 'address' || key === 'slogan' ? 'sm:col-span-2' : undefined} hint={key === 'slogan' ? '거래명세표(출고 양식) 맨 아래 왼쪽에 들어갑니다.' : undefined}>
                {(id) => <TextInput id={id} value={kit.company[key]} placeholder={ph} maxLength={120} onChange={(e) => setCompany({ [key]: e.target.value })} />}
              </Field>
            ))}
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-paper p-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">회사 로고</p>
                <span className="text-xs text-muted">거래명세표(출고 양식) 맨 아래 오른쪽에 들어갑니다. 배경이 투명한 PNG 가 가장 깔끔합니다.</span>
              </div>
              {kit.logo ? (
                <div className="checker flex h-20 items-center justify-center rounded-md border border-line p-2">
                  <img src={kit.logo} alt="회사 로고" className="max-h-full max-w-full" />
                </div>
              ) : (
                <p className="py-3 text-center text-sm text-muted">아직 없습니다. 없으면 상호를 글자로 넣습니다.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <FilePick
                  accept="image/png,image/webp,image/jpeg"
                  icon={FileUp}
                  onFile={(f) =>
                    run('logo', async () => {
                      if (f.size > 5 * 1024 * 1024) throw new Error('5MB 이하 이미지를 올려 주세요.')
                      const { readAsDataURL } = await import('@/lib/files')
                      const logo = await readAsDataURL(f)
                      update((k) => ({ ...k, logo }))
                    })
                  }
                >
                  {kit.logo ? '로고 바꾸기' : '로고 올리기'}
                </FilePick>
                {kit.logo && (
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => update((k) => ({ ...k, logo: null }))}>
                    지우기
                  </Button>
                )}
                {busy === 'logo' && <Spinner />}
              </div>
            </div>
          </div>
        )}

        {tab === 'seal' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <FilePick accept="image/*" icon={Stamp} onFile={(f) => addSeal(f, true)}>
                직인 사진 올리기 (배경 자동 지우기)
              </FilePick>
              <FilePick accept="image/png,image/webp" onFile={(f) => addSeal(f, false)}>
                투명 PNG 그대로 올리기
              </FilePick>
              {busy === 'seal' && <Spinner />}
            </div>
            <Checkbox checked={recolor} onChange={setRecolor} label="흐린 인주를 또렷한 붉은색으로 다시 칠하기" />
            {kit.seals.length === 0 ? (
              <EmptyState icon={Stamp} title="등록된 직인이 없습니다">종이에 찍은 직인을 휴대폰으로 찍어 올리면 배경을 지우고 붉은 인주만 남깁니다.</EmptyState>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {kit.seals.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2 rounded-lg border border-line bg-paper p-2">
                    <div className="checker flex aspect-square items-center justify-center rounded-md">
                      <img src={s.dataUrl} alt={s.name} className="max-h-full max-w-full" />
                    </div>
                    <TextInput aria-label="직인 이름" value={s.name} maxLength={20} onChange={(e) => update((k) => ({ ...k, seals: k.seals.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)) }))} />
                    <div className="flex items-center justify-between">
                      <Button size="sm" variant="ghost" icon={Download} onClick={async () => downloadBlob(await (await fetch(s.dataUrl)).blob(), `${s.name}.png`)}>
                        PNG
                      </Button>
                      <IconButton icon={Trash2} label={`${s.name} 삭제`} size="sm" onClick={() => update((k) => ({ ...k, seals: k.seals.filter((x) => x.id !== s.id) }))} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'docs' && (
          <div className="grid gap-4 sm:grid-cols-2">
            {(['registration', 'bankbook'] as const).map((kind) => {
              const a = kit[kind]
              return (
                <div key={kind} className="flex flex-col gap-2 rounded-lg border border-line bg-paper p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{kind === 'registration' ? '사업자등록증' : '통장 사본'}</p>
                    {a && <Badge tone="brand">{a.pdfDataUrl ? `PDF · ${a.pages.length}쪽` : '이미지'}</Badge>}
                  </div>
                  {a ? <img src={a.pages[0]} alt="" className="max-h-56 w-full rounded-sm border border-line bg-white object-contain" /> : <p className="py-6 text-center text-sm text-muted">아직 없습니다</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <FilePick accept="image/*,.pdf,application/pdf" icon={FileUp} onFile={(f) => setAttachment(kind, f)}>
                      {a ? '바꾸기' : '올리기 (PDF·사진)'}
                    </FilePick>
                    {a && (
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => update((k) => ({ ...k, [kind]: null }))}>
                        지우기
                      </Button>
                    )}
                    {busy === kind && <Spinner />}
                  </div>
                </div>
              )
            })}
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
              <Field label="은행">{(id) => <TextInput id={id} value={kit.bank.bankName} onChange={(e) => update((k) => ({ ...k, bank: { ...k.bank, bankName: e.target.value } }))} placeholder="예: 국민은행" />}</Field>
              <Field label="계좌번호">{(id) => <TextInput id={id} value={kit.bank.account} onChange={(e) => update((k) => ({ ...k, bank: { ...k.bank, account: e.target.value } }))} />}</Field>
              <Field label="예금주">{(id) => <TextInput id={id} value={kit.bank.holder} onChange={(e) => update((k) => ({ ...k, bank: { ...k.bank, holder: e.target.value } }))} />}</Field>
            </div>
            <p className="text-sm text-muted sm:col-span-2">계좌를 적어 두면 통장 사본을 붙일 때 문서 아래에 ‘입금 계좌’ 한 줄이 함께 들어갑니다.</p>
          </div>
        )}

        {tab === 'share' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-2">회사 정보·직인·사업자등록증·통장 사본을 파일 하나로 내보내거나, 받은 파일을 불러옵니다. 직인과 통장이 들어 있으니 믿을 수 있는 곳으로만 보내세요.</p>
            <div className="flex flex-wrap gap-2">
              <Button icon={Download} onClick={() => downloadBlob(kitToBlob({ ...kit, contacts: [] }), `온비짱_회사자료_${(kit.company.name || '회사').replace(/[\\/:*?"<>|()]/g, '')}.json`)}>
                회사 자료 파일 내보내기
              </Button>
              <FilePick
                accept=".json,application/json"
                icon={Upload}
                onFile={(f) =>
                  run('import', async () => {
                    const next = await kitFromFile(f)
                    setKit({ ...next, contacts: kit.contacts })
                    toast.success(`${next.company.name || '회사'} 자료를 불러왔습니다. 아래에서 저장하세요.`)
                  })
                }
              >
                회사 자료 파일 불러오기
              </FilePick>
              {busy === 'import' && <Spinner />}
            </div>
          </div>
        )}
      </Panel>

      <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/95 p-2 shadow-sm backdrop-blur">
        <Button variant="primary" icon={Building2} loading={busy === 'save'} disabled={!dirty || !!busy} onClick={() => run('save', async () => (await saveTeamKit(kit), toast.success(`${team?.name} 팀 회사 자료로 저장했습니다.`)))}>
          팀 회사 자료로 저장
        </Button>
        <Button icon={RotateCcw} disabled={!dirty || !!busy} onClick={() => setKit(savedKit)}>
          고친 것 취소
        </Button>
        {dirty && <Badge tone="warn">저장 전</Badge>}
      </div>
    </div>
  )
}
