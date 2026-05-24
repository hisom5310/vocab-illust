import { list } from '@vercel/blob'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const { blobs } = await list({ prefix: `vocab-illust/${id}/meta.json` })
    if (!blobs.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const res = await fetch(blobs[0].url, { next: { revalidate: 0 } })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Load failed' }, { status: 500 })
  }
}
