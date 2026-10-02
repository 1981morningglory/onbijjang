/**
 * 확장 프로그램을 브라우저에 올려 보지 못하는 대신 정적으로 확인할 수 있는 것을 모두 본다:
 * manifest 가 MV3 규칙에 맞는지, 가리키는 파일이 있는지, 화면에 인라인 스크립트·외부 주소가 없는지,
 * 쓰는 chrome API 가 선언한 권한 안에 있는지, 배포 ZIP 이 소스와 같은지.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import JSZip from 'jszip'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { HANDOVER } from '../../../extension/capture/lib/protocol.js'

const ROOT = path.resolve(__dirname, '../../..')
const EXT = path.join(ROOT, 'extension/capture')
const ZIP = path.join(ROOT, 'public/downloads/onbijjang-capture.zip')
const read = (rel: string) => readFileSync(path.join(EXT, rel), 'utf8')
const manifest = JSON.parse(read('manifest.json'))

function listFiles(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = base ? `${base}/${name}` : name
    return statSync(path.join(dir, name)).isDirectory() ? listFiles(path.join(dir, name), rel) : [rel]
  })
}
const all = listFiles(EXT)
const shipped = all.filter((f) => !f.endsWith('.d.ts'))
const scripts = shipped.filter((f) => f.endsWith('.js'))
const pages = shipped.filter((f) => f.endsWith('.html'))

/** 주석을 뺀 코드(주석 속 낱말에 걸리지 않도록) */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

describe('manifest.json', () => {
  it('Manifest V3 필수 항목', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(typeof manifest.name).toBe('string')
    expect(manifest.name.length).toBeGreaterThan(0)
    expect(manifest.name.length).toBeLessThanOrEqual(75)
    expect(manifest.description.length).toBeLessThanOrEqual(132)
    // 버전: 점으로 나눈 1–4개의 정수(각 0–65535), 앞자리 0 금지
    expect(manifest.version).toMatch(/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/)
    for (const part of manifest.version.split('.')) expect(Number(part)).toBeLessThanOrEqual(65535)
  })

  it('MV2 에서만 쓰던 항목이 없다', () => {
    for (const key of ['browser_action', 'page_action', 'content_security_policy_string', 'web_accessible_resources_v2']) expect(manifest).not.toHaveProperty(key)
    expect(manifest.background).not.toHaveProperty('scripts')
    expect(manifest.background).not.toHaveProperty('page')
    expect(manifest.background).not.toHaveProperty('persistent')
    expect(typeof manifest.content_security_policy === 'string').toBe(false)
  })

  it('알고 있는 항목만 쓴다', () => {
    const known = ['manifest_version', 'name', 'short_name', 'version', 'description', 'minimum_chrome_version', 'icons', 'action', 'background', 'options_ui', 'permissions', 'optional_host_permissions']
    expect(Object.keys(manifest).filter((k) => !known.includes(k))).toEqual([])
  })

  it('권한은 최소: activeTab·scripting·storage 뿐이고 설치할 때 받는 사이트 권한은 없다', () => {
    expect([...manifest.permissions].sort()).toEqual(['activeTab', 'scripting', 'storage'])
    expect(manifest).not.toHaveProperty('host_permissions')
    expect(manifest).not.toHaveProperty('content_scripts')
    expect(manifest).not.toHaveProperty('web_accessible_resources')
    expect(manifest).not.toHaveProperty('externally_connectable')
    // 사이트 권한은 "온비짱에서 편집"을 누를 때 그 주소 하나만 요청한다.
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*'])
    for (const p of manifest.permissions) expect(p).not.toMatch(/:\/\//)
  })

  it('서비스 워커는 모듈이고 파일이 있다', () => {
    expect(manifest.background.type).toBe('module')
    expect(existsSync(path.join(EXT, manifest.background.service_worker))).toBe(true)
    // 서비스 워커는 확장 프로그램 맨 위 폴더에 있어야 전체를 맡을 수 있다.
    expect(manifest.background.service_worker).not.toContain('/')
  })

  it('가리키는 화면 파일이 모두 있다', () => {
    for (const rel of [manifest.action.default_popup, manifest.options_ui.page]) expect(existsSync(path.join(EXT, rel)), rel).toBe(true)
  })

  it('아이콘 16/48/128 이 PNG 로, 적힌 크기대로 있다', async () => {
    for (const set of [manifest.icons, manifest.action.default_icon]) {
      expect(Object.keys(set).sort()).toEqual(['128', '16', '48'])
      for (const [size, rel] of Object.entries(set)) {
        const meta = await sharp(path.join(EXT, rel as string)).metadata()
        expect(meta.format).toBe('png')
        expect(meta.width).toBe(Number(size))
        expect(meta.height).toBe(Number(size))
      }
    }
  })
})

