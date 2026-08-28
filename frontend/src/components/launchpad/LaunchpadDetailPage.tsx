import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import {
  fetchLaunch,
  fetchContribution,
  fetchBuyers,
  fetchLaunchLinks,
  saveLaunchLinks,
  fetchTokenSupply,
  contribute,
  cancelLaunch,
  koindxSwapUrl,
  tradeKoinosMarketHash,
  launchPhase,
  type BuyerEntry,
  type LaunchLinks,
  MODE_FIXED,
  UNSOLD_BURN,
  LIQ_PENDING,
  LIQ_PROVIDED,
  LIQ_RECLAIMED,
  LAUNCH_PRICE_SCALE,
  type LaunchInfo,
  type ContributionInfo,
} from "../../lib/launchpad";
import { parseDecimalScaled, priceToHuman, shortAddress, formatUnits } from "../../lib/format";
import { getSessionToken } from "../../lib/sessionKey";
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
} from "./shared";

const REFRESH_MS = 10000;

/** human listing price implied by a KOIN amount over a token amount */
function listPriceText(
  koinUnits: bigint,
  tokenUnits: bigint,
  launch: LaunchInfo
): string {
  if (tokenUnits <= 0n) return "—";
  const decimals = launch.tokenMeta?.decimals ?? 8;
  // KOIN(1e8) per whole token(10^decimals)
  const priceNumber =
    (Number(koinUnits) / 1e8) / (Number(tokenUnits) / 10 ** decimals);
  if (!Number.isFinite(priceNumber)) return "—";
  return priceNumber.toLocaleString("en-US", {
    maximumSignificantDigits: 4,
  });
}

/** " (−37% vs the launch price)" comparison suffix, FIXED launches only */
function launchPriceCompare(launch: LaunchInfo, raise: bigint): string {
  if (launch.mode !== MODE_FIXED || launch.price <= 0n) return "";
  const decimals = launch.tokenMeta?.decimals ?? 8;
  const liqKoin = (raise * BigInt(launch.liquidityBps)) / 10000n;
  if (launch.liquidityTokens <= 0n) return "";
  const listing =
    (Number(liqKoin) / 1e8) / (Number(launch.liquidityTokens) / 10 ** decimals);
  const launchPrice =
    (Number(launch.price) / 1e8) * (10 ** decimals / 1e8);
  if (!Number.isFinite(listing) || launchPrice <= 0) return "";
  const diff = ((listing - launchPrice) / launchPrice) * 100;
  const sign = diff >= 0 ? "+" : "";
  return ` (${sign}${diff.toFixed(0)}% vs the launch price)`;
}

