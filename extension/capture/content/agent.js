/**
 * 온비짱 캡처 — 페이지 안에서 일하는 부분.
 * 사용자가 확장 아이콘을 눌러 캡처를 시작했을 때만 그 탭에 들어온다(activeTab + scripting).
 * 스크롤, 고정 머리말 숨기기, 이미지 대기, 영역 선택을 맡고 끝나면 바꾼 것을 모두 되돌린다.
 * 페이지 내용을 읽어 어디로 보내는 일은 하지 않는다.
 */
;(() => {
  if (globalThis.__onbijjangCaptureAgent) return

  const WATCHDOG_MS = 20000
  const MAX_SCAN = 30000
  const MIN_SCROLL_RANGE = 40

  /** @type {null | any} */
  let session = null
  let region = null

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  /** 화면이 실제로 다시 그려질 때까지(가려진 탭이면 시간 제한으로) 기다린다. */
  function frames(win, n = 2) {
    return Promise.race([
      new Promise((resolve) => {
        const step = () => (--n <= 0 ? resolve() : win.requestAnimationFrame(step))
        win.requestAnimationFrame(step)
      }),
      sleep(300),
    ])
  }

  function intersect(a, b) {
    const x = Math.max(a.x, b.x)
    const y = Math.max(a.y, b.y)
    const r = Math.min(a.x + a.w, b.x + b.w)
    const bt = Math.min(a.y + a.h, b.y + b.h)
    return { x, y, w: Math.max(0, r - x), h: Math.max(0, bt - y) }
  }

  /** 열린 shadow DOM 까지 포함해 요소를 차례로 돈다. */
  function* walk(root, budget) {
    const doc = root.ownerDocument || root
    const tw = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    let node
    while ((node = tw.nextNode())) {
      if (budget.left-- <= 0) return
      yield node
      if (node.shadowRoot) yield* walk(node.shadowRoot, budget)
    }
  }

  // ── 스타일 바꾸기와 되돌리기 ──────────────────────────────
  function setStyle(el, prop, value) {
    const s = session
    let rec = s.styles.get(el)
    if (!rec) {
      rec = { hadAttr: el.hasAttribute('style'), props: new Map() }
      s.styles.set(el, rec)
    }
    if (!rec.props.has(prop)) rec.props.set(prop, { value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) })
    el.style.setProperty(prop, value, 'important')
  }

  function resetStyle(el, props) {
    const rec = session?.styles.get(el)
    if (!rec) return
    for (const prop of props ?? [...rec.props.keys()]) {
      const prev = rec.props.get(prop)
      if (!prev) continue
      if (prev.value) el.style.setProperty(prop, prev.value, prev.priority)
      else el.style.removeProperty(prop)
      rec.props.delete(prop)
    }
    if (!rec.props.size) {
      if (!rec.hadAttr && el.getAttribute('style') === '') el.removeAttribute('style')
      session.styles.delete(el)
    }
  }

  // ── 스크롤 영역 찾기 ──────────────────────────────────────
  function rootOf(doc) {
    return doc.scrollingElement || doc.documentElement
  }

  function canScroll(el) {
    return el.scrollHeight - el.clientHeight > MIN_SCROLL_RANGE
  }

  /**
   * doc 안에서 가장 넓게 보이는 스크롤 영역 후보를 찾는다.
   * offset: 이 문서의 화면이 맨 위 창에서 시작하는 자리, clip: 맨 위 창에서 실제로 보이는 범위.
   */
  function findInner(doc, offset, clip, depth, chain, budget) {
    const win = doc.defaultView
    let best = null
    const consider = (cand) => {
      if (cand && (!best || cand.area > best.area)) best = cand
    }
    for (const el of walk(doc.documentElement, budget)) {
      const tag = el.tagName
      if (tag === 'IFRAME' || tag === 'FRAME') {
        if (depth >= 2) continue
        let inner = null
        try {
          inner = el.contentDocument
        } catch {
          inner = null
        }
        if (!inner || !inner.defaultView || !inner.documentElement) continue
        const fr = el.getBoundingClientRect()
        const cs = win.getComputedStyle(el)
        const ox = offset.x + fr.left + el.clientLeft + (parseFloat(cs.paddingLeft) || 0)
        const oy = offset.y + fr.top + el.clientTop + (parseFloat(cs.paddingTop) || 0)
        const iroot = rootOf(inner)
        const box = { x: ox, y: oy, w: inner.documentElement.clientWidth, h: inner.documentElement.clientHeight }
        const visible = intersect(box, clip)
        if (visible.w * visible.h <= 0) continue
        const nextChain = [...chain, el]
        if (canScroll(iroot)) {
          consider({ el: iroot, doc: inner, box, view: visible, area: visible.w * visible.h, chain: nextChain, kind: 'frame' })
        } else {
          consider(findInner(inner, { x: ox, y: oy }, visible, depth + 1, nextChain, budget))
        }
        continue
      }
      if (!canScroll(el) || el.clientHeight < 80) continue
      const oy = win.getComputedStyle(el).overflowY
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue
      const r = el.getBoundingClientRect()
      const box = { x: offset.x + r.left + el.clientLeft, y: offset.y + r.top + el.clientTop, w: el.clientWidth, h: el.clientHeight }
      const visible = intersect(box, clip)
      consider({ el, doc, box, view: visible, area: visible.w * visible.h, chain, kind: chain.length ? 'frame' : 'inner' })
    }
    return best
  }

  function findScroller() {
    const root = rootOf(document)
    const viewport = { x: 0, y: 0, w: root.clientWidth || window.innerWidth, h: root.clientHeight || window.innerHeight }
    const page = { el: root, doc: document, box: viewport, view: viewport, area: viewport.w * viewport.h, chain: [], kind: 'page' }
    if (canScroll(root)) return page
    const inner = findInner(document, { x: 0, y: 0 }, viewport, 0, [], { left: MAX_SCAN })
    // 화면의 4분의 1 이상을 차지할 때만 본문으로 본다.
    if (inner && inner.view.h >= 80 && inner.area >= viewport.w * viewport.h * 0.25) return inner
    return page
  }

  // ── 고정 요소(sticky / fixed) ─────────────────────────────
  function docsInPlay() {
    const s = session
    const docs = [document]
    for (const frame of s.chain) {
      try {
        if (frame.contentDocument && !docs.includes(frame.contentDocument)) docs.push(frame.contentDocument)
      } catch {
        // 접근할 수 없는 프레임은 건너뛴다
      }
    }
    return docs
  }

  function holdsScroller(el) {
    const s = session
    if (el === s.scroller || el.contains(s.scroller)) return true
    return s.chain.some((frame) => el === frame || el.contains(frame))
  }

  /** 스크롤을 따라다니는 요소를 찾아 기록한다. sticky 는 제자리에 두고, fixed 는 위·아래로 분류한다. */
  function scanPinned() {
    const s = session
    const budget = { left: MAX_SCAN }
    for (const doc of docsInPlay()) {
      const win = doc.defaultView
      if (!win) continue
      const midY = win.innerHeight / 2
      for (const el of walk(doc.documentElement, budget)) {
        if (s.fixed.has(el) || s.sticky.has(el)) continue
        const cs = win.getComputedStyle(el)
        if (cs.position === 'sticky') {
          s.sticky.add(el)
          // 흐름 속 제자리에 한 번만 찍히도록 붙는 성질만 끈다.
          setStyle(el, 'position', 'relative')
          setStyle(el, 'top', 'auto')
          setStyle(el, 'bottom', 'auto')
          setStyle(el, 'left', 'auto')
          setStyle(el, 'right', 'auto')
          continue
        }
        if (cs.position !== 'fixed') continue
        if (holdsScroller(el)) continue
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        if (r.bottom <= 0 || r.top >= win.innerHeight || r.right <= 0 || r.left >= win.innerWidth) continue
        const tall = r.height >= win.innerHeight * 0.8
        const where = tall || r.top + r.height / 2 <= midY ? 'top' : 'bottom'
        s.fixed.set(el, { where, hidden: false })
      }
    }
  }

  function hideFixed(filter) {
    for (const [el, info] of session.fixed) {
      if (info.hidden || !filter(info)) continue
      setStyle(el, 'transition', 'none')
      setStyle(el, 'opacity', '0')
      info.hidden = true
    }
  }

  /** 마지막 장: 아래쪽에 붙은 요소가 새로 찍히는 구간 안에 온전히 들어오면 다시 보인다. */
  function revealBottomFixed(sliceH) {
    for (const [el, info] of session.fixed) {
      if (!info.hidden || info.where !== 'bottom') continue
      const win = el.ownerDocument.defaultView
      if (!win) continue
      const r = el.getBoundingClientRect()
      if (win.innerHeight - r.top <= sliceH) {
        resetStyle(el, ['opacity', 'transition'])
        info.hidden = false
      }
    }
  }

  // ── 지연 로딩 대기 ────────────────────────────────────────
  async function waitImages(timeout) {
    const s = session
    const deadline = performance.now() + timeout
    const docs = docsInPlay()
    for (;;) {
      let pending = false
      for (const doc of docs) {
        const win = doc.defaultView
        if (!win) continue
        for (const img of doc.images) {
          if (img.complete) continue
          if (!img.currentSrc && !img.getAttribute('src') && !img.getAttribute('srcset')) continue
          const r = img.getBoundingClientRect()
          if (r.bottom < 0 || r.top > win.innerHeight || r.width === 0) continue
          pending = true
          break
        }
        if (pending) break
      }
      if (!pending || performance.now() >= deadline || !session || s.cancelled) return
      await sleep(80)
    }
  }

  function armWatchdog() {
    const s = session
    if (!s) return
    clearTimeout(s.watchdog)
    // 확장 쪽이 중간에 멈추면 페이지를 그대로 두지 않고 스스로 되돌린다.
    s.watchdog = setTimeout(() => api.restore(), WATCHDOG_MS)
  }

  function endY() {
    const s = session
    const maxTop = Math.max(0, s.scroller.scrollHeight - s.scroller.clientHeight)
    return maxTop + s.skipTop + s.view.h
  }

  const api = {
    ping() {
      return { ok: true }
    },

    /** 스크롤 캡처 준비: 스크롤 영역을 찾고 페이지를 캡처하기 좋은 상태로 바꾼다. */
    prepare(opts) {
      if (session) api.restore()
      const found = findScroller()
      const scroller = found.el
      session = {
        scroller,
        doc: found.doc,
        win: found.doc.defaultView,
        chain: found.chain,
        kind: found.kind,
        view: found.view,
        skipTop: Math.max(0, found.view.y - found.box.y),
        orig: { top: scroller.scrollTop, left: scroller.scrollLeft },
        styles: new Map(),
        fixed: new Map(),
        sticky: new Set(),
        cancelled: false,
        settle: Number(opts?.settle) || 150,
        images: Number(opts?.images) || 1500,
        watchdog: 0,
        onKey: (e) => {
          if (e.key === 'Escape' && session) session.cancelled = true
        },
      }
      window.addEventListener('keydown', session.onKey, true)
      // 부드러운 스크롤·스냅이 있으면 원하는 위치에 바로 서지 못한다.
      const targets = new Set([scroller, found.doc.documentElement])
      if (found.doc.body) targets.add(found.doc.body)
      for (const el of targets) {
        setStyle(el, 'scroll-behavior', 'auto')
        setStyle(el, 'scroll-snap-type', 'none')
      }
      scanPinned()
      armWatchdog()
      return {
        ok: true,
        kind: found.kind,
        view: found.view,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
        endY: endY(),
        url: location.href,
        title: document.title,
      }
    },

    /** y(페이지 좌표)가 화면 맨 위에 오도록 스크롤하고, 그릴 준비가 되면 실제 위치를 돌려준다. */
    async scrollTo(arg) {
      const s = session
      if (!s) return { ok: false, reason: 'no-session' }
      armWatchdog()
      if (s.cancelled) return { ok: false, cancelled: true }
      const index = Number(arg?.index) || 0
      const multi = endY() > s.view.h + 1

      if (index === 0) {
        // 첫 장에는 위쪽 고정 요소만 남긴다. 아래쪽 것은 마지막 장에서 한 번만 찍는다.
        if (multi) hideFixed((info) => info.where === 'bottom')
      } else {
        hideFixed(() => true)
      }

      s.scroller.scrollTop = Math.max(0, Math.round((Number(arg?.y) || 0) - s.skipTop))
      await frames(s.win, 2)
      await waitImages(s.images)
      await sleep(s.settle)
      if (!session || s.cancelled) return { ok: false, cancelled: true }

      if (index > 0) {
        // 스크롤한 뒤에야 나타나는 고정 요소(맨 위로 버튼, 접히는 머리말)도 숨긴다.
        scanPinned()
        hideFixed(() => true)
      }

      const y = s.scroller.scrollTop + s.skipTop
      const end = endY()
      const atEnd = y + s.view.h >= end - 1
      if (index > 0 && atEnd) {
        revealBottomFixed(y + s.view.h - (Number(arg?.prevEnd) || 0))
      }
      await frames(s.win, 2)
      armWatchdog()
      return { ok: true, y, viewH: s.view.h, endY: end, atEnd }
    },

    /** 바꾼 스타일과 스크롤 위치를 모두 되돌린다. */
    restore() {
      const s = session
      if (!s) return { ok: true }
      clearTimeout(s.watchdog)
      window.removeEventListener('keydown', s.onKey, true)
      // 스크롤 위치는 scroll-behavior 를 되돌리기 전에 먼저 옮긴다(부드러운 스크롤 방지).
      try {
        s.scroller.scrollTop = s.orig.top
        s.scroller.scrollLeft = s.orig.left
      } catch {
        // 페이지가 그 사이 바뀌었으면 넘어간다
      }
      for (const el of [...s.styles.keys()]) resetStyle(el)
      const cancelled = s.cancelled
      session = null
      return { ok: true, cancelled }
    },

    /** 영역 선택 화면을 띄운다. 선택이 끝나면 확장에 메시지로 알린다. */
    startRegionSelect() {
      if (region) region.close()
      const host = document.createElement('div')
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;'
      const shadow = host.attachShadow({ mode: 'closed' })
      const style = document.createElement('style')
      style.textContent = `
        .veil { position: fixed; inset: 0; cursor: crosshair; background: rgb(20 32 26 / 0.28); touch-action: none; user-select: none; }
        .veil.drawing { background: transparent; }
        .box { position: fixed; display: none; border: 2px solid #ffe55c; box-shadow: 0 0 0 100000px rgb(20 32 26 / 0.45); pointer-events: none; box-sizing: border-box; }
        .tip, .size { position: fixed; font: 600 13px/1.4 'Pretendard Variable', Pretendard, 'Malgun Gothic', system-ui, sans-serif; color: #f7f4ec; background: #14201a; border-radius: 8px; padding: 6px 10px; pointer-events: none; white-space: nowrap; }
        .tip { top: 16px; left: 50%; transform: translateX(-50%); box-shadow: 0 4px 8px rgb(60 48 20 / 0.06), 0 18px 40px -10px rgb(60 48 20 / 0.22); }
        .size { display: none; font-variant-numeric: tabular-nums; }
      `
      const veil = document.createElement('div')
      veil.className = 'veil'
      const box = document.createElement('div')
      box.className = 'box'
      const tip = document.createElement('div')
      tip.className = 'tip'
      tip.textContent = '끌어서 캡처할 영역을 고르세요. Esc 를 누르면 취소됩니다.'
      const size = document.createElement('div')
      size.className = 'size'
      shadow.append(style, veil, box, tip, size)

      let start = null
      let rect = null
      const vw = () => window.innerWidth
      const vh = () => window.innerHeight
      const clampX = (v) => Math.min(vw(), Math.max(0, v))
      const clampY = (v) => Math.min(vh(), Math.max(0, v))

      const draw = () => {
        if (!rect) {
          box.style.display = 'none'
          size.style.display = 'none'
          return
        }
        box.style.display = 'block'
        box.style.left = `${rect.x}px`
        box.style.top = `${rect.y}px`
        box.style.width = `${rect.w}px`
        box.style.height = `${rect.h}px`
        size.style.display = 'block'
        size.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`
        size.style.left = `${Math.min(rect.x, vw() - 110)}px`
        size.style.top = `${rect.y + rect.h + 8 > vh() - 34 ? Math.max(4, rect.y - 36) : rect.y + rect.h + 8}px`
      }
      const onDown = (e) => {
        if (e.button !== 0) return
        e.preventDefault()
        veil.setPointerCapture(e.pointerId)
        start = { x: clampX(e.clientX), y: clampY(e.clientY) }
        rect = { x: start.x, y: start.y, w: 0, h: 0 }
        veil.classList.add('drawing')
        tip.style.display = 'none'
        draw()
      }
      const onMove = (e) => {
        if (!start) return
        const x = clampX(e.clientX)
        const y = clampY(e.clientY)
        rect = { x: Math.min(start.x, x), y: Math.min(start.y, y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) }
        draw()
      }
      const onUp = async () => {
        if (!start) return
        start = null
        if (!rect || rect.w < 8 || rect.h < 8) {
          // 너무 작으면 실수로 본다. 다시 끌 수 있게 처음 상태로.
          rect = null
          veil.classList.remove('drawing')
          tip.style.display = ''
          draw()
          return
        }
        const picked = rect
        close()
        // 선택 화면이 캡처에 찍히지 않도록 지워진 화면이 그려질 때까지 기다린다.
        await frames(window, 2)
        await sleep(80)
        send({ type: 'ob:region', rect: picked, innerWidth: vw(), innerHeight: vh(), url: location.href, title: document.title })
      }
      const onKey = (e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        close()
        send({ type: 'ob:region-cancel' })
      }
      const send = (msg) => {
        try {
          chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError)
        } catch {
          // 확장이 다시 설치되어 연결이 끊긴 경우 — 할 수 있는 일이 없다
        }
      }
      function close() {
        window.removeEventListener('keydown', onKey, true)
        host.remove()
        region = null
      }

      veil.addEventListener('pointerdown', onDown)
      veil.addEventListener('pointermove', onMove)
      veil.addEventListener('pointerup', onUp)
      veil.addEventListener('pointercancel', () => {
        start = null
        rect = null
        veil.classList.remove('drawing')
        tip.style.display = ''
        draw()
      })
      window.addEventListener('keydown', onKey, true)
      ;(document.body || document.documentElement).appendChild(host)
      region = { close }
      return { ok: true }
    },
  }

  globalThis.__onbijjangCaptureAgent = api
})()
