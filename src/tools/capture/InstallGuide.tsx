import { AppWindow, Copy, Download, RefreshCw, ScrollText, ShieldCheck, SquareDashedMousePointer, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import manifest from '../../../extension/capture/manifest.json'
import { DEV_ORIGIN, PRODUCTION_ORIGIN } from '../../../extension/capture/lib/settings.js'
import { usePersistentState } from '@/lib/hooks'
import { Badge, Button, Callout, Panel, Segmented, toast } from '@/ui'

type Browser = 'chrome' | 'edge'

const ZIP_NAME = 'onbijjang-capture.zip'
const ZIP_URL = `${import.meta.env.BASE_URL}downloads/${ZIP_NAME}`

/** 브라우저마다 다른 이름들 */
const WORDS: Record<Browser, { name: string; address: string; devMode: string; load: string; reload: string }> = {
  chrome: {
    name: '크롬',
    address: 'chrome://extensions',
    devMode: '오른쪽 위의 "개발자 모드" 스위치를 켭니다.',
    load: '왼쪽 위에 나타난 "압축해제된 확장 프로그램을 로드합니다" 버튼을 누릅니다.',
    reload: '온비짱 캡처 카드의 새로고침(둥근 화살표) 버튼을 누릅니다.',
  },
  edge: {
    name: '엣지',
    address: 'edge://extensions',
    devMode: '왼쪽 아래의 "개발자 모드" 스위치를 켭니다.',
    load: '위쪽에 나타난 "압축 풀린 파일 로드" 버튼을 누릅니다.',
    reload: '온비짱 캡처 카드의 "다시 로드"를 누릅니다.',
  },
}

function downloadZip() {
  const a = document.createElement('a')
  a.href = ZIP_URL
  a.download = ZIP_NAME
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
  } catch {
    toast.info(`복사하지 못했습니다. 직접 적어 주세요: ${text}`)
  }
}

function Address({ value }: { value: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="rounded-xs border border-line bg-sunken px-1.5 py-0.5 font-mono text-sm text-ink">{value}</code>
      <Button size="sm" icon={Copy} onClick={() => copyText(value, '주소를 복사했습니다. 주소창에 붙여넣으세요.')}>
        주소 복사
      </Button>
    </span>
  )
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="border-b border-line py-4 pl-1 last:border-b-0 marker:font-bold marker:text-brand-ink">
      <h3 className="text-base">{title}</h3>
      <div className="mt-1.5 flex flex-col gap-2 text-sm text-ink-2">{children}</div>
    </li>
  )
}

function Mode({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="text-sm text-muted">{children}</p>
      </div>
    </div>
  )
}

