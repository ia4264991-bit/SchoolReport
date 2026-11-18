// Prepares a school logo in the browser before upload:
//  - accepts PNG, JPEG, WebP, GIF and SVG files
//  - redraws it on a canvas (removes hidden data such as GPS tags and any script in SVG files)
//  - shrinks it to at most 512 px and saves it as PNG (keeps transparent backgrounds)
// The server accepts only PNG/JPEG/WebP up to 512 KB and checks the real bytes again.

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
const MAX_UPLOAD_BYTES = 500 * 1024
const MAX_FILE_BYTES = 10 * 1024 * 1024

export const LOGO_ACCEPT = ACCEPTED.join(',')

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read that image. Try a PNG or JPEG file.'))
    img.src = url
  })
}

/** Returns a PNG Blob ready to upload, or throws an Error with a message for the user. */
export async function prepareLogo(file) {
  if (!ACCEPTED.includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP or SVG image.')
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is too large (10 MB maximum).')

  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    // SVGs without a set size report 0×0: draw them as a 512 px square.
    const w = img.naturalWidth || 512
    const h = img.naturalHeight || 512
    for (const maxSide of [512, 384, 256]) {
      const scale = Math.min(1, maxSide / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(16, Math.round(w * scale))
      canvas.height = Math.max(16, Math.round(h * scale))
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob
    }
    throw new Error('This image is too detailed to use as a logo. Try a simpler or smaller version.')
  } finally {
    URL.revokeObjectURL(url)
  }
}
