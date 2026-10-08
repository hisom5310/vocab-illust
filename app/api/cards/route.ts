import { putImage, saveCard } from '../../lib/blobStore'
import type { Card } from '../../lib/types'

// Save one card's full state. `imageData` (a data URL) is uploaded and appended as the
// card's newest version — used when importing images that only exist in a browser.
export async function PUT(req: Request) {
  try {
    const { card, imageData } = await req.json() as { card: Card; imageData?: string }
    if (!card?.id || !card?.course) {
      return Response.json({ error: '카드 정보가 없습니다' }, { status: 400 })
    }
    let next = card
    if (imageData?.startsWith('data:image/')) {
      const url = await putImage(card.course, card.id, Buffer.from(imageData.split(',')[1], 'base64'))
      const versions = [...card.versions, { url, createdAt: new Date().toISOString() }]
      next = { ...card, versions, current: versions.length - 1 }
    }
    return Response.json({ card: await saveCard(next) })
  } catch (e) {
    console.error('save card failed:', e)
    return Response.json({ error: '저장 실패' }, { status: 500 })
  }
}
