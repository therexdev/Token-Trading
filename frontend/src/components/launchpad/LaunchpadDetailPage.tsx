import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import {
  fetchLaunch,
  fetchContribution,
  contribute,
  launchPhase,
  MODE_FIXED,
  UNSOLD_BURN,
  LIQ_PENDING,
  LIQ_PROVIDED,
  LIQ_RECLAIMED,
  LAUNCH_PRICE_SCALE,
  type LaunchInfo,
  type ContributionInfo,
} from "../../lib/launchpad";
import { parseDecimalScaled, priceToHuman, shortAddress } from "../../lib/format";
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
    } catch {
      // keep the last known state on transient RPC errors
    }
  }, [id, account]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

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
        </div>

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
                    set by the pool — {symbol} splits pro-rata by KOIN share
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
                  </div>
                )}
              </div>
            )}
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
