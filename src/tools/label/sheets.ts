import { deriveSheet, type SheetSeed, type SheetSpec } from './model'

/**
 * A4 라벨지 23종. 칸 크기와 열×행만 적고, 여백·간격은 deriveSheet 가 A4 가운데 정렬로 계산한다.
 * 제조사마다 여백이 조금씩 달라 화면에서 직접 고칠 수 있다.
 */
const SEEDS: SheetSeed[] = [
  { id: 'a4-1-210x296', name: '1칸 (전면)', cols: 1, rows: 1, labelW: 210, labelH: 296 },
  { id: 'a4-1-205x279', name: '1칸', cols: 1, rows: 1, labelW: 205, labelH: 279, radius: 2 },
  { id: 'a4-2-200x140', name: '2칸', cols: 1, rows: 2, labelW: 200, labelH: 140, radius: 2 },
  { id: 'a4-4-99x140', name: '4칸', cols: 2, rows: 2, labelW: 99, labelH: 140, radius: 2 },
  { id: 'a4-6-99x93', name: '6칸', cols: 2, rows: 3, labelW: 99, labelH: 93, radius: 2 },
  { id: 'a4-8-99x68', name: '8칸', cols: 2, rows: 4, labelW: 99, labelH: 68, radius: 2 },
  { id: 'a4-10-89x52', name: '10칸', cols: 2, rows: 5, labelW: 89, labelH: 52, radius: 2 },
  { id: 'a4-12-99x45', name: '12칸 (2×6)', cols: 2, rows: 6, labelW: 99, labelH: 45, radius: 2 },
  { id: 'a4-12-64x70', name: '12칸 (3×4)', cols: 3, rows: 4, labelW: 64, labelH: 70, radius: 2 },
  { id: 'a4-14-99x38', name: '14칸', cols: 2, rows: 7, labelW: 99, labelH: 38, radius: 2 },
  { id: 'a4-16-99x34', name: '16칸', cols: 2, rows: 8, labelW: 99, labelH: 34, radius: 2 },
  { id: 'a4-18-99x30', name: '18칸 (2×9)', cols: 2, rows: 9, labelW: 99, labelH: 30, radius: 2 },
  { id: 'a4-18-63.5x45', name: '18칸 (3×6)', cols: 3, rows: 6, labelW: 63.5, labelH: 45, radius: 2 },
  { id: 'a4-21-63x38', name: '21칸', cols: 3, rows: 7, labelW: 63, labelH: 38, radius: 2 },
  { id: 'a4-24-64x34', name: '24칸', cols: 3, rows: 8, labelW: 64, labelH: 34, radius: 2 },
  { id: 'a4-27-63x30', name: '27칸', cols: 3, rows: 9, labelW: 63, labelH: 30, radius: 2 },
  { id: 'a4-36-95x14', name: '36칸', cols: 2, rows: 18, labelW: 95, labelH: 14, radius: 1 },
  { id: 'a4-40-47x27', name: '40칸', cols: 4, rows: 10, labelW: 47, labelH: 27, radius: 1.5 },
  { id: 'a4-54-26x29', name: '54칸', cols: 6, rows: 9, labelW: 26, labelH: 29, radius: 1.5 },
  { id: 'a4-60-38x19', name: '60칸', cols: 5, rows: 12, labelW: 38, labelH: 19, radius: 1.5 },
  { id: 'a4-65-38x21', name: '65칸', cols: 5, rows: 13, labelW: 38, labelH: 21, radius: 1.5 },
  { id: 'a4-84-46x11', name: '84칸', cols: 4, rows: 21, labelW: 46, labelH: 11, radius: 1 },
  // CD 라벨: 한 장에 두 개. 위·아래·사이를 같은 간격으로 둔다.
  { id: 'a4-cd-114', name: 'CD 라벨', cols: 1, rows: 2, labelW: 114, labelH: 114, shape: 'cd', hole: 41, gapY: 23 },
]

export const SHEETS: SheetSpec[] = SEEDS.map((seed) => deriveSheet(seed))
export const SHEET_BY_ID: Record<string, SheetSpec> = Object.fromEntries(SHEETS.map((s) => [s.id, s]))
export const DEFAULT_SHEET = SHEET_BY_ID['a4-21-63x38']

/** "21", "63", "3x7", "cd" 같은 검색어에 맞는 규격. */
export function searchSheets(list: SheetSpec[], query: string): SheetSpec[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '').replace(/[*×]/g, 'x')
  if (!q) return list
  return list.filter((s) => {
    const hay = [s.name, `${s.cols * s.rows}칸`, `${s.cols}x${s.rows}`, `${s.labelW}x${s.labelH}`, `${s.labelW}mm`, `${s.labelH}mm`, s.shape === 'cd' ? 'cd 씨디 원형 dvd' : '']
      .join(' ')
      .toLowerCase()
      .replace(/×/g, 'x')
    return hay.replace(/\s+/g, '').includes(q) || hay.split(' ').some((part) => part.startsWith(q))
  })
}
