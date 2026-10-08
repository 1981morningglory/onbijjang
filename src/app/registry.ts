import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import {
  Barcode, Blend, Calculator, Camera, Clapperboard, ClipboardCheck, Crop, Download, Eraser, FileText, Files, Film, Gavel,
  Grid3x3, Image as ImageIcon, Images, LayoutTemplate, MonitorPlay, NotebookPen, Package, PenLine, QrCode,
  ReceiptText, Rocket, Scale, Scissors, ShoppingBag, ShoppingCart, Signature, Store, Tags, FilePenLine, Megaphone, Trophy,
  type LucideIcon,
} from 'lucide-react'

export type GroupId = 'image' | 'video' | 'doc' | 'fees' | 'blog' | 'marketing'

export interface ToolGroup {
  id: GroupId
  title: string
  blurb: string
  icon: LucideIcon
}

export interface ToolDef {
  id: string
  group: GroupId
  title: string
  /** 한 줄 설명. 홈·검색·도구 머리말에 쓰인다. */
  summary: string
  /** 검색용 동의어 */
  keywords: string[]
  icon: LucideIcon
  /** public/art/<art>.webp */
  art: string
  /** 파일을 다루는 도구면 true — "내 기기에서 처리" 표시 */
  local: boolean
  /** 이 도구가 다른 도구에서 넘겨받을 수 있는 파일 종류 */
  accepts?: Array<'image' | 'video' | 'pdf'>
  /** true 면 페이지 최대 폭 제한 없이 화면 전체 폭을 쓴다(편집기형 도구) */
  wide?: boolean
  /** 처음 볼 수 있는 등급(기본: 전체). 서버 자원을 쓰는 도구는 직원 이상으로 */
  roles?: Array<'guest' | 'general' | 'member' | 'staff' | 'admin'>
  component: LazyExoticComponent<ComponentType>
}

/** 카테고리 순서: (맨 위 NEW 신상앱) → 문서 → 영상 → 이미지 → 블로그 → 마켓 수수료 */
export const GROUPS: ToolGroup[] = [
  { id: 'doc', title: '문서', blurb: 'PDF와 라벨 인쇄', icon: FileText },
  { id: 'video', title: '영상', blurb: '필요한 순간만 GIF·MP4로', icon: Film },
  { id: 'image', title: '이미지', blurb: '자르고, 지우고, 가리고, 꾸미기', icon: ImageIcon },
  { id: 'blog', title: '블로그', blurb: '붙여넣기 전에 글 다듬기', icon: PenLine },
  { id: 'fees', title: '마켓 수수료', blurb: '남는 돈을 먼저 계산', icon: Calculator },
  { id: 'marketing', title: '마케팅', blurb: '체험단·인플루언서 고르기', icon: Megaphone },
]

