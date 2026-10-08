import sharp from 'sharp'
import { flattenGradients } from './flatten'

// Requesting background:'transparent' directly from the model causes it to treat
// any near-white foreground content (white coats, white collars, etc.) as background
// too, making them semi-transparent ("ghosting"). Instead we always generate on an
// opaque white canvas and strip the background ourselves: flood-fill from the image
// borders through connected near-white pixels only, so an enclosed white shape
// (a collar surrounded by non-white) is untouched while the actual background is removed.
export async function removeWhiteBackground(pngBuffer: Buffer): Promise<Buffer> {
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

  // Pass 2: decontaminated feather on the boundary ring only (pixels adjacent to
  // removed background, NOT the whole image — so pale design colors like Gray 100
  // #EAEEF4 sitting away from any real edge are never touched).
  //
  // A hard 0/255 cutout leaves the anti-aliased blend pixels between object and
  // background fully OPAQUE at their blended (whitened) color — a visible light-gray
  // fringe around every shape on any backdrop. The earlier feathered version fixed
  // the opacity but kept the whitened RGB, so at partial alpha it lightens whatever
  // it's composited over — a halo, just a differently-colored one.
  // Fix: do both — reduce alpha AND un-blend ("decontaminate") the RGB back toward
  // the true foreground color, removing the white the anti-aliasing mixed in.
  const RADIUS = 2
  const LOW = 180
  const HIGH = 245
  const nearBg = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    if (!bg[p]) continue
    const x = p % width
    const y = (p - x) / width
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= height) continue
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= width) continue
        const np = ny * width + nx
        if (!bg[np]) nearBg[np] = 1
      }
    }
  }

  for (let p = 0; p < n; p++) {
    const i = p * channels
    if (bg[p]) {
      data[i + 3] = 0
      continue
    }
    if (!nearBg[p]) continue
    const t = Math.min(1, Math.max(0, (minChannel(p) - LOW) / (HIGH - LOW)))
    if (t <= 0) continue
    const alpha = 255 * (1 - t)
    const keep = 1 - t
    data[i] = Math.min(255, Math.max(0, Math.round((data[i] - t * 255) / keep)))
    data[i + 1] = Math.min(255, Math.max(0, Math.round((data[i + 1] - t * 255) / keep)))
    data[i + 2] = Math.min(255, Math.max(0, Math.round((data[i + 2] - t * 255) / keep)))
    data[i + 3] = Math.min(data[i + 3], Math.round(alpha))
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer()
}

// Designers scale almost every draft up to fill the card (finals: subject spans 75–94%
// of the canvas, 6–12% margins; drafts: ~65%). Do that here: crop to the visible
// subject and re-place it with an 8% margin. A subject that touches the bottom edge
// (a half-body character cut at the chest) stays anchored to the bottom.
const MARGIN = 0.08

export async function fitToCanvas(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 16) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return png

  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  const margin = Math.round(width * MARGIN)
  const bottomAnchored = maxY >= height - 4
  const room = width - margin * 2
  const scale = bottomAnchored
    ? Math.min(room / bw, (height - margin) / bh)
    : Math.min(room / bw, room / bh)
  const w = Math.max(1, Math.round(bw * scale))
  const h = Math.max(1, Math.round(bh * scale))

  const subject = await sharp(png)
    .extract({ left: minX, top: minY, width: bw, height: bh })
    .resize(w, h, { kernel: 'lanczos3' })
    .png()
    .toBuffer()
  const left = Math.round((width - w) / 2)
  const top = bottomAnchored ? height - h : Math.round((height - h) / 2)
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: subject, left, top }])
    .png()
    .toBuffer()
}

// Now and then the model paints a solid dark or colored backdrop despite the prompt
// (seen: a black square behind a "spicy" character). If the image border is one uniform
// non-white color, flood-fill that backdrop from the edges to white so the normal
// white-background removal can take it out.
async function whitenUniformBackdrop(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const border: number[] = []
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x)
  for (let y = 0; y < height; y++) border.push(y * width, y * width + width - 1)
  const med = [0, 1, 2].map(c => {
    const vals = border.map(p => data[p * channels + c]).sort((a, b) => a - b)
    return vals[vals.length >> 1]
  })
  if (Math.min(...med) > 235) return png // already white
  const near = (p: number) => {
    const i = p * channels
    return Math.abs(data[i] - med[0]) <= 24 && Math.abs(data[i + 1] - med[1]) <= 24 && Math.abs(data[i + 2] - med[2]) <= 24
  }
  if (border.filter(near).length < border.length * 0.8) return png // not a uniform backdrop

  const n = width * height
  const seen = new Uint8Array(n)
  const stack = border.filter(p => near(p))
  stack.forEach(p => { seen[p] = 1 })
  while (stack.length) {
    const p = stack.pop()!
    const i = p * channels
    data[i] = data[i + 1] = data[i + 2] = 255
    const x = p % width
    for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p >= width ? p - width : -1, p < n - width ? p + width : -1]) {
      if (q >= 0 && !seen[q] && near(q)) { seen[q] = 1; stack.push(q) }
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer()
}

// Raw model output (opaque, white background) → final transparent card image.
export async function postprocess(raw: Buffer): Promise<Buffer> {
  const flat = await flattenGradients(await whitenUniformBackdrop(raw))
  const transparent = await removeWhiteBackground(flat)
  return fitToCanvas(transparent)
}
