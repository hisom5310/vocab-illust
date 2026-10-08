'use client'

import type { Card, CourseSummary } from './types'

// Browser-side counterpart of blobStore.ts (same base64url course slug).
export function courseSlug(course: string): string {
  const bytes = new TextEncoder().encode(course)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok || (data as { error?: string }).error) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
  }
  return data as T
}

export async function fetchCourses(): Promise<CourseSummary[]> {
  return (await json<{ courses: CourseSummary[] }>(await fetch('/api/courses', { cache: 'no-store' }))).courses
}

export async function fetchCourse(course: string): Promise<Card[]> {
  const res = await fetch(`/api/courses/${courseSlug(course)}`, { cache: 'no-store' })
  return (await json<{ cards: Card[] }>(res)).cards
}

// Saves retry with backoff — a dropped request must never silently lose work.
export async function saveCardRemote(card: Card, imageData?: string): Promise<Card> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('/api/cards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card, imageData }),
      })
      return (await json<{ card: Card }>(res)).card
    } catch (e) {
      lastError = e
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
    }
  }
  throw lastError
}

export type GenerateOptions = {
  feedback?: string
  referenceImage?: string
  series?: boolean
  unitWords?: string[]
}

// Generate a new image for a card; the server stores it in Blob, then the card is saved
// with the image appended as its newest version. Failures are saved on the card too.
export async function generateForCard(card: Card, opts: GenerateOptions = {}): Promise<Card> {
  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: card.word,
        type: card.word.type,
        feedback: opts.feedback || undefined,
        referenceImage: opts.referenceImage || undefined,
        series: opts.series || undefined,
        course: card.course,
        unitWords: opts.unitWords,
        store: { course: card.course, cardId: card.id },
      }),
    })
    const { imageUrl } = await json<{ imageUrl: string }>(res)
    const versions = [...card.versions, { url: imageUrl, createdAt: new Date().toISOString(), ...(opts.feedback ? { feedback: opts.feedback } : {}) }]
    return await saveCardRemote({
      ...card,
      versions,
      current: versions.length - 1,
      status: card.status === 'queued' ? 'pending' : card.status,
      error: null,
    })
  } catch (e) {
    const error = e instanceof Error ? e.message : '생성 실패'
    return await saveCardRemote({ ...card, error }).catch(() => ({ ...card, error }))
  }
}

export function fileName(card: Card, ext = 'png'): string {
  return `${card.id}_${card.word.en.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_')}.${ext}`
}
