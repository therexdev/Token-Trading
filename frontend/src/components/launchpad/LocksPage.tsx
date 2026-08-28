import { useEffect, useState } from "react";
import { useStore } from "../../store/useStore";
import {
  fetchLaunches,
  launchpadEnabled,
  claimLocked,
  claimLiquidity,
  STATUS_COMPLETED,
  LIQ_PENDING,
  LIQ_PROVIDED,
  LIQ_RECLAIMED,
  type LaunchInfo,
} from "../../lib/launchpad";
import { shortAddress } from "../../lib/format";
import {
  TokenLogo,
  useNow,
  countdown,
  fmtKoin,
  fmtToken,
  tokenSymbol,
  launchHash,
} from "./shared";

const REFRESH_MS = 20000;

function fmtDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

interface LockRow {
  launch: LaunchInfo;
  kind: "tokens" | "lp";
  amountText: string;
  unlockTime: number;
  claimed: boolean;
  claimable: boolean;
  statusText: string;
}

function buildRows(launches: LaunchInfo[], now: number): LockRow[] {
  const rows: LockRow[] = [];
  for (const launch of launches) {
    const symbol = tokenSymbol(launch);
    // creator token lock (only meaningful once the sale succeeded)
    if (
      launch.locked > 0n &&
      (launch.status === 1 || launch.status === STATUS_COMPLETED)
    ) {
      const due = now >= launch.unlockTime;
      rows.push({
        launch,
        kind: "tokens",
        amountText: `${fmtToken(launch, launch.locked)} ${symbol}`,
        unlockTime: launch.unlockTime,
        claimed: launch.lockedClaimed,
        claimable: due && !launch.lockedClaimed && launch.status === STATUS_COMPLETED,
        statusText: launch.lockedClaimed
          ? "delivered to creator ✓"
          : due
            ? "unlocked — claimable"
            : `unlocks in ${countdown(launch.unlockTime, now)}`,
      });
    }
    // LP lock
    if (launch.liquidityBps > 0 && launch.liquidityState !== 0) {
      if (launch.liquidityState === LIQ_PROVIDED) {
        const due = now >= launch.lpUnlockTime;
        rows.push({
          launch,
          kind: "lp",
          amountText: `${launch.lpAmount.toString()} LP (${fmtKoin(launch.liquidityKoin)} KOIN + ${fmtToken(launch, launch.liquidityTokens)} ${symbol})`,
          unlockTime: launch.lpUnlockTime,
          claimed: launch.lpClaimed,
          claimable: due && !launch.lpClaimed,
          statusText: launch.lpClaimed
            ? "delivered to creator ✓"
            : due
              ? "unlocked — claimable"
              : `unlocks in ${countdown(launch.lpUnlockTime, now)}`,
        });
      } else if (launch.liquidityState === LIQ_PENDING && (launch.status === 1 || launch.status === STATUS_COMPLETED)) {
        rows.push({
          launch,
          kind: "lp",
          amountText: `${fmtKoin(launch.liquidityKoin)} KOIN + ${fmtToken(launch, launch.liquidityTokens)} ${symbol}`,
          unlockTime: launch.lpUnlockTime,
          claimed: false,
          claimable: false,
          statusText: "listing on KoinDX…",
        });
      } else if (launch.liquidityState === LIQ_RECLAIMED) {
        rows.push({
          launch,
          kind: "lp",
          amountText: `${fmtToken(launch, launch.liquidityTokens)} ${symbol}`,
          unlockTime: 0,
          claimed: true,
          claimable: false,
          statusText: "listing failed — returned to creator",
        });
      }
    }
  }
  // soonest unlock first, settled rows last
  rows.sort((a, b) => {
    if (a.claimed !== b.claimed) return a.claimed ? 1 : -1;
    return (a.unlockTime || 0) - (b.unlockTime || 0);
  });
  return rows;
}

