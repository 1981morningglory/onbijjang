import { Download, FileUp, Plus, Stamp, Trash2, Upload, UserPlus } from 'lucide-react'
import { useRef, useState } from 'react'
import { downloadBlob } from '@/lib/files'
import { Badge, Button, Callout, Checkbox, Dialog, EmptyState, Field, IconButton, Spinner, Tabs, TextInput, toast } from '@/ui'
import { cleanSeal, fileToAttachment, hasOwnData, kitFromFile, kitToBlob, useKit } from './kit'
import { uid, type Company, type CompanyKit, type Contact } from './model'

type Tab = 'company' | 'seal' | 'docs' | 'contacts' | 'share'

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

export function KitDialog({ open, onClose, initialTab = 'company' }: { open: boolean; onClose: () => void; initialTab?: Tab }) {
  const kit = useKit((s) => s.kit)
  const update = useKit((s) => s.update)
  const replace = useKit((s) => s.replace)
  const team = useKit((s) => s.team)
  const ownData = useKit((s) => hasOwnData(s.local))
  const resetToTeam = useKit((s) => s.useTeamDefaults)
  const teamContactIds = new Set(team?.contacts.map((c) => c.id) ?? [])
  const [tab, setTab] = useState<Tab>(initialTab)
  const [busy, setBusy] = useState<string | null>(null)
  const [recolor, setRecolor] = useState(true)
  const setCompany = (patch: Partial<Company>) => update((k) => ({ ...k, company: { ...k.company, ...patch } }))

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '처리하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const addSeal = (file: File, clean: boolean) =>
    run('seal', async () => {
      if (file.size > 15 * 1024 * 1024) throw new Error('15MB 이하 이미지를 올려 주세요.')
      const { readAsDataURL } = await import('@/lib/files')
      const dataUrl = clean ? await cleanSeal(file, recolor) : await readAsDataURL(file)
      update((k) => ({ ...k, seals: [...k.seals, { id: uid(), name: `직인 ${k.seals.length + 1}`, dataUrl }] }))
      toast.success(clean ? '배경을 지운 직인을 추가했습니다.' : '직인 이미지를 추가했습니다.')
    })

  const setDoc = (kind: 'registration' | 'bankbook', file: File) =>
    run(kind, async () => {
      if (file.size > 20 * 1024 * 1024) throw new Error('20MB 이하 파일을 올려 주세요.')
      const a = await fileToAttachment(file)
      update((k) => ({ ...k, [kind]: a }))
      toast.success(kind === 'registration' ? '사업자등록증을 저장했습니다.' : '통장 사본을 저장했습니다.')
    })

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="회사 자료 설정" footer={<Button variant="primary" onClick={onClose}>닫기</Button>}>
      {team && !ownData ? (
        <Callout tone="success" className="mb-4" title="팀 기본 회사 자료를 쓰고 있습니다">
          관리자가 올린 자료입니다. 여기서 고치면 이 브라우저에만 따로 저장되고, 팀 자료는 바뀌지 않습니다. 담당자는 팀 담당자에 내 담당자를 더해 쓸 수 있습니다.
        </Callout>
      ) : team ? (
        <Callout tone="warn" className="mb-4" title="이 브라우저에서 고친 회사 자료를 쓰고 있습니다">
          팀 기본 자료 대신 이 브라우저 자료가 문서에 들어갑니다.
          <div className="mt-2">
            <Button size="sm" onClick={resetToTeam}>
              팀 기본 자료로 되돌리기
            </Button>
          </div>
        </Callout>
      ) : (
        <Callout tone="info" className="mb-4">
          여기 넣은 자료(직인·통장 사본 포함)는 <b>이 브라우저에만</b> 저장됩니다. 팀 모두가 쓰게 하려면 ‘파일로 주고받기’에서 파일로 내보낸 뒤 관리자 화면 ‘회사 자료’에 올리세요.
        </Callout>
      )}
      <Tabs
        label="회사 자료"
        value={tab}
        onValue={setTab}
        className="mb-4"
        tabs={[
          { value: 'company', label: '회사 정보' },
          { value: 'seal', label: '직인' },
          { value: 'docs', label: '사업자등록증·통장' },
          { value: 'contacts', label: '담당자' },
          { value: 'share', label: '파일로 주고받기' },
        ]}
      />

      {tab === 'company' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {COMPANY_FIELDS.map(([key, label, ph]) => (
            <Field key={key} label={label} className={key === 'address' ? 'sm:col-span-2' : undefined}>
              {(id) => <TextInput id={id} value={kit.company[key]} placeholder={ph} maxLength={120} onChange={(e) => setCompany({ [key]: e.target.value })} />}
            </Field>
          ))}
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
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                  <FilePick accept="image/*,.pdf,application/pdf" icon={FileUp} onFile={(f) => setDoc(kind, f)}>
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

      {tab === 'contacts' && (
        <div className="flex flex-col gap-3">
          {kit.contacts.length === 0 && <EmptyState icon={UserPlus} title="등록된 담당자가 없습니다">미리 넣어 두면 문서를 만들 때 한 번에 골라 넣을 수 있습니다.</EmptyState>}
          {kit.contacts.filter((c) => teamContactIds.has(c.id)).map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{[c.name, c.title].filter(Boolean).join(' ')} · {c.phone || c.email}</span>
              <Badge tone="brand">팀 담당자</Badge>
            </div>
          ))}
          {kit.contacts.filter((c) => !teamContactIds.has(c.id)).map((c) => (
            <ContactEditor
              key={c.id}
              contact={c}
              onChange={(next) => update((k) => ({ ...k, contacts: k.contacts.map((x) => (x.id === c.id ? next : x)) }))}
              onRemove={() => update((k) => ({ ...k, contacts: k.contacts.filter((x) => x.id !== c.id) }))}
            />
          ))}
          <Button icon={UserPlus} className="self-start" disabled={kit.contacts.length >= 30} onClick={() => update((k) => ({ ...k, contacts: [...k.contacts, { id: uid(), name: '', title: '', phone: '', email: '', extras: [] }] }))}>
            담당자 추가
          </Button>
        </div>
      )}

      {tab === 'share' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-2">회사 정보·직인·사업자등록증·통장 사본·담당자를 파일 하나로 내보내고, 다른 PC나 팀원 브라우저에서 불러옵니다. 직인과 통장이 들어 있으니 사내 메신저처럼 믿을 수 있는 곳으로만 보내세요.</p>
          <div className="flex flex-wrap gap-2">
            <Button icon={Download} onClick={() => downloadBlob(kitToBlob(kit), `온비짱_회사자료_${(kit.company.name || '회사').replace(/[\\/:*?"<>|()]/g, '')}.json`)}>
              회사 자료 파일 내보내기
            </Button>
            <FilePick
              accept=".json,application/json"
              icon={Upload}
              onFile={(f) =>
                run('import', async () => {
                  const next: CompanyKit = await kitFromFile(f)
                  replace(next)
                  toast.success(`${next.company.name || '회사'} 자료를 불러왔습니다.`)
                })
              }
            >
              회사 자료 파일 불러오기
            </FilePick>
            {busy === 'import' && <Spinner />}
          </div>
          <p className="text-sm text-muted">불러오면 이 브라우저의 지금 회사 자료를 바꿉니다.</p>
        </div>
      )}
    </Dialog>
  )
}
