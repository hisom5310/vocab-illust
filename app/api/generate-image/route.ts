import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'

export const maxDuration = 60

const STYLE_BASE = `STRICT STYLE RULES (never break these):
- Fill (solid color) only. Absolutely NO strokes, NO outlines, NO gradients, NO drop shadows, NO effects.
- Transparent background. No background color, no patterns.
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
const CHAR_SPEC = `CHARACTER DESIGN SYSTEM — replicate exactly, no exceptions:
  PROPORTIONS: Head occupies ≈35% of canvas height, centered 15–30% from top. Body extends to canvas bottom. Half-body portrait only — no waist, no legs visible.
  FACE: Large smooth oval, width ≈ height. Fill with skin tone: Skin A (#E2B6AA), Skin B (#F6D9D0), medium brown (#C0825A), or dark brown (#7A4A2A). Vary skin tone across illustrations. Extremely soft rounded edges — no hard corners anywhere.
  HAIR: STRICTLY a flat filled #555555 silhouette. Simple smooth dome or rounded cap shape resting on top of the head oval. Zero texture, zero individual strands, zero highlights, zero internal lines whatsoever. One solid dark gray shape only.
  EYEBROWS: Two tiny filled dark (#555555) arcs placed HIGH on the forehead (upper quarter of face oval). Each arc is very small — width ≈ 10% of face width. Symmetric placement.
  EYES: Two tiny filled dark (#555555) dots or minimal downward-curved arcs. NO whites, NO iris, NO pupils, NO eyelashes, NO detail — just two tiny dark filled marks.
  NOSE: Omit entirely — strongly preferred. If included at all: maximum one or two tiny 2px dark dots for nostrils only. No nose bridge, no nose shape.
  MOUTH: A single small arc shape only. Upward = smile, horizontal = neutral, downward = sad, small open oval = surprise. Nothing else.
  NECK: Short, slightly narrower than face oval, same skin fill as face.
  BODY/TOP: Extremely wide soft shape — shoulder silhouette extends 70–80% of canvas width. Very puffy, rounded shoulder curves. Single solid palette color fill. MANDATORY: a small white curved shape (inner collar/undershirt) must be visible at the neckline between neck and top's color — this white collar detail is required on every character.
  HANDS/ARMS: Absolutely NO individual fingers or finger lines. If arms or hands appear: render only as simple round blob shapes or rounded stumps. Preferred: do not show hands — arms terminate at canvas edge or behind body.`

const STYLE_REF_PREFIX = `STYLE REFERENCE: The attached image shows the exact illustration style to replicate.
DO NOT copy its content — create an entirely new illustration for the word below.
Preserve from reference: flat solid-fill rendering, limited color palette, soft rounded shapes, minimal detail, overall graphic treatment.
Change everything else: subject, composition, colors, and all content.

`

const TYPE_PROMPTS: Record<string, string> = {
  A: `${STYLE_BASE}

TYPE A — Simple icon illustration for vocabulary flashcard. Word: "{WORD}".
Composition: One clear representative object centered, filling 55–70% of canvas.
Decorative elements rule — judge by word type:
  • Add 2–3 small semantic elements ONLY if they reinforce the word's identity. Place at diagonal positions, not grid-aligned. Examples: party→confetti+stars, music→notes, fire→sparks, rain→droplets, love→hearts.
  • OMIT all decorative elements if the object is self-explanatory on its own. Examples: clothing (T-shirt, dress, pants), food items, furniture, tools, color swatches — the silhouette alone is enough.
Choose the most instantly recognizable form of "{WORD}". Simplify to essential shapes only — remove all surface texture, patterns, and unnecessary details.`,

  B: `${STYLE_BASE}

TYPE B — Character avatar for vocabulary flashcard. Word: "{WORD}".
Composition: Half-body portrait, centered. Character faces toward viewer.
${CHAR_SPEC}
Outfit: The top must show the mandatory white inner collar. Use a single solid palette color for the top that visually fits the profession of "{WORD}".
Props (required): Include 1–2 occupation-specific items that make "{WORD}" instantly recognizable — place them near the character or at center chest (avoid putting in hands, to prevent finger detail). Examples: doctor→stethoscope at chest; chef→white toque hat above head; teacher→open book in front; police→badge on chest; tie→simple dark shape at neckline center. All props must be simple flat solid shapes in palette colors.`,

  C: `${STYLE_BASE}

TYPE C — Action/emotion scene for vocabulary flashcard. Word: "{WORD}".
Composition: 1–2 human figures clearly expressing or performing "{WORD}". Figures centered; symbolic elements placed above or beside them.
${CHAR_SPEC}
Expression: Adjust the mouth arc direction for the emotion. Add 1–2 supporting marks as simple flat filled shapes — speech bubble = rounded rectangle with 3 short white lines inside to suggest text; hearts = simple filled heart shapes; sweat drops = small teardrop shapes; stars = simple filled star shapes; exclamation = "!" shape. All marks flat, filled, palette-colored. The character pose + expression + marks together must communicate "{WORD}" without any text.`,

  D: `${STYLE_BASE}

TYPE D — Nature/season illustration for vocabulary flashcard. Word: "{WORD}".
Composition: 3–5 related nature elements freely scattered across the canvas. No grid alignment — use diagonal/triangular layout. Elements vary in size (largest 2× smallest). Some overlap for depth. Rotate some elements for variety. Choose colors that naturally represent "{WORD}" (e.g., spring→pink+green, ocean→blue+teal).`,
}

function loadStyleRef(type: string): File {
  const refName = `type-${type.toLowerCase()}.png`
  const refPath = path.join(process.cwd(), 'public', 'reference', 'style_refs', refName)
  const buf = fs.readFileSync(refPath)
  return new File([buf], refName, { type: 'image/png' })
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

  if (feedback) {
    prompt += `\n\nImportant corrections from previous attempt: ${feedback}`
  }

  try {
    let b64: string | null | undefined

    if (referenceImage) {
      // User-supplied reference takes priority (regeneration with specific reference)
      const b64data = (referenceImage as string).replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(b64data, 'base64')
      const file = new File([buffer], 'reference.png', { type: 'image/png' })
      const response = await openai.images.edit({
        model: 'gpt-image-1',
        image: file,
        prompt: STYLE_REF_PREFIX + prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
      })
      b64 = response.data?.[0]?.b64_json
    } else {
      // images.generate() with transparent background
      const response = await openai.images.generate({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
        output_format: 'png',
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
