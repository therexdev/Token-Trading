import { useEffect, useState } from "react";
import type { LaunchInfo, LaunchPhase } from "../../lib/launchpad";
import { MODE_FIXED, launchPhase, tokenLogoUrl } from "../../lib/launchpad";
import { formatUnits, formatScaled } from "../../lib/format";

/**
 * A token's logo (stored on usekoinos), falling back to a symbol monogram.
 * The 302 endpoint 404s when no logo exists - onError flips to the fallback.
 */
export function TokenLogo({
  address,
  symbol,
  size = 40,
}: {
  address: string;
  symbol: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const url = tokenLogoUrl(address);
  const dim = { width: size, height: size };
  if (!url || failed) {
    return (
      <div
        style={dim}
        className="flex shrink-0 items-center justify-center rounded-full bg-ink-700 font-bold text-ink-200"
      >
        <span style={{ fontSize: Math.max(10, size * 0.3) }}>
          {(symbol || "?").slice(0, 3)}
        </span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`${symbol} logo`}
      style={dim}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full border border-ink-700 bg-ink-950 object-cover"
    />
  );
}

export const PHASE_LABEL: Record<LaunchPhase, string> = {
  upcoming: "Upcoming",
  live: "Live",
  ended: "Settling…",
  distributing: "Distributing…",
  completed: "Completed",
  refunding: "Refunding…",
  canceled: "Canceled",
};

export const PHASE_CLASS: Record<LaunchPhase, string> = {
  upcoming: "bg-ink-700 text-ink-200",
  live: "bg-up/20 text-up",
  ended: "bg-accent/20 text-accent",
  distributing: "bg-accent/20 text-accent",
  completed: "bg-up/20 text-up",
  refunding: "bg-down/20 text-down",
  canceled: "bg-down/20 text-down",
};

export function PhaseChip({ launch, now }: { launch: LaunchInfo; now: number }) {
  const phase = launchPhase(launch, now);
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PHASE_CLASS[phase]}`}
    >
      {PHASE_LABEL[phase]}
    </span>
  );
}

export function ModeChip({ mode }: { mode: number }) {
  return (
    <span className="rounded border border-ink-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-300">
      {mode === MODE_FIXED ? "Fixed price" : "Pro-rata pool"}
    </span>
  );
}

/** re-render every second - countdowns and phase flips stay honest */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function countdown(target: number, now: number): string {
  let ms = target - now;
  if (ms <= 0) return "now";
  const d = Math.floor(ms / 86400000);
  ms -= d * 86400000;
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms - m * 60000) / 1000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export function fmtKoin(units: bigint, maxFraction = 2): string {
  return formatScaled(units, 8, maxFraction);
}

export function fmtToken(launch: LaunchInfo, units: bigint): string {
  const decimals = launch.tokenMeta?.decimals ?? 8;
  return formatUnits(units, decimals, Math.min(decimals, 4));
}

export function tokenSymbol(launch: LaunchInfo): string {
  return launch.tokenMeta?.symbol || "tokens";
}

/** sale progress in [0,1]: tokens sold (FIXED) or KOIN raised vs cap (POOL) */
export function progressOf(launch: LaunchInfo): number | null {
  if (launch.mode === MODE_FIXED) {
    if (launch.forSale === 0n) return null;
    return Number((launch.sold * 10000n) / launch.forSale) / 10000;
  }
  if (launch.hardCap > 0n) {
    return Number((launch.raised * 10000n) / launch.hardCap) / 10000;
  }
  return null; // uncapped pool: no meaningful percentage
}

export function ProgressBar({ launch }: { launch: LaunchInfo }) {
  const progress = progressOf(launch);
  const softMark =
    launch.softCap > 0n && launch.hardCap > 0n
      ? Math.min(1, Number((launch.softCap * 10000n) / launch.hardCap) / 10000)
      : null;
  if (progress === null) return null;
  const clamped = Math.min(1, progress);
  const reachedSoft = launch.softCap === 0n || launch.raised >= launch.softCap;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-ink-700">
      <div
        className={`h-full rounded-full transition-all ${reachedSoft ? "bg-up" : "bg-accent"}`}
        style={{ width: `${clamped * 100}%` }}
      />
      {softMark !== null && softMark > 0 && softMark < 1 && (
        <div
          className="absolute top-0 h-full w-px bg-white/60"
          style={{ left: `${softMark * 100}%` }}
          title="soft cap"
        />
      )}
    </div>
  );
}

export function launchHash(id: number): string {
  return `#/launchpad/${id}`;
}
