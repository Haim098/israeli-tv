import { AppShell } from './components/Layout/AppShell'
import { Header } from './components/Layout/Header'
import { PlayerContainer } from './components/Player/PlayerContainer'
import { ChannelGrid } from './components/Channels/ChannelGrid'
import { useOrientationLock } from './hooks/useOrientationLock'
import { useOnlineStatus } from './hooks/useOnlineStatus'

export default function App() {
  useOrientationLock()
  const online = useOnlineStatus()

  return (
    <AppShell>
      <Header />
      {!online && (
        <div className="bg-red-600/90 px-4 py-2 text-center text-sm font-semibold text-white">
          אין חיבור לאינטרנט — השידור יתחדש כשהחיבור יחזור
        </div>
      )}
      <main className="flex flex-1 flex-col gap-6 px-4 pb-8 lg:flex-row lg:items-center lg:gap-8">
        <div className="lg:flex-1 lg:min-w-0">
          <PlayerContainer />
        </div>
        <section className="lg:w-80 lg:shrink-0">
          <h2 className="mb-3 text-base font-semibold text-white/70">ערוצים</h2>
          <ChannelGrid />
        </section>
      </main>
      <footer className="py-4 text-center text-xs text-white/30">
        Developed by Haim Raich
      </footer>
    </AppShell>
  )
}