export function LocksPage() {
  const now = useNow();
  const account = useStore((state) => state.account);
  const pushToast = useStore((state) => state.pushToast);
  const dismissToast = useStore((state) => state.dismissToast);
  const guardCanSign = useStore((state) => state.guardCanSign);
  const signingToastTitle = useStore((state) => state.signingToastTitle);

  const [launches, setLaunches] = useState<LaunchInfo[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchLaunches()
        .then((list) => {
          if (alive) setLaunches(list);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const claim = async (row: LockRow) => {
    if (!account) {
      window.dispatchEvent(new Event("tk-open-connect"));
      return;
    }
    if (!guardCanSign()) return;
    const key = `${row.launch.id}-${row.kind}`;
    setBusyKey(key);
    const signToast = pushToast({ kind: "pending", title: signingToastTitle() });
    try {
      const handle =
        row.kind === "tokens"
          ? await claimLocked(account, row.launch.id)
          : await claimLiquidity(account, row.launch.id);
      dismissToast(signToast);
      const mining = pushToast({
        kind: "pending",
        title: "Claiming…",
        txId: handle.id,
      });
      await handle.wait();
      dismissToast(mining);
      pushToast({
        kind: "success",
        title: "Unlocked 🎉",
        detail: "Delivered to the launch creator's wallet.",
        txId: handle.id,
      });
      setLaunches(null);
      void fetchLaunches().then(setLaunches).catch(() => {});
    } catch (error: any) {
      dismissToast(signToast);
      pushToast({
        kind: "error",
        title: "Claim failed",
        detail: error?.message || String(error),
      });
    } finally {
      setBusyKey(null);
    }
  };

  if (!launchpadEnabled()) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-lg border border-ink-600 bg-ink-850 p-6 text-center text-sm text-ink-300">
          The launchpad is not configured yet.
        </div>
      </div>
    );
  }

  const rows = launches ? buildRows(launches, now) : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="text-lg font-bold text-white">Locks</h1>
        <p className="mb-5 text-xs text-ink-400">
          Every creator token lock and KoinDX liquidity lock from the
          launchpad, on-chain and visible to everyone. Unlocked amounts are
          delivered automatically — the claim button just hurries it up (it
          always pays the launch creator, whoever presses it).
        </p>

        {rows === null && (
          <div className="py-16 text-center text-sm text-ink-400">
            <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent align-middle" />
            loading locks…
          </div>
        )}
        {rows !== null && rows.length === 0 && (
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-10 text-center text-xs text-ink-400">
            No locks yet — they appear when launches with a creator lock or a
            KoinDX listing settle.
          </div>
        )}

        <div className="space-y-3">
          {(rows || []).map((row) => {
            const symbol = tokenSymbol(row.launch);
            const key = `${row.launch.id}-${row.kind}`;
            return (
              <div
                key={key}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-700 bg-ink-900 p-4"
              >
                <TokenLogo address={row.launch.token} symbol={symbol} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={launchHash(row.launch.id)}
                      className="truncate text-sm font-bold text-white hover:text-accent"
                    >
                      {row.launch.tokenMeta?.name || symbol}
                    </a>
                    <span className="rounded border border-ink-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-300">
                      {row.kind === "tokens" ? "token lock" : "liquidity"}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-300">
                    {row.amountText}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-500">
                    {row.unlockTime > 0 && !row.claimed
                      ? `unlocks ${fmtDate(row.unlockTime)} · `
                      : ""}
                    creator {shortAddress(row.launch.creator)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs ${row.claimed ? "text-ink-400" : row.claimable ? "text-up" : "text-ink-300"}`}
                  >
                    {row.statusText}
                  </span>
                  {row.claimable && (
                    <button
                      onClick={() => void claim(row)}
                      disabled={busyKey === key}
                      className="rounded-md bg-up px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
                    >
                      {busyKey === key ? "Claiming…" : "Claim"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
