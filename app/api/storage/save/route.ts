import { put, list } from '@vercel/blob'
import { NextRequest, NextResponse } from 'next/server'

type Word = { id: string; en: string; ko: string; type: string }
type Result = { word: Word; image: string | null; error: string | null; lang?: string }
type StatusEntry = { id: string; status: string; comment: string; isNew?: boolean; langs?: string[] }
type StoredResult = { word: Word; imageUrl: string | null; error: string | null; lang?: string }

// Called once per generation batch (and chunked for large batches — see app/generate/page.tsx).
// `results` should be only the NEW/changed items from this call, not the full accumulated history:
// sending the full history every time makes the request grow unbounded and eventually exceeds
// the platform request-size limit, which fails silently on the client (see fetch `.catch(() => {})`).
// Passing `sessionId` appends to that session's existing meta.json instead of creating a new one.
export async function POST(req: NextRequest) {
  try {
    const { results, statuses, lang, course, sessionId: incomingSessionId } = await req.json() as {
      results: Result[]
      statuses: StatusEntry[]
      lang: string
      course: string
      sessionId?: string
    }

    let sessionId = incomingSessionId
    let existingResults: StoredResult[] = []
    let createdAt = new Date().toISOString()
    let savedLang = lang
    let savedCourse = course

    if (sessionId) {
      try {
        const { blobs } = await list({ prefix: `vocab-illust/${sessionId}/meta.json`, limit: 1 })
        if (blobs.length) {
          const prevMeta = await (await fetch(blobs[0].url, { cache: 'no-store' })).json()
          existingResults = prevMeta.results ?? []
          createdAt = prevMeta.createdAt ?? createdAt
          savedLang = prevMeta.lang || lang
          savedCourse = prevMeta.course || course
        } else {
          sessionId = undefined
        }
      } catch {
        sessionId = undefined
      }
    }
    if (!sessionId) sessionId = crypto.randomUUID()

    // Upload only this call's images as blobs (existing ones already have URLs, no re-upload)
    const imageUrls: Record<string, string> = {}
    for (const result of results) {
      const src = result.image
      if (src?.startsWith('data:image/')) {
        const b64 = src.split(',')[1]
        const buffer = Buffer.from(b64, 'base64')
        const { url } = await put(
          `vocab-illust/${sessionId}/${result.word.id}.png`,
          buffer,
          { access: 'public', contentType: 'image/png', allowOverwrite: true }
        )
        imageUrls[result.word.id] = url
      } else if (src?.startsWith('http')) {
        imageUrls[result.word.id] = src
      }
    }

    const incomingStored: StoredResult[] = results.map(r => ({
      word: r.word,
      imageUrl: imageUrls[r.word.id] ?? null,
      error: r.error,
      lang: r.lang,
    }))

    const mergedResults = [...existingResults]
    for (const r of incomingStored) {
      const idx = mergedResults.findIndex(e => e.word.id === r.word.id)
      if (idx >= 0) mergedResults[idx] = r
      else mergedResults.push(r)
    }

    // Save session metadata (no base64 — only URLs)
    const meta = {
      id: sessionId,
      createdAt,
      lang: savedLang,
      course: savedCourse,
      results: mergedResults,
      statuses,
    }

    await put(
      `vocab-illust/${sessionId}/meta.json`,
      JSON.stringify(meta),
      { access: 'public', contentType: 'application/json', allowOverwrite: true }
    )

    return NextResponse.json({ sessionId })
  } catch (e) {
    console.error('save session error:', e)
    return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  }
}
