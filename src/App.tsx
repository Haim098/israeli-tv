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
      <main className="flex flex-1 flex-col gap-6 px-4 pb-8 wide:flex-row wide:items-center wide:justify-center wide:gap-6 wide:pb-4">
        {/* Side by side, the player is as wide as the screen height allows,
            so the whole picture fits without scrolling. */}
        <div className="wide:min-w-0 wide:flex-1 wide:max-w-[calc((100dvh-6rem)*16/9)]">
          <PlayerContainer />
        </div>
        <section className="wide:flex wide:max-h-[calc(100dvh-5rem)] wide:w-72 wide:shrink-0 wide:flex-col">
          <h2 className="mb-3 text-base font-semibold text-white/70 short:mb-2">ערוצים</h2>
          <div className="wide:min-h-0 wide:overflow-y-auto wide:p-1">
            <ChannelGrid />
          </div>
        </section>
      </main>
      <footer className="py-4 text-center text-xs text-white/30">
        Developed by Haim Raich
        <span className="mx-1.5 text-white/15">·</span>
        <span dir="ltr" className="text-[10px] text-white/15">{__BUILD_ID__}</span>
      </footer>
    </AppShell>
  )
}
