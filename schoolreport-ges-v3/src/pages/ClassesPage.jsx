import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSchoolStore } from '@/store/schoolStore'
import { Card, Spinner, EmptyState, Badge, PageHeader } from '@/components/ui'
import { GraduationCap, Users, ChevronRight } from 'lucide-react'

export default function ClassesPage() {
  const { classes, fetchClasses, loading } = useSchoolStore()
  const navigate = useNavigate()
  useEffect(() => { fetchClasses() }, [])

  if (loading) return <Spinner />

  return (
    <div>
      <PageHeader title="Classes" subtitle="Select a class to manage students and scores" />

      {classes.length === 0 ? (
        <Card>
          <EmptyState icon={GraduationCap} title="No classes found" description="Ask your admin to configure classes in Settings." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {classes.map(cls => (
            <button
              key={cls._id}
              onClick={() => navigate(`/students?classId=${cls._id}`)}
              className="border border-border rounded-xl p-4 sm:p-5 cursor-pointer bg-white text-left
                         hover:border-blue hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]
                         transition-all duration-150 group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-blue-light rounded-xl flex items-center justify-center">
                  <GraduationCap className="w-5 h-5 text-blue" />
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue transition-colors mt-1" />
              </div>
              <div className="font-bold text-gray-900 text-sm">{cls.name}</div>
              <div className="text-xs text-gray-400 mt-0.5">{cls.level || 'Primary Level'}</div>
              <div className="flex items-center gap-2 mt-3">
                <Users className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs text-gray-500">{cls.studentCount ?? 0} students</span>
                {cls.teacherName && (
                  <Badge variant="amber">{cls.teacherName}</Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
