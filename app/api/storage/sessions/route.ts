import { list } from '@vercel/blob'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'vocab-illust/', limit: 1000 })
    const metaBlobs = blobs.filter(b => b.pathname.endsWith('/meta.json'))

    const sessions = (
      await Promise.all(
        metaBlobs.slice(0, 30).map(async b => {
          try {
            const res = await fetch(b.url, { next: { revalidate: 0 } })
            const data = await res.json()
            return {
              id: data.id,
              createdAt: data.createdAt,
              lang: data.lang,
              course: data.course,
              count: (data.results ?? []).length,
            }
          } catch {
            return null
          }
        })
      )
    )
      .filter(Boolean)
      .sort((a, b) => new Date(b!.createdAt).getTime() - new Date(a!.createdAt).getTime())

    return NextResponse.json({ sessions })
  } catch {
    return NextResponse.json({ sessions: [] })
  }
}
