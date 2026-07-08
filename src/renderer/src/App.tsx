import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { useStore } from './store'
import { Nav } from './components/Nav'
import { TimerBanner } from './components/TimerBanner'
import { Dashboard } from './pages/Dashboard'
import { Sessions } from './pages/Sessions'
import { SessionDetail } from './pages/SessionDetail'
import { Clients } from './pages/Clients'
import { Settings } from './pages/Settings'

function App(): React.JSX.Element {
  const init = useStore((s) => s.init)

  useEffect(() => {
    init()
  }, [init])

  return (
    <HashRouter>
      <div className="flex h-screen flex-col">
        <Nav />
        <div className="border-b border-slate-200 bg-white px-6 py-3">
          <TimerBanner />
        </div>
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}

export default App
