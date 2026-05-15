export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  if (!url) {
    return Response.json({ error: '시트 URL이 없습니다' }, { status: 400 })
  }

  // Extract sheet ID and GID from Google Sheets URL
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  const gidMatch = url.match(/gid=(\d+)/)

  if (!idMatch) {
    return Response.json({ error: '유효한 구글 시트 URL이 아닙니다' }, { status: 400 })
  }

  const sheetId = idMatch[1]
  const gid = gidMatch ? gidMatch[1] : '0'
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`

  try {
    const res = await fetch(csvUrl)
    if (!res.ok) {
      return Response.json({ error: '시트를 불러올 수 없습니다. 공개 공유 설정을 확인하세요.' }, { status: 400 })
    }
    const csv = await res.text()
    const words = parseCSV(csv)
    return Response.json({ words, sheetId, gid })
  } catch {
    return Response.json({ error: '시트 불러오기 실패' }, { status: 500 })
  }
}

type Word = {
  id: string
  en: string
  ko: string
  type: 'A' | 'B' | 'C' | 'D'
}

function parseCSV(csv: string): Word[] {
  const lines = csv.trim().split('\n').map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')))
  if (lines.length < 2) return []

  const headers = lines[0].map(h => h.toLowerCase())
  const idCol = headers.findIndex(h => h.includes('id') || h.includes('code') || h.includes('번호'))
  const enCol = headers.findIndex(h => h.includes('english') || h.includes('en') || h.includes('영어'))
  const koCol = headers.findIndex(h => h.includes('korean') || h.includes('ko') || h.includes('한국') || h.includes('번역'))
  const typeCol = headers.findIndex(h => h.includes('type') || h.includes('타입') || h.includes('유형'))

  return lines.slice(1)
    .filter(row => row.some(cell => cell.trim()))
    .map((row, i) => {
      const en = enCol >= 0 ? row[enCol] : row[1] || ''
      const ko = koCol >= 0 ? row[koCol] : row[2] || ''
      const type = typeCol >= 0 ? (row[typeCol] as Word['type']) : inferType(en)
      return {
        id: idCol >= 0 ? row[idCol] : `WORD${String(i + 1).padStart(3, '0')}`,
        en: en.replace(/^the\s+/i, '').trim(),
        ko: ko.trim(),
        type,
      }
    })
    .filter(w => w.en && w.ko)
}

function inferType(word: string): Word['type'] {
  const occupations = ['doctor', 'nurse', 'teacher', 'engineer', 'designer', 'manager', 'chef', 'artist', 'writer', 'scientist']
  const actions = ['run', 'jump', 'read', 'write', 'eat', 'sleep', 'walk', 'dance', 'sing', 'cook']
  const nature = ['tree', 'flower', 'mountain', 'river', 'sky', 'cloud', 'sun', 'rain', 'snow', 'forest']
  const w = word.toLowerCase()
  if (occupations.some(o => w.includes(o))) return 'B'
  if (actions.some(a => w.includes(a))) return 'C'
  if (nature.some(n => w.includes(n))) return 'D'
  return 'A'
}
