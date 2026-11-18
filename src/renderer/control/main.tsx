import { createRoot } from 'react-dom/client'
import '../stage/fonts'
import './fonts'
import '../styles/layers.css'
import '../styles/base.css'
import { App } from './App'
import { bootstrap } from './lib/store'

void bootstrap()
createRoot(document.getElementById('root')!).render(<App />)
