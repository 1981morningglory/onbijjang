export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** 온비짱 서버 호출. 서버가 꺼져 있으면 status 0 의 ApiError 를 던진다. */
export async function api<T>(path: string, init?: Omit<RequestInit, 'body'> & { body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다.')
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // 정적 호스팅처럼 API 가 없는 환경에서는 HTML 이 돌아온다.
    throw new ApiError(0, '서버에 연결할 수 없습니다.')
  }
  if (!res.ok) {
    const message = (json as { error?: string } | null)?.error ?? `요청에 실패했습니다 (${res.status}).`
    throw new ApiError(res.status, message)
  }
  return json as T
}
