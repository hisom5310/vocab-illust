'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

type Word = { id: string; en: string; ko: string; type: 'A' | 'B' | 'C' | 'D' }

const TYPE_LABELS: Record<string, string> = {
  A: 'A — 사물/장소',
  B: 'B — 직업/역할',
  C: 'C — 동사/감정',
  D: 'D — 자연/계절',
}

function HomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [sheetUrl, setSheetUrl] = useState('')
  const [manualText, setManualText] = useState('')
  const [words, setWords] = useState<Word[]>([])
  const [courseInfo, setCourseInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'sheet' | 'manual'>('sheet')

  useEffect(() => {
    const sheet = searchParams.get('sheet')
    const course = searchParams.get('course')
    const unit = searchParams.get('unit')
    const data = searchParams.get('data')

    if (course && unit) setCourseInfo(`${course} Unit ${unit}`)

    // data= param: base64 encoded JSON word list (from skill)
    if (data) {
      try {
        const decoded: Word[] = JSON.parse(atob(data))
        setWords(decoded)
      } catch { /* ignore */ }
      return
    }

    if (sheet) {
      setSheetUrl(sheet)
      fetchSheet(sheet)
    }
  }, [searchParams])

  const fetchSheet = async (url: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/fetch-sheet?url=${encodeURIComponent(url)}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setWords(data.words)
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
      setTab('manual')
    }
    setLoading(false)
  }

  // Parse manual text: "영어 | 한국어" per line
  const parseManual = () => {
    const lines = manualText.trim().split('\n').filter(l => l.trim())
    const parsed: Word[] = lines.map((line, i) => {
      const parts = line.split('|').map(p => p.trim())
      return {
        id: `WORD${String(i + 1).padStart(3, '0')}`,
        en: parts[0] || '',
        ko: parts[1] || '',
        type: 'A' as const,
      }
    }).filter(w => w.en && w.ko)
    setWords(parsed)
    setError('')
  }

  const updateType = (idx: number, type: Word['type']) => {
    setWords(prev => prev.map((w, i) => i === idx ? { ...w, type } : w))
  }

  const startGeneration = () => {
    localStorage.setItem('vocab-words', JSON.stringify(words))
    localStorage.setItem('vocab-course', courseInfo)
    router.push('/generate')
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">보캡 일러스트 생성툴</h1>
          {courseInfo && <p className="mt-1 text-teal-600 font-medium">{courseInfo}</p>}
        </div>

        {/* Tab selector */}
        <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
          <button
            onClick={() => setTab('sheet')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'sheet' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            구글 시트
          </button>
          <button
            onClick={() => setTab('manual')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'manual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            직접 입력
          </button>
        </div>

        {tab === 'sheet' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">구글 시트 URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={sheetUrl}
                onChange={e => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              <button
                onClick={() => fetchSheet(sheetUrl)}
                disabled={!sheetUrl || loading}
                className="px-5 py-2.5 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '불러오는 중...' : '불러오기'}
              </button>
            </div>
            {error && (
              <div className="mt-3 p-3 bg-orange-50 border border-orange-100 rounded-lg">
                <p className="text-sm text-orange-600 mb-1">{error}</p>
                <p className="text-xs text-orange-400">시트 공유 설정을 "링크가 있는 모든 사용자"로 변경하거나, <button onClick={() => setTab('manual')} className="underline font-medium">직접 입력</button> 탭을 사용하세요.</p>
              </div>
            )}
          </div>
        )}

        {tab === 'manual' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">단어 직접 입력</label>
            <p className="text-xs text-gray-400 mb-3">형식: <code className="bg-gray-100 px-1 rounded">영어 | 한국어</code> (한 줄에 하나씩)</p>
            <textarea
              value={manualText}
              onChange={e => setManualText(e.target.value)}
              placeholder={`T-shirt | 티셔츠\ndress | 원피스\nsweater | 니트`}
              rows={8}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none"
            />
            <button
              onClick={parseManual}
              disabled={!manualText.trim()}
              className="mt-3 px-5 py-2.5 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              단어 목록 확인
            </button>
          </div>
        )}

        {words.length > 0 && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">단어 목록 ({words.length}개)</h2>
                <span className="text-xs text-gray-400">타입을 수정할 수 있어요</span>
              </div>
              <div className="space-y-1">
                {words.map((word, idx) => (
                  <div key={`${word.id}-${idx}`} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                    <span className="font-medium text-gray-900 w-36 shrink-0">{word.en}</span>
                    <span className="text-gray-500 text-sm w-24 shrink-0">{word.ko}</span>
                    <select
                      value={word.type}
                      onChange={e => updateType(idx, e.target.value as Word['type'])}
                      className="ml-auto text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    >
                      {Object.entries(TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={startGeneration}
              className="w-full py-3.5 bg-teal-500 text-white rounded-xl font-semibold hover:bg-teal-600 transition-colors text-base"
            >
              일러스트 생성 시작 ({words.length}개) →
            </button>
          </>
        )}
      </div>
    </main>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">로딩 중...</div>}>
      <HomeContent />
    </Suspense>
  )
}
