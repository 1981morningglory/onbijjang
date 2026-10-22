# Project notes for Claude

## AI 흔적 정리 스킬 (watermarks-remover)

출처: https://github.com/guillaumemeyer/watermarks-remover (MIT, commit 5c18093)
설치 위치: `.claude/skills/`

- `clean-user-facing-text`: 숨은 유니코드 글자 제거 + 문장 다듬기. 외부 서버 없이 로컬 Python 스크립트로 동작.
- `remove-ai-marks`: 사진·PDF·문서의 C2PA/EXIF/XMP 메타데이터 제거. 저장소의 HTTP 서비스
  (`docker compose up -d` 또는 `make serve`, 기본 주소 `http://127.0.0.1:8765`)가 켜져 있어야 동작.

규칙:
- 사용자에게 보여줄 글(README, 문서, 화면 문구 등)을 완성할 때는 `clean-user-facing-text`의
  숨은 글자 정리(Layer A)를 적용한다. 코드, 명령어, 경로, 식별자는 건드리지 않는다.
- 이미지/PDF 메타데이터 제거와 문장 재작성(Layer B)은 사용자가 요청할 때 실행한다.
- 결과를 "AI 탐지 불가"로 보장하지 않는다. 각 스킬 문서의 한계와 윤리 안내를 따른다.
