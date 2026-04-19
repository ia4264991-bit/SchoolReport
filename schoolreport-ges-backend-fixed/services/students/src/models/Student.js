import mongoose from 'mongoose'

const studentSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  fullName:    { type: String, required: true, trim: true },
  gender:      { type: String, enum: ['M', 'F'], required: true },
  dateOfBirth: { type: Date, default: null },
  classId:     { type: String, required: true },
  isActive:    { type: Boolean, default: true },
}, { timestamps: true })

studentSchema.index({ schoolId: 1 })
studentSchema.index({ schoolId: 1, classId: 1 })

export default mongoose.model('Student', studentSchema)
