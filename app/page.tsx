'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { parseWords } from './lib/parseWords'
import { fetchCourses } from './lib/client'
import { TYPE_LABELS, type CourseSummary, type Word } from './lib/types'

function HomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [course, setCourse] = useState(searchParams.get('course') ?? '')
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [text, setText] = useState('')
  const [words, setWords] = useState<Word[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchCourses().then(setCourses).catch(() => {})
  }, [])

  const parse = (raw: string) => {
    const parsed = parseWords(raw)
    if (parsed.length === 0) { setError('단어를 찾을 수 없어요. 형식을 확인해주세요.'); return }
    setWords(parsed)
    setError('')
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const raw = (ev.target?.result as string) ?? ''
      setText(raw)
      parse(file.name.endsWith('.csv') ? raw.replace(/,/g, '\t') : raw)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const updateWord = (idx: number, patch: Partial<Word>) =>
    setWords(prev => prev.map((w, i) => i === idx ? { ...w, ...patch } : w))

  const start = async () => {
    if (!course.trim()) { setError('코스 이름을 입력해주세요 (예: ESEN Unit 17)'); return }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course: course.trim(), words }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '요청 실패')
      router.push(`/generate?course=${encodeURIComponent(data.course)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청 실패')
      setSubmitting(false)
    }
  }

  const existing = courses.find(c => c.course === course.trim())

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">새 일러스트 만들기</h1>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 space-y-6">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">코스 · 유닛</label>
            <input
              value={course}
              onChange={e => setCourse(e.target.value)}
              list="course-list"
              placeholder="ESEN Unit 17"
              className="w-full sm:w-72 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
            <datalist id="course-list">
              {courses.map(c => <option key={c.slug} value={c.course} />)}
            </datalist>
            <p className="mt-1.5 text-xs text-gray-400">
              {existing
                ? `기존 코스에 추가돼요 (현재 ${existing.total}개). 이미 있는 단어 ID는 건너뜁니다.`
                : '코스 코드(ESEN, FREN…)로 시작하면 그 나라 문화에 맞춰 그려요.'}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">단어</label>
              <button onClick={() => fileRef.current?.click()} className="text-xs text-teal-600 hover:text-teal-700 font-medium">
                파일 업로드 (CSV / TSV / TXT)
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={handleFile} />
            </div>
            <p className="text-xs text-gray-400 mb-2">
              단어장 시트에서 행을 그대로 복사해 붙여넣으면 관리코드·학습어·모국어·한국어를 알아서 읽어요.
              직접 입력은 <code className="bg-gray-100 px-1 rounded">학습어 | 모국어 | 한국어</code> 한 줄에 하나씩.
            </p>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onPaste={e => {
                const pasted = e.clipboardData.getData('text')
                if (pasted.includes('\t')) setTimeout(() => parse(pasted))
              }}
              placeholder={'una limonada | a lemonade | 레모네이드\nun refresco | a soda | 탄산음료'}
              rows={8}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-y"
            />
            <button
              onClick={() => parse(text)}
              disabled={!text.trim()}
              className="mt-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-40 transition-colors"
            >
              단어 목록 확인
            </button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        {words.length > 0 && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900">단어 목록 ({words.length}개)</h2>
                <span className="text-xs text-gray-400">타입을 바꿀 수 있어요 · 동사는 C로 자동 지정</span>
              </div>
              <div className="divide-y divide-gray-50">
                {words.map((w, idx) => (
                  <div key={`${w.id}-${idx}`} className="flex items-center gap-3 py-2 text-sm">
                    <span className="text-xs text-gray-400 w-24 shrink-0 truncate">{w.id.startsWith('WORD-') ? '' : w.id}</span>
                    <span className="font-medium text-gray-900 flex-1 min-w-0 truncate">{w.en}</span>
                    <span className="text-gray-500 flex-1 min-w-0 truncate">{w.ko}</span>
                    <span className="text-gray-400 flex-1 min-w-0 truncate hidden sm:block">{w.kr}</span>
                    <select
                      value={w.type}
                      onChange={e => updateWord(idx, { type: e.target.value as Word['type'] })}
                      className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    >
                      {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <button onClick={() => setWords(prev => prev.filter((_, i) => i !== idx))} className="text-gray-300 hover:text-red-400" title="빼기">✕</button>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={start}
              disabled={submitting || !course.trim()}
              className="w-full py-3.5 bg-teal-500 text-white rounded-xl font-semibold hover:bg-teal-600 disabled:opacity-40 transition-colors"
            >
              {submitting ? '준비 중…' : `${course.trim() || '코스'} — ${words.length}개 생성 시작 →`}
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
