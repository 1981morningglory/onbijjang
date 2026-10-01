# 온비짱 도구 작성 규약

온비짱은 팀이 자주 하는 작업(이미지·영상·문서·마켓 수수료·블로그)을 한 사이트에 모은 사내 도구 모음이다.
뼈대(라우팅, 사이드바, 홈, 관리자, UI 키트, 공통 모듈)는 이미 있다. 도구 하나는 **폴더 하나**이고, 그 폴더만 채우면 된다.

## 1. 맡은 범위

- 도구는 `src/tools/<id>/index.tsx` 의 **default export React 컴포넌트**다. 지금은 "준비 중" 자리 표시가 들어 있으니 교체한다.
- 같은 폴더 안에 파일을 자유롭게 나눈다(`logic.ts`, `Editor.tsx`, `x.worker.ts`, `*.test.ts` …).
- **맡은 폴더 밖은 고치지 않는다.** `src/ui`, `src/lib`, `src/app`, `server/index.mjs`, `package.json`, 설정 파일은 공용이고 다른 작업자가 동시에 쓰고 있다.
  공용 쪽에 꼭 필요한 변경이 있으면 직접 고치지 말고, 자기 폴더 안에서 해결한 뒤 마지막 보고에 "공용에 이런 것이 있으면 좋겠다"고 적는다.
- 라이브러리는 이미 설치되어 있다(`package.json` 확인). 정말 필요한 것이 없을 때만 `npm install <패키지>` 를 한 번 실행하고 보고에 적는다. 라이선스는 MIT·Apache·BSD·ISC 계열만.
- 도구 제목·설명·아이콘·그룹은 `src/app/registry.ts` 에 이미 등록되어 있다. 페이지 머리말(그림, h1, 설명, 즐겨찾기)은 `ToolPage` 가 그린다. **도구 안에서 제목을 다시 쓰지 않는다.**

## 2. 화면 만들기

`@/ui` 에서 가져와 쓴다. 정확한 props 는 `src/ui/controls.tsx`, `surfaces.tsx`, `tooling.tsx` 를 읽는다(짧다).

| 부품 | 용도 |
|---|---|
| `ToolLayout` | 왼쪽 작업 영역 + 오른쪽 설정 패널(360px). 미디어 도구의 기본 배치 |
| `Stage` | 작업 매트(초록 격자) — 이미지·영상·캔버스 미리보기가 놓이는 무대. 투명 이미지는 안쪽에 `.checker` |
| `Section` | 설정 패널 안의 한 구획(제목 + 내용). `ToolLayout` 의 `panel` 안에 나열 |
| `Panel` | 흰 종이 한 장. **패널 안에 패널 금지** |
| `Dropzone` | 끌어놓기·파일 선택·Ctrl+V. 파일이 생긴 뒤에는 `compact` |
| `Button`, `IconButton` | variant: `primary`(화면당 주 동작 하나) · `secondary` · `ghost` · `danger` |
| `Field` + `TextInput`/`NumberInput`/`Select`/`Textarea`/`Slider` | 모든 입력은 `Field` 로 감싼다(라벨·도움말·오류) |
| `Switch`, `Checkbox`, `Segmented`, `Tabs` | 켜기/끄기, 2–5개 중 선택, 작업 모드 전환 |
| `ColorField` | 색 고르기 + 팀 브랜드 색 |
| `WatermarkControls`, `PositionGrid` | 워터마크 설정 UI(그리기는 `@/lib/watermark`) |
| `Callout`, `toast`, `Progress`, `Spinner`, `EmptyState`, `Badge`, `Kbd` | 안내·알림·진행·빈 상태 |
| `Dialog`, `Popover`, `MenuItem` | 집중이 필요한 편집에만 Dialog. 단순 설정은 화면에 펼친다 |
| `SendToMenu` | 결과 파일을 다른 도구로 넘기기 |
| `LibraryMenu` | 팀 보관함(템플릿·서명·양식 저장/불러오기) |

### 디자인 규칙 (반드시)

- 색은 **토큰 클래스만** 쓴다: `bg-paper` `bg-panel` `bg-surface` `bg-sunken` `border-line` `border-line-strong` `text-ink` `text-ink-2` `text-muted` `text-faint` `bg-brand` `text-on-brand` `bg-brand-soft` `text-brand-ink` `bg-mark` `bg-mark-soft` `text-accent` `bg-accent-soft` `text-danger` `bg-danger-soft` `text-warn` `bg-warn-soft` `text-info` `bg-info-soft` `bg-mat`. 임의 hex·Tailwind 기본 팔레트(`gray-500` 등) 금지. 캔버스에 그리는 색은 예외.
- 글자 크기: `text-2xs` `text-xs` `text-sm` `text-base` `text-lg` `text-xl` `text-2xl`. 도구 안 소제목은 `text-sm font-bold` 또는 `text-base`. 숫자 열은 `num` 클래스(고정폭 숫자).
- 모서리: `rounded-xs/sm/md/lg/xl`. 그림자: `shadow-1/2/3`.
- 아이콘은 `lucide-react` 만. **이모지·유니코드 기호(→ ✓ ★)를 아이콘으로 쓰지 않는다.**
- 그라데이션 글자, 보라색 그라데이션, 유리(blur) 장식, 카드 왼쪽 색 띠, 제목 위 작은 영문 라벨(eyebrow), 01/02/03 번호 장식 금지.
- 모든 상호작용 요소에 hover·focus·disabled 상태. 긴 작업에는 진행 표시와 **취소**. 빈 상태는 "무엇을 하면 채워지는지" 알려준다.
- 좁은 화면(375px)에서 가로 스크롤이 생기지 않게. 표는 `overflow-x-auto` 로 감싼다.
- 문구는 한국어, 짧게, 사용자의 말로. 버튼은 동작을 말한다("ZIP 으로 저장"). 오류는 **무엇이 문제이고 어떻게 하면 되는지**를 쓴다. 내부 용어(인페인팅, 세그멘테이션, 인덱스)는 화면에 쓰지 않는다.
- 움직임은 상태 변화에만, 150–250ms.

