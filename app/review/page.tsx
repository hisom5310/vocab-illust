'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

type Word = { id: string; en: string; ko: string; type: 'A' | 'B' | 'C' | 'D' }
type Result = { word: Word; image: string | null; error: string | null }
type Status = 'pending' | 'approved' | 'rejected'
type CardState = {
  result: Result
  status: Status
  comment: string
  regenerating: boolean
  newImage: string | null
}

const TYPE_LABELS: Record<string, string> = {
  A: 'A — 사물/장소', B: 'B — 직업/역할', C: 'C — 동사/감정', D: 'D — 자연/계절',
}

function parseLines(text: string, startIdx: number): Word[] {
  return text.trim().split('\n')
    .filter(l => l.trim())
    .map((line, i) => {
      const parts = line.split(/[|,\t]/).map(p => p.trim())
      return { id: `WORD${String(startIdx + i + 1).padStart(3, '0')}`, en: parts[0] || '', ko: parts[1] || '', type: 'A' as const }
    })
    .filter(w => w.en && w.ko)
}

export default function ReviewPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [cards, setCards] = useState<CardState[]>([])
  const [expandedComment, setExpandedComment] = useState<number | null>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [lightboxComment, setLightboxComment] = useState(false)
  const [addPanel, setAddPanel] = useState(false)
  const [addText, setAddText] = useState('')
  const [addWords, setAddWords] = useState<Word[]>([])
  const [addGenerating, setAddGenerating] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('vocab-results')
    if (!stored) { router.push('/'); return }
    const results: Result[] = JSON.parse(stored)
    setCards(results.map(r => ({
      result: r,
      status: 'pending',
      comment: '',
      regenerating: false,
      newImage: null,
    })))
  }, [router])

  const setStatus = (idx: number, status: Status) => {
    setCards(prev => prev.map((c, i) => i === idx ? { ...c, status } : c))
  }

  const setComment = (idx: number, comment: string) => {
    setCards(prev => prev.map((c, i) => i === idx ? { ...c, comment } : c))
  }

  const regenerate = async (idx: number) => {
    const card = cards[idx]
    setCards(prev => prev.map((c, i) => i === idx ? { ...c, regenerating: true } : c))
    setLightboxComment(false)
    try {
      const r = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: card.result.word,
          type: card.result.word.type,
          feedback: card.comment || undefined,
        }),
      })
      const data = await r.json()
      setCards(prev => prev.map((c, i) =>
        i === idx ? { ...c, regenerating: false, newImage: data.image || null, status: 'pending' } : c
      ))
    } catch {
      setCards(prev => prev.map((c, i) => i === idx ? { ...c, regenerating: false } : c))
    }
  }

  const downloadApproved = () => {
    cards.forEach(card => {
      if (card.status !== 'approved') return
      const img = card.newImage || card.result.image
      if (!img) return
      const a = document.createElement('a')
      a.href = img
      a.download = `${card.result.word.id}_${card.result.word.en.replace(/\s+/g, '_')}.png`
      a.click()
    })
  }

  const openLightbox = (idx: number) => {
    setLightbox(idx)
    setLightboxComment(false)
  }

  const closeLightbox = useCallback(() => {
    setLightbox(null)
    setLightboxComment(false)
  }, [])

  const prevImage = useCallback(() => {
    setLightbox(prev => prev !== null ? Math.max(0, prev - 1) : null)
    setLightboxComment(false)
  }, [])

  const nextImage = useCallback(() => {
    setLightbox(prev => prev !== null ? Math.min(cards.length - 1, prev + 1) : null)
    setLightboxComment(false)
  }, [cards.length])

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

  const parseAddText = () => {
    const parsed = parseLines(addText, cards.length)
    setAddWords(parsed)
  }

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
    const newCards: CardState[] = addWords.map(w => ({
      result: { word: w, image: null, error: null },
      status: 'pending', comment: '', regenerating: true, newImage: null,
    }))
    setCards(prev => [...prev, ...newCards])
    setAddPanel(false)
    setAddText('')
    setAddWords([])

    const startIdx = cards.length
    for (let i = 0; i < addWords.length; i++) {
      const word = addWords[i]
      try {
        const r = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, type: word.type }),
        })
        const data = await r.json()
        setCards(prev => prev.map((c, ci) =>
          ci === startIdx + i
            ? { ...c, regenerating: false, result: { ...c.result, image: data.image || null, error: data.error || null } }
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

  const approvedCount = cards.filter(c => c.status === 'approved').length
  const pendingCount = cards.filter(c => c.status === 'pending').length
  const lbCard = lightbox !== null ? cards[lightbox] : null

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">생성한 일러스트</h1>
            <p className="mt-1 text-sm text-gray-500">
              승인 {approvedCount} · 대기 {pendingCount} · 총 {cards.length}개
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setAddPanel(v => !v)}
              className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              + 단어 추가 생성
            </button>
            <button
              onClick={downloadApproved}
              disabled={approvedCount === 0}
              className="px-5 py-2.5 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              다운로드 ({approvedCount})
            </button>
          </div>
        </div>

        {/* Add panel */}
        {addPanel && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-gray-900 text-sm">단어 추가 생성</h3>
              <button
                onClick={() => fileRef.current?.click()}
                className="text-xs text-teal-600 hover:text-teal-700 font-medium"
              >
                파일 업로드 (CSV / TXT)
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={handleAddFile} />
            </div>
            <p className="text-xs text-gray-400 mb-3">형식: <code className="bg-gray-100 px-1 rounded">영어 | 한국어</code></p>
            <textarea
              value={addText}
              onChange={e => setAddText(e.target.value)}
              placeholder={`jacket | 재킷\nhat | 모자`}
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
                  {addWords.map((w, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                      <span className="font-medium text-sm text-gray-900 w-32 shrink-0">{w.en}</span>
                      <span className="text-sm text-gray-400 w-20 shrink-0">{w.ko}</span>
                      <select
                        value={w.type}
                        onChange={e => updateAddType(i, e.target.value as Word['type'])}
                        className="ml-auto text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 focus:outline-none"
                      >
                        {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setAddWords([])} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                    다시 입력
                  </button>
                  <button
                    onClick={generateAdd}
                    disabled={addGenerating}
                    className="flex-1 py-2 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-40 transition-colors"
                  >
                    {addGenerating ? '생성 중...' : `일러스트 생성 (${addWords.length}개)`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {cards.map((card, idx) => {
            const img = card.newImage || card.result.image
            return (
              <div
                key={card.result.word.id}
                className={`bg-white rounded-xl border-2 overflow-hidden transition-colors ${
                  card.status === 'approved' ? 'border-teal-400' :
                  card.status === 'rejected' ? 'border-red-300' :
                  'border-gray-200'
                }`}
              >
                {/* Image — click to open lightbox */}
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
                    <div className="w-full h-full flex items-center justify-center text-xs text-red-400">
                      생성 실패
                    </div>
                  )}
                  {card.status === 'approved' && (
                    <div className="absolute top-2 right-2 bg-teal-500 text-white text-xs px-2 py-0.5 rounded-full">
                      승인
                    </div>
                  )}
                </div>

                {/* Info */}
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
                      <button
                        onClick={() => { regenerate(idx); setExpandedComment(null) }}
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

      {/* Lightbox */}
      {lightbox !== null && lbCard && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
          onClick={closeLightbox}
        >
          <div
            className="relative bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{ width: 520, maxWidth: '95vw' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Image area */}
            <div className="relative bg-gray-50 aspect-square">
              {lbCard.regenerating ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (lbCard.newImage || lbCard.result.image) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={lbCard.newImage || lbCard.result.image!}
                  alt={lbCard.result.word.en}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-red-400">생성 실패</div>
              )}

              {/* Nav arrows */}
              {lightbox > 0 && (
                <button
                  onClick={prevImage}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow text-gray-700 text-lg transition-colors"
                >
                  ‹
                </button>
              )}
              {lightbox < cards.length - 1 && (
                <button
                  onClick={nextImage}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow text-gray-700 text-lg transition-colors"
                >
                  ›
                </button>
              )}

              {/* Close */}
              <button
                onClick={closeLightbox}
                className="absolute top-3 right-3 w-8 h-8 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow text-gray-500 text-sm transition-colors"
              >
                ✕
              </button>

              {/* Status badge */}
              {lbCard.status === 'approved' && (
                <div className="absolute top-3 left-3 bg-teal-500 text-white text-xs px-2.5 py-1 rounded-full">승인</div>
              )}
            </div>

            {/* Info + actions */}
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
                    lbCard.status === 'approved'
                      ? 'bg-teal-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-teal-50 hover:text-teal-600'
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
                  <button
                    onClick={() => regenerate(lightbox)}
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
