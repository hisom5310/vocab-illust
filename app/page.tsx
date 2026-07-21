'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { idbSet } from './lib/storage'

type Word = { id: string; en: string; ko: string; type: 'A' | 'B' | 'C' | 'D' }

const TYPE_LABELS: Record<string, string> = {
  A: 'A — 사물/장소',
  B: 'B — 직업/역할',
  C: 'C — 동사/감정',
  D: 'D — 자연/계절',
}

const PRESET_LANGS = ['ENKO', 'KOEN', 'FREN', 'JAEN', 'KOJA', 'KOFR', 'ESEN']

// 언어 코드: 학습어/모국어 각 컬럼의 문자 분석
function detectLang(text: string): string {
  if (!text) return ''
  if (/[぀-ヿ]/.test(text)) return 'JA'  // 히라가나/가타카나 → Japanese
  if (/[가-힣]/.test(text)) return 'KO'  // 한글 → Korean
  if (/[؀-ۿ]/.test(text)) return 'AR'  // Arabic
  if (/[Ѐ-ӿ]/.test(text)) return 'RU'  // Cyrillic
  if (/[一-鿿]/.test(text)) return 'ZH'  // CJK (일본어 체크 후)
  if (/[ñÑ¿¡]/.test(text)) return 'ES'           // 스페인어 특수문자
  if (/[çÇœŒæÆèéêëàâîïôùûü]/.test(text)) return 'FR'  // 프랑스어 특수문자
  if (/[a-zA-Z]/.test(text)) return 'EN'
  return ''
}

// 학습어 + 모국어 두 컬럼으로 코스 태그 생성 (e.g. "apple|사과" → "ENKO")
function detectCourseTag(targetWord: string, nativeWord: string): string {
  const target = detectLang(targetWord)
  const native = detectLang(nativeWord)
  if (target && native && target !== native) return native + target
  return target || ''
}

function autoDetectLang(words: Word[]): string {
  const counts: Record<string, number> = {}
  for (const w of words) {
    const tag = detectCourseTag(w.en, w.ko)
    if (tag) counts[tag] = (counts[tag] || 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
}

function parseLines(text: string): Word[] {
  return text.trim().split('\n')
    .filter(l => l.trim())
    .map(line => {
      let parts = line.split(/[|,\t\/]|\s*:\s*/).map(p => p.trim()).filter(Boolean)
      // Space fallback: "사과 apple" — detect language boundary
      if (parts.length < 2) {
        const tokens = line.trim().split(/\s+/)
        let boundary = -1
        for (let j = 1; j < tokens.length; j++) {
          if (detectLang(tokens[j - 1]) !== detectLang(tokens[j])) { boundary = j; break }
        }
        if (boundary > 0) parts = [tokens.slice(0, boundary).join(' '), tokens.slice(boundary).join(' ')]
      }
      return {
        id: `WORD-${crypto.randomUUID()}`,
        en: parts[0] || '',
        ko: parts[1] || '',
        type: 'A' as const,
      }
    })
    .filter(w => w.en && w.ko)
}

function HomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [manualText, setManualText] = useState('')
  const [words, setWords] = useState<Word[]>([])
  const [courseInfo, setCourseInfo] = useState('')
  const [lang, setLang] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const course = searchParams.get('course')
    const unit = searchParams.get('unit')
    const data = searchParams.get('data')
    if (course && unit) {
      setCourseInfo(`${course} Unit ${unit}`)
      setLang(course)
    }
    if (data) {
      try {
        const decoded: Word[] = JSON.parse(atob(data))
        setWords(decoded)
      } catch { /* ignore */ }
    }
  }, [searchParams])

  const parseManual = () => {
    const parsed = parseLines(manualText)
    if (parsed.length === 0) { setError('단어를 입력해주세요'); return }
    setWords(parsed)
    setError('')
    setLang(autoDetectLang(parsed))
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseLines(text)
      if (parsed.length === 0) { setError('파일에서 단어를 찾을 수 없습니다'); return }
      setWords(parsed)
      setError('')
      setLang(autoDetectLang(parsed))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const updateType = (idx: number, type: Word['type']) => {
    setWords(prev => prev.map((w, i) => i === idx ? { ...w, type } : w))
  }

  const startGeneration = async () => {
    await idbSet('vocab-words', words)
    await idbSet('vocab-course', courseInfo)
    await idbSet('vocab-lang', lang.trim().toUpperCase())
    router.push('/generate')
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">보캡 일러스트 생성툴</h1>
          {courseInfo && <p className="mt-1 text-teal-600 font-medium">{courseInfo}</p>}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          {/* Lang selector */}
          <div className="mb-5 pb-5 border-b border-gray-100">
            <label className="text-sm font-medium text-gray-700 block mb-3">언어 선택</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_LANGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => setLang(lang === tag ? '' : tag)}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                    lang === tag
                      ? 'bg-teal-500 text-white border-teal-500'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-teal-400 hover:text-teal-600'
                  }`}
                >
                  {tag}
                </button>
              ))}
              <input
                value={PRESET_LANGS.includes(lang) ? '' : lang}
                onChange={e => setLang(e.target.value.toUpperCase())}
                placeholder="직접 입력"
                maxLength={6}
                className="w-24 border border-gray-200 rounded-full px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
          </div>

          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">단어 입력</label>
            <button
              onClick={() => fileRef.current?.click()}
              className="text-xs text-teal-600 hover:text-teal-700 font-medium"
            >
              파일 업로드 (CSV / TXT)
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={handleFile} />
          </div>
          <p className="text-xs text-gray-400 mb-3">
            형식: <code className="bg-gray-100 px-1 rounded">학습어 | 모국어</code> 또는 <code className="bg-gray-100 px-1 rounded">학습어/모국어</code> 또는 <code className="bg-gray-100 px-1 rounded">학습어 모국어</code>
          </p>
          <textarea
            value={manualText}
            onChange={e => setManualText(e.target.value)}
            placeholder={`사과/apple\n티셔츠 | T-shirt\n개 dog`}
            rows={8}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none"
          />
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <button
            onClick={parseManual}
            disabled={!manualText.trim()}
            className="mt-3 px-5 py-2.5 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            단어 목록 확인
          </button>
        </div>

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
              {lang ? `[${lang}] ` : ''}일러스트 생성 시작 ({words.length}개) →
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
