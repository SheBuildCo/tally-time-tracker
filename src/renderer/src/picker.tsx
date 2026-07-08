import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClientPicker } from './components/ClientPicker'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientPicker />
  </StrictMode>
)
