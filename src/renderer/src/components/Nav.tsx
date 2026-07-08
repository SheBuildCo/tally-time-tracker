import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/sessions', label: 'Sessions' },
  { to: '/clients', label: 'Clients' },
  { to: '/settings', label: 'Settings' }
]

export function Nav(): React.JSX.Element {
  return (
    <nav className="flex items-center gap-1 border-b border-slate-200 bg-white px-4">
      <span className="mr-4 py-3 text-lg font-semibold tracking-tight">Tally</span>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) =>
            `border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
              isActive
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}
