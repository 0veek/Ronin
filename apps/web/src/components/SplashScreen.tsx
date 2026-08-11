/**
 * Mirrors the pre-React boot shell in index.html so the handover from static
 * markup to the mounted app is invisible. Keep the mark geometry, the 64px box,
 * and the crimson blade in step with that copy.
 */
export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex size-24 items-center justify-center" aria-label="Ronin splash screen">
        <svg
          aria-label="Ronin"
          className="size-16 text-foreground"
          role="img"
          viewBox="6 6 116 116"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M120 10C94 54 59 90 16 118C46 78 81 42 120 10Z" fill="#c6303a" />
          <path
            d="M64 22C84 40 102 60 118 82C98 101 30 101 10 82C26 60 44 40 64 22Z"
            fill="currentColor"
          />
        </svg>
      </div>
    </div>
  );
}
