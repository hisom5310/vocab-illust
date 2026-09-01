import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

export const maxDuration = 60

// Requesting background:'transparent' directly from the model causes it to treat
// any near-white foreground content (white coats, white collars, etc.) as background
// too, making them semi-transparent ("ghosting"). Instead we always generate on an
// opaque white canvas and strip the background ourselves: flood-fill from the image
// borders through connected near-white pixels only, so an enclosed white shape
// (a collar surrounded by non-white) is untouched while the actual background is removed.
async function removeWhiteBackground(pngBuffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const n = width * height

  const minChannel = (p: number) => {
    const i = p * channels
    return Math.min(data[i], data[i + 1], data[i + 2])
  }
  const isNearWhite = (p: number) => minChannel(p) > 245

  // Pass 1: flood-fill the hard background — only through near-pure-white pixels,
  // so pale-but-real design colors (e.g. our Gray 100 #EAEEF4) are never absorbed.
  const bg = new Uint8Array(n)
  const queue: number[] = []
  const trySeed = (p: number) => {
    if (!bg[p] && isNearWhite(p)) {
      bg[p] = 1
      queue.push(p)
    }
  }
  for (let x = 0; x < width; x++) {
    trySeed(x)
    trySeed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    trySeed(y * width)
    trySeed(y * width + (width - 1))
  }
  let qi = 0
  while (qi < queue.length) {
    const p = queue[qi++]
    const x = p % width
    const y = (p - x) / width
    if (x > 0) trySeed(p - 1)
    if (x < width - 1) trySeed(p + 1)
    if (y > 0) trySeed(p - width)
    if (y < height - 1) trySeed(p + width)
  }

  // Hard cutout only — no soft-alpha feathering. An earlier version faded alpha near
  // the cut edge for anti-aliasing, but left the pixel's RGB at its original near-white
  // value, only reducing opacity. That produces "semi-transparent white" boundary pixels:
  // correct on a white page (invisible), but a visible light halo on any other background,
  // since alpha-blending near-white at partial opacity always lightens whatever is behind it.
  // A hard 0/255 cutout has no such pixels, so there is nothing to glow regardless of backdrop.
  for (let p = 0; p < n; p++) {
    if (bg[p]) data[p * channels + 3] = 0
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer()
}

const STYLE_BASE = `STRICT STYLE RULES (never break these):
- Fill (solid color) only. Absolutely NO strokes, NO outlines, NO gradients, NO drop shadows, NO effects.
- CRITICAL: NO blur, NO bokeh, NO glow, NO soft focus, NO depth-of-field, NO vignette, NO photographic lighting of any kind. Every edge between color regions must be perfectly sharp and crisp — a flat 2D vector illustration, not a photo.
- Transparent background. No background color, no patterns, no haze, no color variation anywhere in the background.
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

// Legacy text-only character anatomy spec — fallback only, used when a fixed
// character template file is missing. Normal path uses CHARACTER_TEMPLATES below.
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

const STYLE_REF_PREFIX = `STYLE REFERENCE: The attached image shows the exact illustration style to replicate — flat solid-fill shapes, perfectly sharp edges with zero blur/glow/gradient/shadow, plain background.
DO NOT copy its content — create an entirely new illustration for the word below.
Preserve from reference: flat solid-fill rendering, limited color palette, soft rounded shapes, minimal detail, overall graphic treatment.
Change everything else: subject, composition, colors, and all content.

`

// Fixed face/hair templates (public/reference/character/) — reused as an images.edit()
// reference so the face form stays pixel-consistent across every Type B/C generation,
// instead of re-describing anatomy in text every time (which drifted between generations).
const CHARACTER_TEMPLATES: Record<string, string> = {
  'adult-male': 'char-adult-male.png',
  'adult-male-2': 'char-adult-male-2.png',
  'adult-male-3': 'char-adult-male-3.png',
  'adult-male-4': 'char-adult-male-4.png',
  'adult-female': 'char-adult-female.png',
  'adult-female-2': 'char-adult-female-2.png',
  'adult-female-3': 'char-adult-female-3.png',
  'elderly-male': 'char-elderly-male.png',
  'elderly-female': 'char-elderly-female.png',
  'child-male': 'char-child-male.png',
  'child-female': 'char-child-female.png',
}

// Adult templates that a word with no specific family-role keyword should be
// split across at random (deterministically, by word id/text) for variety.
const ADULT_FALLBACK_KEYS = [
  'adult-male', 'adult-male-2', 'adult-male-3', 'adult-male-4',
  'adult-female', 'adult-female-2', 'adult-female-3',
]

// Keyword → demographic template. Covers family-role words across the base
// languages seen so far (English/Korean/French/Spanish translations). Anything
// unmatched falls back to a random adult template (see ADULT_FALLBACK_KEYS).
const FAMILY_KEYWORDS: Record<string, string[]> = {
  'elderly-male': ['할아버지', 'grandfather', 'grandpa', 'abuelo', 'grand-père', 'grandpère'],
  'elderly-female': ['할머니', 'grandmother', 'grandma', 'abuela', 'grand-mère', 'grandmère'],
  'adult-male': ['아빠', '아버지', 'father', 'dad', 'padre', 'père'],
  'adult-female': ['엄마', '어머니', 'mother', 'mom', 'madre', 'mère'],
  'adult-male-3': ['애인', '연인', 'lover', 'sweetheart', 'boyfriend'],
  'adult-female-2': ['누나', '언니', 'older sister'],
  'child-male': ['아들', '남동생', '손자', 'son', 'little brother', 'niño', 'fils'],
  'child-female': ['딸', '여동생', '손녀', 'daughter', 'little sister', 'niña', 'fille'],
}

function matchFamilyKeyword(word: Word): string | null {
  const text = `${word.en} ${word.ko}`.toLowerCase()
  for (const [key, keywords] of Object.entries(FAMILY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw.toLowerCase()))) return key
  }
  return null
}

function pickCharacterTemplate(word: Word): string {
  const familyKey = matchFamilyKeyword(word)
  if (familyKey) return familyKey
  const seed = word.id || word.en
  const hash = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0)
  return ADULT_FALLBACK_KEYS[hash % ADULT_FALLBACK_KEYS.length]
}

// CHARACTER SHEET — Type B person-words split into two categories with separate
// pose pools, so a family/relation word (e.g. "누나") is never forced into an
// invented profession (Type B previously demanded "job action + prop" for every
// person-word, which made the model hallucinate a nurse outfit for "older sister").
// Each pool holds pose archetypes only (not job-specific) — the profession-specific
// prop is still resolved per word by the model. One pose is picked deterministically
// per word (stable across regeneration, varied across the word list) so adding more
// poses to either array is the only step needed to extend the sheet later.
type PersonCategory = 'occupation' | 'family'

const POSE_LIBRARY: Record<PersonCategory, string[]> = {
  occupation: [
    'standing upright, one arm bent holding a prop at chest height, slight forward lean',
    'standing, both arms bent holding a large prop centered at chest',
    'sitting at a desk or table, one arm resting on the surface, prop placed on the surface in front',
    'standing, one hand raised outward as if explaining or pointing, other arm holding a prop at chest',
    'standing, arms loosely crossed in front with a prop resting against the chest',
    'standing three-quarter turn, one arm bent holding a prop up near the shoulder',
    'kneeling or crouching slightly, one arm extended toward a prop at chest height',
    'standing, both hands together in front holding a small prop at waist height',
  ],
  family: [
    'standing, arms relaxed at sides, gentle forward-facing pose',
    'standing, one hand resting near the chest, warm gentle posture',
    'sitting, hands folded gently in the lap',
    'standing, one arm slightly raised in a small greeting gesture',
    'standing, arms loosely crossed, relaxed casual posture',
    'standing, both hands clasped together in front at waist height',
  ],
}

function pickPose(word: Word, category: PersonCategory): string {
  const seed = (word.id || word.en) + category
  const hash = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0)
  const pool = POSE_LIBRARY[category]
  return pool[hash % pool.length]
}

function buildTypeBPrompt(word: Word): string {
  const category: PersonCategory = matchFamilyKeyword(word) ? 'family' : 'occupation'
  const pose = pickPose(word, category)
  const propRule = category === 'occupation'
    ? `Props (required): 1–2 large, unambiguous occupation-specific props for "{WORD}", integrated into the pose, placed near center chest rather than in the hands (to avoid finger detail). All props are simple flat solid shapes in palette colors.`
    : `Props: none — "{WORD}" is a family/relationship word, not an occupation. Do not invent a job, uniform, or professional tool. Convey identity through pose, outfit color, and expression only.`

  return `${STYLE_BASE}

TYPE B — Character avatar for vocabulary flashcard. Word: "{WORD}".
Composition: Half-body figure, ${pose}.
Outfit: single solid palette color for the top that fits "{WORD}".
${propRule}
Expression: neutral-to-friendly smile, adjust only the mouth arc.`
}

const CHARACTER_EDIT_PREFIX = `CHARACTER REFERENCE — the attached image is a FIXED face/head template. Use it as-is for this character:
Keep identical, at the EXACT SAME SCALE AND POSITION as the reference — do not zoom in, crop tighter, or enlarge the head: face shape (including the rounded cheek bumps), hair silhouette and color, collar style, skin tone, and the amount of empty margin above the head.
CRITICAL — NO NOSE: the reference has no nose. Do not add one. The gap between the eyes and mouth must stay bare skin, exactly like the reference — no bump, no curve, no line, nothing there at all, even though this is a different pose/outfit.
CRITICAL — NO EXTRA LINES ON CLOTHING: any new clothing (coat, uniform, etc.) must be a single flat solid color shape with no fold lines, no lapel lines, no stitching lines, no internal strokes of any kind — flat fill only, same rule as the reference top.
You MAY change: the eyes, eyebrows, and mouth TOGETHER as one unit (to match the required expression below — never change only one of the three, they must match the same mood), the shirt/top color, and add a pose, props, or symbolic elements as instructed below — but keep the face shape, hair, and overall head/shoulder framing identical to the reference.
Do not redraw the face from scratch — edit around the fixed reference, do not shrink or omit the hair.

`

const TYPE_PROMPTS: Record<string, string> = {
  A: `${STYLE_BASE}

TYPE A — Simple icon illustration for vocabulary flashcard. Word: "{WORD}".
Composition: One clear representative object centered, filling 55–70% of canvas.
Decorative elements rule — judge by word type:
  • Add 2–3 small semantic elements ONLY if they reinforce the word's identity. Place at diagonal positions, not grid-aligned. Examples: party→confetti+stars, music→notes, fire→sparks, rain→droplets, love→hearts.
  • OMIT all decorative elements if the object is self-explanatory on its own. Examples: clothing (T-shirt, dress, pants), food items, furniture, tools, color swatches — the silhouette alone is enough.
Choose the most instantly recognizable form of "{WORD}". Simplify to essential shapes only — remove all surface texture, patterns, and unnecessary details.`,

  C: `${STYLE_BASE}

TYPE C — Action/emotion scene for vocabulary flashcard. Word: "{WORD}".

STEP 1 — Classify "{WORD}" into exactly one composition category, then follow ONLY that category's rules below (do not mix categories):
  (a) SOLO REACTION — a single figure's emotion, state, or sensation, with no second figure and no shared prop (e.g. spicy, surprised, sad, angry, embarrassed, tired).
  (b) TWO-FIGURE INTERACTION — one figure acting toward or with another figure (e.g. help, introduce, point at, greet, praise, thank, explain to).
  (c) GROUP/SCENE — an activity involving 3+ figures, or 2 figures explicitly arranged around one shared prop such as a table or screen (e.g. have a meeting, give a presentation).

EXPRESSION TABLE — used by every category below. Pick the row matching the mood of "{WORD}" (or the mood each figure should show) and render the eyes, eyebrows, and mouth EXACTLY as specified together as one unit — never mix rows:
  • Neutral: round circles or slightly flattened ovals (eyes), straight horizontal lines (eyebrows), short flat line or omitted (mouth), no accent.
  • Happy/pleased: upward-curved crescents (eyes), horizontal or slightly raised (eyebrows), upward C-curve arc (mouth), pink cheek circles.
  • Requesting/awkward: downward-curved crescents (eyes), inner ends raised in a ∧ shape (eyebrows), wavy or downward arc (mouth), teal sweat drop.
  • Sad/struggling: downward-curved crescents (eyes), inner ends raised in a ∧ shape (eyebrows), wavy or downward arc (mouth), teal tear drops on both sides.
  • Angry: slightly furrowed ovals (eyes), inner ends lowered in a ∨ shape (eyebrows), short flat or downward line (mouth), no accent.
  • Spicy/surprised: large round circles (eyes), raised upward (eyebrows), large open oval (mouth), red cheek circles.
Accent placement: beside the head, never overlapping the face.

CATEGORY (a) SOLO REACTION:
Composition: One half-body figure, facing forward, centered.
Use the expression table above for the face. Add exactly one accent from the matching row.

CATEGORY (b) TWO-FIGURE INTERACTION:
Composition: Exactly 2 half-body figures, positioned left-right, angled 15–30° toward each other (not both flat front-facing). Acting figure at 100% scale, the other at 85% scale for depth.
Gesture rule — convey the action through ARM ANGLE and BODY ROTATION only, never through finger detail (hands stay simple rounded mitten shapes):
  • Pointing/indicating at the other figure: arm fully extended in a straight diagonal line toward them.
  • Greeting/waving: one arm raised beside the head, forearm angled outward.
  • Introducing/presenting/offering: arm extended forward at roughly 45°, rounded palm-side shape facing up, body turned toward the other figure.
  • Helping/supporting: arm bent toward the other figure at chest-to-shoulder height, as if steadying or offering something.
  • Praising/thanking: hands brought together at chest height, or one arm extended with a rounded thumbs-up-shaped mitten.
Pick whichever gesture best matches "{WORD}". Use the expression table above for both figures' faces, matched to the tone of "{WORD}".

CATEGORY (c) GROUP/SCENE:
Composition: 3+ half-body figures (or 2 figures plus a shared prop) arranged around one shared prop — a table, screen, or podium — that anchors the scene. Front-row figure(s) at 100% scale, back row at 85% for depth.
Prop: one simple flat solid-color shape sized to visually anchor the group (e.g. a table spanning the lower third of the composition).
Use the expression table above for all figures — default to Neutral or Happy/pleased unless "{WORD}" implies a specific mood.

All categories — hands/arms: no individual fingers ever, always simple rounded blob or mitten shapes, or keep arms out of frame. Add 1–2 supporting marks if "{WORD}" needs them beyond the expression accent — speech bubble = rounded rectangle with 3 short white lines inside; stars = simple filled star shapes; exclamation = "!" shape. All marks flat, filled, palette-colored, placed beside the figures, never as text.`,

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

function loadCharacterTemplate(key: string): File {
  const refName = CHARACTER_TEMPLATES[key]
  const refPath = path.join(process.cwd(), 'public', 'reference', 'character', refName)
  const buf = fs.readFileSync(refPath)
  return new File([buf], refName, { type: 'image/png' })
}

type Word = { id?: string; en: string; ko: string; type?: string }

export async function POST(request: Request) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const { word, type = 'A', feedback, referenceImage } = await request.json() as {
    word: Word
    type?: string
    feedback?: string
    referenceImage?: string
  }

  if (!word?.en || !word?.ko) {
    return Response.json({ error: '단어 정보가 없습니다' }, { status: 400 })
  }

  const basePrompt = type === 'B' ? buildTypeBPrompt(word) : (TYPE_PROMPTS[type] || TYPE_PROMPTS.A)
  const typePrompt = basePrompt
    .replace(/\{WORD\}/g, word.en)

  const prompt = feedback
    ? `MANDATORY REVISION INSTRUCTIONS — HIGHEST PRIORITY. These override ANY conflicting rule in the composition spec below, including required human figures, characters, speech bubbles, or text:
${feedback}

If the instructions above say not to use people/characters/hands/faces or not to use text/speech bubbles, you MUST omit them entirely, even though the composition spec below requests them — replace with a simple flat icon-only illustration instead. The feedback above always wins over the composition spec.

---
${typePrompt}`
    : typePrompt

  const isCharacterType = (type === 'B' || type === 'C') && !referenceImage

  try {
    let b64: string | null | undefined
    let debugFallback: string | null = null

    if (referenceImage) {
      // User-supplied reference takes priority (regeneration with specific reference)
      const b64data = (referenceImage as string).replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(b64data, 'base64')
      const file = new File([buffer], 'reference.png', { type: 'image/png' })
      const response = await openai.images.edit({
        model: 'gpt-image-1.5',
        image: file,
        prompt: STYLE_REF_PREFIX + prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        output_format: 'png',
      })
      b64 = response.data?.[0]?.b64_json
    } else if (isCharacterType) {
      // Type B/C base generation: edit a fixed face template so the face form
      // stays pixel-consistent instead of being re-described in text each time.
      try {
        const templateKey = pickCharacterTemplate(word)
        const file = loadCharacterTemplate(templateKey)
        const response = await openai.images.edit({
          model: 'gpt-image-1.5',
          image: file,
          prompt: CHARACTER_EDIT_PREFIX + prompt,
          n: 1,
          size: '1024x1024',
          quality: 'medium',
          output_format: 'png',
        })
        b64 = response.data?.[0]?.b64_json
      } catch (refErr) {
        // Template file missing/unreadable — fall back to the legacy text-only anatomy spec
        console.error('character-template edit() failed, falling back to generate():', refErr)
        debugFallback = String(refErr)
        const response = await openai.images.generate({
          model: 'gpt-image-1.5',
          prompt: `${prompt}\n\n${CHAR_SPEC}`,
          n: 1,
          size: '1024x1024',
          quality: 'medium',
          output_format: 'png',
        })
        b64 = response.data?.[0]?.b64_json
      }
    } else {
      // Type A/D: images.edit() grounded on a flat-icon style reference image.
      // Plain text-to-image (images.generate()) reliably drifts into a glowing/blurred
      // "neon icon" render once the ~80-hex color palette block appears in the prompt —
      // confirmed by direct A/B testing: same prompt, generate() glows, edit()-with-reference
      // stays perfectly flat. Falls back to generate() if the reference file is missing.
      try {
        const file = loadStyleRef(type)
        const response = await openai.images.edit({
          model: 'gpt-image-1.5',
          image: file,
          prompt: STYLE_REF_PREFIX + prompt,
          n: 1,
          size: '1024x1024',
          quality: 'medium',
          output_format: 'png',
        })
        b64 = response.data?.[0]?.b64_json
      } catch (refErr) {
        console.error('style-ref edit() failed, falling back to generate():', refErr)
        debugFallback = String(refErr)
        const response = await openai.images.generate({
          model: 'gpt-image-1.5',
          prompt,
          n: 1,
          size: '1024x1024',
          quality: 'medium',
          output_format: 'png',
        })
        b64 = response.data?.[0]?.b64_json
      }
    }

    if (!b64) throw new Error('이미지 생성 실패')
    const transparentBuffer = await removeWhiteBackground(Buffer.from(b64, 'base64'))
    return Response.json({
      image: `data:image/png;base64,${transparentBuffer.toString('base64')}`,
      ...(debugFallback ? { debugFallback } : {}),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '이미지 생성 실패'
    return Response.json({ error: message }, { status: 500 })
  }
}
