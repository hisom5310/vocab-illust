// Detect a word's language from its characters. Best-effort heuristic only —
// used purely as a fallback when no explicit lang tag is available.
export function detectLang(text: string): string {
  if (!text) return ''
  if (/[぀-ヿ]/.test(text)) return 'JA'  // 히라가나/가타카나 → Japanese
  if (/[가-힣]/.test(text)) return 'KO'  // 한글 → Korean
  if (/[؀-ۿ]/.test(text)) return 'AR'  // Arabic
  if (/[Ѐ-ӿ]/.test(text)) return 'RU'  // Cyrillic
  if (/[一-鿿]/.test(text)) return 'ZH'  // CJK (일본어 체크 후)
  if (/[ñÑ¿¡]/.test(text)) return 'ES'           // 스페인어 특수문자
  if (/[çÇœŒæÆèéêëàâîïôùûü]/.test(text)) return 'FR'  // 프랑스어 특수문자
  if (/[a-zA-Z]/.test(text)) return 'EN'
  return ''
}

// 학습어(target) + 모국어(native) 두 컬럼으로 코스 태그 생성.
// 순서는 항상 target(학습어) + native(모국어) — 예: en="김밥", ko="gimbap" → "KOEN".
export function detectCourseTag(targetWord: string, nativeWord: string): string {
  const target = detectLang(targetWord)
  const native = detectLang(nativeWord)
  if (target && native && target !== native) return target + native
  return target || ''
}
