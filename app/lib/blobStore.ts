import { put, list, del } from '@vercel/blob'
import type { Card, CardStatus, CourseSummary } from './types'

// Server-side card store on Vercel Blob — the source of truth for every card, so work
// survives across browsers, devices and cleared site data.
//
// Layout:
//   v2/cards/{courseSlug}/{cardKey}/{timestamp}-{status}.json   card state snapshots
//   v2/images/{courseSlug}/{cardKey}/{timestamp}.png             every generated image
//
// Each save writes a NEW snapshot file and then deletes the older ones. Blob URLs are
// CDN-cached for a long time, so overwriting one pathname could serve stale state;
// immutable snapshot paths never can. The status is encoded in the filename so the
// course list can count statuses from a single listing without downloading each card.

const CARDS = 'v2/cards/'
const IMAGES = 'v2/images/'

const encode = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const decode = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

export const courseSlug = encode
export const slugToCourse = decode

const stamp = () => String(Date.now()).padStart(15, '0')

type Snapshot = { slug: string; cardKey: string; pathname: string; url: string; status: string; uploadedAt: Date }

async function listAll(prefix: string) {
  const out: { pathname: string; url: string; uploadedAt: Date }[] = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix, cursor, limit: 1000 })
    out.push(...page.blobs)
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return out
}

// Latest snapshot per card under the given prefix.
async function latestSnapshots(prefix: string): Promise<Snapshot[]> {
  const latest = new Map<string, Snapshot>()
  for (const b of await listAll(prefix)) {
    const m = b.pathname.match(/^v2\/cards\/([^/]+)\/([^/]+)\/(\d+)-([a-z]+)\.json$/)
    if (!m) continue
    const [, slug, cardKey, , status] = m
    const key = `${slug}/${cardKey}`
    const prev = latest.get(key)
    if (!prev || b.pathname > prev.pathname) {
      latest.set(key, { slug, cardKey, pathname: b.pathname, url: b.url, status, uploadedAt: b.uploadedAt })
    }
  }
  return [...latest.values()]
}

export async function listCourses(): Promise<CourseSummary[]> {
  const byCourse = new Map<string, CourseSummary>()
  for (const s of await latestSnapshots(CARDS)) {
    let summary = byCourse.get(s.slug)
    if (!summary) {
      summary = { course: decode(s.slug), slug: s.slug, total: 0, counts: {}, updatedAt: new Date(0).toISOString() }
      byCourse.set(s.slug, summary)
    }
    const status = s.status as CardStatus | 'deleted'
    summary.counts[status] = (summary.counts[status] ?? 0) + 1
    if (status !== 'deleted') summary.total++
    const at = new Date(s.uploadedAt).toISOString()
    if (at > summary.updatedAt) summary.updatedAt = at
  }
  return [...byCourse.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function loadCourse(course: string): Promise<Card[]> {
  const snaps = await latestSnapshots(`${CARDS}${courseSlug(course)}/`)
  const cards = await Promise.all(snaps.map(async s => {
    const res = await fetch(s.url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`card load failed: ${s.pathname}`)
    return await res.json() as Card
  }))
  return cards.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id, undefined, { numeric: true }))
}

async function loadLatest(folder: string): Promise<Card | null> {
  const snaps = await latestSnapshots(folder)
  if (!snaps.length) return null
  const res = await fetch(snaps[0].url, { cache: 'no-store' })
  return res.ok ? await res.json() as Card : null
}

// Two tabs can save the same card concurrently (the generate page appending an image while
// the review page saves a comment). Never lose an image to that race: union the stored
// versions with the incoming ones and keep pointing at the version the caller selected.
function mergeVersions(stored: Card | null, incoming: Card): Card {
  if (!stored) return incoming
  const byUrl = new Map(stored.versions.map(v => [v.url, v]))
  for (const v of incoming.versions) byUrl.set(v.url, v)
  const versions = [...byUrl.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const selected = incoming.versions[incoming.current]?.url ?? stored.versions[stored.current]?.url
  const current = selected ? versions.findIndex(v => v.url === selected) : versions.length - 1
  const status = incoming.status === 'queued' && versions.length ? 'pending' : incoming.status
  return { ...incoming, versions, current, status }
}

export async function saveCard(card: Card): Promise<Card> {
  const folder = `${CARDS}${courseSlug(card.course)}/${encode(card.id)}/`
  const saved: Card = { ...mergeVersions(await loadLatest(folder), card), updatedAt: new Date().toISOString() }
  const status = saved.deleted ? 'deleted' : saved.status
  const pathname = `${folder}${stamp()}-${status}.json`
  await put(pathname, JSON.stringify(saved), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  })
  // Drop older snapshots of this card. Best-effort — the newest one always wins on read.
  try {
    const older = (await listAll(folder)).filter(b => b.pathname < pathname).map(b => b.url)
    if (older.length) await del(older)
  } catch (e) {
    console.error('old snapshot cleanup failed:', e)
  }
  return saved
}

export async function putImage(course: string, cardId: string, png: Buffer): Promise<string> {
  const { url } = await put(`${IMAGES}${courseSlug(course)}/${encode(cardId)}/${stamp()}.png`, png, {
    access: 'public',
    contentType: 'image/png',
    addRandomSuffix: false,
  })
  return url
}

export function newCard(course: string, word: Card['word']): Card {
  const now = new Date().toISOString()
  return {
    id: word.id,
    course,
    word,
    status: 'queued',
    comment: '',
    versions: [],
    current: -1,
    error: null,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  }
}

// Legacy (v1) server sessions: vocab-illust/{sessionId}/meta.json — read-only, for import.
export type LegacySession = {
  id: string
  createdAt: string
  lang: string
  course: string
  results: { word: Card['word']; imageUrl: string | null; error: string | null; lang?: string }[]
  statuses: { id: string; status: string; comment: string }[]
}

export async function listLegacySessions(): Promise<LegacySession[]> {
  const metas = (await listAll('vocab-illust/')).filter(b => b.pathname.endsWith('/meta.json'))
  const sessions = await Promise.all(metas.map(async b => {
    try {
      const res = await fetch(b.url, { cache: 'no-store' })
      return await res.json() as LegacySession
    } catch {
      return null
    }
  }))
  return sessions.filter((s): s is LegacySession => !!s)
}
