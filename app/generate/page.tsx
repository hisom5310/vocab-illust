'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchCourse, generateForCard } from '../lib/client'
import { currentImage, type Card } from '../lib/types'

// Two at a time: roughly halves a 24-word batch without tripping OpenAI rate limits.
const CONCURRENCY = 2

function GenerateContent() {
  const router = useRouter()
  const course = useSearchParams().get('course') ?? ''
  const [cards, setCards] = useState<Card[]>([])
  const [active, setActive] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [loadError, setLoadError] = useState('')
  const started = useRef(false)

  const run = useCallback(async (all: Card[], targets: Card[]) => {
    setRunning(true)
    const unitWords = all.filter(c => !c.deleted).map(c => c.word.en)
    const queue = [...targets]
    const worker = async () => {
      for (let card = queue.shift(); card; card = queue.shift()) {
        const id = card.id
        setActive(prev => new Set(prev).add(id))
        const updated = await generateForCard(card, { unitWords })
        setCards(prev => prev.map(c => c.id === id ? updated : c))
        setActive(prev => { const s = new Set(prev); s.delete(id); return s })
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    setRunning(false)
  }, [])

  useEffect(() => {
    if (!course || started.current) return
    started.current = true
    fetchCourse(course)
      .then(loaded => {
        setCards(loaded)
        const todo = loaded.filter(c => !c.deleted && c.status === 'queued' && !c.error)
        if (todo.length) run(loaded, todo)
      })
      .catch(e => setLoadError(e instanceof Error ? e.message : '불러오기 실패'))
  }, [course, run])

  const live = cards.filter(c => !c.deleted)
  const waiting = live.filter(c => c.status === 'queued')
  const failed = waiting.filter(c => c.error && !active.has(c.id))
  const doneCount = live.length - waiting.length
  const finished = !running && cards.length > 0 && waiting.length === 0

  useEffect(() => {
    if (finished) router.push(`/review?course=${encodeURIComponent(course)}`)
  }, [finished, course, router])

  if (!course) {
    return <p className="p-10 text-gray-500">코스가 지정되지 않았어요.</p>
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-teal-600 font-medium text-sm">{course}</p>
            <h1 className="text-2xl font-bold text-gray-900">일러스트 생성</h1>
            <p className="mt-1 text-sm text-gray-500">
              {running
                ? '완성된 이미지는 바로 저장돼요. 이 탭이 열려 있는 동안 계속 생성하고, 닫았다가 다시 열면 남은 단어부터 이어서 만들어요.'
                : failed.length
                  ? `${failed.length}개가 실패했어요.`
                  : '불러오는 중…'}
            </p>
          </div>
          <div className="flex gap-2">
            {failed.length > 0 && !running && (
              <button
                onClick={() => run(cards, failed.map(c => ({ ...c, error: null })))}
                className="px-4 py-2 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-600"
              >
                실패한 {failed.length}개 다시 시도
              </button>
            )}
            <button
              onClick={() => router.push(`/review?course=${encodeURIComponent(course)}`)}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              검토 화면으로
            </button>
          </div>
        </div>

        {loadError && <p className="mb-4 text-sm text-red-500">{loadError}</p>}

        {live.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span>진행률</span>
              <span>{doneCount} / {live.length}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full transition-all duration-500" style={{ width: `${(doneCount / live.length) * 100}%` }} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {live.map(card => {
            const img = currentImage(card)
            return (
              <div key={card.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="aspect-square bg-gray-50 flex items-center justify-center">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt={card.word.en} className="w-full h-full object-contain" />
                  ) : active.has(card.id) ? (
                    <div className="w-7 h-7 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                  ) : card.error ? (
                    <p className="text-xs text-red-400 px-2 text-center">{card.error}</p>
                  ) : (
                    <p className="text-xs text-gray-300">대기 중</p>
                  )}
                </div>
                <div className="px-2.5 py-2">
                  <p className="text-sm font-medium text-gray-900 truncate">{card.word.en}</p>
                  <p className="text-xs text-gray-400 truncate">{card.word.ko}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}

export default function GeneratePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">로딩 중...</div>}>
      <GenerateContent />
    </Suspense>
  )
}
