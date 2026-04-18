import { Router } from 'express'
import Score from '../models/Score.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

const sid = (req) => req.user.schoolId

/* ══════════════════════════════════
   SCORES
══════════════════════════════════ */

/* GET /scores/:classId/:term */
router.get('/scores/:classId/:term', requireAuth, async (req, res) => {
  try {
    const { classId, term } = req.params
    // Teachers scoped to their own class
    if (req.user.role === 'teacher' && req.user.classId !== classId) {
      return res.status(403).json({ message: 'Access denied to this class.' })
    }
    const scores = await Score.find({ schoolId: sid(req), classId, term })
    res.json(scores)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* GET /scores/student/:studentId/:term */
router.get('/scores/student/:studentId/:term', requireAuth, async (req, res) => {
  try {
    const scores = await Score.find({
      schoolId:  sid(req),
      studentId: req.params.studentId,
      term:      req.params.term,
    })
    res.json(scores)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* POST /scores/:classId/:term/bulk — upsert all scores for a class */
router.post('/scores/:classId/:term/bulk', requireAuth, async (req, res) => {
  try {
    const { classId, term } = req.params
    const { scores } = req.body
    const schoolId = sid(req)

    const ops = []
    for (const [studentId, subjects] of Object.entries(scores)) {
      for (const [subjectId, vals] of Object.entries(subjects)) {
        if (vals.classScore === '' && vals.examScore === '') continue
        ops.push({
          updateOne: {
            filter: { studentId, subjectId, term, schoolId },
            update: {
              $set: {
                classId,
                schoolId,
                classScore: parseFloat(vals.classScore) || 0,
                examScore:  parseFloat(vals.examScore)  || 0,
              }
            },
            upsert: true,
          }
        })
      }
    }
    if (ops.length) await Score.bulkWrite(ops)
    res.json({ message: `${ops.length} score entries saved.` })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* PUT /scores/:id */
router.put('/scores/:id', requireAuth, async (req, res) => {
  try {
    const score = await Score.findOneAndUpdate(
      { _id: req.params.id, schoolId: sid(req) },
      req.body,
      { new: true }
    )
    if (!score) return res.status(404).json({ message: 'Score not found.' })
    res.json(score)
  } catch (err) { res.status(400).json({ message: err.message }) }
})

/* DELETE /scores/:classId/:term */
router.delete('/scores/:classId/:term', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await Score.deleteMany({
      schoolId: sid(req),
      classId:  req.params.classId,
      term:     req.params.term,
    })
    res.json({ message: `${result.deletedCount} scores deleted.` })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* ══════════════════════════════════
   REPORTS
══════════════════════════════════ */

/* GET /reports/student/:studentId/:term */
router.get('/reports/student/:studentId/:term', requireAuth, async (req, res) => {
  try {
    const scores = await Score.find({
      schoolId:  sid(req),
      studentId: req.params.studentId,
      term:      req.params.term,
    })
    res.json(scores)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* GET /reports/class/:classId/:term */
router.get('/reports/class/:classId/:term', requireAuth, async (req, res) => {
  try {
    const scores = await Score.find({
      schoolId: sid(req),
      classId:  req.params.classId,
      term:     req.params.term,
    })
    const grouped = {}
    scores.forEach(s => {
      if (!grouped[s.studentId]) grouped[s.studentId] = []
      grouped[s.studentId].push(s)
    })
    res.json(grouped)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

/* GET /reports/school/:schoolId/analytics — headmaster / admin */
router.get('/reports/school/:schoolId/analytics', requireAuth, requireRole('admin', 'head', 'superadmin'), async (req, res) => {
  try {
    // Admins can only query their own school
    if (req.user.role !== 'superadmin' && req.params.schoolId !== sid(req)) {
      return res.status(403).json({ message: 'Access denied.' })
    }
    const scores = await Score.find({ schoolId: req.params.schoolId })
    const totalEntries = scores.length
    const avgScore = totalEntries
      ? (scores.reduce((a, s) => a + ((s.classScore / 100 * 40) + (s.examScore / 100 * 60)), 0) / totalEntries).toFixed(1)
      : 0
    const classBreakdown = {}
    scores.forEach(s => {
      if (!classBreakdown[s.classId]) classBreakdown[s.classId] = { count: 0, total: 0 }
      classBreakdown[s.classId].count++
      classBreakdown[s.classId].total += (s.classScore / 100 * 40) + (s.examScore / 100 * 60)
    })
    res.json({ totalEntries, avgScore, classBreakdown })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

export default router
