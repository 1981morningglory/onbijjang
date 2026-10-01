/**
 * 캡처 임시 보관소(IndexedDB). 서비스 워커가 찍은 장면을 넣고 결과 화면이 꺼내 이어 붙인다.
 * 이 브라우저 안에만 있고, 오래된 것은 sweep() 이 지운다.
 */
import { LIMITS, pickExpired } from './plan.js'

const DB_NAME = 'onbijjang-capture'
const DB_VERSION = 1
const META = 'captures'
const SHOTS = 'shots'

let dbPromise = null

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(SHOTS)) db.createObjectStore(SHOTS)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        dbPromise = null
        reject(req.error ?? new Error('보관소를 열지 못했습니다.'))
      }
    })
  }
  return dbPromise
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('저장이 중단되었습니다.'))
  })
}

function ask(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const shotKey = (id, index) => `${id}:${String(index).padStart(4, '0')}`

export async function putCapture(meta) {
  const db = await open()
  const tx = db.transaction(META, 'readwrite')
  tx.objectStore(META).put(meta)
  await done(tx)
}

export async function getCapture(id) {
  const db = await open()
  return (await ask(db.transaction(META).objectStore(META).get(id))) ?? null
}

export async function listCaptures() {
  const db = await open()
  return ask(db.transaction(META).objectStore(META).getAll())
}

export async function putShot(id, index, blob) {
  const db = await open()
  const tx = db.transaction(SHOTS, 'readwrite')
  tx.objectStore(SHOTS).put(blob, shotKey(id, index))
  await done(tx)
}

export async function getShot(id, index) {
  const db = await open()
  return (await ask(db.transaction(SHOTS).objectStore(SHOTS).get(shotKey(id, index)))) ?? null
}

export async function deleteCapture(id) {
  const db = await open()
  const tx = db.transaction([META, SHOTS], 'readwrite')
  tx.objectStore(META).delete(id)
  // 키가 "id:0000" 꼴이라 범위로 한 번에 지운다.
  tx.objectStore(SHOTS).delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`))
  await done(tx)
}

export async function deleteAll() {
  const db = await open()
  const tx = db.transaction([META, SHOTS], 'readwrite')
  tx.objectStore(META).clear()
  tx.objectStore(SHOTS).clear()
  await done(tx)
}

/** 오래됐거나 개수를 넘긴 캡처를 지운다. keepId 는 지우지 않는다. */
export async function sweep(keepId = null, now = Date.now()) {
  try {
    const list = await listCaptures()
    const ids = pickExpired(list, now, LIMITS.KEEP_MS, LIMITS.KEEP_COUNT).filter((id) => id !== keepId)
    for (const id of ids) await deleteCapture(id)
    return ids.length
  } catch {
    return 0
  }
}
