import { useMemo } from "react";

import { SahurMark } from "../SahurMark";

interface Marcher {
  readonly key: number;
  readonly size: number;
  readonly durationS: number;
  readonly delayS: number;
  readonly bobDurationS: number;
  readonly chant: string | null;
  readonly chantDelayS: number;
}

const CHANTS = ["tung", "tung tung", "TUNG TUNG TUNG", "sahur", "SAHURRR"];

function buildMarchers(count: number): ReadonlyArray<Marcher> {
  return Array.from({ length: count }, (_, index) => {
    const durationS = 9 + Math.random() * 10;
    return {
      key: index,
      size: 26 + Math.round(Math.random() * 42),
      durationS,
      // Negative delays pre-spread the parade across the viewport so it is
      // already mid-march the moment the agent starts working.
      delayS: -Math.random() * durationS,
      bobDurationS: 0.38 + Math.random() * 0.22,
      chant: Math.random() < 0.6 ? CHANTS[index % CHANTS.length]! : null,
      chantDelayS: Math.random() * 2.8,
    };
  });
}

/**
 * Full-app haunting while the Tung Tung Tung Sahur pet is active: a giant
 * spectral anomaly watching over the workspace, and — whenever the agent is
 * working — a parade of smaller anomalies marching across the bottom of the
 * window, chanting.
 */
export function SahurTakeover(props: { readonly marching: boolean }) {
  const marchers = useMemo(() => buildMarchers(9), []);

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-30 grid place-items-center"
      >
        <SahurMark className="t3-sahur-watermark h-[72vh] w-auto opacity-[0.045] dark:opacity-[0.07]" />
      </div>
      {props.marching ? (
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
          {marchers.map((marcher) => (
            <div
              key={marcher.key}
              className="t3-sahur-marcher"
              style={{
                animationDuration: `${marcher.durationS}s`,
                animationDelay: `${marcher.delayS}s`,
              }}
            >
              <div
                className="t3-sahur-march-bob relative"
                style={{ animationDuration: `${marcher.bobDurationS}s` }}
              >
                {marcher.chant ? (
                  <span
                    className="t3-sahur-chant absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded-full border border-border/60 bg-popover/90 px-2 py-0.5 text-[10px] font-bold text-popover-foreground shadow-sm"
                    style={{ animationDelay: `${marcher.chantDelayS}s` }}
                  >
                    {marcher.chant}
                  </span>
                ) : null}
                <div style={{ height: marcher.size }}>
                  <SahurMark className="h-full w-auto" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
