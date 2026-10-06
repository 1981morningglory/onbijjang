import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { ToastViewport } from '@/ui'
import { Admin } from './Admin'
import { useSite } from './config'
import { useViewerStore } from './viewer'
import { Home } from './Home'
import { Shell } from './Shell'
import { ToolPage } from './ToolPage'

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
