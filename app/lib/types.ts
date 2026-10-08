export type WordType = 'A' | 'B' | 'C' | 'D'

// en = learning-language word (flashcard front), ko = native-language translation (back),
// kr = Korean translation for the team (optional, display only).
export type Word = { id: string; en: string; ko: string; kr?: string; type: WordType }

// queued   — waiting for its first image
// pending  — has an image, not reviewed yet
// approved — used as-is
// edited   — used after editing in Figma
// redrawn  — drawn from scratch in Figma (the generated image wasn't usable)
export type CardStatus = 'queued' | 'pending' | 'approved' | 'edited' | 'redrawn'

export type ImageVersion = { url: string; createdAt: string; feedback?: string }

export type Card = {
  id: string // word id, unique within a course
  course: string // e.g. "ESEN Unit 17"
  word: Word
  status: CardStatus
  comment: string
  versions: ImageVersion[] // every image ever generated for this card, oldest first
  current: number // index into versions, -1 when there is no image yet
  error: string | null
  deleted: boolean // soft delete — shown in the trash, restorable
  createdAt: string
  updatedAt: string
}

export type CourseSummary = {
  course: string
  slug: string
  total: number
  counts: Partial<Record<CardStatus | 'deleted', number>>
  updatedAt: string
}

export const TYPE_LABELS: Record<WordType, string> = {
  A: 'A — 사물/장소',
  B: 'B — 직업/역할',
  C: 'C — 동사/감정',
  D: 'D — 자연/계절',
}

export const STATUS_LABELS: Record<CardStatus, string> = {
  queued: '생성 대기',
  pending: '검토 대기',
  approved: '승인 (그대로 사용)',
  edited: '수정해서 사용',
  redrawn: '직접 제작',
}

export function currentImage(card: Card): string | null {
  return card.current >= 0 ? card.versions[card.current]?.url ?? null : null
}

// "ESEN Unit 17" → "ESEN". Course codes are 4 uppercase letters: learning + native language.
export function courseLang(course: string): string {
  const m = course.trim().match(/^([A-Z]{4})\b/)
  return m ? m[1] : ''
}
