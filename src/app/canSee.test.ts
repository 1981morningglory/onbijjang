import { describe, expect, it } from 'vitest'
import { canSee, type MenuEntry } from './config'

const entry = (patch: Partial<MenuEntry> = {}): MenuEntry => ({ enabled: true, badge: null, roles: ['admin'], deleted: false, ...patch })

describe('canSee', () => {
  it('스탭은 등급 칩과 상관없이 켜진 앱을 모두 본다', () => {
    expect(canSee(entry(), 'x', { role: 'staff', access: {} })).toBe(true)
    expect(canSee(entry(), 'x', { role: 'member', access: {} })).toBe(false)
  })
  it('꺼짐·삭제·계정별 차단은 스탭에게도 그대로', () => {
    expect(canSee(entry({ enabled: false }), 'x', { role: 'staff', access: {} })).toBe(false)
    expect(canSee(entry({ deleted: true }), 'x', { role: 'staff', access: {} })).toBe(false)
    expect(canSee(entry(), 'x', { role: 'staff', access: { x: 'deny' } })).toBe(false)
  })
})
