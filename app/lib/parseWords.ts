import { detectLang } from './lang'
import type { Word } from './types'

// Results are keyed by word id, so a shared id (a sheet's 관리코드 like EEV1701 is used
// by every word in its set) would make later words overwrite earlier ones.
// Repeats get a/b/c… suffixes: EEV1701 ×3 → EEV1701a, EEV1701b, EEV1701c.
export function withUniqueIds<T extends { id: string }>(words: T[]): T[] {
  const counts = new Map<string, number>()
  for (const w of words) counts.set(w.id, (counts.get(w.id) ?? 0) + 1)
  const seen = new Map<string, number>()
  return words.map(w => {
    if ((counts.get(w.id) ?? 0) < 2) return w
    const n = seen.get(w.id) ?? 0
    seen.set(w.id, n + 1)
    return { ...w, id: `${w.id}${String.fromCharCode(97 + n)}` }
  })
}

const CODE = /^[A-Z]{3}\d{4}[a-z]?$/
const HEADER = /학습어|모국어|관리코드|단어장|^유닛$/

// "to rest", "to go out" → verbs read best as action scenes.
function guessType(native: string): Word['type'] {
  return /^to\s/i.test(native.trim()) ? 'C' : 'A'
}

// Rows copied straight from the TEUIDA vocab sheet arrive tab-separated, with merged
// cells (unit, 관리코드, titles) filled only on the first row of each set:
//   유닛 | 관리코드 | 모국어 타이틀 | 학습어 타이틀 | 학습어 | 모국어 | 한국어 | 메모
// Copying just the 학습어/모국어/한국어 columns also works.
function parseSheetRows(lines: string[]): Word[] {
  const rows = lines.map(l => l.split('\t').map(c => c.trim())).filter(r => !r.some(c => HEADER.test(c)))
  const codeCol = (() => {
    for (const r of rows) {
      const i = r.findIndex(c => CODE.test(c))
      if (i >= 0) return i
    }
    return -1
  })()

  const words: Word[] = []
  let code = ''
  for (const r of rows) {
    let en: string, ko: string, kr: string | undefined
    if (codeCol >= 0) {
      if (CODE.test(r[codeCol] ?? '')) code = r[codeCol]
      ;[en, ko, kr] = [r[codeCol + 3], r[codeCol + 4], r[codeCol + 5]]
    } else {
      const cells = r.filter(Boolean)
      ;[en, ko, kr] = [cells[0], cells[1], cells[2]]
    }
    if (!en || !ko) continue
    words.push({
      id: code || `WORD-${crypto.randomUUID()}`,
      en,
      ko,
      ...(kr ? { kr } : {}),
      type: guessType(ko),
    })
  }
  return withUniqueIds(words)
}

// Free-form lines: "학습어 | 모국어 | 한국어", "학습어/모국어", "사과 apple" …
function parseFreeLines(lines: string[]): Word[] {
  return lines.map(line => {
    let parts = line.split(/[|,\/]|\s*:\s*/).map(p => p.trim()).filter(Boolean)
    if (parts.length < 2) {
      const tokens = line.trim().split(/\s+/)
      for (let j = 1; j < tokens.length; j++) {
        if (detectLang(tokens[j - 1]) !== detectLang(tokens[j])) {
          parts = [tokens.slice(0, j).join(' '), tokens.slice(j).join(' ')]
          break
        }
      }
    }
    const [en = '', ko = '', kr] = parts
    return {
      id: `WORD-${crypto.randomUUID()}`,
      en,
      ko,
      ...(kr ? { kr } : {}),
      type: guessType(ko),
    }
  }).filter(w => w.en && w.ko)
}

export function parseWords(text: string): Word[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  return lines.some(l => l.includes('\t')) ? parseSheetRows(lines) : parseFreeLines(lines)
}