export const TOOLS: ToolDef[] = [
  // ── 이미지 ──────────────────────────────────────────────
  {
    id: 'image', group: 'image', title: '이미지 편집',
    summary: '여러 장의 크기·테두리·워터마크를 한 번에, 한 장씩 정밀 편집까지',
    keywords: ['리사이즈', '크기', '워터마크', '자르기', '크롭', '압축', 'webp', '썸네일', '사진'],
    icon: Crop, art: 'image', local: true, accepts: ['image'],
    component: lazy(() => import('@/tools/image')),
  },
  {
    id: 'template', group: 'image', title: '템플릿 캔버스',
    summary: '사진·글자·도형을 자유롭게 배치해 이미지·PDF·GIF·영상으로',
    keywords: ['카드뉴스', '상세페이지', '썸네일', '배너', '디자인', '합치기', '콜라주'],
    icon: LayoutTemplate, art: 'template', local: true, accepts: ['image'], wide: true,
    component: lazy(() => import('@/tools/template')),
  },
  {
    id: 'background', group: 'image', title: '배경 제거·바꾸기',
    summary: '누끼를 자동으로 따고 흰 배경·단색·다른 사진으로 교체',
    keywords: ['누끼', '투명', '배경', '흰배경', '썸네일'],
    icon: Blend, art: 'background', local: true, accepts: ['image'],
    component: lazy(() => import('@/tools/background')),
  },
  {
    id: 'split', group: 'image', title: '사진 분할',
    summary: '한 장을 행×열로, 또는 긴 상세페이지를 높이 기준으로 나누기',
    keywords: ['자르기', '분할', '상세페이지', '조각', '그리드'],
    icon: Scissors, art: 'split', local: true, accepts: ['image'],
    component: lazy(() => import('@/tools/split')),
  },
  {
    id: 'mosaic', group: 'image', title: '사진 모자이크',
    summary: '얼굴과 전화번호·차량번호 같은 글자를 찾아서 가리기',
    keywords: ['블러', '가리기', '얼굴', '개인정보', '번호판'],
    icon: Grid3x3, art: 'mosaic', local: true, accepts: ['image'],
    component: lazy(() => import('@/tools/mosaic')),
  },
  {
    id: 'cleanup', group: 'image', title: '작은 표시 지우기',
    summary: '내 사진 속 잡티·작은 글씨를 브러시로 칠해 지우기',
    keywords: ['지우개', '잡티', '보정', '리터치', '인페인팅'],
    icon: Eraser, art: 'cleanup', local: true, accepts: ['image'],
    component: lazy(() => import('@/tools/cleanup')),
  },
  {
    id: 'signature', group: 'image', title: '사진·문서 서명',
    summary: '서명·직인을 만들어 두고 사진·PDF·Word 원하는 위치에',
    keywords: ['사인', '도장', '직인', '전자서명', '계약서'],
    icon: Signature, art: 'signature', local: true, accepts: ['image', 'pdf'],
    component: lazy(() => import('@/tools/signature')),
  },
  {
    id: 'qr', group: 'image', title: 'QR 코드 생성',
    summary: '로고를 넣은 QR, 엑셀 목록으로 한 번에 여러 개',
    keywords: ['큐알', 'qrcode', '링크', '와이파이', '명함'],
    icon: QrCode, art: 'qr', local: false,
    component: lazy(() => import('@/tools/qr')),
  },
  {
    id: 'rename', group: 'image', title: '파일명 일괄 변경',
    summary: '순번·찾아 바꾸기·날짜·엑셀 매핑으로 이름을 한 번에',
    keywords: ['이름', '리네임', '번호', '정리', 'zip'],
    icon: FilePenLine, art: 'rename', local: true, accepts: ['image', 'video', 'pdf'],
    component: lazy(() => import('@/tools/rename')),
  },
  {
    id: 'capture', group: 'image', title: '웹페이지 전체 캡처',
    summary: '크롬 확장으로 스크롤 끝까지 한 장에 담고 바로 편집',
    keywords: ['스크린샷', '스크롤', '캡쳐', '확장프로그램', '상세페이지'],
    icon: Camera, art: 'capture', local: true, accepts: ['image'],
    component: lazy(() => import('@/tools/capture')),
  },

  // ── 영상 ────────────────────────────────────────────────
  {
    id: 'clips', group: 'video', title: '영상 구간 자르기',
    summary: '긴 영상에서 여러 구간을 골라 GIF·MP4·WebP로',
    keywords: ['gif', '움짤', 'mp4', '구간', '클립', '자르기'],
    icon: Clapperboard, art: 'clips', local: true, accepts: ['video'],
    component: lazy(() => import('@/tools/clips')),
  },
  {
    id: 'gif', group: 'video', title: '영상 일괄 변환',
    summary: '짧은 영상 여러 개를 한 번에 GIF·MP4·WebP로 변환',
    keywords: ['gif', '움짤', '일괄', '변환', '압축'],
    icon: Images, art: 'gif', local: true, accepts: ['video'],
    component: lazy(() => import('@/tools/gif')),
  },
  {
    id: 'record', group: 'video', title: '화면 녹화',
    summary: '화면의 원하는 영역만 GIF 또는 MP4로 길게 녹화',
    keywords: ['녹화', '스크린', 'gif', 'mp4', '캡처', '설명'],
    icon: MonitorPlay, art: 'record', local: true,
    component: lazy(() => import('@/tools/record')),
  },
  {
    id: 'saver', group: 'video', title: 'SNS 영상 받기',
    summary: '유튜브·틱톡·인스타 링크로 영상·소리·대본을 원하는 형식과 구간으로',
    keywords: ['유튜브', '틱톡', '인스타', '다운로드', '저장', 'mp3', 'mp4', '대본', '자막', '링크'],
    icon: Download, art: 'saver', local: false, roles: ['member', 'staff', 'admin'],
    component: lazy(() => import('@/tools/saver')),
  },

  // ── 문서 ────────────────────────────────────────────────
  {
    id: 'pdf', group: 'doc', title: 'PDF 변환·관리',
    summary: '변환·병합·분할·압축·암호·페이지 번호·글자 인식까지 한곳에서',
    keywords: ['word', 'excel', 'ppt', '병합', '정리', '순서', '분할', 'ocr', '압축', '용량', '암호', '한글'],
    icon: Files, art: 'pdf', local: true, accepts: ['pdf', 'image'],
    component: lazy(() => import('@/tools/pdf')),
  },
  {
    id: 'quote', group: 'doc', title: '견적서·거래명세서',
    summary: '팀 코드로 들어가 견적서·거래명세서를 만들고, 팀 문서함에서 날짜·거래처·품목별로 찾아 PDF·엑셀로',
    keywords: ['견적', '견적서', '거래명세서', '명세표', '명세서', '인보이스', '직인', '사업자등록증', '통장사본', '엑셀', '팀', '문서함', '거래처'],
    icon: ReceiptText, art: 'quote', local: false, wide: true,
    component: lazy(() => import('@/tools/quote')),
  },
  {
    id: 'label', group: 'doc', title: 'A4 라벨메이트',
    summary: '라벨지 23종에 글자·바코드·QR을 얹고 엑셀 목록으로 채우기',
    keywords: ['라벨', '바코드', '폼텍', '주소', '스티커', '인쇄'],
    icon: Tags, art: 'label', local: false,
    component: lazy(() => import('@/tools/label')),
  },
  {
    id: 'barcode', group: 'doc', title: '바코드 생성',
    summary: '회사코드로 EAN-13(평형·롱바)과 쿠팡 R 바코드를 EPS·AI·PDF로, 엑셀 붙여넣기로 여러 개',
    keywords: ['바코드', 'ean', 'ean13', '쿠팡', 'r바코드', 'code128', '코드128', 'eps', 'ai', '일러스트', '회사코드', '품번'],
    icon: Barcode, art: 'barcode', local: true,
    component: lazy(() => import('@/tools/barcode')),
  },

  // ── 마켓 수수료 ─────────────────────────────────────────
  {
    id: 'fee-compare', group: 'fees', title: '마켓 수수료 비교',
    summary: '한 상품을 여섯 마켓에 동시에 넣어 어디가 가장 남는지',
    keywords: ['마진', '비교', '역산', '판매가', '일괄', '엑셀'],
    icon: Scale, art: 'fee-compare', local: false,
    component: lazy(() => import('@/tools/fees/compare')),
  },
  {
    id: 'smartstore', group: 'fees', title: '스마트스토어',
    summary: '사업자 등급·유입 경로별 수수료와 이익',
    keywords: ['네이버', '수수료', '마진', '스토어'],
    icon: Store, art: 'smartstore', local: false,
    component: lazy(() => import('@/tools/fees/smartstore')),
  },
  {
    id: 'coupang', group: 'fees', title: '쿠팡',
    summary: '카테고리 요율과 배송 조건을 반영한 판매 이익',
    keywords: ['쿠팡', '윙', '수수료', '마진', '마켓플레이스'],
    icon: Package, art: 'coupang', local: false,
    component: lazy(() => import('@/tools/fees/coupang')),
  },
  {
    id: 'rocket-margin', group: 'fees', title: '로켓그로스 마진',
    summary: '입출고·보관·세이버까지 넣은 상품 1개 마진',
    keywords: ['쿠팡', '로켓', '그로스', '풀필먼트', '물류'],
    icon: Rocket, art: 'rocket-margin', local: false,
    component: lazy(() => import('@/tools/fees/rocket')),
  },
  {
    id: 'rocket-policy', group: 'fees', title: '로켓그로스 정책',
    summary: '공식 요금·정책 문서와 팀 메모를 한 페이지에',
    keywords: ['쿠팡', '정책', '요금표', '링크'],
    icon: ClipboardCheck, art: 'rocket-policy', local: false,
    component: lazy(() => import('@/tools/fees/policy')),
  },
  {
    id: 'gmarket', group: 'fees', title: '지마켓',
    summary: '카테고리·제휴·프로모션·월 서버 이용료 반영',
    keywords: ['g마켓', 'esm', '수수료', '마진'],
    icon: ShoppingCart, art: 'gmarket', local: false,
    component: lazy(() => import('@/tools/fees/gmarket')),
  },
  {
    id: 'auction', group: 'fees', title: '옥션',
    summary: '카테고리·제휴·프로모션·월 서버 이용료 반영',
    keywords: ['esm', '수수료', '마진'],
    icon: Gavel, art: 'auction', local: false,
    component: lazy(() => import('@/tools/fees/auction')),
  },
  {
    id: 'elevenst', group: 'fees', title: '11번가',
    summary: '카테고리 요율과 쿠폰 부담·제휴 이용료 구분 계산',
    keywords: ['11st', '십일번가', '수수료', '마진'],
    icon: ShoppingBag, art: 'elevenst', local: false,
    component: lazy(() => import('@/tools/fees/elevenst')),
  },

  // ── 블로그 ──────────────────────────────────────────────
  {
    id: 'blog', group: 'blog', title: '블로그 본문 정리',
    summary: '줄바꿈 정리, 글자 수·키워드 횟수·금칙어 확인',
    keywords: ['네이버', '줄바꿈', '해시태그', '글자수', '키워드', '금칙어'],
    icon: NotebookPen, art: 'blog', local: false,
    component: lazy(() => import('@/tools/blog')),
  },

  // ── 마케팅 ──────────────────────────────────────────────
  {
    id: 'sns', group: 'marketing', title: '체험단 SNS 선발',
    summary: '지원자 인스타그램·블로그를 방문해 팔로워·반응·방문자·이웃을 모아 지원자 전체의 활동 점수를 엑셀로',
    keywords: ['체험단', '인플루언서', '인스타그램', '인스타', '블로그', '네이버', '팔로워', '방문자', '이웃', '서포터즈', '선발', '순위'],
    icon: Trophy, art: 'sns', local: false, wide: true, roles: ['member', 'staff', 'admin'],
    component: lazy(() => import('@/tools/sns')),
  },
]

export const TOOL_BY_ID: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t]))
export const GROUP_BY_ID = Object.fromEntries(GROUPS.map((g) => [g.id, g])) as Record<GroupId, ToolGroup>

export const toolPath = (id: string) => `/tools/${id}`
export const artUrl = (art: string) => `/art/${art}.webp`
