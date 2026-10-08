import { describe, expect, it } from 'vitest'
import { normalizeConfig } from './config'

describe('신상앱', () => {
  it('설정이 없던 서버: 출시 뒤 추가한 앱(바코드·SNS 영상 받기·체험단 SNS 선발)이 신상앱', () => {
    expect(normalizeConfig({ version: 1, tools: {} }).newApps.items.sort()).toEqual(['barcode', 'saver', 'sns'])
  })
  it('SNS 영상 받기는 처음엔 직원등급 이상만', () => {
    expect(normalizeConfig({ version: 1, tools: {} }).tools.saver.roles.sort()).toEqual(['admin', 'member', 'staff'])
  })
  it('스탭 등급 추가: 예전 저장분에서 직원등급에게 보이던 것은 스탭에게도', () => {
    const c = normalizeConfig({ version: 1, rolesV: 2, tools: { qr: { enabled: true, badge: null, roles: ['admin', 'member'], deleted: false }, pdf: { enabled: true, badge: null, roles: ['admin'], deleted: false } } })
    expect(c.tools.qr.roles).toEqual(['admin', 'staff', 'member'])
    expect(c.tools.pdf.roles).toEqual(['admin'])
    const again = normalizeConfig({ ...c })
    expect(again.tools.qr.roles).toEqual(['admin', 'staff', 'member'])
    const removed = normalizeConfig({ ...c, tools: { ...c.tools, qr: { ...c.tools.qr, roles: ['admin', 'member'] } } })
    expect(removed.tools.qr.roles).toEqual(['admin', 'member'])
  })
  it('저장 뒤 새로 생긴 도구는 자동으로 맨 앞 + NEW 표시', () => {
    const known = normalizeConfig({ version: 1, tools: {} }).knownTools!.filter((id) => id !== 'blog')
    const c = normalizeConfig({ version: 1, tools: {}, knownTools: known, newApps: { enabled: true, title: '신상앱', items: ['barcode'], autoAdd: true } })
    expect(c.newApps.items).toEqual(['blog', 'barcode'])
    expect(c.tools.blog.badge).toBe('new')
  })
  it('자동 등록을 끄면 새 도구를 넣지 않는다', () => {
    const c = normalizeConfig({ version: 1, tools: {}, knownTools: ['image'], newApps: { enabled: true, title: '신상앱', items: [], autoAdd: false } })
    expect(c.newApps.items).toEqual([])
  })
  it('관리자가 뺀 앱은 다시 들어오지 않고, 없는 앱은 빠진다', () => {
    const known = normalizeConfig({ version: 1, tools: {} }).knownTools
    const c = normalizeConfig({ version: 1, tools: {}, knownTools: known, newApps: { enabled: true, title: '새 도구', items: ['ghost', 'qr'], autoAdd: true } })
    expect(c.newApps.items).toEqual(['qr'])
    expect(c.newApps.title).toBe('새 도구')
  })
})

describe('카테고리 옮기기', () => {
  it('저장된 카테고리를 따르고, 잘못된 값은 원래 카테고리로', async () => {
    const { groupOf } = await import('./config')
    const { TOOL_BY_ID } = await import('./registry')
    const c = normalizeConfig({ version: 1, tools: { barcode: { enabled: true, badge: null, roles: ['guest'], deleted: false, group: 'image' }, qr: { enabled: true, badge: null, roles: ['guest'], deleted: false, group: 'nope' } } })
    expect(groupOf(c, TOOL_BY_ID.barcode)).toBe('image')
    expect(groupOf(c, TOOL_BY_ID.qr)).toBe('image')
    expect(c.tools.qr.group).toBeUndefined()
  })
})

describe('카테고리 순서', () => {
  it('기본은 문서·영상·이미지·블로그·마켓 수수료·마케팅', () => {
    expect(normalizeConfig({ version: 1, tools: {} }).groupOrder).toEqual(['doc', 'video', 'image', 'blog', 'fees', 'marketing'])
  })
  it('저장된 순서를 따르고, 빠진 카테고리는 뒤에 붙인다', () => {
    expect(normalizeConfig({ version: 1, tools: {}, groupOrder: ['fees', 'image', 'bad'] }).groupOrder).toEqual(['fees', 'image', 'doc', 'video', 'blog', 'marketing'])
  })
})
