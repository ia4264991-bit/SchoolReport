import { Router } from 'express'
import { School, Settings, Class, Subject, MaxMarks } from '../models/index.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

// Helper: get schoolId from the authenticated user's JWT
const sid = (req) => req.user.schoolId

/* ══════════════════════════════════════════════════════
   SCHOOLS (superadmin only)
══════════════════════════════════════════════════════ */
router.get('/schools', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const schools = await School.find().sort({ createdAt: -1 })
    res.json(schools)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.get('/schools/:id', requireAuth, async (req, res) => {
  try {
    // Admins can only fetch their own school; superadmin can fetch any
    const filter = req.user.role === 'superadmin'
      ? { _id: req.params.id }
      : { _id: req.params.id, _id: sid(req) }
    const school = await School.findOne(filter)
    if (!school) return res.status(404).json({ message: 'School not found.' })
    res.json(school)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* ══════════════════════════════════════════════════════
   SETTINGS  (scoped by schoolId from JWT)
══════════════════════════════════════════════════════ */
router.get('/settings', requireAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne({ schoolId: sid(req) })
    if (!settings) {
      // Auto-create settings record for this school
      const school = await School.findById(sid(req))
      settings = await Settings.create({
        schoolId: sid(req),
        schoolName: school?.name || 'My School',
        circuit: school?.circuit || '',
        district: school?.district || '',
        region: school?.region || '',
      })
    }
    res.json(settings)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.put('/settings', requireAuth, requireRole('admin', 'head'), async (req, res) => {
  try {
    let settings = await Settings.findOne({ schoolId: sid(req) })
    if (!settings) settings = new Settings({ schoolId: sid(req) })
    Object.assign(settings, req.body)
    settings.schoolId = sid(req)  // prevent override
    await settings.save()
    res.json(settings)
  } catch (err) { res.status(400).json({ message: err.message }) }
})

/* ══════════════════════════════════════════════════════
   STATS  (for dashboard)
══════════════════════════════════════════════════════ */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const [classes, subjects] = await Promise.all([
      Class.countDocuments({ schoolId: sid(req) }),
      Subject.countDocuments({ schoolId: sid(req) }),
    ])
    res.json({ totalClasses: classes, subjectsCount: subjects, totalStudents: 0, reportsGenerated: 0 })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* ══════════════════════════════════════════════════════
   CLASSES  (scoped CRUD)
══════════════════════════════════════════════════════ */
router.get('/classes', requireAuth, async (req, res) => {
  try {
    const classes = await Class.find({ schoolId: sid(req) }).sort({ name: 1 })
    res.json(classes)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.post('/classes', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const cls = await Class.create({ ...req.body, schoolId: sid(req) })
    res.status(201).json(cls)
  } catch (err) { res.status(400).json({ message: err.message }) }
})

router.put('/classes/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const cls = await Class.findOneAndUpdate(
      { _id: req.params.id, schoolId: sid(req) },
      req.body,
      { new: true, runValidators: true }
    )
    if (!cls) return res.status(404).json({ message: 'Class not found.' })
    res.json(cls)
  } catch (err) { res.status(400).json({ message: err.message }) }
})

router.delete('/classes/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await Class.findOneAndDelete({ _id: req.params.id, schoolId: sid(req) })
    res.json({ message: 'Class deleted.' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* ══════════════════════════════════════════════════════
   SUBJECTS  (scoped CRUD)
══════════════════════════════════════════════════════ */
router.get('/subjects', requireAuth, async (req, res) => {
  try {
    const subjects = await Subject.find({ schoolId: sid(req) }).sort({ order: 1, name: 1 })
    res.json(subjects)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.post('/subjects', requireAuth, requireRole('admin', 'head'), async (req, res) => {
  try {
    const sub = await Subject.create({ ...req.body, schoolId: sid(req) })
    res.status(201).json(sub)
  } catch (err) { res.status(400).json({ message: err.message }) }
})

router.put('/subjects/:id', requireAuth, requireRole('admin', 'head'), async (req, res) => {
  try {
    const sub = await Subject.findOneAndUpdate(
      { _id: req.params.id, schoolId: sid(req) },
      req.body,
      { new: true }
    )
    if (!sub) return res.status(404).json({ message: 'Subject not found.' })
    res.json(sub)
  } catch (err) { res.status(400).json({ message: err.message }) }
})

router.delete('/subjects/:id', requireAuth, requireRole('admin', 'head'), async (req, res) => {
  try {
    await Subject.findOneAndDelete({ _id: req.params.id, schoolId: sid(req) })
    res.json({ message: 'Subject deleted.' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* ══════════════════════════════════════════════════════
   MAX MARKS  (scoped per school)
══════════════════════════════════════════════════════ */
router.get('/max-marks', requireAuth, async (req, res) => {
  try {
    let doc = await MaxMarks.findOne({ schoolId: sid(req) })
    if (!doc) doc = await MaxMarks.create({ schoolId: sid(req), marks: {} })
    res.json(Object.fromEntries(doc.marks))
  } catch (err) { res.status(500).json({ message: err.message }) }
})

router.put('/max-marks', requireAuth, requireRole('admin', 'head'), async (req, res) => {
  try {
    let doc = await MaxMarks.findOne({ schoolId: sid(req) })
    if (!doc) doc = new MaxMarks({ schoolId: sid(req) })
    doc.marks = new Map(Object.entries(req.body))
    await doc.save()
    res.json(Object.fromEntries(doc.marks))
  } catch (err) { res.status(400).json({ message: err.message }) }
})

export default router
