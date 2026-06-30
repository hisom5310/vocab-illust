import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: '로컬 개발 환경에서만 사용 가능' }, { status: 403 })
  }
  const { imageBase64, filename } = await req.json()
  const dir = path.join(process.cwd(), 'pending-svg')
  await mkdir(dir, { recursive: true })
  const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, '')
  await writeFile(path.join(dir, filename), Buffer.from(b64, 'base64'))
  return NextResponse.json({ success: true, filename })
}
