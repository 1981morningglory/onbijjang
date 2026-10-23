import { Brain, ScrollText } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Spinner, Tabs } from '@/ui'
import SajuTab from './SajuTab'
import { mbtiQuery, parseMbtiLink, parseSajuLink } from './share'

const MbtiTab = lazy(() => import('./mbti/MbtiTab'))

type Tab = 'saju' | 'mbti'
/** 예전 긴 공유 주소(/tools/saju?y=…, ?tab=mbti&r=…)는 메뉴 없는 결과 화면으로 옮긴다 */
function oldShareTarget(): string | null {
  const q = new URLSearchParams(location.search)
  if (q.get('tab') === 'mbti') {
    const m = parseMbtiLink(location.search)
    return m ? `/v/mbti?${mbtiQuery(m.type, m.pct)}` : null
  }
  return parseSajuLink(location.search) ? `/v/saju${location.search}` : null
}

const readTab = (): Tab => (new URLSearchParams(location.search).get('tab') === 'mbti' ? 'mbti' : 'saju')

/** 사주·MBTI — 두 탭. 탭은 주소(?tab=mbti)에도 남겨 새로 고쳐도 그대로 */
export default function SajuMbtiTool() {
  const moved = oldShareTarget()
  if (moved) {
    location.replace(moved)
    return null
  }
  return <SajuMbtiTabs />
}

function SajuMbtiTabs() {
  const [tab, setTab] = useState<Tab>(readTab)
  // MBTI 탭은 처음 열 때 불러오고, 그 뒤로는 계속 그려 둔다(검사 중 답이 남게)
  const [mbtiOpened, setMbtiOpened] = useState(tab === 'mbti')
  const change = (t: Tab) => {
    setTab(t)
    if (t === 'mbti') setMbtiOpened(true)
    const u = new URL(location.href)
    if (t === 'mbti') u.searchParams.set('tab', 'mbti')
    else u.searchParams.delete('tab')
    history.replaceState(history.state, '', u)
  }
  return (
    <div className="flex flex-col gap-5">
      <Tabs
        label="사주·MBTI"
        value={tab}
        onValue={change}
        tabs={[
          { value: 'saju', label: '사주풀이', icon: ScrollText },
          { value: 'mbti', label: 'MBTI 성격유형', icon: Brain },
        ]}
      />
      {/* 탭을 오가도 입력·결과가 남게 둘 다 그려 두고 숨긴다 */}
      <div hidden={tab !== 'saju'}>
        <SajuTab />
      </div>
      <div hidden={tab !== 'mbti'}>
        <Suspense
          fallback={
            <div className="flex items-center gap-2 text-muted">
              <Spinner /> 불러오는 중
            </div>
          }
        >
          {mbtiOpened && <MbtiTab />}
        </Suspense>
      </div>
    </div>
  )
}
