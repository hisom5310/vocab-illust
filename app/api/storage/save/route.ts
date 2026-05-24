import { put } from '@vercel/blob'
import { NextRequest, NextResponse } from 'next/server'

type Word = { id: string; en: string; ko: string; type: string }
type Result = { word: Word; image: string | null; error: string | null; lang?: string }
type StatusEntry = { id: string; status: string; comment: string; isNew?: boolean; langs?: string[] }

export async function POST(req: NextRequest) {
  try {
    const { results, statuses, lang, course } = await req.json() as {
      results: Result[]
      statuses: StatusEntry[]
      lang: string
      course: string
    }

    const sessionId = crypto.randomUUID()

    // Upload each image as a separate PNG blob
    const imageUrls: Record<string, string> = {}
    for (const result of results) {
      const src = result.image
      if (src?.startsWith('data:image/')) {
        const b64 = src.split(',')[1]
        const buffer = Buffer.from(b64, 'base64')
        const { url } = await put(
          `vocab-illust/${sessionId}/${result.word.id}.png`,
          buffer,
          { access: 'public', contentType: 'image/png' }
        )
        imageUrls[result.word.id] = url
      } else if (src?.startsWith('http')) {
        imageUrls[result.word.id] = src
      }
    }

    // Save session metadata (no base64 — only URLs)
    const meta = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      lang,
      course,
      results: results.map(r => ({
        word: r.word,
        imageUrl: imageUrls[r.word.id] ?? null,
        error: r.error,
        lang: r.lang,
      })),
      statuses,
    }

    await put(
      `vocab-illust/${sessionId}/meta.json`,
      JSON.stringify(meta),
      { access: 'public', contentType: 'application/json' }
    )

    return NextResponse.json({ sessionId })
  } catch (e) {
    console.error('save session error:', e)
    return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  }
}
