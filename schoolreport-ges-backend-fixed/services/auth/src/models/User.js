import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema({
  fullName:           { type: String, required: true, trim: true },
  email:              { type: String, required: true, unique: true, lowercase: true, trim: true },
  username:           { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  password:           { type: String, required: true, minlength: 6 },
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'head', 'teacher', 'student'],
    required: true,
  },
  schoolId:           { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
  classId:            { type: String, default: null },
  notes:              { type: String, default: '' },
  isActive:           { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false },
  // OTP-based password reset
  otpCode:            { type: String, default: null },
  otpExpiry:          { type: Date,   default: null },
}, { timestamps: true })

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password)
}

userSchema.set('toJSON', {
  transform: (_, obj) => {
    delete obj.password
    delete obj.otpCode
    delete obj.otpExpiry
    return obj
  },
})

export default mongoose.model('User', userSchema)
