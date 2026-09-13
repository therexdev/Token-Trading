import { useEffect, useMemo, useState } from "react";
import {
  fetchLaunches,
  launchpadEnabled,
  launchPhase,
  MODE_FIXED,
  type LaunchInfo,
} from "../../lib/launchpad";
import { priceToHuman } from "../../lib/format";
import {
  PhaseChip,
  ModeChip,
  ProgressBar,
  TokenLogo,
  useNow,
  countdown,
  fmtKoin,
  fmtToken,
  tokenSymbol,
  launchHash,
} from "./shared";

const REFRESH_MS = 15000;

function LaunchCard({ launch, now }: { launch: LaunchInfo; now: number }) {
  const phase = launchPhase(launch, now);
  const symbol = tokenSymbol(launch);
  return (
    <a
      href={launchHash(launch.id)}
      className="block rounded-lg border border-ink-700 bg-ink-900 p-4 transition hover:border-accent"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <TokenLogo address={launch.token} symbol={symbol} size={34} />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-white">
              {launch.tokenMeta?.name || symbol}
              <span className="ml-1.5 text-ink-400">{symbol}</span>
            </div>
          </div>
        </div>
        <PhaseChip launch={launch} now={now} />
      </div>

      <div className="mb-3 flex items-center gap-1.5">
        <ModeChip mode={launch.mode} />
        {launch.softCap > 0n && (
          <span className="rounded border border-ink-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-300">
            soft cap {fmtKoin(launch.softCap)} KOIN
          </span>
        )}
        {launch.locked > 0n && (
          <span className="rounded border border-ink-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-300">
            🔒 lock
          </span>
        )}
      </div>

      <div className="mb-1.5">
        <ProgressBar launch={launch} />
      </div>
      <div className="mb-3 flex justify-between text-xs text-ink-300">
        <span>
          {launch.mode === MODE_FIXED ? (
            <>
              {fmtToken(launch, launch.sold)} / {fmtToken(launch, launch.forSale)}{" "}
              {symbol} sold
            </>
          ) : (
            <>
              {fmtKoin(launch.raised)}
              {launch.hardCap > 0n ? ` / ${fmtKoin(launch.hardCap)}` : ""} KOIN
              raised
            </>
          )}
        </span>
        <span className="text-ink-400">{launch.buyerCount} buyer{launch.buyerCount === 1 ? "" : "s"}</span>
      </div>

      <div className="flex items-center justify-between text-xs">
        {launch.mode === MODE_FIXED ? (
          <span className="text-ink-300">
            <span className="font-mono text-white">
              {priceToHuman(launch.price, launch.tokenMeta?.decimals ?? 8, 8)}
            </span>{" "}
            KOIN / {symbol}
          </span>
        ) : (
          <span className="text-ink-300">price set by the pool</span>
        )}
        <span className="font-mono text-ink-300">
          {phase === "upcoming" && <>starts in {countdown(launch.startTime, now)}</>}
          {phase === "live" && <>ends in {countdown(launch.endTime, now)}</>}
        </span>
      </div>
    </a>
  );
}

export function LaunchpadListPage() {
  const now = useNow();
  const [launches, setLaunches] = useState<LaunchInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchLaunches()
        .then((list) => {
          if (!alive) return;
          setLaunches(list);
          setError(null);
        })
        .catch((err) => {
          if (!alive) return;
          if (launches === null) setError(err?.message || "Could not load launches");
        });
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const list = launches || [];
    const live = list.filter((l) => ["live", "ended"].includes(launchPhase(l, now)));
    const upcoming = list.filter((l) => launchPhase(l, now) === "upcoming");
    const past = list.filter((l) =>
      ["distributing", "completed", "refunding", "canceled"].includes(
        launchPhase(l, now)
      )
    );
    return { live, upcoming, past };
  }, [launches, now]);

  if (!launchpadEnabled()) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-ink-600 bg-ink-850 p-6 text-center text-sm text-ink-300">
          The launchpad is not configured yet.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Launchpad</h1>
            <p className="text-xs text-ink-400">
              New Koinos tokens raising in KOIN — settlement runs automatically
              when a sale ends.
            </p>
          </div>
          <a
            href="#/launchpad/create"
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
          >
            Create launch
          </a>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-down/40 bg-ink-850 p-4 text-xs text-ink-300">
            Could not load launches: {error}
          </div>
        )}
        {launches === null && !error && (
          <div className="py-16 text-center text-sm text-ink-400">
            <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent align-middle" />
            loading launches…
          </div>
        )}

        {launches !== null && launches.length === 0 && (
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-10 text-center">
            <div className="mb-1 text-sm font-semibold text-white">
              No launches yet
            </div>
            <div className="text-xs text-ink-400">
              Be the first — mint a token and open its sale in a couple of
              minutes.
            </div>
          </div>
        )}

        {groups.live.length > 0 && (
          <>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">
              Live now
            </h2>
            <div className="mb-6 grid gap-3 sm:grid-cols-2">
              {groups.live.map((launch) => (
                <LaunchCard key={launch.id} launch={launch} now={now} />
              ))}
            </div>
          </>
        )}
        {groups.upcoming.length > 0 && (
          <>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">
              Upcoming
            </h2>
            <div className="mb-6 grid gap-3 sm:grid-cols-2">
              {groups.upcoming.map((launch) => (
                <LaunchCard key={launch.id} launch={launch} now={now} />
              ))}
            </div>
          </>
        )}
        {groups.past.length > 0 && (
          <>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">
              Finished
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {groups.past.map((launch) => (
                <LaunchCard key={launch.id} launch={launch} now={now} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
