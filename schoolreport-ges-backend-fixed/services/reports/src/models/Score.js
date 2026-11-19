/** DB row → the JSON shape the frontend expects. */
export function scoreToApi(r) {
  return {
    _id: r.id,
    schoolId: r.school_id,
    studentId: r.student_id,
    classId: r.class_id,
    subjectId: r.subject_id,
    academicYear: r.academic_year,
    term: r.term,
    classScore: r.class_score,
    examScore: r.exam_score,
    updatedAt: r.updated_at,
  }
}

/** Old name of subjectTotal (shared/grading.js), which also takes the school's class-score weight. */
export { subjectTotal as weightedTotal } from '../../../../shared/grading.js'
