'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

type Word = { id: string; en: string; ko: string; type: 'A' | 'B' | 'C' | 'D' }
type Result = { word: Word; image: string | null; error: string | null }

export default function GeneratePage() {
  const router = useRouter()
  const [words, setWords] = useState<Word[]>([])
  const [results, setResults] = useState<Result[]>([])
  const [current, setCurrent] = useState(-1)
  const [done, setDone] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    const stored = localStorage.getItem('vocab-words')
    if (!stored) { router.push('/'); return }
    const w: Word[] = JSON.parse(stored)
    setWords(w)
    setResults(w.map(word => ({ word, image: null, error: null })))
  }, [router])

  useEffect(() => {
    if (words.length === 0 || started.current) return
    started.current = true
    generateAll(words)
  }, [words])

  const generateAll = async (wordList: Word[]) => {
    const res: Result[] = wordList.map(w => ({ word: w, image: null, error: null }))
    for (let i = 0; i < wordList.length; i++) {
      setCurrent(i)
      try {
        const r = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word: wordList[i], type: wordList[i].type }),
        })
        const data = await r.json()
        res[i] = { word: wordList[i], image: data.image || null, error: data.error || null }
      } catch {
        res[i] = { word: wordList[i], image: null, error: '생성 실패' }
      }
      setResults([...res])
    }
    setCurrent(-1)
    setDone(true)
    localStorage.setItem('vocab-results', JSON.stringify(res))
  }

  const goToReview = () => router.push('/review')

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">일러스트 생성 중</h1>
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

        {done && (
          <button
            onClick={goToReview}
            className="w-full py-3.5 bg-teal-500 text-white rounded-xl font-semibold hover:bg-teal-600 transition-colors"
          >
            검토 페이지로 →
          </button>
        )}
      </div>
    </main>
  )
}