describe('확장 프로그램 화면(HTML)', () => {
  it.each(pages)('%s: 인라인 스크립트·이벤트 속성·외부 주소가 없다(MV3 기본 CSP)', (rel) => {
    const html = read(rel)
    for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
      expect(tag).toMatch(/\ssrc="[^"]+"/)
      expect(tag).toMatch(/type="module"/)
    }
    expect(html).not.toMatch(/<script\b[^>]*>\s*\S[\s\S]*?<\/script>/i)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(html).not.toMatch(/javascript:/i)
    expect(html).not.toMatch(/(src|href)\s*=\s*"(https?:)?\/\//i)
    expect(html).toMatch(/<html lang="ko">/)
  })

  it.each(pages)('%s: 불러오는 파일과 스크립트가 찾는 id 가 모두 있다', (rel) => {
    const html = read(rel)
    const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1])
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect(existsSync(path.join(EXT, path.dirname(rel), ref)), `${rel} → ${ref}`).toBe(true)

    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
    const js = read(rel.replace(/\.html$/, '.js'))
    const wanted = [...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1])
    expect(wanted.length).toBeGreaterThan(0)
    for (const id of wanted) expect(ids.has(id), `${rel} 에 #${id} 가 없음`).toBe(true)
  })

  it('아이콘 자리(data-icon)는 모두 준비된 그림이다', async () => {
    const { ICONS } = await import('../../../extension/capture/lib/icons.js' as string)
    for (const rel of pages) {
      for (const m of read(rel).matchAll(/data-icon="([^"]+)"/g)) expect(Object.keys(ICONS), `${rel}: ${m[1]}`).toContain(m[1])
    }
  })

  it('스타일에도 외부 주소가 없다', () => {
    for (const rel of shipped.filter((f) => f.endsWith('.css') || f.endsWith('.html'))) {
      expect(read(rel), rel).not.toMatch(/url\(\s*['"]?(https?:)?\/\//i)
      expect(read(rel), rel).not.toMatch(/@import/i)
    }
  })
})

describe('확장 프로그램 스크립트', () => {
  it('외부로 데이터를 보내는 코드가 없다', () => {
    for (const rel of scripts) {
      const src = code(rel)
      expect(src, rel).not.toMatch(/\bfetch\s*\(/)
      expect(src, rel).not.toMatch(/XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|RTCPeerConnection/)
      // 온비짱 주소(배포·개발)와 SVG 이름공간 말고는 웹 주소가 없어야 한다.
      const allowed = ['https://onbijjang-production.up.railway.app', 'http://localhost:5173', 'http://www.w3.org/2000/svg']
      const urls = (src.match(/https?:\/\/[^\s'"`)]+/g) ?? []).filter((u) => !allowed.some((a) => u.startsWith(a)))
      expect(urls, rel).toEqual([])
    }
  })

  it('문자열을 코드로 실행하지 않는다(MV3 금지)', () => {
    for (const rel of scripts) {
      const src = code(rel)
      expect(src, rel).not.toMatch(/\beval\s*\(|new Function\s*\(/)
      expect(src, rel).not.toMatch(/set(Timeout|Interval)\s*\(\s*['"`]/)
    }
  })

  it('쓰는 chrome API 가 선언한 권한으로 모두 가능하다', () => {
    // 권한 없이 쓸 수 있는 것: runtime, action, tabs 의 기본 동작(get/query/create/captureVisibleTab 은 activeTab), permissions
    const needs: Record<string, string | null> = { runtime: null, action: null, tabs: null, permissions: null, scripting: 'scripting', storage: 'storage' }
    const used = new Set<string>()
    for (const rel of scripts) for (const m of code(rel).matchAll(/\bchrome\.([a-zA-Z]+)\b/g)) used.add(m[1])
    for (const ns of used) {
      expect(Object.keys(needs), `chrome.${ns}`).toContain(ns)
      const perm = needs[ns]
      if (perm) expect(manifest.permissions).toContain(perm)
    }
    expect([...used].sort()).toEqual(['action', 'permissions', 'runtime', 'scripting', 'storage', 'tabs'])
  })

  it('"tabs" 권한이 필요한 호출(다른 탭의 주소 읽기 등)을 하지 않는다', () => {
    const calls = new Set<string>()
    for (const rel of scripts) for (const m of code(rel).matchAll(/\bchrome\.tabs\.([a-zA-Z]+)/g)) calls.add(m[1])
    expect([...calls].sort()).toEqual(['captureVisibleTab', 'create', 'get', 'query'])
  })

  it('페이지에 넣는 스크립트는 모듈이 아닌 일반 스크립트로 읽힌다', () => {
    const src = read('content/agent.js')
    expect(() => new vm.Script(src, { filename: 'agent.js' })).not.toThrow()
    expect(src).not.toMatch(/^\s*(import|export)\s/m)
  })

  it('페이지에 넣는 스크립트는 페이지 내용을 확장으로 보내지 않는다(영역 좌표와 주소·제목만)', () => {
    const src = code('content/agent.js')
    const sends = [...src.matchAll(/send\(\{([^}]*)\}\)/g)].map((m) => m[1])
    expect(sends.length).toBe(2)
    for (const body of sends) expect(body).not.toMatch(/innerHTML|innerText|textContent|cookie|localStorage|value/)
  })

  it('모듈들이 서로 가져다 쓰는 이름이 실제로 있다', async () => {
    for (const rel of scripts.filter((f) => f !== 'content/agent.js')) {
      for (const m of read(rel).matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
        const target = path.join(EXT, path.dirname(rel), m[2])
        expect(existsSync(target), `${rel} → ${m[2]}`).toBe(true)
        const exported = [...readFileSync(target, 'utf8').matchAll(/export\s+(?:async\s+)?(?:const|function|class)\s+([A-Za-z0-9_$]+)/g)].map((x) => x[1])
        for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) expect(exported, `${rel}: ${name} from ${m[2]}`).toContain(name)
      }
    }
  })

  it('서비스 워커가 페이지 도우미에게 시키는 일과 도우미가 아는 일이 같다', () => {
    const called = new Set([...read('background.js').matchAll(/call\(tab\.id,\s*'([a-zA-Z]+)'/g)].map((m) => m[1]))
    const agent = read('content/agent.js')
    expect([...called].sort()).toEqual(['prepare', 'restore', 'scrollTo', 'startRegionSelect'])
    for (const name of called) expect(agent, name).toMatch(new RegExp(`\\n    (async )?${name}\\(`))
  })

  it('주고받는 메시지 이름이 양쪽에서 같다', () => {
    const bg = read('background.js')
    for (const type of ['ob:start', 'ob:cancel', 'ob:region', 'ob:region-cancel']) expect(bg).toContain(`'${type}'`)
    expect(read('popup.js')).toContain("'ob:start'")
    expect(read('popup.js')).toContain("'ob:cancel'")
    expect(read('content/agent.js')).toContain("'ob:region'")
    expect(read('content/agent.js')).toContain("'ob:region-cancel'")
  })
})

describe('사이트와의 약속', () => {
  it('확장이 여는 경로가 이 도구의 경로와 같다', () => {
    const registry = readFileSync(path.join(ROOT, 'src/app/registry.ts'), 'utf8')
    expect(registry).toContain("id: 'capture'")
    expect(HANDOVER.TOOL_PATH).toBe('/tools/capture')
  })
  it('기본 온비짱 주소는 배포 사이트(HTTPS)이고, 개발 주소도 고를 수 있다', async () => {
    const s = await import('../../../extension/capture/lib/settings.js')
    expect(s.DEFAULT_SETTINGS.origin).toBe('https://onbijjang-production.up.railway.app')
    expect(s.PRODUCTION_ORIGIN).toBe(s.DEFAULT_SETTINGS.origin)
    expect(s.DEV_ORIGIN).toBe('http://localhost:5173')
    const { normalizeOrigin } = await import('../../../extension/capture/lib/plan.js')
    // 두 주소 모두 정리해도 그대로이고, 요청할 권한이 manifest 의 선택 권한 안에 든다.
    for (const origin of [s.PRODUCTION_ORIGIN, s.DEV_ORIGIN]) {
      const r = normalizeOrigin(origin)
      expect(r).toMatchObject({ ok: true, origin })
      if (r.ok) expect(manifest.optional_host_permissions).toContain(r.pattern.startsWith('https:') ? 'https://*/*' : 'http://*/*')
    }
    expect(normalizeOrigin(s.PRODUCTION_ORIGIN)).toMatchObject({ pattern: 'https://onbijjang-production.up.railway.app/*' })
    const html = read('options.html')
    expect(html).toContain('id="use-production"')
    expect(html).toContain('id="use-dev"')
  })
  it('디자인 토큰이 사이트와 같다', () => {
    const site = readFileSync(path.join(ROOT, 'src/styles/app.css'), 'utf8')
    const ext = read('ui.css')
    for (const m of ext.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)) {
      expect(site, `--color-${m[1]}`).toContain(`--color-${m[1]}: ${m[2]};`)
    }
  })
})

describe('배포 ZIP', () => {
  it('소스와 내용이 같다(scripts/build-extension.mjs 를 다시 돌렸는지)', async () => {
    expect(existsSync(ZIP), 'node scripts/build-extension.mjs 를 실행해 ZIP 을 만들어 주세요').toBe(true)
    const zip = await JSZip.loadAsync(readFileSync(ZIP))
    const inZip = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort()
    expect(inZip).toEqual([...shipped].sort())
    for (const rel of shipped) {
      const packed = await zip.file(rel)!.async('nodebuffer')
      expect(packed.equals(readFileSync(path.join(EXT, rel))), `${rel} 이 ZIP 과 다름 — 빌드 스크립트를 다시 실행`).toBe(true)
    }
    // 압축을 풀면 manifest.json 이 맨 위에 있어야 그 폴더를 바로 고를 수 있다.
    expect(inZip).toContain('manifest.json')
  })
})
