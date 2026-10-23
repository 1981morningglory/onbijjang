/**
 * 공유 링크로 받은 결과만 보는 화면 — 온비짱 메뉴·머리말 없이 결과만.
 * /s/:id (짧은 주소) 또는 /v/saju?…, /v/mbti?… (긴 주소)
 */
import { FileDown, Link2Off } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { api } from '@/lib/api'
import { Button, Panel, Spinner } from '@/ui'
import { computeChart } from './logic'
import { ResultView } from './mbti/MbtiTab'
import { TYPES } from './mbti/data'
import { mbtiQuery, parseMbtiLink, parseSajuLink, safeName, sajuQuery, type ShareKind } from './share'
import { AiReading, ChartView } from './SajuTab'
import { useShare } from './ShareUI'

type Loaded = { kind: ShareKind; q: string } | 'loading' | 'missing'

export default function SharedPage() {
  const { id, kind } = useParams()
  const [data, setData] = useState<Loaded>(() => (id ? 'loading' : kind === 'saju' || kind === 'mbti' ? { kind, q: location.search.slice(1) } : 'missing'))
  useEffect(() => {
    if (!id) return
    api<{ kind: ShareKind; q: string }>(`/share/${encodeURIComponent(id)}`)
      .then(setData)
      .catch(() => setData('missing'))
  }, [id])
  return (
    <div className="min-h-dvh bg-paper">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
        {data === 'loading' ? (
          <div className="flex items-center justify-center gap-2 py-20 text-muted">
            <Spinner /> 결과를 불러오는 중
          </div>
        ) : data === 'missing' ? (
          <Missing />
        ) : data.kind === 'saju' ? (
          <SajuShared q={data.q} />
        ) : (
          <MbtiShared q={data.q} />
        )}
        <p className="pb-4 text-center text-sm text-faint">공유받은 결과입니다 · 전통 명리학·성격유형 이론에 따른 참고용 해석입니다.</p>
      </main>
    </div>
  )
}

function Missing() {
  useEffect(() => {
    document.title = '결과를 찾을 수 없어요'
  }, [])
  return (
    <Panel className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Link2Off className="size-10 text-faint" aria-hidden />
      <p className="text-xl font-bold text-ink">결과를 찾을 수 없어요</p>
      <p className="text-base text-muted">링크가 잘렸거나 올바르지 않습니다. 보낸 분께 링크를 다시 받아 주세요.</p>
    </Panel>
  )
}

function SajuShared({ q }: { q: string }) {
  const got = useMemo(() => parseSajuLink(q), [q])
  const chart = useMemo(() => {
    try {
      return got ? computeChart(got.input) : null
    } catch {
      return null
    }
  }, [got])
  const name = got?.name ?? ''
  const share = useShare(
    chart && got
      ? {
          containerId: 'shared-result',
          filename: `${safeName(`사주_${name || '결과'}_${chart.solar.year}-${String(chart.solar.month).padStart(2, '0')}-${String(chart.solar.day).padStart(2, '0')}`)}.pdf`,
          title: `${name ? `${name} 님의 ` : ''}사주풀이`,
          kind: 'saju',
          query: sajuQuery(got.input, name),
        }
      : null,
  )
  useEffect(() => {
    document.title = `${name ? `${name} 님의 ` : ''}사주 결과`
  }, [name])
  if (!chart) return <Missing />
  return (
    <div id="shared-result" className="flex flex-col gap-5">
      <ChartView
        chart={chart}
        name={name}
        actions={
          <Button size="sm" icon={FileDown} loading={share.busy} onClick={() => void share.pdf()} data-pdf-skip>
            PDF 다운로드
          </Button>
        }
      />
      <AiReading chart={chart} name={name} readOnly />
    </div>
  )
}

function MbtiShared({ q }: { q: string }) {
  const got = useMemo(() => parseMbtiLink(q), [q])
  const share = useShare(got ? { containerId: 'mbti-result', filename: `MBTI_${got.type}_${TYPES[got.type].nick}.pdf`, title: `성격유형 ${got.type} ${TYPES[got.type].nick}`, kind: 'mbti', query: mbtiQuery(got.type, got.pct) } : null)
  useEffect(() => {
    if (got) document.title = `성격유형 ${got.type} 결과`
  }, [got])
  if (!got) return <Missing />
  return (
    <div className="flex flex-col gap-5">
      <ResultView result={{ ...got, shared: true }} share={share} readOnly />
    </div>
  )
}
