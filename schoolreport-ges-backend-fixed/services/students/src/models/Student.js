export const GENDERS = ['M', 'F']

/** DB row → the JSON shape the frontend expects. */
export function studentToApi(r) {
  return {
    _id: r.id,
    schoolId: r.school_id,
    classId: r.class_id,
    fullName: r.full_name,
    gender: r.gender,
    dateOfBirth: r.date_of_birth, // 'YYYY-MM-DD' or null
    guardianName: r.guardian_name ?? '',
    guardianPhone: r.guardian_phone ?? '',
    guardianPhone2: r.guardian_phone2 ?? '',
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
