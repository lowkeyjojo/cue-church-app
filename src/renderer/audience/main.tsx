import { createRoot } from 'react-dom/client'
import '../stage/fonts'
import '../styles/tokens.css'
import { Output } from './Output'

createRoot(document.getElementById('root')!).render(<Output />)
