import { useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import {
  createLaunch,
  mintTokenViaUsekoinos,
  MODE_FIXED,
  MODE_POOL,
  UNSOLD_RETURN,
  UNSOLD_BURN,
} from "../../lib/launchpad";
import { probeToken, fetchBalance, type ProbedTokenMeta } from "../../lib/koinos";
import { getSessionToken } from "../../lib/sessionKey";
import {
  parseUnits,
  parseDecimalScaled,
  priceToContract,
  formatUnits,
} from "../../lib/format";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold text-ink-300">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-ink-500">{hint}</div>}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 text-sm text-white outline-none placeholder:text-ink-500 focus:border-accent";

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time */
function toLocalInput(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CreateLaunchPage() {
  const account = useStore((state) => state.account);
  const authMethod = useStore((state) => state.authMethod);
  const authConfig = useStore((state) => state.authConfig);
  const pushToast = useStore((state) => state.pushToast);
  const dismissToast = useStore((state) => state.dismissToast);
  const guardCanSign = useStore((state) => state.guardCanSign);
  const signingToastTitle = useStore((state) => state.signingToastTitle);

  // ---- token source ----
  const [source, setSource] = useState<"existing" | "mint">("existing");
  const [tokenAddress, setTokenAddress] = useState("");
  const [tokenMeta, setTokenMeta] = useState<ProbedTokenMeta | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [probing, setProbing] = useState(false);
  // mint form
  const [mintName, setMintName] = useState("");
  const [mintSymbol, setMintSymbol] = useState("");
  const [mintDecimals, setMintDecimals] = useState("8");
  const [mintSupply, setMintSupply] = useState("");
  const [minting, setMinting] = useState(false);

  // ---- launch terms ----
  const [mode, setMode] = useState(MODE_FIXED);
  const [price, setPrice] = useState("");
  const [forSale, setForSale] = useState("");
  const [locked, setLocked] = useState("");
  const [unlockAt, setUnlockAt] = useState(
    toLocalInput(Date.now() + 90 * 86400000)
  );
  const [startAt, setStartAt] = useState(toLocalInput(Date.now() + 3600000));
  const [endAt, setEndAt] = useState(toLocalInput(Date.now() + 7 * 86400000));
  const [softCap, setSoftCap] = useState("");
  const [hardCap, setHardCap] = useState("");
  const [unsoldAction, setUnsoldAction] = useState(UNSOLD_RETURN);
  const [submitting, setSubmitting] = useState(false);

  const probe = async () => {
    const address = tokenAddress.trim();
    if (!address) return;
    setProbing(true);
    setTokenMeta(null);
    const meta = await probeToken(address, true);
    setProbing(false);
    if (!meta) {
      pushToast({
        kind: "error",
        title: "Not a token",
        detail: "That address does not answer like a live token contract.",
      });
      return;
    }
    setTokenMeta(meta);
    // how much of it the creator actually holds - the escrow ceiling
    if (account) {
      try {
        setTokenBalance(
          await fetchBalance({ address, decimals: meta.decimals } as any, account)
        );
      } catch {
        setTokenBalance(null); // unknown balance: let the chain be the judge
      }
    }
  };

  /**
   * The token the FORM is being written against. In mint mode the token does
   * not exist yet, so its symbol/decimals come straight from the mint fields -
   * that is what lets token details and sale terms be filled in together and
   * submitted as one.
   */
  const formToken = useMemo(() => {
    if (source === "mint") {
      return {
        symbol: mintSymbol.trim().toUpperCase() || "tokens",
        name: mintName.trim(),
        decimals: Math.max(0, Math.min(18, Number(mintDecimals) || 8)),
        allowances: true, // freshly minted tokens are standard KCS-4
      };
    }
    return tokenMeta;
  }, [source, mintSymbol, mintName, mintDecimals, tokenMeta]);

  const validation = useMemo((): string | null => {
    if (source === "mint") {
      if (!mintName.trim() || !mintSymbol.trim()) return "Name the token";
      if (!mintSupply.trim()) return "Set the total supply";
    }
    if (!formToken) return "Pick a token first";
    try {
      const forSaleUnits = parseUnits(forSale || "0", formToken.decimals);
      if (forSaleUnits <= 0n) return "Set how many tokens are for sale";
      const lockedUnits = parseUnits(locked || "0", formToken.decimals);
      if (source === "mint") {
        // the sale can only escrow what the mint creates
        const supplyUnits = parseUnits(mintSupply.trim() || "0", formToken.decimals);
        if (supplyUnits <= 0n) return "Set the total supply";
        if (forSaleUnits + lockedUnits > supplyUnits)
          return "For sale + locked exceeds the minted supply";
      } else if (tokenBalance !== null && forSaleUnits + lockedUnits > tokenBalance) {
        return `You hold ${formatUnits(tokenBalance, formToken.decimals, 4)} ${formToken.symbol} — lower the amounts`;
      }
      const start = new Date(startAt).getTime();
      const end = new Date(endAt).getTime();
      if (!end || end <= Date.now()) return "The end must be in the future";
      if (end <= start) return "The end must be after the start";
      if (lockedUnits > 0n) {
        const unlock = new Date(unlockAt).getTime();
        if (!unlock || unlock < end)
          return "The unlock must not be before the end";
      }
      if (mode === MODE_FIXED) {
        const contractPrice = priceToContract(price || "0", formToken.decimals, 8);
        if (contractPrice <= 0n) return "Set a price";
      }
      const soft = parseDecimalScaled(softCap || "0", 8);
      const hard = parseDecimalScaled(hardCap || "0", 8);
      if (mode === MODE_POOL && soft > 0n && hard > 0n && soft > hard)
        return "The soft cap is above the hard cap";
      return null;
    } catch (error: any) {
      return error?.message || "Check the amounts";
    }
  }, [source, mintName, mintSymbol, mintSupply, formToken, tokenBalance, forSale, locked, startAt, endAt, unlockAt, mode, price, softCap, hardCap]);

  /** mint via usekoinos and return the token ready for createLaunch */
  const doMint = async (): Promise<{ address: string; meta: ProbedTokenMeta }> => {
    const minted = await mintTokenViaUsekoinos({
      name: mintName.trim(),
      symbol: mintSymbol.trim().toUpperCase(),
      decimals: Number(mintDecimals) || 8,
      supply: mintSupply.trim(),
      mintable: false,
      sessionToken: authMethod === "google" ? getSessionToken() : null,
      kondorAddress: authMethod === "google" ? null : account,
    });
    const meta = (await probeToken(minted.address, true)) || {
      symbol: mintSymbol.trim().toUpperCase(),
      name: mintName.trim(),
      decimals: Number(mintDecimals) || 8,
      allowances: true,
    };
    return { address: minted.address, meta };
  };

  const submit = async () => {
    if (!account || validation) return;
    if (!guardCanSign()) return;
    setSubmitting(true);

    // 1. In mint mode the token is created first, as part of the same submit.
    let launchToken = tokenAddress.trim();
    let launchMeta = tokenMeta;
    if (source === "mint") {
      setMinting(true);
      const mintToast = pushToast({
        kind: "pending",
        title: `Minting ${mintSymbol.trim().toUpperCase()}…`,
        detail: "usekoinos is deploying your token (takes ~half a minute)",
      });
      try {
        const minted = await doMint();
        launchToken = minted.address;
        launchMeta = minted.meta;
        // remember the minted token: if the launch step below fails (or is
        // cancelled), it is NOT lost - the form flips to "I have a token"
        // with the fresh address, and resubmitting only retries the launch
        setTokenAddress(minted.address);
        setTokenMeta(minted.meta);
        setTokenBalance(parseUnits(mintSupply.trim() || "0", minted.meta.decimals));
        setSource("existing");
        dismissToast(mintToast);
        pushToast({
          kind: "success",
          title: `${minted.meta.symbol} minted 🎉`,
          detail: "Full supply is in your wallet — opening the sale…",
        });
      } catch (error: any) {
        dismissToast(mintToast);
        pushToast({
          kind: "error",
          title: "Mint failed",
          detail: error?.message || String(error),
        });
        setMinting(false);
        setSubmitting(false);
        return;
      }
      setMinting(false);
    }
    if (!launchMeta) {
      setSubmitting(false);
      return;
    }

    // 2. Escrow and open the launch.
    const signToast = pushToast({ kind: "pending", title: signingToastTitle() });
    let miningToast = 0;
    try {
      const decimals = launchMeta.decimals;
      const handle = await createLaunch({
        creator: account,
        token: launchToken,
        tokenAllowances: launchMeta.allowances,
        mode,
        price: mode === MODE_FIXED ? priceToContract(price, decimals, 8) : 0n,
        forSale: parseUnits(forSale, decimals),
        locked: parseUnits(locked || "0", decimals),
        unlockTime: new Date(unlockAt).getTime(),
        startTime: new Date(startAt).getTime(),
        endTime: new Date(endAt).getTime(),
        softCap: parseDecimalScaled(softCap || "0", 8),
        hardCap: mode === MODE_POOL ? parseDecimalScaled(hardCap || "0", 8) : 0n,
        unsoldAction,
      });
      dismissToast(signToast);
      miningToast = pushToast({
        kind: "pending",
        title: "Creating the launch…",
        detail: "Escrowing your tokens on-chain",
        txId: handle.id,
      });
      await handle.wait();
      dismissToast(miningToast);
      pushToast({
        kind: "success",
        title: "Launch is up 🚀",
        detail: "Your sale page is live — share the link.",
        txId: handle.id,
      });
      // land on the list; the newest launch is on top
      window.location.hash = "#/launchpads";
    } catch (error: any) {
      dismissToast(signToast);
      if (miningToast) dismissToast(miningToast);
      pushToast({
        kind: "error",
        title: "Launch creation failed",
        detail:
          (error?.message || String(error)) +
          (source === "existing" && launchToken && tokenAddress === launchToken
            ? ""
            : " — your minted token is safe in your wallet; just press the button again to retry the launch."),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!account) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-ink-600 bg-ink-850 p-6 text-center">
          <div className="mb-2 text-sm font-semibold text-white">
            Sign in to create a launch
          </div>
          <p className="mb-4 text-xs text-ink-400">
            Connect Kondor or continue with Google — your tokens are escrowed
            from your own wallet.
          </p>
          <button
            onClick={() => window.dispatchEvent(new Event("tk-open-connect"))}
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <a href="#/launchpads" className="text-xs text-ink-400 hover:text-white">
          ← All launches
        </a>
        <h1 className="mb-1 mt-2 text-lg font-bold text-white">
          Create a launch
        </h1>
        <p className="mb-5 text-xs leading-relaxed text-ink-400">
          Escrow your token, set the terms, and the sale runs itself: buyers
          pay in KOIN, and when it ends usekoinos settles everything
          automatically — payouts, refunds, and your locked tokens at unlock.
        </p>

        {/* ---- step 1: the token ---- */}
        <div className="mb-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-400">
            1 · The token
          </h2>
          <div className="mb-3 flex gap-1 rounded-md bg-ink-950 p-1">
            <button
              onClick={() => setSource("existing")}
              className={`flex-1 rounded py-1.5 text-xs font-semibold transition ${source === "existing" ? "bg-ink-700 text-white" : "text-ink-400"}`}
            >
              I have a token
            </button>
            <button
              onClick={() => setSource("mint")}
              disabled={!authConfig?.tokenLaunch}
              title={
                authConfig?.tokenLaunch
                  ? undefined
                  : "Minting is not available right now"
              }
              className={`flex-1 rounded py-1.5 text-xs font-semibold transition disabled:opacity-40 ${source === "mint" ? "bg-ink-700 text-white" : "text-ink-400"}`}
            >
              Mint a new token
            </button>
          </div>

          {source === "existing" ? (
            <div className="space-y-3">
              <Field
                label="Token contract address"
                hint="Any live Koinos token you hold — including one minted on usekoinos.com."
              >
                <div className="flex gap-2">
                  <input
                    value={tokenAddress}
                    onChange={(event) => {
                      setTokenAddress(event.target.value);
                      setTokenMeta(null);
                      setTokenBalance(null);
                    }}
                    placeholder="1ABC…"
                    className={inputClass}
                  />
                  <button
                    onClick={() => void probe()}
                    disabled={probing || !tokenAddress.trim()}
                    className="shrink-0 rounded-md border border-ink-600 px-3 text-xs font-semibold text-ink-300 transition hover:border-accent hover:text-white disabled:opacity-40"
                  >
                    {probing ? "Checking…" : "Check"}
                  </button>
                </div>
              </Field>
              {tokenMeta && (
                <div className="rounded-md border border-up/40 bg-up/10 px-3 py-2 text-xs text-ink-200">
                  ✓ {tokenMeta.name} ({tokenMeta.symbol}), {tokenMeta.decimals}{" "}
                  decimals
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name">
                  <input
                    value={mintName}
                    onChange={(event) => setMintName(event.target.value)}
                    placeholder="My Token"
                    className={inputClass}
                  />
                </Field>
                <Field label="Symbol">
                  <input
                    value={mintSymbol}
                    onChange={(event) => setMintSymbol(event.target.value)}
                    placeholder="MTK"
                    className={inputClass}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Total supply" hint="Minted straight to your wallet.">
                  <input
                    value={mintSupply}
                    onChange={(event) => setMintSupply(event.target.value)}
                    inputMode="decimal"
                    placeholder="1000000"
                    className={inputClass}
                  />
                </Field>
                <Field label="Decimals">
                  <input
                    value={mintDecimals}
                    onChange={(event) => setMintDecimals(event.target.value)}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </Field>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-500">
                Nothing to click here — fill in the sale below and the launch
                button mints the token and opens the sale in one go. Minting is
                free (usekoinos pays the mana).
              </p>
            </div>
          )}
        </div>

        {/* ---- step 2: the sale ---- */}
        <div className="mb-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-400">
            2 · The sale
          </h2>
          <div className="mb-3 flex gap-1 rounded-md bg-ink-950 p-1">
            <button
              onClick={() => setMode(MODE_FIXED)}
              className={`flex-1 rounded py-1.5 text-xs font-semibold transition ${mode === MODE_FIXED ? "bg-ink-700 text-white" : "text-ink-400"}`}
            >
              Fixed price
            </button>
            <button
              onClick={() => setMode(MODE_POOL)}
              className={`flex-1 rounded py-1.5 text-xs font-semibold transition ${mode === MODE_POOL ? "bg-ink-700 text-white" : "text-ink-400"}`}
            >
              Pro-rata pool
            </button>
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-ink-500">
            {mode === MODE_FIXED
              ? "Buyers pay a flat KOIN price per token, first come first served, until the pool sells out."
              : "Buyers deposit KOIN for the whole window; at the end the pool splits pro-rata by each buyer's share. It can oversubscribe — later buyers dilute everyone."}
          </p>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`For sale (${formToken?.symbol || "tokens"})`}>
                <input
                  value={forSale}
                  onChange={(event) => setForSale(event.target.value)}
                  inputMode="decimal"
                  placeholder="500000"
                  className={inputClass}
                />
              </Field>
              {mode === MODE_FIXED ? (
                <Field label="Price (KOIN per token)">
                  <input
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.05"
                    className={inputClass}
                  />
                </Field>
              ) : (
                <Field label="Hard cap (KOIN, optional)">
                  <input
                    value={hardCap}
                    onChange={(event) => setHardCap(event.target.value)}
                    inputMode="decimal"
                    placeholder="uncapped"
                    className={inputClass}
                  />
                </Field>
              )}
            </div>
            <Field
              label="Soft cap (KOIN, optional)"
              hint="Below this at the end, the sale cancels: buyers are refunded and your tokens come back."
            >
              <input
                value={softCap}
                onChange={(event) => setSoftCap(event.target.value)}
                inputMode="decimal"
                placeholder="none"
                className={inputClass}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(event) => setStartAt(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Ends">
                <input
                  type="datetime-local"
                  value={endAt}
                  onChange={(event) => setEndAt(event.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="If tokens are left unsold">
              <div className="flex gap-1 rounded-md bg-ink-950 p-1">
                <button
                  onClick={() => setUnsoldAction(UNSOLD_RETURN)}
                  className={`flex-1 rounded py-1.5 text-xs font-semibold transition ${unsoldAction === UNSOLD_RETURN ? "bg-ink-700 text-white" : "text-ink-400"}`}
                >
                  Return them to me
                </button>
                <button
                  onClick={() => setUnsoldAction(UNSOLD_BURN)}
                  className={`flex-1 rounded py-1.5 text-xs font-semibold transition ${unsoldAction === UNSOLD_BURN ? "bg-ink-700 text-white" : "text-ink-400"}`}
                >
                  Burn them 🔥
                </button>
              </div>
            </Field>
          </div>
        </div>

        {/* ---- step 3: the lock ---- */}
        <div className="mb-5 rounded-lg border border-ink-700 bg-ink-900 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-400">
            3 · Creator lock (optional)
          </h2>
          <p className="mb-3 text-[11px] leading-relaxed text-ink-500">
            Escrow part of your own supply until a date you choose — buyers can
            see you cannot dump it. Delivered back to you automatically at
            unlock.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Locked amount (${formToken?.symbol || "tokens"})`}>
              <input
                value={locked}
                onChange={(event) => setLocked(event.target.value)}
                inputMode="decimal"
                placeholder="0"
                className={inputClass}
              />
            </Field>
            <Field label="Unlocks">
              <input
                type="datetime-local"
                value={unlockAt}
                onChange={(event) => setUnlockAt(event.target.value)}
                disabled={!locked || locked === "0"}
                className={`${inputClass} disabled:opacity-40`}
              />
            </Field>
          </div>
        </div>

        <button
          onClick={() => void submit()}
          disabled={submitting || !!validation}
          className="w-full rounded-md bg-up py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {submitting
            ? minting
              ? "Minting your token…"
              : "Creating the launch…"
            : validation
              ? validation
              : source === "mint"
                ? `Mint ${formToken?.symbol || "the token"} & open the launch`
                : "Escrow tokens & open the launch"}
        </button>
        <p className="mt-2 text-center text-[11px] text-ink-500">
          Creating the launch escrows the for-sale + locked tokens from your
          wallet in one transaction.
        </p>
      </div>
    </div>
  );
}
