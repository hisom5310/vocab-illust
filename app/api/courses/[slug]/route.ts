import { loadCourse, slugToCourse } from '../../../lib/blobStore'

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const course = slugToCourse(slug)
  try {
    return Response.json({ course, cards: await loadCourse(course) })
  } catch (e) {
    console.error('load course failed:', e)
    return Response.json({ error: '카드를 불러오지 못했습니다' }, { status: 500 })
  }
}
