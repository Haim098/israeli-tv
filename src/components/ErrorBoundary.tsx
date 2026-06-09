import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Catches render-time crashes so a backgrounded/throttled PWA that resumes in a
 * bad state shows a recoverable "reload" screen instead of a blank white page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-neutral-950 p-6 text-center text-white">
          <p className="text-base text-white/80">משהו השתבש</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-white/10 px-5 py-2.5 text-sm text-white transition hover:bg-white/20"
          >
            טען מחדש
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
