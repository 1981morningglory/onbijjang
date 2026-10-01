import { Crop, Puzzle } from 'lucide-react'
import { useCallback } from 'react'
import { usePersistentState } from '@/lib/hooks'
import { Tabs } from '@/ui'
import { Editor } from './Editor'
import { InstallGuide } from './InstallGuide'

type View = 'install' | 'edit'

/**
 * 웹페이지 전체 캡처 — 확장 프로그램(extension/capture) 설치 안내와, 캡처를 받아 다듬는 편집 화면.
 * 편집 화면은 탭이 가려져 있어도 살아 있어 확장 프로그램·다른 도구가 보낸 이미지를 언제든 받는다.
 */
export default function CaptureTool() {
  const [view, setView] = usePersistentState<View>('onbijjang:capture:view', 'install')
  const openEditor = useCallback(() => setView('edit'), [setView])

  return (
    <div className="flex flex-col gap-5">
      <Tabs
        label="화면 고르기"
        value={view}
        onValue={setView}
        tabs={[
          { value: 'install', label: '확장 프로그램 설치', icon: Puzzle },
          { value: 'edit', label: '캡처 편집', icon: Crop },
        ]}
      />
      {view === 'install' && <InstallGuide onOpenEditor={openEditor} />}
      <Editor active={view === 'edit'} onReceived={openEditor} />
    </div>
  )
}
