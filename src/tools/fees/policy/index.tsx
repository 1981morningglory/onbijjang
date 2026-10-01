import { ExternalLink, LockKeyhole, Rocket } from 'lucide-react'
import { Link } from 'react-router'
import { toolPath } from '@/app/registry'
import { fmt, usePersistentState } from '@/lib/hooks'
import { Button, LibraryMenu, Panel, Section, Textarea, ToolLayout, toast } from '@/ui'
import { ROCKET_FREE_MONTHLY, ROCKET_FREE_STORAGE_DAYS, ROCKET_META, ROCKET_SAVER_MONTHLY, ROCKET_SIZES } from '../shared/rates/rocket'

/** 2026-10-01 에 직접 열어 본 쿠팡 공식 페이지만 싣는다. */
const LINKS: Array<{ group: string; items: Array<{ title: string; desc: string; url: string; login?: boolean }> }> = [
  {
    group: '요금·수수료',
    items: [
      { title: '로켓그로스 비용 구성', desc: '판매 수수료, 사이즈별 입출고비·배송비 최저 요금, 보관·반품·반출 무료 조건', url: 'https://marketplace.coupang.com/rocket-growth' },
      { title: '로켓그로스 비용/수수료', desc: '비용 항목만 모아 놓은 안내 페이지', url: 'https://marketplace.coupang.com/rocketgrowth-fee-after-zerocostpromotion' },
      { title: '입출고·배송 요금표', desc: '카테고리·사이즈·판매가별 실제 요금. 마진 계산기에 넣을 금액은 여기서 확인', url: 'https://wing.coupang.com/tenants/rfm/settlements/fee-details', login: true },
      { title: '카테고리별 판매 수수료', desc: '로켓그로스 판매 수수료는 판매자배송과 같은 표를 씁니다', url: 'https://cloud.mkt.coupang.com/Fee-Table' },
      { title: '쿠팡 수수료 부과 기준', desc: '고객이 결제한 최종 가격 기준, 월 서비스 이용료', url: 'https://marketplace.coupang.com/information-center/almyeon-alsurog-deo-joheun-kupang-susuryo-2' },
    ],
  },
  {
    group: '정책·기준',
    items: [
      { title: '사이즈 유형 기준', desc: '세 변의 합과 무게로 극소형~특대형을 나누는 기준', url: 'https://wing.coupang.com/tenants/rfm/settlements/size-guide' },
      { title: '로켓그로스 세이버', desc: '월 구독료, 60일 무료 보관, 반품 회수·재입고비 무료, 빠른 정산 혜택', url: 'https://marketplace.coupang.com/rg-promotion/saverpack-benefit' },
      { title: '쿠팡 마켓플레이스 자주 묻는 질문', desc: '마켓플레이스·로켓그로스·로켓배송의 차이, 정산 방식', url: 'https://marketplace.coupang.com/faq' },
    ],
  },
]

const NOTES: Array<{ title: string; lines: string[] }> = [
  {
    title: '비용이 붙는 곳',
    lines: [
      '판매 수수료는 판매자배송(마켓플레이스)과 같습니다.',
      '기본 비용은 입출고비와 배송비 두 가지이고, 카테고리·사이즈 유형·판매가에 따라 최종 금액이 정해집니다.',
      `보관비는 입고할 때마다 ${ROCKET_FREE_STORAGE_DAYS.base}일 무료입니다. 의류·신발·악세서리는 ${ROCKET_FREE_STORAGE_DAYS.apparelPromo}일까지 무료(프로모션 중).`,
      `반품 회수비는 매달 ${ROCKET_FREE_MONTHLY.returnPickup}건, 반품 재입고비와 반출비는 매달 ${ROCKET_FREE_MONTHLY.returnRestock}개까지 무료(프로모션 중).`,
      '같은 상품 여러 개가 한 번에 반품돼도 반품 회수비는 한 번만 붙습니다.',
      '무료·할인 프로모션이 바뀌면 쿠팡이 미리 공지합니다. 바뀐 내용은 위 공식 페이지에서 다시 확인하세요.',
    ],
  },
  {
    title: '세이버',
    lines: [
      `월 ${fmt.format(ROCKET_SAVER_MONTHLY.value ?? 0)}원. 혜택은 매월 1일 자동으로 이어지고 언제든 해지할 수 있습니다.`,
      `모든 상품 ${ROCKET_FREE_STORAGE_DAYS.saver}일 무료 보관(이미 있는 재고와 새로 입고하는 재고 모두).`,
      '반품 회수비·재입고비가 건수와 상관없이 무료입니다(가입한 뒤 생긴 반품부터).',
      '빠른 정산을 매월 500만 원까지 수수료 없이 쓸 수 있습니다.',
    ],
  },
  {
    title: '사이즈 판정',
    lines: [
      '낱개 포장한 상품의 세 변의 합(가로+세로+높이)과 무게를 함께 봅니다.',
      '둘 중 하나라도 기준을 넘으면 더 큰 유형으로 분류됩니다. 예: 세 변의 합은 극소형인데 무게가 소형이면 소형.',
      '처음 입고할 때 물류센터에서 잰 값으로 최종 유형이 정해집니다.',
      '특대형보다 큰 상품은 입고할 수 없습니다.',
    ],
  },
]

