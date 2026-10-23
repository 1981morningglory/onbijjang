import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Spinner, ToastViewport } from '@/ui'
import { Admin } from './Admin'
import { useSite } from './config'
import { useViewerStore } from './viewer'
import { Home } from './Home'
import { Shell } from './Shell'
import { ToolPage } from './ToolPage'

// 공유받은 결과만 보는 화면(메뉴 없이) — 사주·MBTI
const SharedPage = lazy(() => import('@/tools/saju/SharedPage'))
const shared = (
  <Suspense
    fallback={
      <div className="flex min-h-dvh items-center justify-center gap-2 text-muted">
        <Spinner /> 불러오는 중
      </div>
    }
  >
    <SharedPage />
  </Suspense>
)

export function App() {
  const load = useSite((s) => s.load)
  const loadViewer = useViewerStore((s) => s.load)
  useEffect(() => {
    load().catch(() => {})
    void loadViewer()
    // 관리자가 메뉴·권한을 바꾸면 다른 팀원 화면에도 반영되도록 창으로 돌아올 때 다시 읽는다.
    const onFocus = () => {
      load().catch(() => {})
      void loadViewer()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load, loadViewer])
  return (
    <BrowserRouter>
      <Routes>
        <Route path="s/:id" element={shared} />
        <Route path="v/:kind" element={shared} />
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="tools/:id" element={<ToolPage />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ToastViewport />
    </BrowserRouter>
  )
}
