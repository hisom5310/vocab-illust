'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { idbGet, idbSet } from '../lib/storage'

type Word = { id: string; en: string; ko: string; type: 'A' | 'B' | 'C' | 'D' }
type Result = { word: Word; image: string | null; error: string | null; lang?: string }
type Status = 'pending' | 'approved' | 'rejected'
type CardState = {
  result: Result
  status: Status
  comment: string
  regenerating: boolean
  newImage: string | null
  isNew: boolean
  langs: string[]
}

type FilterType = 'all' | 'approved' | 'pending' | 'regenerated'

const TYPE_LABELS: Record<string, string> = {
  A: 'A — 사물/장소', B: 'B — 직업/역할', C: 'C — 동사/감정', D: 'D — 자연/계절',
}

const PRESET_LANGS = ['ENKO', 'FREN', 'JAEN', 'KOEN', 'KOJA', 'KOFR', 'ESEN']

function detectLang(text: string): string {
  if (!text) return ''
  if (/[぀-ヿ]/.test(text)) return 'JA'
  if (/[가-힣]/.test(text)) return 'KO'
  if (/[؀-ۿ]/.test(text)) return 'AR'
  if (/[Ѐ-ӿ]/.test(text)) return 'RU'
  if (/[一-鿿]/.test(text)) return 'ZH'
  if (/[ñÑ¿¡]/.test(text)) return 'ES'
  if (/[çÇœŒæÆèéêëàâîïôùûü]/.test(text)) return 'FR'
  if (/[a-zA-Z]/.test(text)) return 'EN'
  return ''
}

function detectCourseTag(targetWord: string, nativeWord: string): string {
  const target = detectLang(targetWord)
  const native = detectLang(nativeWord)
  if (target && native && target !== native) return target + native
  return target || ''
}

function parseLines(text: string, startIdx: number): Word[] {
  return text.trim().split('\n')
    .filter(l => l.trim())
    .map((line, i) => {
      let parts = line.split(/[|,\t\/]|\s*:\s*/).map(p => p.trim()).filter(Boolean)
      if (parts.length < 2) {
        const tokens = line.trim().split(/\s+/)
        let boundary = -1
        for (let j = 1; j < tokens.length; j++) {
          if (detectLang(tokens[j - 1]) !== detectLang(tokens[j])) { boundary = j; break }
        }
        if (boundary > 0) parts = [tokens.slice(0, boundary).join(' '), tokens.slice(boundary).join(' ')]
      }
      return { id: `WORD${String(startIdx + i + 1).padStart(3, '0')}`, en: parts[0] || '', ko: parts[1] || '', type: 'A' as const }
    })
    .filter(w => w.en && w.ko)
}

type SessionMeta = { id: string; createdAt: string; lang: string; course: string; count: number }
type ServerResult = { word: Word; imageUrl: string | null; error: string | null; lang?: string }
type ServerSession = {
  id: string; createdAt: string; lang: string; course: string
  results: ServerResult[]
  statuses: { id: string; status: Status; comment: string; isNew?: boolean; langs?: string[] }[]
}

