import { NextRequest } from 'next/server'
import { loadCourse, newCard, saveCard } from '../../lib/blobStore'
import { withUniqueIds } from '../../lib/parseWords'
import type { Word } from '../../lib/types'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

// Create cards for a course (status "queued") and return the page that generates them.
// Used by the home page and by the Claude vocab-illustrate skill. Words whose id already
// exists in the course are skipped, so re-sending a list never duplicates or resets work.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { words: Partial<Word>[]; course: string }
    const course = (body.course || '').trim()
    if (!course) {
      return Response.json({ error: '코스 이름이 없습니다 (예: ESEN Unit 17)' }, { status: 400, headers: CORS })
    }
    if (!Array.isArray(body.words) || body.words.length === 0) {
      return Response.json({ error: '단어 목록이 없습니다' }, { status: 400, headers: CORS })
    }

    const words = withUniqueIds(body.words
      .filter(w => w.en && w.ko)
      .map(w => ({
        id: w.id || `WORD-${crypto.randomUUID()}`,
        en: w.en!.trim(),
        ko: w.ko!.trim(),
        ...(w.kr ? { kr: w.kr.trim() } : {}),
        type: (['A', 'B', 'C', 'D'].includes(w.type ?? '') ? w.type : 'A') as Word['type'],
      })))

    const existing = new Set((await loadCourse(course)).map(c => c.id))
    const fresh = words.filter(w => !existing.has(w.id))
    // Sequential: keeps createdAt in list order, which is the order cards are shown in.
    for (const w of fresh) await saveCard(newCard(course, w))

    const url = `${new URL(req.url).origin}/generate?course=${encodeURIComponent(course)}`
    return Response.json(
      { url, course, count: fresh.length, skipped: words.length - fresh.length },
      { headers: CORS }
    )
  } catch (e) {
    console.error('queue failed:', e)
    return Response.json({ error: '요청 처리 실패' }, { status: 500, headers: CORS })
  }
}
