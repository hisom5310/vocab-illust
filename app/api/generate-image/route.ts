import { GoogleGenAI } from '@google/genai'

const TYPE_PROMPTS: Record<string, string> = {
  A: `Flat vector illustration for a vocabulary flashcard. Subject: "{WORD}" ({KO}).
Style rules: flat design only, solid color fills, NO gradients, NO outlines or strokes, NO shadows, white background (#FFFFFF).
Composition: show the place or object as a clean recognizable scene or building exterior. Center-focused, generous white space around subject.
Colors: use a limited warm palette — peach, sage green, sky blue, warm yellow, soft orange, light grey. Max 5 colors total.
The illustration should be instantly recognizable to a language learner. Simple shapes, friendly and approachable style.`,

  B: `Flat vector illustration for a vocabulary flashcard. Subject: a "{WORD}" character ({KO}).
Style rules: flat design only, solid color fills, NO gradients, NO outlines or strokes, NO shadows, white background (#FFFFFF).
Composition: half-body portrait centered in frame, character facing slightly toward viewer. Include 1-2 clear profession props or uniform details.
Colors: diverse skin tone (vary between illustrations), use a limited palette of 5-6 flat colors.
The character should be instantly recognizable as a {WORD}. Simple shapes, friendly and approachable style.`,

  C: `Flat vector illustration for a vocabulary flashcard. Subject: the action "{WORD}" ({KO}).
Style rules: flat design only, solid color fills, NO gradients, NO outlines or strokes, NO shadows, white background (#FFFFFF).
Composition: a simple figure clearly performing the action. Dynamic but clean pose. Center-focused.
Colors: use a limited warm palette. Max 5 flat colors.
The action should be instantly recognizable. Simple shapes, friendly and approachable style.`,

  D: `Flat vector illustration for a vocabulary flashcard. Subject: "{WORD}" ({KO}) — a nature or seasonal element.
Style rules: flat design only, solid color fills, NO gradients, NO outlines or strokes, NO shadows, white background (#FFFFFF).
Composition: clean minimal scene showcasing the natural element. Center-focused, generous white space.
Colors: natural palette — greens, blues, warm earth tones. Max 5 flat colors.
The illustration should be instantly recognizable. Simple shapes, friendly and approachable style.`,
}

export async function POST(request: Request) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const { word, type = 'A', feedback } = await request.json()

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
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
      contents: prompt,
      config: {
        responseModalities: ['IMAGE'],
      },
    })

    const parts = response.candidates?.[0]?.content?.parts
    const imagePart = parts?.find((p: { inlineData?: { mimeType?: string; data?: string } }) => p.inlineData?.mimeType?.startsWith('image/'))

    if (!imagePart?.inlineData?.data) throw new Error('이미지 생성 실패')

    const { mimeType, data } = imagePart.inlineData
    return Response.json({ image: `data:${mimeType};base64,${data}` })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '이미지 생성 실패'
    return Response.json({ error: message }, { status: 500 })
  }
}