## 3. 공통 모듈

- `@/lib/files` — `downloadBlob` `downloadZip` `makeZip` `formatBytes` `extOf` `stripExt` `sanitizeFilename` `uniqueName` `blobToFile` `readAsDataURL` `dataUrlToBlob` `todayStamp` `fileKind`
- `@/lib/image` — `loadBitmap`(EXIF 회전 반영) `fileToCanvas` `makeCanvas` `ctx2d` `canvasToBlob`(png/jpeg/webp) `encodeUnderSize`(목표 용량) `resizeCanvas`(고품질 축소) `fitWithin` `isCanvasSizeSafe` `hexToRgb` `FORMAT_EXT`
- `@/lib/watermark` — `prepareWatermark(settings)` → `(ctx, w, h) => void`
- `@/lib/hooks` — `usePersistentState(key, initial)` `usePasteFiles` `useObjectUrl` `useAbortable` `useDebounced` `fmt`(천 단위) `won`
- `@/lib/library` — 팀 보관함 직접 호출이 필요할 때(`LibraryMenu` 로 충분하면 쓰지 않는다)
- `@/app/config` — `useTeamPresets()`(브랜드 색·팀 워터마크·자주 쓰는 크기·파일명 규칙), 타입 `WatermarkSettings` `Pos9`, 기본값 `DEFAULT_WATERMARK`
- `@/app/handoff` — `useHandoffFiles('<내 도구 id>', (files) => …)` 로 다른 도구가 보낸 파일을 받는다. `registry.ts` 의 `accepts` 에 적힌 종류가 넘어온다.

## 4. 동작 원칙

- **파일은 브라우저 안에서만 처리한다.** 서버로 올리지 않는다(스펙에 명시된 예외 제외).
- 설정은 `usePersistentState('onbijjang:<id>:<이름>', 기본값)` 으로 새로고침 뒤에도 남긴다. 파일 자체는 남기지 않는다(스펙이 요구하면 `idb-keyval`).
- 무거운 라이브러리(pdfjs, tesseract, transformers, mediapipe, fabric, docx, pptxgenjs, xlsx 등)는 **필요한 순간에 `await import()`** 로 불러 첫 화면을 가볍게 한다.
- 오래 걸리는 계산은 Web Worker(`new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`) 또는 잘게 나눠 `await` 로 화면이 멈추지 않게 한다.
- 파일 크기·개수·해상도 한도를 정하고, 넘으면 이유와 한도를 알려준다. 캔버스는 `isCanvasSizeSafe` 로 확인.
- 저장 이미지는 캔버스에서 새로 만들어 EXIF·GPS 가 남지 않게 한다.
- 결과 파일명은 원본 이름을 살려 알아볼 수 있게(`사진_분할_1.png`).
- 결과가 이미지·영상·PDF 면 `SendToMenu` 로 다른 도구에 넘길 수 있게 한다. 받을 수 있는 도구는 `useHandoffFiles` 를 구현한다.
- 관리자 프리셋이 있으면 초기값·빠른 선택으로 쓴다(`useTeamPresets`).

## 5. 확인

- `npx tsc --noEmit` — **자기 폴더의 오류만** 본다(다른 작업자가 동시에 작업 중이라 남의 폴더 오류가 잠깐 보일 수 있다).
- 순수 로직(계산·파싱·이름 규칙)은 `src/tools/<id>/*.test.ts` 로 vitest 테스트를 쓰고 `npx vitest run src/tools/<id>` 로 돌린다.
- 화면 확인: 개발 서버가 **이미 `http://localhost:5173` 에서 돌고 있다. 서버를 새로 띄우지 않는다.**
  브라우저 도구(`mcp__Claude_Browser__*`)를 쓸 수 있으면 `tabs_create` 로 **자기 탭을 만들고 모든 호출에 그 `tabId` 를 넘긴다.** 다른 탭은 건드리지 않고, 끝나면 자기 탭을 닫는다.
  파일 입력은 `javascript_tool` 로 캔버스에서 테스트 이미지를 만들어 `DataTransfer` 로 `input[type=file]` 에 넣거나 `drop` 이벤트를 보내 시험한다.
  실제로 끝까지 한 번은 돌려 본다(파일 넣기 → 설정 → 결과 생성). 콘솔 오류가 없어야 한다.
- 브라우저 도구를 쓸 수 없으면 그렇다고 보고하고, 타입 검사·단위 테스트로 확인한 범위를 적는다.

## 6. 마지막 보고에 담을 것

1. 만든 기능 목록(스펙 항목별로 됨/안 됨)
2. 직접 확인한 것과 확인하지 못한 것 — 지어내지 않는다
3. 알려진 한계, 외부에서 내려받는 모델·데이터가 있으면 주소와 크기, 라이선스
4. 공용 코드에 대한 요청이 있으면
