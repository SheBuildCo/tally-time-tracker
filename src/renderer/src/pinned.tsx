import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PinnedTimer } from './components/PinnedTimer'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PinnedTimer />
  </StrictMode>
)
