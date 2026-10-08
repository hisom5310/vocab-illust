// Course for a card imported from the pre-v2 storage, which only kept a language tag.
// TEUIDA word ids encode the unit (EEV1701a → unit 17), so "ESEN" + EEV1701a → "ESEN Unit 17".
export function legacyCourse(wordId: string, lang: string | undefined, fallback?: string): string {
  const tag = lang && /^[A-Z]{4}$/.test(lang) ? lang : ''
  const m = wordId.match(/^[A-Z]{2}V(\d{2})\d{2}/)
  if (m && tag) return `${tag} Unit ${parseInt(m[1], 10)}`
  return fallback || `${tag || '기타'} 이전 작업`
}
