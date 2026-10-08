import sharp from 'sharp'

// gpt-image paints "flat" fills as soft gradients no matter what the prompt says.
// Flatten them deterministically: flood-fill regions whose neighboring pixels differ
// only slightly (as inside a gradient), then repaint the region with its median color.
// Real shape edges are hard color jumps, so they split regions and stay crisp.
//
// Safety: a region is only repainted when its overall color spread is small — i.e. it
// really is one fill with lighting on it. If a soft edge bridged two different fills
// (skin into hair, a pale bottle into its outline) the spread is large and the region
// is left exactly as drawn, so flattening can never merge two parts into one color.
const STEP = 6 // max per-channel difference between neighbors inside one region
const MIN_REGION = 400 // px; smaller regions are edges/details — leave as drawn
const MAX_SPREAD = 48 // max per-channel (p95 − p5) for a region to count as one fill

export async function flattenGradients(pngBuffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const n = width * height
  const seen = new Uint8Array(n)

  // Near-white is background territory — never let a region grow into it.
  const isWhite = (p: number) => {
    const i = p * channels
    return Math.min(data[i], data[i + 1], data[i + 2]) > 235
  }
  const close = (a: number, b: number) => {
    const i = a * channels
    const j = b * channels
    return Math.abs(data[i] - data[j]) <= STEP &&
      Math.abs(data[i + 1] - data[j + 1]) <= STEP &&
      Math.abs(data[i + 2] - data[j + 2]) <= STEP
  }

  const stack: number[] = []
  for (let start = 0; start < n; start++) {
    if (seen[start] || isWhite(start)) continue
    seen[start] = 1
    const region = [start]
    stack.push(start)
    while (stack.length) {
      const p = stack.pop()!
      const x = p % width
      const neighbors = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        p >= width ? p - width : -1,
        p < n - width ? p + width : -1,
      ]
      for (const q of neighbors) {
        if (q < 0 || seen[q] || isWhite(q) || !close(p, q)) continue
        seen[q] = 1
        region.push(q)
        stack.push(q)
      }
    }
    if (region.length < MIN_REGION) continue

    const stats = [0, 1, 2].map(c => {
      const vals = region.map(p => data[p * channels + c]).sort((a, b) => a - b)
      const at = (f: number) => vals[Math.floor((vals.length - 1) * f)]
      return { median: at(0.5), spread: at(0.95) - at(0.05) }
    })
    if (stats.some(s => s.spread > MAX_SPREAD)) continue

    for (const p of region) {
      const i = p * channels
      data[i] = stats[0].median
      data[i + 1] = stats[1].median
      data[i + 2] = stats[2].median
    }
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer()
}
