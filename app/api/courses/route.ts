import { listCourses } from '../../lib/blobStore'

export async function GET() {
  try {
    return Response.json({ courses: await listCourses() })
  } catch (e) {
    console.error('list courses failed:', e)
    return Response.json({ error: '코스 목록을 불러오지 못했습니다' }, { status: 500 })
  }
}
