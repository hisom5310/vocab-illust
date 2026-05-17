import OpenAI from 'openai'

const STYLE_BASE = `STRICT STYLE RULES (never break these):
- Fill (solid color) only. Absolutely NO strokes, NO outlines, NO gradients, NO drop shadows, NO effects.
- White background #FFFFFF only. No patterns.
- All corners must be rounded/soft — no sharp edges.
- Colors ONLY from this palette:
  Red: #FCDBD9 #FFB1AD #FF817A #FC5951 #E0433A #B84640 #7A4340
  Pink: #FCDEDE #FFBDC5 #FC9AA4 #FF7B82 #F25F67 #C95259 #874E51
  Orange: #FFE3B4 #FDD28B #FFC76C #FFB63F #E29D2E #C38A2F #846738
  Yellow: #FFFBC2 #FBF496 #FFE67B #FEDE55 #D9C468 #AA9E6B #78704F
  Green: #B6FCBF #83F292 #55E068 #38C74B #2AAB3B #288B34 #265E2D
  Mint: #B6FFF3 #86FCDF #5CF3DB #43DFC6 #3FCCB5 #33AB98 #1D7769
  Teal: #ACFDD7 #96E5CE #6ACAC2 #4FB6AE #38AFA5 #35928B #1C6862
  Blue: #E0E9F7 #B9D8F6 #94B6FF #7FA7FF #647FC9 #596B9D #374B82
  Purple: #E3CDFA #CCA1F7 #B374F2 #9B55E0 #7D3CBD #663A91 #4E3566
  Cool Pink: #FCD4F2 #FFA8E9 #FA73D8 #F24EC9 #D13BAB #A63C8B #703862
  Gray: #EAEEF4 #D8E2F2 #B4C2D7 #95A3B9 #818C9B #6A7380 #555555
  Skin A: #E2B6AA  Skin B: #F6D9D0
- Use the level-300 color as main, level-500 for shadow/depth. Max 4 colors for Type A, max 5 for others.
- Object fills the canvas 55–70%. Even white space on all sides.
- Silhouette alone must convey the word — readable in grayscale.`

const TYPE_PROMPTS: Record<string, string> = {
  A: `${STYLE_BASE}

TYPE A — Simple icon illustration for vocabulary flashcard. Word: "{WORD}" ({KO}).
Composition: One clear representative object centered. Add 2–3 small decorative elements around it at diagonal positions (not aligned to grid). Size variation: largest element 2× bigger than smallest.
Choose the most instantly recognizable form of "{WORD}". Simplify to essential shapes only — remove all surface texture, patterns, and unnecessary details.`,

  B: `${STYLE_BASE}

TYPE B — Character avatar for vocabulary flashcard. Word: "{WORD}" ({KO}).
Composition: Half-body portrait, centered. Character faces slightly toward viewer.
Character rules: rounded oval face (width:height ≈ 1:1.15), short thick neck, simple hair as flat filled shape in gray #555555. Eyes as small arcs or ovals. No finger details — hands as simple rounded rectangles. Skin tone: #E2B6AA (face, neck, hands). Outfit: simple rounded-neck top in a single palette color. Include 1–2 profession-specific props or uniform details to make the role "{WORD}" instantly recognizable.`,

  C: `${STYLE_BASE}

TYPE C — Action/emotion scene for vocabulary flashcard. Word: "{WORD}" ({KO}).
Composition: 1–2 simplified human figures clearly performing the action "{WORD}". Figures placed at bottom–center; symbolic elements (speech bubbles, arrows, icons) above. Figures shown as silhouettes + pose — minimal face detail. Use symbolic props to reinforce the action concept.`,

  D: `${STYLE_BASE}

TYPE D — Nature/season illustration for vocabulary flashcard. Word: "{WORD}" ({KO}).
Composition: 3–5 related nature elements freely scattered across the canvas. No grid alignment — use diagonal/triangular layout. Elements vary in size (largest 2× smallest). Some overlap for depth. Rotate some elements for variety. Choose colors that naturally represent "{WORD}" (e.g., spring→pink+green, ocean→blue+teal).`,
}

export async function POST(request: Request) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const { word, type = 'A', feedback, referenceImage } = await request.json()

  if (!word?.en || !word?.ko) {
    return Response.json({ error: '단어 정보가 없습니다' }, { status: 400 })
  }

  const basePrompt = TYPE_PROMPTS[type] || TYPE_PROMPTS.A
  let prompt = basePrompt
    .replace(/\{WORD\}/g, word.en)
    .replace(/\{KO\}/g, word.ko)

  if (feedback) {
    prompt += `\n\nImportant corrections from previous attempt: ${feedback}`
  }

  try {
    let b64: string | null | undefined

    if (referenceImage) {
      const b64data = (referenceImage as string).replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(b64data, 'base64')
      const file = new File([buffer], 'reference.png', { type: 'image/png' })
      const response = await openai.images.edit({
        model: 'gpt-image-1',
        image: file,
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
      })
      b64 = response.data?.[0]?.b64_json
    } else {
      const response = await openai.images.generate({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
      })
      b64 = response.data?.[0]?.b64_json
    }

    if (!b64) throw new Error('이미지 생성 실패')
    return Response.json({ image: `data:image/png;base64,${b64}` })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '이미지 생성 실패'
    return Response.json({ error: message }, { status: 500 })
  }
}
