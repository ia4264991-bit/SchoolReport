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

/**
 * GES weighting: class score is converted to 40%, exam score (out of 100) to 60%.
 * maxClassScore is the subject's raw maximum for the class score (100 when not set).
 */
export function weightedTotal(classScore, examScore, maxClassScore) {
  const max = maxClassScore > 0 ? maxClassScore : 100
  return (classScore / max) * 40 + (examScore / 100) * 60
}
