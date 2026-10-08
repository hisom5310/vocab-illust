import { listLegacySessions, loadCourse, newCard, saveCard } from '../../../lib/blobStore'
import { legacyCourse } from '../../../lib/legacy'
import type { Card } from '../../../lib/types'

export const maxDuration = 120

// One-time import of pre-v2 server sessions (vocab-illust/{id}/meta.json) into v2 cards.
// Idempotent: a card that already exists in its v2 course is left alone.
export async function POST() {
  try {
    const sessions = await listLegacySessions()
    const known = new Map<string, Set<string>>()
    let imported = 0
    for (const session of sessions) {
      if (session.course === '__connectivity_test__') continue
      const statusMap = Object.fromEntries((session.statuses ?? []).map(s => [s.id, s]))
      for (const r of session.results ?? []) {
        if (!r.imageUrl) continue
        const course = session.course || legacyCourse(r.word.id, r.lang || session.lang)
        if (!known.has(course)) known.set(course, new Set((await loadCourse(course)).map(c => c.id)))
        const ids = known.get(course)!
        if (ids.has(r.word.id)) continue
        const saved = statusMap[r.word.id]
        const card: Card = {
          ...newCard(course, { ...r.word, type: (r.word.type || 'A') as Card['word']['type'] }),
          status: saved?.status === 'approved' ? 'approved' : 'pending',
          comment: saved?.comment ?? '',
          versions: [{ url: r.imageUrl, createdAt: session.createdAt }],
          current: 0,
        }
        await saveCard(card)
        ids.add(r.word.id)
        imported++
      }
    }
    return Response.json({ imported })
  } catch (e) {
    console.error('legacy import failed:', e)
    return Response.json({ error: '이전 데이터 가져오기 실패' }, { status: 500 })
  }
}