const LINK_META: { key: keyof LaunchLinks; label: string; icon: string }[] = [
  { key: "website", label: "Website", icon: "M8 1a7 7 0 100 14A7 7 0 008 1zm5.3 6.3h-2.1a10 10 0 00-.8-3.6 5.6 5.6 0 012.9 3.6zM8 2.5c.7.9 1.3 2.3 1.5 4.1h-3C6.7 4.8 7.3 3.4 8 2.5zM5.6 3.7a10 10 0 00-.8 3.6H2.7a5.6 5.6 0 012.9-3.6zM2.7 8.7h2.1c.1 1.4.4 2.6.8 3.6a5.6 5.6 0 01-2.9-3.6zm3.9 0h3c-.2 1.8-.8 3.2-1.5 4.1-.7-.9-1.3-2.3-1.5-4.1zm4.5 3.6c.4-1 .7-2.2.8-3.6h2.1a5.6 5.6 0 01-2.9 3.6z" },
  { key: "x", label: "X", icon: "M9.5 6.9L14.7 1h-1.2L8.9 6.1 5.3 1H1.1l5.4 7.8L1.1 15h1.2l4.7-5.4 3.8 5.4h4.2L9.5 6.9zM7.7 8.9l-.6-.8-4.3-6.2h1.9l3.5 5 .5.8 4.6 6.5h-1.9L7.7 8.9z" },
  { key: "telegram", label: "Telegram", icon: "M14.7 2.1L1.6 7.2c-.9.4-.9.9-.2 1.1l3.4 1.1 1.3 3.9c.2.4.1.6.5.6.3 0 .5-.1.7-.3l1.7-1.6 3.4 2.5c.6.3 1.1.2 1.2-.6l2.2-10.5c.2-1-.4-1.5-1.1-1.3zM5.3 9l7.2-4.5c.4-.2.7-.1.4.2L6.8 10l-.2 2.5L5.3 9z" },
  { key: "discord", label: "Discord", icon: "M13.5 3.2A13 13 0 0010.3 2l-.2.4a12 12 0 00-4.2 0L5.7 2a13 13 0 00-3.2 1.2A13.4 13.4 0 00.3 12.2a13 13 0 004 2l.8-1.3a8 8 0 01-1.3-.6l.3-.2a9.3 9.3 0 007.8 0l.3.2-1.3.6.8 1.3a13 13 0 004-2 13.4 13.4 0 00-2.2-9zM5.7 10.4c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6 1.4.7 1.4 1.6-.6 1.6-1.4 1.6zm4.6 0c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6 1.4.7 1.4 1.6-.6 1.6-1.4 1.6z" },
  { key: "github", label: "GitHub", icon: "M8 1a7 7 0 00-2.2 13.6c.4.1.5-.2.5-.3v-1.2c-2 .4-2.4-.9-2.4-.9-.3-.8-.8-1-.8-1-.6-.5 0-.5 0-.5.7 0 1.1.8 1.1.8.6 1.1 1.7.8 2.1.6 0-.5.2-.8.4-1-1.5-.2-3.2-.8-3.2-3.5 0-.8.3-1.4.8-1.9-.1-.2-.4-1 0-2 0 0 .6-.2 2 .7a6.7 6.7 0 013.6 0c1.4-.9 2-.7 2-.7.4 1 .1 1.8 0 2 .5.5.8 1.1.8 1.9 0 2.7-1.7 3.3-3.2 3.5.2.2.5.6.5 1.2v1.8c0 .1.1.4.5.3A7 7 0 008 1z" },
  { key: "facebook", label: "Facebook", icon: "M15 8a7 7 0 10-8.1 6.9v-4.9H5.1V8h1.8V6.5c0-1.8 1-2.7 2.6-2.7l1.6.1v1.7h-.9c-.9 0-1.1.4-1.1 1V8h1.9l-.3 2h-1.6v4.9A7 7 0 0015 8z" },
  { key: "youtube", label: "YouTube", icon: "M14.7 4.6a1.8 1.8 0 00-1.2-1.3C12.4 3 8 3 8 3s-4.4 0-5.5.3a1.8 1.8 0 00-1.2 1.3A19 19 0 001 8c0 1.1.1 2.3.3 3.4.2.6.6 1.1 1.2 1.3C3.6 13 8 13 8 13s4.4 0 5.5-.3a1.8 1.8 0 001.2-1.3c.2-1.1.3-2.3.3-3.4 0-1.1-.1-2.3-.3-3.4zM6.6 10.2V5.8L10.4 8l-3.8 2.2z" },
];

function LinkIcons({ links }: { links: LaunchLinks }) {
  const present = LINK_META.filter((meta) => links[meta.key]);
  if (!present.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {present.map((meta) => (
        <a
          key={meta.key}
          href={links[meta.key]}
          target="_blank"
          rel="noopener nofollow"
          title={meta.label}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-ink-600 bg-ink-850 text-ink-300 transition hover:border-accent hover:text-white"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current">
            <path d={meta.icon} />
          </svg>
        </a>
      ))}
    </div>
  );
}

/** minimal SVG donut for the tokenomics split */
function Donut({
  slices,
  size = 120,
}: {
  slices: { value: number; color: string }[];
  size?: number;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  const r = 44;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg
      viewBox="0 0 100 100"
      style={{ width: size, height: size }}
      className="shrink-0 -rotate-90"
    >
      {slices.map((slice, i) => {
        const frac = slice.value / total;
        const dash = frac * c;
        const el = (
          <circle
            key={i}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={slice.color}
            strokeWidth="12"
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={-offset}
          />
        );
        offset += dash;
        return frac > 0 ? el : null;
      })}
    </svg>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-ink-400">{label}</span>
      <span className="min-w-0 text-right text-xs text-white">{children}</span>
    </div>
  );
}

function fmtDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function LaunchpadDetailPage({ id }: { id: number }) {
  const now = useNow();
  const account = useStore((state) => state.account);
  const pushToast = useStore((state) => state.pushToast);
  const dismissToast = useStore((state) => state.dismissToast);
  const guardCanSign = useStore((state) => state.guardCanSign);
  const signingToastTitle = useStore((state) => state.signingToastTitle);

  const [launch, setLaunch] = useState<LaunchInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [mine, setMine] = useState<ContributionInfo | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [buyers, setBuyers] = useState<BuyerEntry[]>([]);
  const [links, setLinks] = useState<LaunchLinks>({});
  const [supply, setSupply] = useState<bigint | null>(null);
  const [editingLinks, setEditingLinks] = useState(false);
  const [linkDraft, setLinkDraft] = useState<LaunchLinks>({});
  const [savingLinks, setSavingLinks] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const load = useCallback(async () => {
    try {
      const fresh = await fetchLaunch(id);
      if (!fresh) {
        setMissing(true);
        return;
      }
      setLaunch(fresh);
      if (account) setMine(await fetchContribution(id, account));
      else setMine(null);
      // the investor list rides the same poll so it stays live as buys land
      try {
        setBuyers(await fetchBuyers(id, 0, 100));
      } catch {
        /* keep the last list */
      }
    } catch {
      // keep the last known state on transient RPC errors
    }
  }, [id, account]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // links + total supply: fetched once (links again after edits)
  useEffect(() => {
    void fetchLaunchLinks(id).then(setLinks);
  }, [id]);
  useEffect(() => {
    if (launch && supply === null) {
      void fetchTokenSupply(launch.token).then(setSupply);
    }
  }, [launch, supply]);

  const isCreator = !!account && !!launch && account === launch.creator;

  const doCancel = async () => {
    if (!launch || !account || !guardCanSign()) return;
    setCanceling(true);
    const signToast = pushToast({ kind: "pending", title: signingToastTitle() });
    try {
      const handle = await cancelLaunch(account, launch.id);
      dismissToast(signToast);
      const mining = pushToast({
        kind: "pending",
        title: "Canceling the launch…",
        txId: handle.id,
      });
      await handle.wait();
      dismissToast(mining);
      pushToast({
        kind: "success",
        title: "Launch canceled",
        detail:
          "Your tokens are back in your wallet; buyers are refunded automatically.",
        txId: handle.id,
      });
      setConfirmCancel(false);
      void load();
    } catch (error: any) {
      dismissToast(signToast);
      pushToast({
        kind: "error",
        title: "Cancel failed",
        detail: error?.message || String(error),
      });
    } finally {
      setCanceling(false);
    }
  };

  const doSaveLinks = async () => {
    if (!launch || !account) return;
    setSavingLinks(true);
    try {
      await saveLaunchLinks({
        launchId: launch.id,
        links: linkDraft,
        sessionToken: account ? getSessionToken() : null,
        kondorAddress: getSessionToken() ? null : account,
      });
      setLinks(linkDraft);
      setEditingLinks(false);
      pushToast({ kind: "success", title: "Links saved" });
    } catch (error: any) {
      pushToast({
        kind: "error",
        title: "Saving links failed",
        detail: error?.message || String(error),
      });
    } finally {
      setSavingLinks(false);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/launchpad/${id}`;
    const title = `${launch?.tokenMeta?.name || symbol} launch on Trade Koinos`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      pushToast({ kind: "success", title: "Link copied" });
    } catch {
      pushToast({ kind: "info", title: url });
    }
  };

  const phase = launch ? launchPhase(launch, now) : null;
  const symbol = launch ? tokenSymbol(launch) : "";

  // what the typed KOIN amount buys / earns
  const preview = useMemo(() => {
    if (!launch) return null;
    let units: bigint;
    try {
      units = parseDecimalScaled(amount || "0", 8);
    } catch {
      return null;
    }
    if (units <= 0n) return null;
    if (launch.mode === MODE_FIXED) {
      const tokens = (units * LAUNCH_PRICE_SCALE) / launch.price;
      return { units, text: `≈ ${fmtToken(launch, tokens)} ${symbol}` };
    }
    const pool = launch.raised + units;
    const share = pool > 0n ? (launch.forSale * units) / pool : 0n;
    return {
      units,
      text: `≈ ${fmtToken(launch, share)} ${symbol} at the current pool (dilutes as others join)`,
    };
  }, [launch, amount, symbol]);

  const buy = async () => {
    if (!launch || !account || !preview) return;
    if (!guardCanSign()) return;
    setBusy(true);
    const signToast = pushToast({ kind: "pending", title: signingToastTitle() });
    let miningToast = 0;
    try {
      const handle = await contribute(account, launch.id, preview.units);
      dismissToast(signToast);
      miningToast = pushToast({
        kind: "pending",
        title: "Buying in…",
        detail: "Waiting for the transaction to confirm",
        txId: handle.id,
      });
      await handle.wait();
      dismissToast(miningToast);
      pushToast({
        kind: "success",
        title: "You're in 🎉",
        detail:
          launch.mode === MODE_FIXED
            ? `Your ${symbol} arrives automatically when the sale settles.`
            : `Your share settles automatically when the sale ends.`,
        txId: handle.id,
      });
      setAmount("");
      void load();
    } catch (error: any) {
      dismissToast(signToast);
      if (miningToast) dismissToast(miningToast);
      pushToast({
        kind: "error",
        title: "Buy-in failed",
        detail: error?.message || String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-lg border border-ink-600 bg-ink-850 p-6 text-center text-sm text-ink-300">
          Launch #{id} does not exist.{" "}
          <a href="#/launchpads" className="text-accent hover:underline">
            Back to the launchpad
          </a>
        </div>
      </div>
    );
  }
  if (!launch) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ink-400">
        <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        loading launch…
      </div>
    );
  }

  const canBuy = phase === "live";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <a href="#/launchpads" className="text-xs text-ink-400 hover:text-white">
          ← All launches
        </a>

        <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
          <TokenLogo address={launch.token} symbol={symbol} size={44} />
          <h1 className="text-xl font-bold text-white">
            {launch.tokenMeta?.name || symbol}{" "}
            <span className="text-ink-400">{symbol}</span>
          </h1>
          <PhaseChip launch={launch} now={now} />
          <ModeChip mode={launch.mode} />
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <LinkIcons links={links} />
            <button
              onClick={() => void share()}
              title="Share this launch"
              className="flex h-8 items-center gap-1.5 rounded-md border border-ink-600 bg-ink-850 px-2.5 text-xs font-semibold text-ink-300 transition hover:border-accent hover:text-white"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current"><path d="M12 10.6c-.6 0-1.2.3-1.6.7L5.9 8.7a2.5 2.5 0 000-1.4l4.5-2.6a2.3 2.3 0 10-.7-1.2L5.2 6.1a2.3 2.3 0 100 3.8l4.5 2.6a2.3 2.3 0 102.3-1.9z"/></svg>
              Share
            </button>
            {isCreator && (
              <button
                onClick={() => {
                  setLinkDraft(links);
                  setEditingLinks(!editingLinks);
                }}
                className="h-8 rounded-md border border-ink-600 bg-ink-850 px-2.5 text-xs font-semibold text-ink-300 transition hover:border-accent hover:text-white"
              >
                {editingLinks ? "Close" : "Edit links"}
              </button>
            )}
            {isCreator && (phase === "upcoming" || phase === "live") && (
              <button
                onClick={() => setConfirmCancel(true)}
                className="h-8 rounded-md border border-down/50 bg-ink-850 px-2.5 text-xs font-semibold text-down transition hover:bg-down hover:text-white"
              >
                Cancel launch
              </button>
            )}
          </div>
        </div>

        {/* creator: cancel confirmation */}
        {confirmCancel && (
          <div className="mb-4 rounded-lg border border-down/50 bg-down/10 p-4">
            <div className="mb-2 text-sm font-semibold text-white">
              Cancel this launch?
            </div>
            <p className="mb-3 text-xs leading-relaxed text-ink-300">
              All escrowed tokens return to your wallet immediately, and every
              buyer's KOIN is refunded automatically. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => void doCancel()}
                disabled={canceling}
                className="rounded-md bg-down px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {canceling ? "Canceling…" : "Yes, cancel and refund everyone"}
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                className="rounded-md border border-ink-600 px-4 py-2 text-xs font-semibold text-ink-300 transition hover:text-white"
              >
                Keep it running
              </button>
            </div>
          </div>
        )}

        {/* creator: link editor */}
        {editingLinks && (
          <div className="mb-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">
              Project links
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {LINK_META.map((meta) => (
                <label key={meta.key} className="block">
                  <div className="mb-0.5 text-[11px] font-semibold text-ink-400">
                    {meta.label}
                  </div>
                  <input
                    value={linkDraft[meta.key] || ""}
                    onChange={(event) =>
                      setLinkDraft({ ...linkDraft, [meta.key]: event.target.value })
                    }
                    placeholder="https://…"
                    className="w-full rounded-md border border-ink-600 bg-ink-950 px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-ink-500 focus:border-accent"
                  />
                </label>
              ))}
            </div>
            <button
              onClick={() => void doSaveLinks()}
              disabled={savingLinks}
              className="mt-3 rounded-md bg-accent px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {savingLinks ? "Saving…" : "Save links"}
            </button>
          </div>
        )}

        {/* status banner */}
        {phase === "ended" && (
          <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs text-ink-200">
            The sale has ended. Settlement is automatic — payouts are processed
            by usekoinos within a couple of minutes, no claiming needed.
          </div>
        )}
        {phase === "distributing" && (
          <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs text-ink-200">
            Distributing tokens to {launch.buyerCount} buyer
            {launch.buyerCount === 1 ? "" : "s"} — {launch.cursor} settled so
            far. This finishes automatically.
          </div>
        )}
        {phase === "refunding" && (
          <div className="mb-4 rounded-lg border border-down/40 bg-down/10 p-3 text-xs text-ink-200">
            The sale ended below its soft cap and is being canceled — every
            buyer's KOIN is refunded automatically.
          </div>
        )}
        {phase === "canceled" && (
          <div className="mb-4 rounded-lg border border-down/40 bg-down/10 p-3 text-xs text-ink-200">
            This sale ended below its soft cap. All buy-ins were refunded and
            the tokens returned to the creator.
          </div>
        )}
        {phase === "completed" && (
          <div className="mb-4 rounded-lg border border-up/40 bg-up/10 p-3 text-xs text-ink-200">
            Sale completed — {fmtKoin(launch.raised)} KOIN raised,{" "}
            {launch.buyerCount} buyer{launch.buyerCount === 1 ? "" : "s"} paid
            out automatically.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[1fr_300px]">
          {/* left: progress + terms */}
          <div className="space-y-4">
            <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
              <div className="mb-2">
                <ProgressBar launch={launch} />
              </div>
              <div className="flex justify-between text-xs text-ink-300">
                <span>
                  {launch.mode === MODE_FIXED ? (
                    <>
                      {fmtToken(launch, launch.sold)} /{" "}
                      {fmtToken(launch, launch.forSale)} {symbol} sold
                    </>
                  ) : (
                    <>
                      {fmtKoin(launch.raised)}
                      {launch.hardCap > 0n
                        ? ` / ${fmtKoin(launch.hardCap)}`
                        : ""}{" "}
                      KOIN raised
                    </>
                  )}
                </span>
                <span>
                  {launch.buyerCount} buyer{launch.buyerCount === 1 ? "" : "s"}
                </span>
              </div>
              {(phase === "upcoming" || phase === "live") && (
                <div className="mt-3 border-t border-ink-700 pt-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-ink-400">
                    {phase === "upcoming" ? "starts in" : "ends in"}
                  </div>
                  <div className="font-mono text-lg text-white">
                    {countdown(
                      phase === "upcoming" ? launch.startTime : launch.endTime,
                      now
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
              <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-400">
                Terms
              </h2>
              <div className="divide-y divide-ink-800">
                {launch.mode === MODE_FIXED ? (
                  <Row label="Price">
                    <span className="font-mono">
                      {priceToHuman(
                        launch.price,
                        launch.tokenMeta?.decimals ?? 8,
                        8
                      )}
                    </span>{" "}
                    KOIN per {symbol}
                  </Row>
                ) : (
                  <Row label="Price">
                    {launch.raised > 0n ? (
                      <>
                        <span className="font-mono">
                          {listPriceText(launch.raised, launch.forSale, launch)}
                        </span>{" "}
                        KOIN per {symbol} at the current pool (moves as people
                        buy in)
                      </>
                    ) : (
                      <>set by the pool — {symbol} splits pro-rata by KOIN share</>
                    )}
                  </Row>
                )}
                <Row label="For sale">
                  {fmtToken(launch, launch.forSale)} {symbol}
                </Row>
                <Row label="Soft cap">
                  {launch.softCap > 0n
                    ? `${fmtKoin(launch.softCap)} KOIN (below = full refund)`
                    : "none"}
                </Row>
                {launch.mode !== MODE_FIXED && (
                  <Row label="Hard cap">
                    {launch.hardCap > 0n
                      ? `${fmtKoin(launch.hardCap)} KOIN`
                      : "uncapped"}
                  </Row>
                )}
                <Row label="Unsold tokens">
                  {launch.unsoldAction === UNSOLD_BURN
                    ? "burned 🔥"
                    : "returned to the creator"}
                </Row>
                {launch.liquidityBps > 0 && (
                  <Row label="KoinDX liquidity">
                    {(launch.liquidityBps / 100).toFixed(0)}% of the raise +{" "}
                    {fmtToken(launch, launch.liquidityTokens)} {symbol}, LP
                    locked until {fmtDate(launch.lpUnlockTime)}
                  </Row>
                )}
                <Row label="Creator lock">
                  {launch.locked > 0n ? (
                    <>
                      {fmtToken(launch, launch.locked)} {symbol} locked until{" "}
                      {fmtDate(launch.unlockTime)}
                      {launch.lockedClaimed ? " (delivered)" : ""}
                    </>
                  ) : (
                    "none"
                  )}
                </Row>
                <Row label="Window">
                  {fmtDate(launch.startTime)} → {fmtDate(launch.endTime)}
                </Row>
                <Row label="Token">
                  <a
                    href={`https://koinosblocks.com/address/${launch.token}`}
                    target="_blank"
                    rel="noopener"
                    className="font-mono text-accent hover:underline"
                  >
                    {shortAddress(launch.token)}
                  </a>
                </Row>
                <Row label="Creator">
                  <span className="font-mono">{shortAddress(launch.creator)}</span>
                </Row>
              </div>
            </div>

            {launch.liquidityBps > 0 && (
              <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
                <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-400">
                  KoinDX listing
                </h2>
                {launch.liquidityState === LIQ_PROVIDED ? (
                  <div className="text-xs leading-relaxed text-ink-200">
                    Listed 🎉 — {fmtKoin(launch.liquidityKoin)} KOIN +{" "}
                    {fmtToken(launch, launch.liquidityTokens)} {symbol} went into
                    the pool (listing price{" "}
                    <span className="font-mono text-white">
                      {listPriceText(launch.liquidityKoin, launch.liquidityTokens, launch)}
                    </span>{" "}
                    KOIN). LP tokens are locked until{" "}
                    {fmtDate(launch.lpUnlockTime)}
                    {launch.lpClaimed ? " (delivered to the creator)" : ""} — see
                    the <a href="#/locks" className="text-accent hover:underline">locks page</a>.
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a
                        href={koindxSwapUrl(launch.token)}
                        target="_blank"
                        rel="noopener"
                        className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110"
                      >
                        Trade on KoinDX ↗
                      </a>
                      <a
                        href={tradeKoinosMarketHash(launch.token)}
                        className="rounded-md bg-up px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110"
                      >
                        Trade on Trade Koinos
                      </a>
                      <a
                        href={`https://koinosblocks.com/address/${launch.pair}`}
                        target="_blank"
                        rel="noopener"
                        className="rounded-md border border-ink-600 px-3 py-1.5 text-xs font-semibold text-ink-300 transition hover:text-white"
                      >
                        LP pair ↗
                      </a>
                    </div>
                  </div>
                ) : launch.liquidityState === LIQ_RECLAIMED ? (
                  <div className="text-xs leading-relaxed text-down">
                    ⚠️ The KoinDX listing could not be completed and the
                    earmarked KOIN + tokens were returned to the creator after
                    the 7-day grace period.
                  </div>
                ) : launch.liquidityState === LIQ_PENDING &&
                  (phase === "distributing" || phase === "completed") ? (
                  <div className="text-xs leading-relaxed text-ink-200">
                    Pairing {fmtKoin(launch.liquidityKoin)} KOIN with{" "}
                    {fmtToken(launch, launch.liquidityTokens)} {symbol} on KoinDX
                    — happens automatically within a couple of minutes.
                  </div>
                ) : (
                  <div className="space-y-1.5 text-xs leading-relaxed text-ink-300">
                    <div>
                      After a successful sale,{" "}
                      <span className="text-white">
                        {(launch.liquidityBps / 100).toFixed(0)}% of the KOIN
                        raised
                      </span>{" "}
                      is paired with{" "}
                      <span className="text-white">
                        {fmtToken(launch, launch.liquidityTokens)} {symbol}
                      </span>{" "}
                      on KoinDX, and the LP tokens lock until{" "}
                      {fmtDate(launch.lpUnlockTime)}.
                    </div>
                    {launch.softCap > 0n && (
                      <div>
                        At the soft cap: lists at ≈{" "}
                        <span className="font-mono text-white">
                          {listPriceText(
                            (launch.softCap * BigInt(launch.liquidityBps)) / 10000n,
                            launch.liquidityTokens,
                            launch
                          )}
                        </span>{" "}
                        KOIN per {symbol}
                        {launchPriceCompare(launch, launch.softCap)}
                      </div>
                    )}
                    {launch.hardCap > 0n && (
                      <div>
                        At a full sale: lists at ≈{" "}
                        <span className="font-mono text-white">
                          {listPriceText(
                            (launch.hardCap * BigInt(launch.liquidityBps)) / 10000n,
                            launch.liquidityTokens,
                            launch
                          )}
                        </span>{" "}
                        KOIN per {symbol}
                        {launchPriceCompare(launch, launch.hardCap)}
                      </div>
                    )}
                    {launch.raised > 0n && (
                      <div className="text-white">
                        At the CURRENT raise ({fmtKoin(launch.raised)} KOIN):
                        lists at ≈{" "}
                        <span className="font-mono">
                          {listPriceText(
                            (launch.raised * BigInt(launch.liquidityBps)) / 10000n,
                            launch.liquidityTokens,
                            launch
                          )}
                        </span>{" "}
                        KOIN per {symbol}
                        {launchPriceCompare(launch, launch.raised)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* tokenomics: where the supply goes */}
            <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-400">
                Tokenomics
              </h2>
              {(() => {
                const decimals = launch.tokenMeta?.decimals ?? 8;
                const toNum = (units: bigint) => Number(units) / 10 ** decimals;
                const forSaleN = toNum(launch.forSale);
                const liqN = toNum(launch.liquidityTokens);
                const lockN = toNum(launch.locked);
                const supplyN = supply !== null ? toNum(supply) : null;
                const restN =
                  supplyN !== null
                    ? Math.max(0, supplyN - forSaleN - liqN - lockN)
                    : null;
                const total = supplyN ?? forSaleN + liqN + lockN;
                const pct = (v: number) =>
                  total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—";
                const slices = [
                  { label: `For sale`, value: forSaleN, color: "#4f8cff" },
                  { label: `KoinDX liquidity`, value: liqN, color: "#2ebd85" },
                  { label: `Creator lock`, value: lockN, color: "#f0b90b" },
                  ...(restN !== null && restN > 0
                    ? [{ label: "Creator / other", value: restN, color: "#3a4150" }]
                    : []),
                ].filter((slice) => slice.value > 0);
                return (
                  <div className="flex flex-wrap items-center gap-4">
                    <Donut slices={slices} />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {slices.map((slice) => (
                        <div
                          key={slice.label}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: slice.color }}
                          />
                          <span className="flex-1 text-ink-300">{slice.label}</span>
                          <span className="font-mono text-white">
                            {slice.value.toLocaleString("en-US", {
                              maximumFractionDigits: 0,
                            })}
                          </span>
                          <span className="w-12 text-right font-mono text-ink-400">
                            {pct(slice.value)}
                          </span>
                        </div>
                      ))}
                      <div className="pt-1 text-[11px] text-ink-500">
                        {supplyN !== null
                          ? `Total supply ${supplyN.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${symbol}`
                          : "Total supply unavailable — showing escrowed amounts only"}
                        {launch.locked > 0n &&
                          ` · lock until ${fmtDate(launch.unlockTime)}`}
                        {launch.liquidityBps > 0 &&
                          ` · LP locked until ${fmtDate(launch.lpUnlockTime)}`}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* who's in */}
            <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">
                Investors ({launch.buyerCount})
              </h2>
              {buyers.length === 0 ? (
                <p className="text-xs text-ink-400">
                  Nobody yet — the first buy lands here live.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500">
                        <th className="pb-1.5 pr-3 font-semibold">Wallet</th>
                        <th className="pb-1.5 pr-3 text-right font-semibold">KOIN in</th>
                        <th className="pb-1.5 pr-3 text-right font-semibold">
                          {launch.mode === MODE_FIXED ? symbol : `est. ${symbol}`}
                        </th>
                        <th className="pb-1.5 text-right font-semibold">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-800">
                      {buyers.map((entry) => {
                        const tokensOwed =
                          launch.mode === MODE_FIXED
                            ? entry.tokens
                            : launch.raised > 0n
                              ? (launch.forSale * entry.koin) / launch.raised
                              : 0n;
                        const shareBase =
                          launch.mode === MODE_FIXED ? launch.forSale : launch.raised;
                        const shareRef =
                          launch.mode === MODE_FIXED ? tokensOwed : entry.koin;
                        const sharePct =
                          shareBase > 0n
                            ? Number((shareRef * 10000n) / shareBase) / 100
                            : 0;
                        return (
                          <tr key={entry.buyer} className={entry.buyer === account ? "text-accent" : "text-ink-200"}>
                            <td className="py-1.5 pr-3">
                              <a
                                href={`https://koinosblocks.com/address/${entry.buyer}`}
                                target="_blank"
                                rel="noopener"
                                className="font-mono hover:underline"
                              >
                                {shortAddress(entry.buyer)}
                                {entry.buyer === account ? " (you)" : ""}
                              </a>
                            </td>
                            <td className="py-1.5 pr-3 text-right font-mono">
                              {fmtKoin(entry.koin)}
                            </td>
                            <td className="py-1.5 pr-3 text-right font-mono">
                              {fmtToken(launch, tokensOwed)}
                            </td>
                            <td className="py-1.5 text-right font-mono text-ink-400">
                              {sharePct.toFixed(2)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {launch.buyerCount > buyers.length && (
                    <p className="mt-2 text-[11px] text-ink-500">
                      Showing the first {buyers.length} of {launch.buyerCount} investors.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* right: buy box + my position */}
          <div className="space-y-4">
            <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">
                Buy in
              </h2>
              {canBuy ? (
                <>
                  <div className="mb-2 flex items-center gap-2 rounded-md border border-ink-600 bg-ink-950 px-3 py-2">
                    <input
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      inputMode="decimal"
                      placeholder="0.0"
                      className="min-w-0 flex-1 bg-transparent font-mono text-sm text-white outline-none placeholder:text-ink-500"
                    />
                    <span className="text-xs font-semibold text-ink-300">
                      KOIN
                    </span>
                  </div>
                  <div className="mb-3 min-h-[1rem] text-xs text-ink-400">
                    {preview?.text || " "}
                  </div>
                  {account ? (
                    <button
                      onClick={() => void buy()}
                      disabled={busy || !preview}
                      className="w-full rounded-md bg-up py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-40"
                    >
                      {busy ? "Buying…" : `Buy ${symbol}`}
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        window.dispatchEvent(new Event("tk-open-connect"))
                      }
                      className="w-full rounded-md bg-accent py-2.5 text-sm font-bold text-white transition hover:brightness-110"
                    >
                      Sign in to buy
                    </button>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                    {launch.mode === MODE_FIXED
                      ? "Tokens are delivered automatically when the sale settles."
                      : "Your share is computed and delivered automatically when the sale ends."}
                    {launch.softCap > 0n &&
                      " If the soft cap is missed, your KOIN comes back automatically."}
                  </p>
                </>
              ) : (
                <p className="text-xs text-ink-400">
                  {phase === "upcoming"
                    ? `Buying opens ${fmtDate(launch.startTime)}.`
                    : "This sale is no longer accepting buy-ins."}
                </p>
              )}
            </div>

            {account && mine && mine.koin > 0n && (
              <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">
                  Your position
                </h2>
                <div className="divide-y divide-ink-800">
                  <Row label="Paid">{fmtKoin(mine.koin, 8)} KOIN</Row>
                  {launch.mode === MODE_FIXED ? (
                    <Row label="Bought">
                      {fmtToken(launch, mine.tokens)} {symbol}
                    </Row>
                  ) : (
                    <Row label={mine.settled ? "Received" : "Est. share"}>
                      {fmtToken(
                        launch,
                        mine.settled || launch.raised === 0n
                          ? mine.tokens
                          : (launch.forSale * mine.koin) / launch.raised
                      )}{" "}
                      {symbol}
                    </Row>
                  )}
                  <Row label="Status">
                    {mine.settled
                      ? phase === "canceled" || phase === "refunding"
                        ? "refunded ✓"
                        : "delivered ✓"
                      : phase === "refunding"
                        ? "refund on the way"
                        : phase === "distributing" || phase === "ended"
                          ? "delivery on the way"
                          : "in"}
                  </Row>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
