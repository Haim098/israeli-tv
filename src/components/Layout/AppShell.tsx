import type { ReactNode } from 'react'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-neutral-950">
      {children}
    </div>
  )
}
