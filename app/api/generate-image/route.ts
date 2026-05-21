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

// Shared character anatomy spec — used in both B and C prompts
const CHAR_SPEC = `Character anatomy (must match exactly — this is the design system):
  Face: large smooth oval, width ≈ height, extremely soft rounded edges
  Eyebrows: two small thick filled dark arcs, placed high on forehead
  Eyes: small filled dark ovals or downward arcs — no iris/white detail
  Nose: absent, or a single tiny minimal dot
  Mouth: small arc whose direction expresses emotion (up=smile, flat=neutral, down=sad, wavy=distressed, open=surprised)
  Hair: flat filled dark gray (#555555) silhouette, zero texture or detail
  Neck: short, slightly narrower than face, same skin fill
  Body: very wide rounded shoulders, extremely puffy soft curves, simple silhouette
  Hands: round blob shapes — absolutely NO individual fingers or finger lines
  Skin tone: choose freely any race/ethnicity — Skin A (#E2B6AA), Skin B (#F6D9D0), medium brown, dark brown — vary across illustrations`

const CHAR_STYLE_PREFIX = `STYLE REFERENCE: The attached image defines the character art style to replicate.
DO NOT copy its content — create an entirely new illustration for the word below.
Preserve from reference: face proportions, flat-fill rendering, minimal facial features (arcs only), body proportions, soft rounded silhouettes.
Change freely: skin tone (any race/ethnicity), hair, outfit, pose, props, expression.

`

const TYPE_PROMPTS: Record<string, string> = {
  A: `${STYLE_BASE}

TYPE A — Simple icon illustration for vocabulary flashcard. Word: "{WORD}" ({KO}).
Composition: One clear representative object centered, filling 55–70% of canvas.
Decorative elements rule — judge by word type:
  • Add 2–3 small semantic elements ONLY if they reinforce the word's identity. Place at diagonal positions, not grid-aligned. Examples: party→confetti+stars, music→notes, fire→sparks, rain→droplets, love→hearts.
  • OMIT all decorative elements if the object is self-explanatory on its own. Examples: clothing (T-shirt, dress, pants), food items, furniture, tools, color swatches — the silhouette alone is enough.
Choose the most instantly recognizable form of "{WORD}". Simplify to essential shapes only — remove all surface texture, patterns, and unnecessary details.`,

  B: `${STYLE_BASE}

TYPE B — Character avatar for vocabulary flashcard. Word: "{WORD}" ({KO}).
Composition: Half-body portrait, centered. Character faces toward viewer.
${CHAR_SPEC}
Outfit: simple rounded-neck top in a single palette color that matches the profession's identity.
Props (required): Include 1–2 profession-specific items that instantly identify "{WORD}". Place in hands or beside the character (e.g., doctor→stethoscope, chef→toque+ladle, teacher→book+pointer, police→badge, firefighter→helmet). No generic decorations.`,

  C: `${STYLE_BASE}

TYPE C — Action/emotion scene for vocabulary flashcard. Word: "{WORD}" ({KO}).
Composition: 1–2 human figures clearly performing or expressing "{WORD}". Place at center/bottom; symbolic elements (speech bubbles, arrows, emotion marks) above or around.
${CHAR_SPEC}
Expression clarity: adjust mouth arc direction and add supporting marks (sweat drops=tired/hot, stars=dizzy, hearts=love, exclamation=surprise) as simple filled shapes. Body pose + expression must together communicate "{WORD}" without any text.`,

  D: `${STYLE_BASE}

TYPE D — Nature/season illustration for vocabulary flashcard. Word: "{WORD}" ({KO}).
Composition: 3–5 related nature elements freely scattered across the canvas. No grid alignment — use diagonal/triangular layout. Elements vary in size (largest 2× smallest). Some overlap for depth. Rotate some elements for variety. Choose colors that naturally represent "{WORD}" (e.g., spring→pink+green, ocean→blue+teal).`,
}

export async function POST(request: Request) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const { word, type = 'A', feedback, referenceImage, characterRef } = await request.json()

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

    // User-supplied reference takes priority (regeneration with reference)
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
    } else if (characterRef) {
      // Auto character style reference for Type B/C
      const b64data = (characterRef as string).replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(b64data, 'base64')
      const file = new File([buffer], 'char-ref.png', { type: 'image/png' })
      const response = await openai.images.edit({
        model: 'gpt-image-1',
        image: file,
        prompt: CHAR_STYLE_PREFIX + prompt,
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