/** 확장 프로그램 설치·업데이트·사용 안내 */
export function InstallGuide({ onOpenEditor }: { onOpenEditor: () => void }) {
  const [browser, setBrowser] = usePersistentState<Browser>('onbijjang:capture:browser', 'chrome')
  const words = WORDS[browser]
  const origin = window.location.origin

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel className="px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div className="min-w-0">
            <h2 className="text-lg">확장 프로그램 설치</h2>
            <p className="text-sm text-muted">한 번만 설치하면 됩니다. 3분쯤 걸립니다.</p>
          </div>
          <Segmented
            label="쓰는 브라우저"
            size="sm"
            value={browser}
            onValue={setBrowser}
            options={[
              { value: 'chrome', label: '크롬' },
              { value: 'edge', label: '엣지' },
            ]}
          />
        </div>

        <ol className="list-decimal pl-6">
          <Step title="확장 프로그램 내려받기">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={Download} onClick={downloadZip}>
                확장 프로그램 내려받기
              </Button>
              <Badge tone="brand" className="num">
                v{manifest.version}
              </Badge>
            </div>
            <p className="text-muted">{ZIP_NAME} 파일이 내려받기 폴더에 저장됩니다.</p>
          </Step>
          <Step title="압축 풀기">
            <p>내려받은 ZIP 파일을 마우스 오른쪽 버튼으로 눌러 "압축 풀기"를 고릅니다.</p>
            <p className="text-muted">푼 폴더는 지우지 않을 곳(예: 문서 폴더)에 두세요. 폴더를 지우거나 옮기면 확장 프로그램도 사라집니다.</p>
          </Step>
          <Step title="확장 프로그램 관리 화면 열기">
            <p>{words.name} 주소창에 아래 주소를 넣고 Enter 를 누릅니다. 보안상 링크로는 열 수 없어 직접 넣어야 합니다.</p>
            <Address value={words.address} />
          </Step>
          <Step title="개발자 모드 켜기">
            <p>{words.devMode}</p>
          </Step>
          <Step title="푼 폴더 불러오기">
            <p>{words.load}</p>
            <p>앞에서 압축을 푼 폴더(안에 manifest.json 이 보이는 폴더)를 고릅니다.</p>
            <p className="text-muted">"매니페스트 파일이 없습니다"라고 나오면 한 단계 안쪽 폴더를 골라 보세요.</p>
          </Step>
          <Step title="도구 모음에 고정하기">
            <p>주소창 오른쪽의 퍼즐 조각 아이콘을 누르고, 온비짱 캡처 옆의 핀을 눌러 고정합니다.</p>
          </Step>
          <Step title="온비짱 주소 맞추기">
            {origin === PRODUCTION_ORIGIN ? (
              <p>확장 프로그램은 처음부터 이 사이트로 연결되어 있어 바꿀 것이 없습니다.</p>
            ) : origin === DEV_ORIGIN ? (
              <p>
                지금은 개발용 주소입니다. 확장 아이콘을 누르고 "옵션"을 열어 "개발용(내 컴퓨터)"를 누르면 "온비짱에서 편집"이 이 화면으로 열립니다. 팀원은 기본값(팀 온비짱 사이트)을 그대로 쓰면 됩니다.
              </p>
            ) : (
              <>
                <p>확장 아이콘을 누르고 "옵션"을 열어 온비짱 주소를 아래 값으로 바꾼 뒤 저장합니다. 그래야 "온비짱에서 편집"이 이 사이트로 열립니다.</p>
                <Address value={origin} />
              </>
            )}
          </Step>
        </ol>
      </Panel>

      <div className="flex flex-col gap-5">
        <Panel className="flex flex-col gap-4 px-5 py-4">
          <h2 className="text-base">캡처하는 방법</h2>
          <p className="text-sm text-ink-2">캡처할 페이지에서 온비짱 캡처 아이콘을 누르고 방식을 고릅니다.</p>
          <Mode icon={ScrollText} title="전체 페이지">
            맨 위부터 끝까지 스크롤하며 한 장으로 이어 붙입니다. 끝날 때까지 탭을 그대로 두세요.
          </Mode>
          <Mode icon={AppWindow} title="보이는 부분">
            지금 화면에 보이는 만큼만 찍습니다.
          </Mode>
          <Mode icon={SquareDashedMousePointer} title="영역 선택">
            끌어서 고른 부분만 찍습니다.
          </Mode>
          <p className="text-sm text-ink-2">결과 화면에서 바로 저장하거나 "온비짱에서 편집"을 누르면 이 화면의 캡처 편집으로 넘어옵니다.</p>
          <div>
            <Button size="sm" onClick={onOpenEditor}>
              캡처 편집 열기
            </Button>
          </div>
        </Panel>

        <Panel className="flex flex-col gap-3 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base">
            <RefreshCw className="size-4 text-brand" aria-hidden />
            업데이트하는 방법
          </h2>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
            <li>위의 버튼으로 새 ZIP 을 내려받습니다. 지금 올라와 있는 버전은 v{manifest.version} 입니다.</li>
            <li>처음 설치할 때 푼 폴더에 덮어써서 풉니다.</li>
            <li>
              <span className="font-mono text-ink">{words.address}</span> 에서 {words.reload}
            </li>
          </ol>
          <p className="text-sm text-muted">설치된 버전은 확장 아이콘을 눌렀을 때 아래쪽에 보입니다.</p>
        </Panel>

        <Callout tone="info" title="캡처가 되지 않는 페이지">
          브라우저 설정 화면, 확장 프로그램 스토어, 새 탭 화면처럼 브라우저가 보호하는 페이지는 "보이는 부분"만 캡처할 수 있습니다. 내 컴퓨터의 파일(file://)은 확장 프로그램 세부정보에서 "파일 URL에 대한 액세스 허용"을 켜야 합니다.
        </Callout>

        <div className="flex items-start gap-2.5 rounded-md bg-brand-soft px-3 py-2.5 text-sm text-ink-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <p>확장 프로그램은 아이콘을 눌러 캡처를 시작한 탭에서만 동작하고, 캡처한 이미지를 외부로 보내지 않습니다.</p>
        </div>
      </div>
    </div>
  )
}
