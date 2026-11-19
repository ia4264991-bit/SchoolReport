// Ready-made grading scales for the Settings editor (the server keeps each school's own
// scale and does all the grading; these only fill the editor).
export const PRESET_LABELS = {
  nacca: 'NaCCA proficiency levels (KG – Basic 6)',
  bece: 'Grades 1–9 (JHS / BECE style)',
  wassce: 'A1–F9 (WASSCE style)',
  custom: 'Custom',
}

export { ordinal } from './format'
