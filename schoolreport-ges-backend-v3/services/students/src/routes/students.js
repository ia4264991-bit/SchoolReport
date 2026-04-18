import { Router } from 'express'
import Student from '../models/Student.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

// Helper: schoolId from JWT
const sid = (req) => req.user.schoolId

/* GET /students?classId=xxx */
router.get('/', requireAuth, async (req, res) => {
  try {
    const filter = { schoolId: sid(req), isActive: true }
    if (req.query.classId) filter.classId = req.query.classId
    // Teachers only see their assigned class
    if (req.user.role === 'teacher' && req.user.classId) {
      filter.classId = req.user.classId
    }
    const students = await Student.find(filter).sort({ fullName: 1 })
    res.json(students)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* GET /students/:id */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const student = await Student.findOne({ _id: req.params.id, schoolId: sid(req) })
    if (!student) return res.status(404).json({ message: 'Student not found.' })
    res.json(student)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* POST /students */
router.post('/', requireAuth, requireRole('admin', 'head', 'teacher'), async (req, res) => {
  try {
    const student = await Student.create({ ...req.body, schoolId: sid(req) })
    res.status(201).json(student)
  } catch (err) { res.status(400).json({ message: err.message }) }
})

/* POST /students/bulk */
router.post('/bulk', requireAuth, requireRole('admin', 'head'), async (req, res) => {
  try {
    const { students } = req.body
    const withSchool = students.map(s => ({ ...s, schoolId: sid(req) }))
    const created = await Student.insertMany(withSchool)
    res.status(201).json(created)
  } catch (err) { res.status(400).json({ message: err.message }) }
})

/* PUT /students/:id */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const student = await Student.findOneAndUpdate(
      { _id: req.params.id, schoolId: sid(req) },
      req.body,
      { new: true, runValidators: true }
    )
    if (!student) return res.status(404).json({ message: 'Student not found.' })
    res.json(student)
  } catch (err) { res.status(400).json({ message: err.message }) }
})

/* DELETE /students/:id — soft delete */
router.delete('/:id', requireAuth, requireRole('admin', 'head'), async (req, res) => {
  try {
    await Student.findOneAndUpdate(
      { _id: req.params.id, schoolId: sid(req) },
      { isActive: false }
    )
    res.json({ message: 'Student removed.' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

export default router
