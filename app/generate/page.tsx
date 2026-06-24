'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { idbSet, idbGet } from '../lib/storage'

type Word = { id: string; en: string; ko: string; type: 'A' | 'B' | 'C' | 'D' }
type Result = { word: Word; image: string | null; error: string | null; lang?: string }

function GenerateContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [words, setWords] = useState<Word[]>([])
  const [results, setResults] = useState<Result[]>([])
  const [current, setCurrent] = useState(-1)
  const [done, setDone] = useState(false)
  const [courseLabel, setCourseLabel] = useState('')
  const started = useRef(false)

  useEffect(() => {
    const queueParam = searchParams.get('queue')

    if (queueParam) {
      // Claude API route path: /generate?queue=BASE64
      try {
        const bytes = Uint8Array.from(atob(queueParam), c => c.charCodeAt(0))
        const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
          words: Word[]
          lang: string
          course: string
        }
        const { words: w, lang, course } = decoded
        if (!w?.length) { router.push('/'); return }
        if (course) setCourseLabel(course)
        setWords(w)
        setResults(w.map(word => ({ word, image: null, error: null, lang })))
        idbSet('vocab-words', w)
        idbSet('vocab-lang', lang)
        idbSet('vocab-course', course)
        if (!started.current) {
          started.current = true
          generateAll(w, lang)
        }
      } catch {
        router.push('/')
      }
      return
    }

    // Normal flow: read from IDB
    Promise.all([
      idbGet<Word[]>('vocab-words'),
      idbGet<string>('vocab-lang'),
      idbGet<string>('vocab-course'),
    ]).then(([w, l, c]) => {
      if (!w) { router.push('/'); return }
      const lang = l || ''
      if (c) setCourseLabel(c)
      setWords(w)
      setResults(w.map(word => ({ word, image: null, error: null, lang })))
      if (!started.current) {
        started.current = true
        generateAll(w, lang)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generateAll = async (wordList: Word[], lang: string) => {
    const res: Result[] = wordList.map(w => ({ word: w, image: null, error: null, lang }))
    for (let i = 0; i < wordList.length; i++) {
      setCurrent(i)
      const word = wordList[i]
      try {
        const r = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, type: word.type }),
        })
        const data = await r.json()
        res[i] = { word, image: data.image || null, error: data.error || null, lang }
      } catch {
        res[i] = { word, image: null, error: '생성 실패', lang }
      }
      setResults([...res])
    }
    setCurrent(-1)
    setDone(true)

    // Merge with existing results (preserve previously generated images)
    const existingResults = await idbGet<Result[]>('vocab-results') ?? []
    const existingStatuses = await idbGet<{ id: string; status: string; comment: string }[]>('vocab-card-statuses') ?? []

    const mergedResults = [...existingResults]
    const mergedStatuses = [...existingStatuses]

    for (const r of res) {
      const idx = mergedResults.findIndex(e => e.word.id === r.word.id)
      if (idx >= 0) {
        mergedResults[idx] = r
      } else {
        mergedResults.push(r)
        if (!mergedStatuses.find(s => s.id === r.word.id)) {
          mergedStatuses.push({ id: r.word.id, status: 'pending', comment: '' })
        }
      }
    }

    await idbSet('vocab-results', mergedResults)
    await idbSet('vocab-card-statuses', mergedStatuses)

    // Background save to server (non-blocking)
    const [savedLang, savedCourse] = await Promise.all([
      idbGet<string>('vocab-lang'),
      idbGet<string>('vocab-course'),
    ])
    fetch('/api/storage/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: mergedResults,
        statuses: mergedStatuses,
        lang: savedLang ?? '',
        course: savedCourse ?? '',
      }),
    })
      .then(r => r.json())
      .then(({ sessionId }) => { if (sessionId) localStorage.setItem('vocab-last-session', sessionId) })
      .catch(() => {})

    router.push('/review')
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <button
            onClick={() => router.push('/')}
            className="mb-4 text-sm text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
          >
            ← 단어 목록으로
          </button>
          <h1 className="text-2xl font-bold text-gray-900">일러스트 생성 중</h1>
          {courseLabel && <p className="mt-1 text-teal-600 font-medium text-sm">{courseLabel}</p>}
          {!done && current >= 0 && (
            <p className="mt-1 text-gray-500 text-sm">
              {current + 1} / {words.length} 생성 중... ({words[current]?.en})
            </p>
          )}
          {done && <p className="mt-1 text-teal-600 font-medium">완료! 검토 페이지로 이동하세요.</p>}
        </div>

        {/* Progress bar */}
        {words.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span>진행률</span>
              <span>{results.filter(r => r.image || r.error).length} / {words.length}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-500 rounded-full transition-all duration-500"
                style={{ width: `${(results.filter(r => r.image || r.error).length / words.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Cards grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-6">
          {results.map((res, i) => (
            <div
              key={res.word.id}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden"
            >
              <div className="aspect-square bg-gray-50 flex items-center justify-center relative">
                {res.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={res.image} alt={res.word.en} className="w-full h-full object-cover" />
                ) : res.error ? (
                  <span className="text-xs text-red-400 text-center px-2">{res.error}</span>
                ) : current === i ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-gray-400">생성 중</span>
                  </div>
                ) : (
                  <span className="text-xs text-gray-300">대기 중</span>
                )}
              </div>
              <div className="p-2.5">
                <p className="text-xs font-medium text-gray-900 truncate">{res.word.en}</p>
                <p className="text-xs text-gray-400 truncate">{res.word.ko}</p>
              </div>
            </div>
          ))}
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
