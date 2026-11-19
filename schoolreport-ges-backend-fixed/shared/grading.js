import { HttpError } from './http.js'

/**
 * Grading scales. Each school stores its own (school_settings.grading_scale) as
 * { preset, bands: [{ min, grade, remark }, …] } with the highest band first and the last
 * band starting at 0. These presets fill the editor; a school can change any band.
 */
export const GRADING_PRESETS = {
  // NaCCA standards-based curriculum (KG – Basic 6): proficiency levels.
  nacca: [
    { min: 80, grade: 'HP', remark: 'Highly Proficient' },
    { min: 68, grade: 'P', remark: 'Proficient' },
    { min: 54, grade: 'AP', remark: 'Approaching Proficiency' },
    { min: 40, grade: 'D', remark: 'Developing' },
    { min: 0, grade: 'E', remark: 'Emerging' },
  ],
  // Grades 1–9 as used for JHS / BECE.
  bece: [
    { min: 80, grade: '1', remark: 'Highest' },
    { min: 70, grade: '2', remark: 'Higher' },
    { min: 60, grade: '3', remark: 'High' },
    { min: 55, grade: '4', remark: 'High Average' },
    { min: 50, grade: '5', remark: 'Average' },
    { min: 45, grade: '6', remark: 'Low Average' },
    { min: 40, grade: '7', remark: 'Low' },
    { min: 35, grade: '8', remark: 'Lower' },
    { min: 0, grade: '9', remark: 'Lowest' },
  ],
  // A1–F9 (the WASSCE-style scale this app used at first).
  wassce: [
    { min: 80, grade: 'A1', remark: 'Excellent' },
    { min: 70, grade: 'B2', remark: 'Very Good' },
    { min: 60, grade: 'B3', remark: 'Good' },
    { min: 55, grade: 'C4', remark: 'Credit' },
    { min: 50, grade: 'C5', remark: 'Credit' },
    { min: 45, grade: 'C6', remark: 'Credit' },
    { min: 40, grade: 'D7', remark: 'Pass' },
    { min: 35, grade: 'E8', remark: 'Pass' },
    { min: 0, grade: 'F9', remark: 'Fail' },
  ],
}

export const DEFAULT_SCALE = { preset: 'nacca', bands: GRADING_PRESETS.nacca }

/** Validates a scale sent by a school; returns the cleaned value or throws 400. */
export function checkGradingScale(input) {
  const bands = input?.bands
  if (!Array.isArray(bands) || bands.length < 2 || bands.length > 12) {
    throw new HttpError(400, 'The grading scale needs between 2 and 12 bands.')
  }
  const out = bands.map((b, i) => {
    const min = Number(b?.min)
    if (!Number.isFinite(min) || min < 0 || min > 100) throw new HttpError(400, `Band ${i + 1}: the lowest mark must be between 0 and 100.`)
    const grade = typeof b?.grade === 'string' ? b.grade.trim() : ''
    const remark = typeof b?.remark === 'string' ? b.remark.trim() : ''
    if (!grade || grade.length > 6) throw new HttpError(400, `Band ${i + 1}: the grade must be 1–6 characters.`)
    if (remark.length > 40) throw new HttpError(400, `Band ${i + 1}: the remark must be at most 40 characters.`)
    return { min: Math.round(min * 10) / 10, grade, remark }
  })
  for (let i = 1; i < out.length; i++) {
    if (out[i].min >= out[i - 1].min) throw new HttpError(400, 'List the bands from the highest mark to the lowest.')
  }
  if (out[out.length - 1].min !== 0) throw new HttpError(400, 'The last band must start at 0.')
  const preset = Object.keys(GRADING_PRESETS).includes(input?.preset) ? input.preset : 'custom'
  return { preset, bands: out }
}

/** The band a mark (0–100) falls in. */
export function gradeFor(bands, mark) {
  const m = Number(mark) || 0
  for (const b of bands) if (m >= b.min) return b
  return bands[bands.length - 1]
}

/**
 * A subject's total out of 100: the class score is scaled to `weight`%, the exam (out of
 * 100) to the rest. maxClassScore is the raw maximum of the class score (100 when not set).
 */
export function subjectTotal(classScore, examScore, maxClassScore, weight = 40) {
  const max = maxClassScore > 0 ? maxClassScore : 100
  return (classScore / max) * weight + (examScore / 100) * (100 - weight)
}

/**
 * Standard competition ranking (1, 2, 2, 4): equal values to one decimal share a position.
 * Returns Map(id → position).
 */
export function rankBy(entries) {
  const sorted = [...entries].sort((a, b) => b.value - a.value)
  const out = new Map()
  let prev = null
  sorted.forEach((e, i) => {
    const r = Math.round(e.value * 10)
    const pos = prev && prev.r === r ? prev.pos : i + 1
    out.set(e.id, pos)
    prev = { r, pos }
  })
  return out
}
