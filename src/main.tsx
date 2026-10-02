import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles/app.css'

// 새 버전이 배포되면 예전 화면이 찾던 파일 이름이 바뀌어 도구를 열 때 불러오기에 실패한다.
// 그때는 한 번만 새로고침해 새 버전을 받는다(무한 새로고침 방지를 위해 1분에 한 번).
function reloadForNewVersion() {
  const key = 'onbijjang:reloaded-at'
  const last = Number(sessionStorage.getItem(key) ?? 0)
  if (Date.now() - last < 60_000) return false
  sessionStorage.setItem(key, String(Date.now()))
  location.reload()
  return true
}
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForNewVersion()) event.preventDefault()
})
;(window as unknown as { __onbijjangReload: () => boolean }).__onbijjangReload = reloadForNewVersion

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
