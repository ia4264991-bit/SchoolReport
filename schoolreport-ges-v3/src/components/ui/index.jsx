import clsx from 'clsx'

/* ─── Card ─── */
export function Card({ children, className = '' }) {
  return (
    <div className={clsx('bg-white border border-border rounded-xl2 p-4 sm:p-5 mb-4 shadow-sm', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children }) {
  return <div className="font-bold text-sm text-gray-900 mb-3">{children}</div>
}

export function SectionHeader({ title, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 className="font-bold text-sm text-gray-900">{title}</h2>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

/* ─── Button ─── */
export function Button({ children, variant = 'default', size = 'md', className = '', ...props }) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-semibold rounded-lg border cursor-pointer transition-all whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed active:scale-[0.97]'
  const sizes = {
    sm: 'px-3 py-2 text-xs min-h-[32px]',
    md: 'px-4 py-2.5 text-[13px] min-h-[38px]',
    lg: 'px-5 py-3 text-sm min-h-[44px]',
  }
  const variants = {
    default: 'border-[#d0d7e8] bg-white text-gray-700 hover:bg-[#f0f5ff] hover:border-blue hover:text-blue',
    primary: 'border-blue bg-blue text-white hover:bg-blue-dark',
    success: 'border-green bg-green text-white hover:bg-[#27500A]',
    danger:  'border-red-300 bg-white text-red hover:bg-red-light',
    warn:    'border-[#FAC775] bg-amber-light text-amber hover:bg-amber hover:text-white',
  }
  return (
    <button className={clsx(base, sizes[size], variants[variant], className)} {...props}>
      {children}
    </button>
  )
}

/* ─── Badge ─── */
export function Badge({ children, variant = 'blue', className = '' }) {
  const variants = {
    blue:  'bg-blue-light text-blue',
    green: 'bg-green-light text-green',
    amber: 'bg-amber-light text-amber',
    red:   'bg-red-light text-red',
    gray:  'bg-gray-100 text-gray-600',
  }
  return (
    <span className={clsx('inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-bold', variants[variant], className)}>
      {children}
    </span>
  )
}

/* ─── Alert ─── */
export function Alert({ children, variant = 'info' }) {
  const variants = {
    info: 'bg-blue-light text-blue border-[#b5d4f4]',
    warn: 'bg-amber-light text-amber border-[#FAC775]',
    ok:   'bg-green-light text-green border-[#C0DD97]',
    err:  'bg-red-light text-[#A32D2D] border-[#F09595]',
  }
  return (
    <div className={clsx('px-4 py-3 rounded-[9px] text-[13px] mb-3 border leading-relaxed', variants[variant])}>
      {children}
    </div>
  )
}

/* ─── Metric ─── */
export function Metric({ value, label, icon: Icon, color = 'blue' }) {
  const colors = {
    blue:  { bg: 'bg-blue-light', text: 'text-blue', icon: 'text-blue' },
    green: { bg: 'bg-green-light', text: 'text-green', icon: 'text-green' },
    amber: { bg: 'bg-amber-light', text: 'text-amber', icon: 'text-amber' },
    red:   { bg: 'bg-red-light', text: 'text-red', icon: 'text-red' },
  }
  const c = colors[color] || colors.blue
  return (
    <div className="bg-white border border-border rounded-xl2 p-4 shadow-sm flex items-center gap-3">
      {Icon && (
        <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', c.bg)}>
          <Icon className={clsx('w-5 h-5', c.icon)} />
        </div>
      )}
      <div className="min-w-0">
        <div className={clsx('text-xl sm:text-2xl font-bold leading-tight', c.text)}>{value}</div>
        <div className="text-[11px] text-gray-400 mt-0.5 truncate">{label}</div>
      </div>
    </div>
  )
}

/* ─── Table ─── */
export function Table({ headers = [], children }) {
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg">
      <table className="w-full border-collapse text-[13px] min-w-[500px]">
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} className="text-left px-3 py-2.5 bg-[#f0f4fb] border-b border-border font-bold text-[11px] text-gray-500 uppercase tracking-wide first:pl-4 last:pr-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Tr({ children, onClick }) {
  return (
    <tr onClick={onClick} className={clsx(
      'border-b border-[#f0f4fb] last:border-none transition-colors',
      onClick ? 'cursor-pointer hover:bg-[#f8faff] active:bg-blue-light/30' : 'hover:bg-[#f8faff]'
    )}>
      {children}
    </tr>
  )
}

export function Td({ children, className = '' }) {
  return (
    <td className={clsx('px-3 py-2.5 align-middle first:pl-4 last:pr-4', className)}>
      {children}
    </td>
  )
}

/* ─── Modal ─── */
export function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="bg-white w-full sm:rounded-xl3 sm:max-w-lg shadow-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto
                      rounded-t-2xl animate-slide-up">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 sm:px-6 pt-5 pb-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="text-[16px] font-bold text-blue">{title}</h2>
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-all -mr-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="px-5 sm:px-6 py-4">
          {children}
        </div>

        {footer && (
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-2.5 sm:justify-end px-5 sm:px-6 pb-5 pt-3 border-t border-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Form Field ─── */
export function Field({ label, children, className = '' }) {
  return (
    <div className={clsx('mb-3', className)}>
      <label className="block text-xs font-semibold text-gray-500 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

export function Input({ className = '', ...props }) {
  return (
    <input
      className={clsx(
        'w-full px-3 py-2.5 border border-[#d0d7e8] rounded-lg text-[13px]',
        'focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-light transition-colors',
        'placeholder:text-gray-300',
        className
      )}
      {...props}
    />
  )
}

export function Select({ className = '', children, ...props }) {
  return (
    <select
      className={clsx(
        'w-full px-3 py-2.5 border border-[#d0d7e8] rounded-lg text-[13px] bg-white',
        'focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-light transition-colors',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Textarea({ className = '', ...props }) {
  return (
    <textarea
      className={clsx(
        'w-full px-3 py-2.5 border border-[#d0d7e8] rounded-lg text-[13px] resize-y min-h-[70px]',
        'focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-light transition-colors',
        className
      )}
      {...props}
    />
  )
}

/* ─── Avatar ─── */
export function Avatar({ name = '', color = 'blue' }) {
  const initials = name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
  const colors = {
    blue:  'bg-blue-light text-blue',
    green: 'bg-green-light text-green',
    amber: 'bg-amber-light text-amber',
    gray:  'bg-gray-100 text-gray-500',
    red:   'bg-red-light text-red',
  }
  return (
    <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0', colors[color] || colors.blue)}>
      {initials}
    </div>
  )
}

/* ─── Loading ─── */
export function Spinner({ size = 'md' }) {
  const sizes = { sm: 'w-5 h-5', md: 'w-8 h-8', lg: 'w-12 h-12' }
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className={clsx('border-[3px] border-blue border-t-transparent rounded-full animate-spin', sizes[size])} />
      <span className="text-xs text-gray-400">Loading…</span>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="text-center py-12 sm:py-16 text-gray-400 px-4">
      {Icon && (
        <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Icon className="w-7 h-7 text-gray-300" />
        </div>
      )}
      <div className="font-semibold text-sm text-gray-600">{title}</div>
      {description && <div className="text-xs mt-1.5 max-w-xs mx-auto leading-relaxed">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ─── Page Header ─── */
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4 sm:mb-6">
      <div>
        <h1 className="text-lg sm:text-xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-xs sm:text-sm text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  )
}
