import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useTvStore } from './stores/tvStore'
import { warmChannel } from './lib/warmup'

// Start resolving the last-watched channel while React boots, instead of
// waiting for the player's mount effect. The player then picks up the
// resolver's in-flight request.
warmChannel(useTvStore.getState().currentChannel)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
