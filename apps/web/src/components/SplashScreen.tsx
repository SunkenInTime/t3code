import { SahurMark } from "./SahurMark";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex flex-col items-center justify-center gap-4"
        aria-label="Tung Tung Tung Sahur Code splash screen"
      >
        <SahurMark className="animate-tung-thump h-20 w-auto" />
        <span className="animate-pulse text-xs font-semibold tracking-[0.14em] uppercase text-muted-foreground">
          tung tung tung sahur 🥁
        </span>
      </div>
    </div>
  );
}