export default function RocketPolicyTool() {
  const [memo, setMemo] = usePersistentState('onbijjang:rocket-policy:memo', '')

  return (
    <ToolLayout
      panelWidth={380}
      panel={
        <>
          <Section
            title="내 메모"
            hint="이 브라우저에만 저장됩니다. 팀과 나누려면 팀 보관함에 저장하세요."
            action={
              <LibraryMenu<{ memo: string }>
                kind="rocket-policy-memo"
                noun="메모"
                size="sm"
                getData={() => (memo.trim() ? { data: { memo } } : null)}
                onLoad={(data, entry) => {
                  if (typeof data?.memo !== 'string') return toast.warn('메모를 읽지 못했습니다.')
                  setMemo(data.memo)
                  toast.success(`‘${entry.name}’ 메모를 불러왔습니다.`)
                }}
              />
            }
          >
            <Textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value.slice(0, 5000))}
              placeholder={'예: 우리 주력 상품은 소형 · 입출고비 ○○원 · 배송비 ○○원\n입고는 매주 화요일, 담당 ○○○'}
              aria-label="내 메모"
              className="min-h-56"
            />
            <div className="flex items-center justify-between gap-2 text-sm text-muted">
              <span className="num">{fmt.format(memo.length)} / 5,000자</span>
              <Button size="sm" variant="ghost" disabled={!memo} onClick={() => setMemo('')}>
                메모 지우기
              </Button>
            </div>
          </Section>
          <Section title="마진 계산">
            <p className="text-sm text-ink-2">요금표에서 확인한 입출고비·배송비를 넣어 상품 1개 마진을 계산합니다.</p>
            <Link
              to={toolPath('rocket-margin')}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-base font-semibold text-ink shadow-1 transition-colors duration-150 hover:border-faint hover:bg-sunken"
            >
              <Rocket className="size-4" aria-hidden />
              로켓그로스 마진 계산기 열기
            </Link>
          </Section>
        </>
      }
    >
      <Panel>
        {LINKS.map((g) => (
          <Section key={g.group} title={`공식 페이지 — ${g.group}`}>
            <ul className="flex flex-col divide-y divide-line">
              {g.items.map((item) => (
                <li key={item.url}>
                  <a href={item.url} target="_blank" rel="noreferrer noopener" className="group flex items-start gap-3 rounded-sm px-1 py-2.5 transition-colors duration-150 hover:bg-sunken">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 font-semibold text-ink group-hover:text-brand-ink">
                        {item.title}
                        {item.login && (
                          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-sunken px-2 text-2xs font-bold text-muted">
                            <LockKeyhole className="size-3" aria-hidden />
                            WING 로그인 필요
                          </span>
                        )}
                      </span>
                      <span className="block text-sm text-muted">{item.desc}</span>
                    </span>
                    <ExternalLink className="mt-1 size-4 shrink-0 text-muted group-hover:text-brand-ink" aria-hidden />
                    <span className="sr-only">새 창에서 열기</span>
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        ))}
      </Panel>

      <Panel>
        <Section title="팀 고정 안내" hint={`쿠팡 공식 페이지에서 ${ROCKET_META.checkedAt} 에 확인한 내용입니다. 프로모션 조건은 바뀔 수 있습니다.`}>
          <div className="flex flex-col gap-4">
            {NOTES.map((n) => (
              <div key={n.title}>
                <h4 className="text-sm font-bold text-ink">{n.title}</h4>
                <ul className="prose-ob mt-1 text-sm">
                  {n.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
        <Section title="사이즈 유형과 공개 최저 요금" hint="최저 요금은 ‘~원부터’로 안내된 값입니다. 배송비는 공식 페이지 두 곳의 숫자가 달라 둘 다 적었습니다.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left text-2xs font-bold text-muted">
                  <th scope="col" className="py-2 pr-3">유형</th>
                  <th scope="col" className="py-2 pr-3 text-right">세 변의 합</th>
                  <th scope="col" className="py-2 pr-3 text-right">무게</th>
                  <th scope="col" className="py-2 pr-3 text-right">입출고비</th>
                  <th scope="col" className="py-2 text-right">배송비</th>
                </tr>
              </thead>
              <tbody>
                {ROCKET_SIZES.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-2 pr-3 text-left font-semibold text-ink">{s.label}</th>
                    <td className="num py-2 pr-3 text-right text-ink-2">{s.maxSumCm}cm 이하</td>
                    <td className="num py-2 pr-3 text-right text-ink-2">{s.maxKg}kg 이하</td>
                    <td className="num py-2 pr-3 text-right text-ink-2">{fmt.format(s.fulfillFrom)}원부터</td>
                    <td className="num py-2 text-right text-ink-2">
                      {fmt.format(s.deliveryFrom[0])}원부터
                      <span className="block text-2xs text-muted">다른 페이지 {fmt.format(s.deliveryFrom[1])}원부터</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </Panel>

      <p className="text-sm text-muted">
        안내 기준: {ROCKET_META.sourceName}, {ROCKET_META.checkedAt} 확인 · 실제 요금과 정산은 WING 에서 다시 확인하세요.
      </p>
    </ToolLayout>
  )
}
