import { Dices, Gift, Sparkles } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Spinner, Tabs } from '@/ui'
import RaffleTab from './RaffleTab'

const GamesTab = lazy(() => import('./GamesTab'))
const LottoTab = lazy(() => import('./LottoTab'))

type Tab = 'raffle' | 'games' | 'lotto'
const readTab = (): Tab => {
  const t = new URLSearchParams(location.search).get('tab')
  return t === 'games' || t === 'lotto' ? t : 'raffle'
}

/** 추첨 시스템 — 명단 추첨 · 사다리·룰렛·주사위 · 이번 주 로또 추천. 탭은 주소(?tab=)에도 남긴다 */
export default function DrawTool() {
  const [tab, setTab] = useState<Tab>(readTab)
  // 한 번 연 탭은 계속 그려 둔다(다른 탭에 다녀와도 입력·결과가 남게)
  const [opened, setOpened] = useState<Set<Tab>>(() => new Set([readTab()]))
  const change = (t: Tab) => {
    setTab(t)
    setOpened((s) => new Set(s).add(t))
    const u = new URL(location.href)
    if (t === 'raffle') u.searchParams.delete('tab')
    else u.searchParams.set('tab', t)
    history.replaceState(history.state, '', u)
  }
  const fallback = (
    <div className="flex items-center gap-2 text-muted">
      <Spinner /> 불러오는 중
    </div>
  )
  return (
    <div className="flex flex-col gap-5">
      <Tabs
        label="추첨 시스템"
        value={tab}
        onValue={change}
        tabs={[
          { value: 'raffle', label: '명단 추첨', icon: Gift },
          { value: 'games', label: '사다리·룰렛·주사위', icon: Dices },
          { value: 'lotto', label: '이번 주 로또 추천', icon: Sparkles },
        ]}
      />
      <div hidden={tab !== 'raffle'}>
        <RaffleTab />
      </div>
      <div hidden={tab !== 'games'}>{opened.has('games') && <Suspense fallback={fallback}><GamesTab /></Suspense>}</div>
      <div hidden={tab !== 'lotto'}>{opened.has('lotto') && <Suspense fallback={fallback}><LottoTab /></Suspense>}</div>
    </div>
  )
}