export default function ReviewPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [cards, setCards] = useState<CardState[]>([])
  const [selectedLang, setSelectedLang] = useState<string>('all')
  const [filter, setFilter] = useState<FilterType>('all')
  const [expandedComment, setExpandedComment] = useState<number | null>(null)
  const [refImages, setRefImages] = useState<Record<number, string>>({})
  const [lbRefImage, setLbRefImage] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [lightboxComment, setLightboxComment] = useState(false)
  const [addPanel, setAddPanel] = useState(false)
  const [addText, setAddText] = useState('')
  const [addLang, setAddLang] = useState('')
  const [addWords, setAddWords] = useState<Word[]>([])
  const [addGenerating, setAddGenerating] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [vectorizing, setVectorizing] = useState<Set<number>>(new Set())
  const [pendingSaved, setPendingSaved] = useState(0)
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null)
  const [loadingSession, setLoadingSession] = useState(false)
  const [selectedCards, setSelectedCards] = useState<Set<number>>(new Set())

  const loadSessionIntoState = (session: ServerSession) => {
    const statusMap = Object.fromEntries((session.statuses ?? []).map(s => [s.id, s]))
    setCards(session.results.map(r => {
      const saved = statusMap[r.word.id]
      const image = r.imageUrl ?? null
      const autoLang = detectCourseTag(r.word.en, r.word.ko)
      const primaryLang = (r.lang && r.lang.length >= 4 ? r.lang : null)
        || (saved?.langs || []).find(l => l.length >= 4)
        || autoLang
      return {
        result: { word: r.word, image, error: r.error, lang: r.lang },
        status: saved?.status ?? 'pending',
        comment: saved?.comment ?? '',
        regenerating: false,
        newImage: null,
        isNew: saved?.isNew ?? false,
        langs: primaryLang ? [primaryLang] : [],
      }
    }))
    setRecovering(false)
  }

  const restoreSession = async (sessionId: string) => {
    setLoadingSession(true)
    try {
      const res = await fetch(`/api/storage/sessions/${sessionId}`)
      const session: ServerSession = await res.json()
      // Persist to IndexedDB so it survives page refreshes
      const results: Result[] = session.results.map(r => ({
        word: r.word, image: r.imageUrl, error: r.error, lang: r.lang,
      }))
      await idbSet('vocab-results', results)
      await idbSet('vocab-card-statuses', session.statuses ?? [])
      loadSessionIntoState(session)
    } catch {
      alert('세션 불러오기 실패')
    }
    setLoadingSession(false)
  }

  useEffect(() => {
    Promise.all([
      idbGet<Result[]>('vocab-results'),
      idbGet<{ id: string; status: Status; comment: string; isNew?: boolean; langs?: string[] }[]>('vocab-card-statuses'),
    ]).then(([results, statuses]) => {
      if (!results) {
        setRecovering(true)
        fetch('/api/storage/sessions')
          .then(r => r.json())
          .then(({ sessions: s }) => setSessions(s ?? []))
          .catch(() => setSessions([]))
        return
      }
      const statusMap: Record<string, { status: Status; comment: string; isNew?: boolean; langs?: string[] }> =
        statuses ? Object.fromEntries(statuses.map(s => [s.id, s])) : {}
      setCards(results.map(r => {
        const savedLangs = statusMap[r.word.id]?.langs
        const sourceLang = r.lang && r.lang.length >= 4 ? r.lang : null
        const savedValidLang = (savedLangs || []).find(l => l.length >= 4)
        const autoLang = detectCourseTag(r.word.en, r.word.ko)
        // Single lang per card. Priority: r.lang > savedLangs (first) > autoLang
        const primaryLang = sourceLang || savedValidLang || autoLang
        const langs = primaryLang ? [primaryLang] : []
        return {
          result: r,
          status: statusMap[r.word.id]?.status ?? 'pending',
          comment: statusMap[r.word.id]?.comment ?? '',
          regenerating: false,
          newImage: null,
          isNew: statusMap[r.word.id]?.isNew ?? false,
          langs,
        }
      }))
    })
  }, [router])

  useEffect(() => {
    if (cards.length === 0) return
    const results = cards.map(c => ({ ...c.result, image: c.newImage ?? c.result.image }))
    idbSet('vocab-results', results)
    const statuses = cards.map(c => ({
      id: c.result.word.id, status: c.status, comment: c.comment, isNew: c.isNew, langs: c.langs,
    }))
    idbSet('vocab-card-statuses', statuses)
  }, [cards])

  const setStatus = (idx: number, status: Status) => {
    setCards(prev => prev.map((c, i) =>
      i === idx ? { ...c, status, isNew: status === 'approved' ? false : c.isNew } : c
    ))
  }

  const deleteCard = (idx: number) => {
    if (lightbox !== null) {
      if (lightbox === idx) closeLightbox()
      else if (lightbox > idx) setLightbox(prev => prev !== null ? prev - 1 : null)
    }
    setCards(prev => prev.filter((_, i) => i !== idx))
  }

  const setComment = (idx: number, comment: string) => {
    setCards(prev => prev.map((c, i) => i === idx ? { ...c, comment } : c))
  }

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = e => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const regenerate = async (idx: number, referenceImage?: string) => {
    const card = cards[idx]
    setCards(prev => prev.map((c, i) => i === idx ? { ...c, regenerating: true, isNew: false } : c))
    setLightboxComment(false)
    setRefImages(prev => { const n = { ...prev }; delete n[idx]; return n })
    setLbRefImage(null)
    try {
      const r = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: card.result.word,
          type: card.result.word.type,
          feedback: card.comment || undefined,
          referenceImage: referenceImage || undefined,
        }),
      })
      const data = await r.json()
      setCards(prev => prev.map((c, i) =>
        i === idx ? { ...c, regenerating: false, newImage: data.image || null, status: 'pending', isNew: true } : c
      ))
    } catch {
      setCards(prev => prev.map((c, i) => i === idx ? { ...c, regenerating: false } : c))
    }
  }

  const downloadSingle = (card: CardState) => {
    const img = card.newImage || card.result.image
    if (!img) return
    const a = document.createElement('a')
    a.href = img
    a.download = `${card.result.word.id}_${card.result.word.en.replace(/\s+/g, '_')}.png`
    a.click()
  }

  const downloadSVG = async (card: CardState, idx: number) => {
    const img = card.newImage || card.result.image
    if (!img) return
    setVectorizing(prev => new Set(prev).add(idx))
    const filename = `${card.result.word.id}_${card.result.word.en.replace(/\s+/g, '_')}.png`
    try {
      if (window.location.hostname === 'localhost') {
        const res = await fetch('/api/local/save-pending', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: img, filename }),
        })
        if (res.ok) {
          setPendingSaved(n => n + 1)
          return
        }
      }
      // 프로덕션 폴백: imagetracerjs
      const image = new Image()
      image.src = img
      await new Promise<void>(resolve => { image.onload = () => resolve() })
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const ImageTracer = (await import('imagetracerjs')).default
      const svgStr = ImageTracer.imagedataToSVG(imageData, {
        numberofcolors: 16, pathomit: 4, blurradius: 0,
        ltres: 1, qtres: 1, roundcoords: 2, viewbox: true, desc: false,
      })
      const blob = new Blob([svgStr], { type: 'image/svg+xml' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${card.result.word.id}_${card.result.word.en.replace(/\s+/g, '_')}.svg`
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setVectorizing(prev => { const s = new Set(prev); s.delete(idx); return s })
    }
  }

  const openLightbox = (idx: number) => { setLightbox(idx); setLightboxComment(false) }
  const closeLightbox = useCallback(() => { setLightbox(null); setLightboxComment(false) }, [])
  const prevImage = useCallback(() => { setLightbox(prev => prev !== null ? Math.max(0, prev - 1) : null); setLightboxComment(false) }, [])
  const nextImage = useCallback(() => { setLightbox(prev => prev !== null ? Math.min(cards.length - 1, prev + 1) : null); setLightboxComment(false) }, [cards.length])

  useEffect(() => {
    if (lightbox === null) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prevImage()
      if (e.key === 'ArrowRight') nextImage()
      if (e.key === 'Escape') closeLightbox()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox, prevImage, nextImage, closeLightbox])

  const parseAddText = () => setAddWords(parseLines(addText, cards.length))

  const handleAddFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      setAddText(text.trim())
      setAddWords(parseLines(text, cards.length))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const updateAddType = (idx: number, type: Word['type']) => {
    setAddWords(prev => prev.map((w, i) => i === idx ? { ...w, type } : w))
  }

  const generateAdd = async () => {
    if (addWords.length === 0) return
    setAddGenerating(true)
    const currentCards = cards

    // Auto-detect lang from words if addLang is empty
    const detectedLang = detectCourseTag(addWords[0]?.en || '', addWords[0]?.ko || '')
    const lang = (addLang.trim().toUpperCase()) || detectedLang

    const duplicateIndices: number[] = []
    const newWords: Word[] = []
    for (const word of addWords) {
      const existingIdx = currentCards.findIndex(
        c => c.result.word.en.toLowerCase() === word.en.toLowerCase()
      )
      if (existingIdx !== -1) duplicateIndices.push(existingIdx)
      else newWords.push(word)
    }

    if (lang && duplicateIndices.length > 0) {
      setCards(prev => prev.map((c, i) =>
        duplicateIndices.includes(i) && !c.langs.includes(lang)
          ? { ...c, langs: [...c.langs, lang] }
          : c
      ))
    }

    setAddPanel(false)
    setAddText('')
    setAddWords([])

    if (newWords.length === 0) { setAddGenerating(false); return }

    const startIdx = currentCards.length
    setCards(prev => [...prev, ...newWords.map(w => ({
      result: { word: w, image: null, error: null },
      status: 'pending' as Status, comment: '', regenerating: true, newImage: null, isNew: false,
      langs: lang ? [lang] : [],
    }))])

    for (let i = 0; i < newWords.length; i++) {
      try {
        const r = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word: newWords[i], type: newWords[i].type }),
        })
        const data = await r.json()
        setCards(prev => prev.map((c, ci) =>
          ci === startIdx + i
            ? { ...c, regenerating: false, isNew: true, result: { ...c.result, image: data.image || null, error: data.error || null } }
            : c
        ))
      } catch {
        setCards(prev => prev.map((c, ci) =>
          ci === startIdx + i ? { ...c, regenerating: false, result: { ...c.result, error: '생성 실패' } } : c
        ))
      }
    }
    setAddGenerating(false)
  }

  // Derived data
  const cardLangs = [...new Set(cards.flatMap(c => c.langs).filter(Boolean))]
  const allLangs = [...new Set([...PRESET_LANGS, ...cardLangs])]

  const langFilteredCards: { card: CardState; idx: number }[] =
    selectedLang === 'all'
      ? cards.map((card, idx) => ({ card, idx }))
      : cards.map((card, idx) => ({ card, idx })).filter(({ card }) => card.langs.includes(selectedLang))

  const filteredCards =
    filter === 'all' ? langFilteredCards :
    filter === 'approved' ? langFilteredCards.filter(({ card }) => card.status === 'approved') :
    filter === 'pending' ? langFilteredCards.filter(({ card }) => card.status !== 'approved') :
    langFilteredCards.filter(({ card }) => card.isNew)

  const approvedCount = langFilteredCards.filter(({ card }) => card.status === 'approved').length
  const pendingCount = langFilteredCards.filter(({ card }) => card.status === 'pending').length
  const regeneratedCount = langFilteredCards.filter(({ card }) => card.isNew).length

  const downloadApproved = () => {
    langFilteredCards.filter(({ card }) => card.status === 'approved').forEach(({ card }) => downloadSingle(card))
  }

  const toggleSelect = (idx: number) => {
    setSelectedCards(prev => { const s = new Set(prev); s.has(idx) ? s.delete(idx) : s.add(idx); return s })
  }
  const clearSelection = () => setSelectedCards(new Set())
  const selectAll = () => setSelectedCards(new Set(filteredCards.map(({ idx }) => idx)))
  const downloadSelected = () => {
    filteredCards.filter(({ idx }) => selectedCards.has(idx)).forEach(({ card }) => downloadSingle(card))
  }

  const lbCard = lightbox !== null ? cards[lightbox] : null

  const addWordDups = addWords.filter(w =>
    cards.some(c => c.result.word.en.toLowerCase() === w.en.toLowerCase())
  )
  const addWordNew = addWords.filter(w =>
    !cards.some(c => c.result.word.en.toLowerCase() === w.en.toLowerCase())
  )

  if (recovering) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-lg w-full mx-4">
          <h2 className="text-xl font-bold text-gray-900 mb-1">저장된 데이터가 없어요</h2>
          <p className="text-sm text-gray-500 mb-6">서버에 백업된 세션을 불러올 수 있어요.</p>

          {sessions === null ? (
            <p className="text-sm text-gray-400">세션 목록 불러오는 중...</p>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              <p>서버에 저장된 세션이 없어요.</p>
              <button onClick={() => router.push('/')} className="mt-4 text-teal-600 underline text-sm">
                새로 생성하기
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => restoreSession(s.id)}
                  disabled={loadingSession}
                  className="w-full text-left px-4 py-3 bg-white border border-gray-200 rounded-xl hover:border-teal-400 hover:bg-teal-50 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-gray-800">
                        {s.course || s.lang || '알 수 없는 코스'}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">{s.count}개</span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(s.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </button>
              ))}
              <button onClick={() => router.push('/')} className="mt-2 text-sm text-gray-400 underline w-full text-center pt-2">
                새로 생성하기
              </button>
            </div>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6">

        {/* pending-svg 저장 배너 */}
        {pendingSaved > 0 && (
          <div className="mt-6 flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-700">
            <span>📁 {pendingSaved}개 PNG가 <code className="bg-teal-100 px-1 rounded">pending-svg/</code>에 저장됨 — Claude에게 SVG 변환을 요청하세요</span>
            <button onClick={() => setPendingSaved(0)} className="text-teal-400 hover:text-teal-600 ml-4">✕</button>
          </div>
        )}

        {/* ① Header */}
        <div className="pt-10 pb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">생성한 일러스트</h1>
            <p className="mt-1 text-sm text-gray-500">
              승인 {approvedCount} · 대기 {pendingCount} · 총 {langFilteredCards.length}개
              {selectedLang !== 'all' && (
                <span className="ml-2 px-1.5 py-0.5 bg-teal-50 text-teal-600 text-xs rounded font-medium">{selectedLang}</span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            {selectedCards.size > 0 && (
              <button
                onClick={downloadSelected}
                className="px-5 py-2.5 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-600 transition-colors"
              >
                선택 다운로드 ({selectedCards.size})
              </button>
            )}
            <button
              onClick={() => {
                setAddPanel(v => !v)
                if (!addPanel && selectedLang !== 'all') setAddLang(selectedLang)
              }}
              className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              + 단어 추가 생성
            </button>
            <button
              onClick={downloadApproved}
              disabled={approvedCount === 0}
              className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              승인 다운로드 ({approvedCount})
            </button>
          </div>
        </div>

        {/* ② Language tabs — always visible, page-level navigation */}
        <div className="border-b border-gray-200">
          <div className="flex">
            <button
              onClick={() => { setSelectedLang('all'); setFilter('all') }}
              className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                selectedLang === 'all'
                  ? 'border-teal-500 text-teal-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-300'
              }`}
            >
              All
              <span className={`ml-2 text-xs font-normal tabular-nums ${selectedLang === 'all' ? 'text-teal-400' : 'text-gray-400'}`}>
                {cards.length}
              </span>
            </button>
            {allLangs.map(lang => (
              <button
                key={lang}
                onClick={() => { setSelectedLang(lang); setFilter('all') }}
                className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  selectedLang === lang
                    ? 'border-teal-500 text-teal-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-300'
                }`}
              >
                {lang}
                <span className={`ml-2 text-xs font-normal tabular-nums ${selectedLang === lang ? 'text-teal-400' : 'text-gray-400'}`}>
                  {cards.filter(c => c.langs.includes(lang)).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="pt-6 pb-10">

          {/* ③ Add panel */}
          {addPanel && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
              <div className="mb-4 pb-4 border-b border-gray-100">
                <label className="text-xs font-medium text-gray-600 block mb-2">언어 선택</label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_LANGS.map(tag => (
                    <button
                      key={tag}
                      onClick={() => setAddLang(addLang === tag ? '' : tag)}
                      className={`px-3 py-1 text-xs font-semibold rounded-full border transition-colors ${
                        addLang === tag
                          ? 'bg-teal-500 text-white border-teal-500'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-teal-400 hover:text-teal-600'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                  <input
                    value={PRESET_LANGS.includes(addLang) ? '' : addLang}
                    onChange={e => setAddLang(e.target.value.toUpperCase())}
                    placeholder="직접 입력"
                    maxLength={6}
                    className="w-20 border border-gray-200 rounded-full px-2.5 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-gray-900 text-sm">단어 추가 생성</h3>
                <button onClick={() => fileRef.current?.click()} className="text-xs text-teal-600 hover:text-teal-700 font-medium">
                  파일 업로드 (CSV / TXT)
                </button>
                <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={handleAddFile} />
              </div>
              <p className="text-xs text-gray-400 mb-3">
                형식: <code className="bg-gray-100 px-1 rounded">학습어 | 모국어</code> 또는 <code className="bg-gray-100 px-1 rounded">학습어/모국어</code>
              </p>
              <textarea
                value={addText}
                onChange={e => setAddText(e.target.value)}
                placeholder={`사과/apple\n티셔츠 | T-shirt`}
                rows={4}
                className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none mb-3"
              />
              {addWords.length === 0 ? (
                <button
                  onClick={parseAddText}
                  disabled={!addText.trim()}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-40 transition-colors"
                >
                  단어 확인
                </button>
              ) : (
                <>
                  <div className="space-y-1 mb-3">
                    {addWords.map((w, i) => {
                      const isDup = cards.some(c => c.result.word.en.toLowerCase() === w.en.toLowerCase())
                      return (
                        <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                          <span className="font-medium text-sm text-gray-900 w-32 shrink-0">{w.en}</span>
                          <span className="text-sm text-gray-400 w-20 shrink-0">{w.ko}</span>
                          {isDup ? (
                            <span className="ml-auto text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full border border-amber-200">태그 추가</span>
                          ) : (
                            <select
                              value={w.type}
                              onChange={e => updateAddType(i, e.target.value as Word['type'])}
                              className="ml-auto text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 focus:outline-none"
                            >
                              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {addWordDups.length > 0 && (
                    <p className="text-xs text-amber-600 mb-2">
                      {addWordDups.length}개는 이미 존재 — 언어 태그만 추가됩니다.
                      {addWordNew.length > 0 && ` ${addWordNew.length}개 신규 생성.`}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => setAddWords([])} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                      다시 입력
                    </button>
                    <button
                      onClick={generateAdd}
                      disabled={addGenerating}
                      className="flex-1 py-2 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-40 transition-colors"
                    >
                      {addGenerating ? '생성 중...' : (
                        addWordNew.length > 0
                          ? `일러스트 생성 (${addWordNew.length}개)${addWordDups.length > 0 ? ` + 태그 추가 (${addWordDups.length}개)` : ''}`
                          : `태그 추가 (${addWordDups.length}개)`
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ④ Status filter tabs + selection controls */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
              {([
                ['all', '전체', langFilteredCards.length],
                ['approved', '승인됨', approvedCount],
                ['pending', '승인전', langFilteredCards.filter(({ card }) => card.status !== 'approved').length],
                ['regenerated', '재생성', regeneratedCount],
              ] as [FilterType, string, number][]).map(([key, label, count]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    filter === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                  {count > 0 && <span className="ml-1.5 text-xs tabular-nums text-gray-400">{count}</span>}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              {selectedCards.size > 0 && (
                <span className="text-sm text-teal-600 font-medium">{selectedCards.size}개 선택됨</span>
              )}
              <button
                onClick={selectedCards.size > 0 ? clearSelection : selectAll}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                {selectedCards.size > 0 ? '선택 해제' : '전체 선택'}
              </button>
            </div>
          </div>

          {/* ⑤ Cards grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {filteredCards.map(({ card, idx }) => {
              const img = card.newImage || card.result.image
              return (
                <div
                  key={card.result.word.id}
                  className={`bg-white rounded-xl border-2 overflow-hidden transition-colors ${
                    card.status === 'approved' ? 'border-teal-400' :
                    card.status === 'rejected' ? 'border-red-300' : 'border-gray-200'
                  }`}
                >
                  <div className="px-3 pt-2 pb-1 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedCards.has(idx)}
                      onChange={() => toggleSelect(idx)}
                      className="w-3.5 h-3.5 rounded accent-teal-500 cursor-pointer shrink-0"
                    />
                    {card.isNew && !card.regenerating && (
                      <span className="text-xs bg-orange-400 text-white px-1.5 py-0.5 rounded-full font-semibold leading-none">NEW</span>
                    )}
                  </div>
                  <div
                    className="aspect-square bg-gray-50 relative cursor-pointer group"
                    onClick={() => img && openLightbox(idx)}
                  >
                    {card.regenerating ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : img ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img} alt={card.result.word.en} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/40 px-2 py-1 rounded-full transition-opacity">미리보기</span>
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-red-400">생성 실패</div>
                    )}

                    {card.status === 'approved' && (
                      <div className="absolute top-2 right-2 bg-teal-500 text-white text-xs px-2 py-0.5 rounded-full">승인</div>
                    )}
                    {card.langs.length > 0 && (
                      <div className="absolute bottom-2 left-2 flex gap-1 flex-wrap">
                        {card.langs.map(l => (
                          <span key={l} className="text-xs px-1.5 py-0.5 bg-black/30 text-white rounded backdrop-blur-sm">{l}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-3">
                    <p className="text-xs font-semibold text-gray-900 mb-0.5">{card.result.word.en}</p>
                    <p className="text-xs text-gray-400 mb-3">{card.result.word.ko}</p>

                    <div className="flex gap-1.5 mb-2">
                      <button
                        onClick={() => setStatus(idx, card.status === 'approved' ? 'pending' : 'approved')}
                        className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          card.status === 'approved'
                            ? 'bg-teal-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-teal-50 hover:text-teal-600'
                        }`}
                      >
                        {card.status === 'approved' ? '✓ 승인됨' : '승인'}
                      </button>
                      <button
                        onClick={() => setExpandedComment(expandedComment === idx ? null : idx)}
                        className="flex-1 py-1.5 bg-gray-100 text-gray-600 rounded-md text-xs font-medium hover:bg-orange-50 hover:text-orange-500 transition-colors"
                      >
                        재생성
                      </button>
                      <button
                        onClick={() => downloadSingle(card)}
                        disabled={!(card.newImage || card.result.image)}
                        title="PNG 저장"
                        className="w-7 py-1.5 bg-gray-100 text-gray-500 rounded-md text-xs font-medium hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => downloadSVG(card, idx)}
                        disabled={!(card.newImage || card.result.image) || vectorizing.has(idx)}
                        title="SVG 변환 후 저장"
                        className="w-9 py-1.5 bg-gray-100 text-gray-500 rounded-md text-xs font-medium hover:bg-purple-50 hover:text-purple-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                      >
                        {vectorizing.has(idx) ? (
                          <span className="inline-block w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin" />
                        ) : 'SVG'}
                      </button>
                      <button
                        onClick={() => deleteCard(idx)}
                        title="삭제"
                        className="w-7 py-1.5 bg-gray-100 text-gray-400 rounded-md text-xs font-medium hover:bg-red-50 hover:text-red-400 transition-colors flex items-center justify-center"
                      >
                        ✕
                      </button>
                    </div>

                    {expandedComment === idx && (
                      <div className="mt-1">
                        <textarea
                          value={card.comment}
                          onChange={e => setComment(idx, e.target.value)}
                          placeholder="수정 요청 사항 (선택)&#10;예: 배경 색상 변경, 크기 조정"
                          rows={2}
                          className="w-full text-xs text-gray-900 border border-gray-200 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-orange-300 mb-1.5"
                        />
                        <label className="flex items-center gap-1.5 cursor-pointer mb-1.5">
                          <input
                            type="file" accept="image/*" className="hidden"
                            onChange={async e => {
                              const file = e.target.files?.[0]
                              if (file) {
                                const b64 = await readFileAsBase64(file)
                                setRefImages(prev => ({ ...prev, [idx]: b64 }))
                              }
                              e.target.value = ''
                            }}
                          />
                          <span className="text-xs text-teal-600 hover:text-teal-700 font-medium">
                            {refImages[idx] ? '✓ 레퍼런스 첨부됨' : '+ 레퍼런스 이미지'}
                          </span>
                          {refImages[idx] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={refImages[idx]} alt="" className="w-8 h-8 rounded object-cover" />
                          )}
                        </label>
                        <button
                          onClick={() => { regenerate(idx, refImages[idx]); setExpandedComment(null) }}
                          className="w-full py-1.5 bg-orange-400 text-white rounded-md text-xs font-medium hover:bg-orange-500 transition-colors"
                        >
                          다시 생성
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

        </div>
      </div>

      {/* Lightbox */}
      {lightbox !== null && lbCard && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center" onClick={closeLightbox}>
          <div
            className="relative bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{ width: 520, maxWidth: '95vw' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="relative bg-gray-50 aspect-square">
              {lbCard.regenerating ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (lbCard.newImage || lbCard.result.image) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lbCard.newImage || lbCard.result.image!} alt={lbCard.result.word.en} className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-red-400">생성 실패</div>
              )}

              {lightbox > 0 && (
                <button onClick={prevImage} className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow text-gray-700 text-lg">‹</button>
              )}
              {lightbox < cards.length - 1 && (
                <button onClick={nextImage} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow text-gray-700 text-lg">›</button>
              )}
              <button onClick={closeLightbox} className="absolute top-3 right-3 w-8 h-8 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow text-gray-500 text-sm">✕</button>

              {lbCard.status === 'approved' && (
                <div className="absolute top-3 left-3 bg-teal-500 text-white text-xs px-2.5 py-1 rounded-full">승인</div>
              )}
              {lbCard.isNew && !lbCard.regenerating && (
                <div className="absolute top-3 left-3 bg-orange-400 text-white text-xs px-2.5 py-1 rounded-full font-semibold">NEW</div>
              )}
              {lbCard.langs.length > 0 && (
                <div className="absolute bottom-3 left-3 flex gap-1.5 flex-wrap">
                  {lbCard.langs.map(l => (
                    <span key={l} className="text-xs px-2 py-0.5 bg-black/30 text-white rounded-full backdrop-blur-sm font-medium">{l}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-semibold text-gray-900">{lbCard.result.word.en}</p>
                  <p className="text-sm text-gray-400">{lbCard.result.word.ko}</p>
                </div>
                <p className="text-xs text-gray-300">{lightbox + 1} / {cards.length}</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStatus(lightbox, lbCard.status === 'approved' ? 'pending' : 'approved')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    lbCard.status === 'approved' ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-teal-50 hover:text-teal-600'
                  }`}
                >
                  {lbCard.status === 'approved' ? '✓ 승인됨' : '승인'}
                </button>
                <button
                  onClick={() => setLightboxComment(v => !v)}
                  className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-orange-50 hover:text-orange-500 transition-colors"
                >
                  재생성
                </button>
                <button
                  onClick={() => downloadSingle(lbCard)}
                  disabled={!(lbCard.newImage || lbCard.result.image)}
                  className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 disabled:opacity-30 transition-colors"
                >
                  ↓ 저장
                </button>
                <button
                  onClick={() => deleteCard(lightbox)}
                  className="px-4 py-2.5 bg-gray-100 text-gray-400 rounded-xl text-sm font-medium hover:bg-red-50 hover:text-red-400 transition-colors"
                >
                  삭제
                </button>
              </div>

              {lightboxComment && (
                <div className="mt-3">
                  <textarea
                    value={lbCard.comment}
                    onChange={e => setComment(lightbox, e.target.value)}
                    placeholder="수정 요청 사항 (선택)"
                    rows={2}
                    className="w-full text-sm text-gray-900 border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 mb-2"
                  />
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input
                      type="file" accept="image/*" className="hidden"
                      onChange={async e => {
                        const file = e.target.files?.[0]
                        if (file) readFileAsBase64(file).then(setLbRefImage)
                        e.target.value = ''
                      }}
                    />
                    <span className="text-sm text-teal-600 hover:text-teal-700 font-medium">
                      {lbRefImage ? '✓ 레퍼런스 첨부됨' : '+ 레퍼런스 이미지'}
                    </span>
                    {lbRefImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={lbRefImage} alt="" className="w-10 h-10 rounded object-cover" />
                    )}
                  </label>
                  <button
                    onClick={() => regenerate(lightbox, lbRefImage ?? undefined)}
                    className="w-full py-2.5 bg-orange-400 text-white rounded-xl text-sm font-medium hover:bg-orange-500 transition-colors"
                  >
                    다시 생성
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
