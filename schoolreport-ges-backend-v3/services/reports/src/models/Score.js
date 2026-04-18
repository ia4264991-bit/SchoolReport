import mongoose from 'mongoose'

const scoreSchema = new mongoose.Schema({
  schoolId:   { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  studentId:  { type: String, required: true },
  classId:    { type: String, required: true },
  subjectId:  { type: String, required: true },
  term:       { type: String, enum: ['1', '2', '3'], required: true },
  classScore: { type: Number, default: 0, min: 0 },
  examScore:  { type: Number, default: 0, min: 0, max: 100 },
}, { timestamps: true })

scoreSchema.index({ schoolId: 1, classId: 1, term: 1 })
scoreSchema.index({ studentId: 1, subjectId: 1, term: 1, schoolId: 1 }, { unique: true })

export default mongoose.model('Score', scoreSchema)
