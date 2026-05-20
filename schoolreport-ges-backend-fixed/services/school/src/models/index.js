import mongoose from 'mongoose'

/* ─── School (master record — one per school) ─── */
const schoolSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  circuit:      { type: String, default: '' },
  district:     { type: String, default: '' },
  region:       { type: String, default: '' },
  academicYear: { type: String, default: '2024/2025' },
  term:         { type: String, enum: ['1','2','3'], default: '1' },
  isActive:     { type: Boolean, default: true },
}, { timestamps: true })

export const School = mongoose.model('School', schoolSchema)

/* ─── Settings (one per school — schoolId is the key) ─── */
const settingsSchema = new mongoose.Schema({
  schoolId:     { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, unique: true },
  schoolName:   { type: String, default: 'My School' },
  circuit:      { type: String, default: '' },
  district:     { type: String, default: '' },
  region:       { type: String, default: '' },
  headTeacher:  { type: String, default: '' },
  academicYear: { type: String, default: '2024/2025' },
  term:         { type: String, enum: ['1','2','3'], default: '1' },
  nextTermDate: { type: String, default: '' },
}, { timestamps: true })

export const Settings = mongoose.model('Settings', settingsSchema)

/* ─── Class ─── */
const classSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  name:        { type: String, required: true, trim: true },
  level:       { type: String, default: '' },
  teacherId:   { type: String, default: null },
  teacherName: { type: String, default: '' },
}, { timestamps: true })

classSchema.index({ schoolId: 1 })
export const Class = mongoose.model('Class', classSchema)

/* ─── Subject ─── */
const subjectSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  name:     { type: String, required: true, trim: true },
  code:     { type: String, default: '' },
  order:    { type: Number, default: 0 },
}, { timestamps: true })

subjectSchema.index({ schoolId: 1 })
export const Subject = mongoose.model('Subject', subjectSchema)

/* ─── MaxMarks — per school, per subject ─── */
const maxMarksSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, unique: true },
  marks:    { type: Map, of: Number, default: {} },  // { subjectId: maxMark }
}, { timestamps: true })

export const MaxMarks = mongoose.model('MaxMarks', maxMarksSchema)
