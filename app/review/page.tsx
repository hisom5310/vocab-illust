'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { idbGet, idbSet } from '../lib/storage'
import { fetchCourse, fetchCourses, fileName, generateForCard, saveCardRemote, type GenerateOptions } from '../lib/client'
import { legacyCourse } from '../lib/legacy'
import {
  currentImage, STATUS_LABELS, TYPE_LABELS,
  type Card, type CardStatus, type CourseSummary, type Word,
} from '../lib/types'

type Filter = 'all' | CardStatus | 'trash'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: '검토 대기' },
  { key: 'approved', label: '승인' },
  { key: 'edited', label: '수정 사용' },
  { key: 'redrawn', label: '직접 제작' },
  { key: 'queued', label: '생성 대기' },
  { key: 'trash', label: '휴지통' },
]

// Quick status buttons on each card. Clicking the active one returns the card to "검토 대기".
const QUICK_STATUSES: { status: CardStatus; label: string; active: string }[] = [
  { status: 'approved', label: '승인', active: 'bg-teal-500 text-white border-teal-500' },
  { status: 'edited', label: '수정 사용', active: 'bg-amber-400 text-white border-amber-400' },
  { status: 'redrawn', label: '직접 제작', active: 'bg-gray-700 text-white border-gray-700' },
]

const matches = (card: Card, filter: Filter) =>
  filter === 'trash' ? card.deleted : !card.deleted && (filter === 'all' || card.status === filter)

