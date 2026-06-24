import { NextRequest } from 'next/server'

type Word = { id: string; en: string; ko: string; type: 'A' | 'B' | 'C' | 'D' }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const words: Word[] = body.words
    const lang: string = (body.lang || '').toUpperCase()
    const course: string = body.course || ''

    if (!Array.isArray(words) || words.length === 0) {
      return Response.json({ error: '단어 목록이 없습니다' }, { status: 400, headers: CORS })
    }

    const wordList = words.map((w, i) => ({
      id: w.id || `WORD${String(i + 1).padStart(3, '0')}`,
      en: w.en || '',
      ko: w.ko || '',
      type: (w.type || 'A') as Word['type'],
    })).filter(w => w.en && w.ko)

    const payload = { words: wordList, lang, course }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const origin = new URL(req.url).origin
    const url = `${origin}/generate?queue=${encoded}`

    return Response.json(
      { url, count: wordList.length, lang, course },
      { headers: CORS }
    )
  } catch {
    return Response.json({ error: '요청 파싱 실패' }, { status: 400, headers: CORS })
  }
}