async function downloadUrl(url: string, name: string) {
  const blob = await (await fetch(url)).blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

// ---------- one-time import of work saved before server storage (v1) ----------

type LegacyResult = { word: Word; image: string | null; error: string | null; lang?: string }

async function importLegacy(): Promise<number> {
  let imported = 0
  try {
    if (!localStorage.getItem('vocab-v2-server-imported')) {
      const res = await fetch('/api/legacy/import', { method: 'POST' })
      if (res.ok) {
        imported += (await res.json()).imported ?? 0
        localStorage.setItem('vocab-v2-server-imported', '1')
      }
    }
  } catch { /* retried next visit */ }

  if (await idbGet<boolean>('vocab-v2-imported')) return imported
  const results = await idbGet<LegacyResult[]>('vocab-results')
  if (!results?.length) {
    await idbSet('vocab-v2-imported', true)
    return imported
  }
  const statuses = await idbGet<{ id: string; status: string; comment: string }[]>('vocab-card-statuses') ?? []
  const statusMap = Object.fromEntries(statuses.map(s => [s.id, s]))
  const lastLang = await idbGet<string>('vocab-lang') ?? ''
  const known = new Map<string, Set<string>>()
  let failed = false
  for (const r of results) {
    if (!r.image) continue
    const course = legacyCourse(r.word.id, r.lang || lastLang)
    if (!known.has(course)) known.set(course, new Set((await fetchCourse(course)).map(c => c.id)))
    const ids = known.get(course)!
    if (ids.has(r.word.id)) continue
    const now = new Date().toISOString()
    const saved = statusMap[r.word.id]
    const card: Card = {
      id: r.word.id, course, word: { ...r.word, type: r.word.type || 'A' },
      status: saved?.status === 'approved' ? 'approved' : 'pending',
      comment: saved?.comment ?? '', error: null, deleted: false, createdAt: now, updatedAt: now,
      ...(r.image.startsWith('http')
        ? { versions: [{ url: r.image, createdAt: now }], current: 0 }
        : { versions: [], current: -1 }),
    }
    try {
      await saveCardRemote(card, r.image.startsWith('data:') ? r.image : undefined)
      ids.add(r.word.id)
      imported++
    } catch {
      failed = true
    }
  }
  // Keep the browser copy until everything made it to the server.
  if (!failed) await idbSet('vocab-v2-imported', true)
  return imported
}

// ---------- page ----------

function ReviewContent() {
  const router = useRouter()
  const params = useSearchParams()
  const [courses, setCourses] = useState<CourseSummary[] | null>(null)
  const [course, setCourse] = useState(params.get('course') ?? '')
  const [cards, setCards] = useState<Card[]>([])
  const [loadedFor, setLoadedFor] = useState('')
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)
  const [saveError, setSaveError] = useState(false)
  const [banner, setBanner] = useState('')
  const [seriesOpen, setSeriesOpen] = useState(false)
  const [zipping, setZipping] = useState(false)

  const cardsRef = useRef<Card[]>([])
  useEffect(() => { cardsRef.current = cards }, [cards])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const reloadCourses = useCallback(() => {
    return fetchCourses().then(list => {
      setCourses(list)
      return list
    }).catch(() => { setCourses([]); return [] as CourseSummary[] })
  }, [])

  useEffect(() => {
    reloadCourses().then(list => {
      setCourse(prev => prev || list[0]?.course || '')
    })
    importLegacy().then(n => {
      if (n > 0) {
        setBanner(`예전 작업 ${n}개를 서버로 옮겼어요. 이제 어느 브라우저에서나 보여요.`)
        reloadCourses()
      }
    })
  }, [reloadCourses])

  useEffect(() => {
    if (!course) return
    router.replace(`/review?course=${encodeURIComponent(course)}`, { scroll: false })
    fetchCourse(course)
      .then(loaded => { setCards(loaded); setLoadError('') })
      .catch(e => setLoadError(e instanceof Error ? e.message : '불러오기 실패'))
      .finally(() => setLoadedFor(course))
  }, [course, router])

  const openCourse = (next: string) => {
    if (next === course) return
    setSelected(new Set())
    setCards([])
    setCourse(next)
  }
  const loading = !!course && loadedFor !== course

  // ----- saving -----

  const persist = useCallback(async (id: string) => {
    const card = cardsRef.current.find(c => c.id === id)
    if (!card) return
    setSaving(n => n + 1)
    try {
      const saved = await saveCardRemote(card)
      // Keep local edits made while the request was in flight; take the server's merged versions.
      setCards(prev => prev.map(c => c.id === id ? { ...c, versions: saved.versions, current: saved.current } : c))
      setSaveError(false)
    } catch {
      setSaveError(true)
    } finally {
      setSaving(n => n - 1)
    }
  }, [])

  const update = useCallback((id: string, patch: Partial<Card>, debounceMs = 0) => {
    // Write the ref inside the updater too, so a save firing before the next render
    // already sees this change.
    setCards(prev => {
      const next = prev.map(c => c.id === id ? { ...c, ...patch } : c)
      cardsRef.current = next
      return next
    })
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id)
      persist(id)
    }, debounceMs))
  }, [persist])

  const retryFailedSaves = () => cardsRef.current.forEach(c => persist(c.id))

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saving > 0 || timers.current.size > 0) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saving])

  // ----- actions -----

  const regenerate = useCallback(async (card: Card, opts: GenerateOptions = {}) => {
    setBusy(prev => new Set(prev).add(card.id))
    const fresh = cardsRef.current.find(c => c.id === card.id) ?? card
    const updated = await generateForCard({ ...fresh, status: fresh.status === 'queued' ? 'queued' : 'pending' }, {
      feedback: fresh.comment || undefined,
      unitWords: cardsRef.current.filter(c => !c.deleted).map(c => c.word.en),
      ...opts,
    })
    setCards(prev => prev.map(c => c.id === card.id ? updated : c))
    setBusy(prev => { const s = new Set(prev); s.delete(card.id); return s })
    if (updated.error) alert(`${card.word.en}: ${updated.error}`)
  }, [])

  const setStatus = (card: Card, status: CardStatus) =>
    update(card.id, { status: card.status === status ? 'pending' : status })

  const bulk = (patch: Partial<Card>) => {
    selected.forEach(id => update(id, patch))
    setSelected(new Set())
  }

  const downloadZip = async (target: Card[]) => {
    const withImage = target.filter(c => currentImage(c))
    if (!withImage.length) return
    setZipping(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      await Promise.all(withImage.map(async c => {
        zip.file(fileName(c), await (await fetch(currentImage(c)!)).blob())
      }))
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${course.replace(/\s+/g, '_')}.zip`
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setZipping(false)
    }
  }

  const runSeries = (base: Card) => {
    const url = currentImage(base)
    if (!url) return
    cards.filter(c => selected.has(c.id) && c.id !== base.id)
      .forEach(c => regenerate(c, { referenceImage: url, series: true }))
    setSeriesOpen(false)
    setSelected(new Set())
  }

  // ----- derived -----

  const visible = cards.filter(c => matches(c, filter))
  const count = (f: Filter) => cards.filter(c => matches(c, f)).length
  const queuedCount = count('queued')
  const approvedCards = cards.filter(c => !c.deleted && c.status === 'approved')
  const lbIndex = lightbox ? visible.findIndex(c => c.id === lightbox) : -1
  const lbCard = lbIndex >= 0 ? visible[lbIndex] : null
  const selectedCards = cards.filter(c => selected.has(c.id))

  // ----- render -----

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex gap-6">
        {/* Course list */}
        <aside className="hidden md:block w-56 shrink-0">
          <div className="sticky top-16">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">코스</h2>
              <button onClick={() => router.push('/')} className="text-xs text-teal-600 hover:text-teal-700 font-medium">+ 새로 만들기</button>
            </div>
            <div className="space-y-0.5 max-h-[calc(100vh-8rem)] overflow-y-auto">
              {courses === null && <p className="text-sm text-gray-400 px-2 py-1">불러오는 중…</p>}
              {courses?.length === 0 && <p className="text-sm text-gray-400 px-2 py-1">아직 없어요</p>}
              {courses?.map(c => (
                <button
                  key={c.slug}
                  onClick={() => openCourse(c.course)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors ${
                    c.course === course ? 'bg-teal-50 text-teal-800' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="block truncate font-medium">{c.course}</span>
                  <span className="block text-xs text-gray-400">
                    승인 {c.counts.approved ?? 0} / {c.total}
                    {(c.counts.queued ?? 0) > 0 && <span className="text-amber-500"> · 대기 {c.counts.queued}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          {/* Mobile course picker */}
          <select
            value={course}
            onChange={e => openCourse(e.target.value)}
            className="md:hidden w-full mb-4 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {courses?.map(c => <option key={c.slug} value={c.course}>{c.course}</option>)}
          </select>

          {banner && (
            <div className="mb-4 flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-700">
              <span>{banner}</span>
              <button onClick={() => setBanner('')} className="ml-4 text-teal-400 hover:text-teal-600">✕</button>
            </div>
          )}

          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{course || '생성한 일러스트'}</h1>
              <p className="text-xs mt-0.5 h-4">
                {saveError
                  ? <button onClick={retryFailedSaves} className="text-red-500 underline">저장 실패 — 다시 시도</button>
                  : saving > 0
                    ? <span className="text-gray-400">저장 중…</span>
                    : cards.length > 0 && <span className="text-gray-400">모든 변경사항이 서버에 저장됨</span>}
              </p>
            </div>
            {course && (
              <div className="flex flex-wrap gap-2">
                {queuedCount > 0 && (
                  <button
                    onClick={() => router.push(`/generate?course=${encodeURIComponent(course)}`)}
                    className="px-3.5 py-2 bg-amber-400 text-white rounded-lg text-sm font-medium hover:bg-amber-500"
                  >
                    남은 {queuedCount}개 이어서 생성
                  </button>
                )}
                <button
                  onClick={() => router.push(`/?course=${encodeURIComponent(course)}`)}
                  className="px-3.5 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  + 단어 추가
                </button>
                <button
                  onClick={() => downloadZip(approvedCards)}
                  disabled={!approvedCards.length || zipping}
                  className="px-3.5 py-2 bg-teal-500 text-white rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-40"
                >
                  {zipping ? '압축 중…' : `승인된 ${approvedCards.length}개 다운로드`}
                </button>
              </div>
            )}
          </div>

          {/* Filters + bulk actions */}
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  filter === f.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                }`}
              >
                {f.label} {count(f.key)}
              </button>
            ))}
            <div className="flex-1" />
            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-gray-500 mr-1">{selected.size}개 선택</span>
                {filter === 'trash' ? (
                  <button onClick={() => bulk({ deleted: false })} className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50">복원</button>
                ) : (
                  <>
                    <button onClick={() => bulk({ status: 'approved' })} className="px-2.5 py-1.5 rounded-lg bg-teal-500 text-white hover:bg-teal-600">승인</button>
                    <button onClick={() => downloadZip(selectedCards)} className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50">다운로드</button>
                    {selected.size >= 2 && (
                      <button onClick={() => setSeriesOpen(true)} className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50" title="하나를 기준으로 나머지를 같은 틀로 다시 그려요 (달력·요일 등)">
                        시리즈로 맞추기
                      </button>
                    )}
                    <button onClick={() => { selectedCards.forEach(c => regenerate(c)); setSelected(new Set()) }} className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50">재생성</button>
                    <button onClick={() => bulk({ deleted: true })} className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-red-500 hover:bg-red-50">휴지통</button>
                  </>
                )}
                <button onClick={() => setSelected(new Set())} className="px-2 py-1.5 text-gray-400 hover:text-gray-600">선택 해제</button>
              </div>
            ) : visible.length > 0 && (
              <button onClick={() => setSelected(new Set(visible.map(c => c.id)))} className="text-xs text-gray-400 hover:text-gray-600">전체 선택</button>
            )}
          </div>

          {loadError && <p className="text-sm text-red-500 mb-4">{loadError}</p>}
          {loading && <p className="text-sm text-gray-400">불러오는 중…</p>}
          {!loading && course && visible.length === 0 && <p className="text-sm text-gray-400 py-10 text-center">해당하는 카드가 없어요.</p>}

          {/* Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {visible.map(card => {
              const img = currentImage(card)
              const isBusy = busy.has(card.id)
              const isSelected = selected.has(card.id)
              return (
                <div key={card.id} className={`bg-white rounded-xl border overflow-hidden flex flex-col ${isSelected ? 'border-teal-400 ring-2 ring-teal-200' : 'border-gray-200'}`}>
                  <div className="relative aspect-square bg-gray-50 group">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={card.word.en} onClick={() => setLightbox(card.id)} className="w-full h-full object-contain cursor-zoom-in" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-gray-300 px-2 text-center">
                        {card.error ? <span className="text-red-400">{card.error}</span> : '이미지 없음'}
                      </div>
                    )}
                    {isBusy && (
                      <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                        <div className="w-7 h-7 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => setSelected(prev => { const s = new Set(prev); if (s.has(card.id)) s.delete(card.id); else s.add(card.id); return s })}
                      className={`absolute top-2 left-2 w-4 h-4 accent-teal-500 ${isSelected ? '' : 'opacity-0 group-hover:opacity-100'}`}
                    />
                    {card.versions.length > 1 && (
                      <div className="absolute bottom-1.5 right-1.5 flex items-center bg-white/90 rounded-full text-[11px] text-gray-500 shadow-sm">
                        <button disabled={card.current <= 0} onClick={() => update(card.id, { current: card.current - 1 })} className="px-1.5 py-0.5 disabled:opacity-30">‹</button>
                        <span>{card.current + 1}/{card.versions.length}</span>
                        <button disabled={card.current >= card.versions.length - 1} onClick={() => update(card.id, { current: card.current + 1 })} className="px-1.5 py-0.5 disabled:opacity-30">›</button>
                      </div>
                    )}
                    <span className="absolute top-2 right-2 text-[10px] font-semibold text-gray-400 bg-white/80 rounded px-1">{card.word.type}</span>
                  </div>

                  <div className="px-3 pt-2 pb-1">
                    <p className="text-sm font-semibold text-gray-900 truncate" title={card.word.en}>{card.word.en}</p>
                    <p className="text-xs text-gray-500 truncate" title={card.word.ko}>{card.word.ko}{card.word.kr && <span className="text-gray-400"> · {card.word.kr}</span>}</p>
                  </div>

                  <div className="px-3 pb-3 mt-auto space-y-1.5">
                    {card.deleted ? (
                      <button onClick={() => update(card.id, { deleted: false })} className="w-full py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50">복원</button>
                    ) : (
                      <>
                        <div className="flex gap-1">
                          {QUICK_STATUSES.map(q => (
                            <button
                              key={q.status}
                              disabled={!img}
                              onClick={() => setStatus(card, q.status)}
                              className={`flex-1 py-1 text-[11px] rounded-md border transition-colors disabled:opacity-30 ${
                                card.status === q.status ? q.active : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                              }`}
                            >
                              {q.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1 text-[11px] text-gray-400">
                          <button onClick={() => setLightbox(card.id)} className={`flex-1 py-1 rounded-md hover:bg-gray-50 ${card.comment ? 'text-teal-600' : ''}`}>
                            {card.comment ? '코멘트 ●' : '코멘트'}
                          </button>
                          <button disabled={isBusy} onClick={() => regenerate(card)} className="flex-1 py-1 rounded-md hover:bg-gray-50 disabled:opacity-40">재생성</button>
                          <button disabled={!img} onClick={() => img && downloadUrl(img, fileName(card))} className="flex-1 py-1 rounded-md hover:bg-gray-50 disabled:opacity-40">다운</button>
                          <button onClick={() => update(card.id, { deleted: true })} className="px-1.5 py-1 rounded-md hover:bg-red-50 hover:text-red-400" title="휴지통">✕</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {lbCard && (
        <Lightbox
          card={lbCard}
          busy={busy.has(lbCard.id)}
          hasPrev={lbIndex > 0}
          hasNext={lbIndex < visible.length - 1}
          onPrev={() => setLightbox(visible[lbIndex - 1].id)}
          onNext={() => setLightbox(visible[lbIndex + 1].id)}
          onClose={() => setLightbox(null)}
          onUpdate={(patch, debounce) => update(lbCard.id, patch, debounce)}
          onStatus={s => setStatus(lbCard, s)}
          onRegenerate={opts => regenerate(lbCard, opts)}
        />
      )}

      {seriesOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSeriesOpen(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900">기준이 될 카드를 고르세요</h3>
            <p className="text-sm text-gray-500 mt-1 mb-4">나머지 {selected.size - 1}개를 이 카드와 같은 틀로 다시 그려요. 단어에 맞춰 강조 부분만 바뀌어요.</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {selectedCards.filter(c => currentImage(c)).map(c => (
                <button key={c.id} onClick={() => runSeries(c)} className="border border-gray-200 rounded-xl overflow-hidden hover:border-teal-400 hover:ring-2 hover:ring-teal-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={currentImage(c)!} alt={c.word.en} className="aspect-square object-contain bg-gray-50" />
                  <p className="text-xs py-1.5 truncate px-1">{c.word.en}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ---------- lightbox ----------

function Lightbox({ card, busy, hasPrev, hasNext, onPrev, onNext, onClose, onUpdate, onStatus, onRegenerate }: {
  card: Card
  busy: boolean
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onUpdate: (patch: Partial<Card>, debounceMs?: number) => void
  onStatus: (s: CardStatus) => void
  onRegenerate: (opts?: GenerateOptions) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [refImage, setRefImage] = useState<string | null>(null)
  const [vectorizing, setVectorizing] = useState(false)
  const img = currentImage(card)
  const version = card.versions[card.current]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft' && hasPrev) onPrev()
      if (e.key === 'ArrowRight' && hasNext) onNext()
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasPrev, hasNext, onPrev, onNext, onClose])

  const pickRef = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setRefImage(ev.target?.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const downloadSVG = async () => {
    if (!img) return
    setVectorizing(true)
    try {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.src = img
      await new Promise<void>(resolve => { image.onload = () => resolve() })
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const ImageTracer = (await import('imagetracerjs')).default
      const svg = ImageTracer.imagedataToSVG(ctx.getImageData(0, 0, canvas.width, canvas.height), {
        numberofcolors: 16, pathomit: 4, blurradius: 0, ltres: 1, qtres: 1, roundcoords: 2, viewbox: true, desc: false,
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      a.download = fileName(card, 'svg')
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setVectorizing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl overflow-hidden max-w-4xl w-full max-h-[92vh] flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
        <div className="relative md:w-[58%] bg-gray-50 aspect-square shrink-0">
          {img
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={img} alt={card.word.en} className="w-full h-full object-contain" />
            : <div className="w-full h-full flex items-center justify-center text-gray-300">이미지 없음</div>}
          {busy && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
              <div className="w-9 h-9 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {hasPrev && <button onClick={onPrev} className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 rounded-full shadow text-gray-700">‹</button>}
          {hasNext && <button onClick={onNext} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 rounded-full shadow text-gray-700">›</button>}
          {card.versions.length > 1 && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 rounded-full shadow px-2 py-1 text-xs text-gray-600">
              <button disabled={card.current <= 0} onClick={() => onUpdate({ current: card.current - 1 })} className="px-1.5 disabled:opacity-30">‹</button>
              <span>버전 {card.current + 1} / {card.versions.length}</span>
              <button disabled={card.current >= card.versions.length - 1} onClick={() => onUpdate({ current: card.current + 1 })} className="px-1.5 disabled:opacity-30">›</button>
            </div>
          )}
        </div>

        <div className="flex-1 p-5 overflow-y-auto space-y-4 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-gray-400">{card.id}</p>
              <h3 className="text-lg font-bold text-gray-900">{card.word.en}</h3>
              <p className="text-gray-500">{card.word.ko}{card.word.kr && <span className="text-gray-400"> · {card.word.kr}</span>}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>

          {version?.feedback && <p className="text-xs text-gray-400">이 버전 생성 시 코멘트: {version.feedback}</p>}

          <div className="flex flex-wrap gap-1.5">
            {QUICK_STATUSES.map(q => (
              <button
                key={q.status}
                disabled={!img}
                onClick={() => onStatus(q.status)}
                className={`px-3 py-1.5 text-xs rounded-lg border disabled:opacity-30 ${card.status === q.status ? q.active : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
              >
                {q.label}
              </button>
            ))}
            <span className="text-xs text-gray-400 self-center ml-1">{STATUS_LABELS[card.status]}</span>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">타입</label>
            <select
              value={card.word.type}
              onChange={e => onUpdate({ word: { ...card.word, type: e.target.value as Word['type'] } })}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700"
            >
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">코멘트 (재생성 시 반영)</label>
            <textarea
              value={card.comment}
              onChange={e => onUpdate({ comment: e.target.value }, 700)}
              rows={3}
              placeholder="예: 사람 없이 컵만, 색을 더 따뜻하게"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button onClick={() => fileRef.current?.click()} className="text-xs text-teal-600 hover:text-teal-700 font-medium">
                {refImage ? '레퍼런스 이미지 변경' : '+ 레퍼런스 이미지 (선택)'}
              </button>
              {refImage && <button onClick={() => setRefImage(null)} className="text-xs text-gray-400">빼기</button>}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickRef} />
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {refImage && <img src={refImage} alt="reference" className="w-20 h-20 object-contain border border-gray-200 rounded-lg" />}
            <button
              disabled={busy}
              onClick={() => { onRegenerate(refImage ? { referenceImage: refImage } : {}); setRefImage(null) }}
              className="w-full py-2.5 bg-teal-500 text-white rounded-lg font-medium hover:bg-teal-600 disabled:opacity-40"
            >
              {busy ? '생성 중…' : card.comment ? '코멘트 반영해서 재생성' : '재생성'}
            </button>
            <p className="text-xs text-gray-400">재생성해도 이전 버전은 남아요. 이미지 아래 ‹ › 로 되돌릴 수 있어요.</p>
          </div>

          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button disabled={!img} onClick={() => img && downloadUrl(img, fileName(card))} className="flex-1 py-2 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">PNG 다운로드</button>
            <button disabled={!img || vectorizing} onClick={downloadSVG} className="flex-1 py-2 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">{vectorizing ? '변환 중…' : 'SVG 다운로드'}</button>
            <button onClick={() => { onUpdate({ deleted: !card.deleted }); if (!card.deleted) onClose() }} className="px-3 py-2 text-xs rounded-lg border border-gray-200 text-red-500 hover:bg-red-50">
              {card.deleted ? '복원' : '휴지통'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">로딩 중...</div>}>
      <ReviewContent />
    </Suspense>
  )
}
