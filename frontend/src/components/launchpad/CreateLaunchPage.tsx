import { useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import {
  createLaunch,
  mintTokenViaUsekoinos,
  uploadTokenLogo,
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

  // ---- logo (optional, stored on usekoinos) ----
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  // ---- project links (optional; editable later from the launch page) ----
  const [links, setLinks] = useState<Record<string, string>>({});

  // ---- KoinDX auto-liquidity (optional) ----
  const [liqEnabled, setLiqEnabled] = useState(false);
  const [liqPercent, setLiqPercent] = useState("50");
  const [liqTokens, setLiqTokens] = useState("");
  const [lpUnlockAt, setLpUnlockAt] = useState(
    toLocalInput(Date.now() + 180 * 86400000)
  );

  const onLogoFile = (file: File | null) => {
    if (!file) return setLogoDataUrl(null);
    if (file.size > 1_500_000) {
      pushToast({
        kind: "error",
        title: "Logo too large",
        detail: "Keep it under 1.5MB (PNG, JPEG, GIF or WebP).",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(String(reader.result || "") || null);
    reader.readAsDataURL(file);
  };

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
      const liqTokenUnits = liqEnabled
        ? parseUnits(liqTokens || "0", formToken.decimals)
        : 0n;
      if (liqEnabled) {
        const pct = Number(liqPercent);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 100)
          return "Liquidity % must be between 1 and 100";
        if (liqTokenUnits <= 0n) return "Set the liquidity token amount";
        const lpUnlock = new Date(lpUnlockAt).getTime();
        const endT = new Date(endAt).getTime();
        if (!lpUnlock || lpUnlock < endT)
          return "The LP unlock must not be before the end";
      }
      const escrowNeed = forSaleUnits + lockedUnits + liqTokenUnits;
      if (source === "mint") {
        // the sale can only escrow what the mint creates
        const supplyUnits = parseUnits(mintSupply.trim() || "0", formToken.decimals);
        if (supplyUnits <= 0n) return "Set the total supply";
        if (escrowNeed > supplyUnits)
          return "For sale + locked + liquidity exceeds the minted supply";
      } else if (tokenBalance !== null && escrowNeed > tokenBalance) {
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
  }, [source, mintName, mintSymbol, mintSupply, formToken, tokenBalance, forSale, locked, startAt, endAt, unlockAt, mode, price, softCap, hardCap, liqEnabled, liqPercent, liqTokens, lpUnlockAt]);

  /**
   * What the KoinDX listing would look like: implied listing price at the
   * soft cap and at a full sale, next to the launch price. The whole point
   * is that buyers (and the creator) see the end state before committing.
   */
  const listingPreview = useMemo(() => {
    if (!liqEnabled || !formToken) return null;
    const pct = Number(liqPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
    const tokensNum = Number(liqTokens);
    if (!Number.isFinite(tokensNum) || tokensNum <= 0) return null;
    const forSaleNum = Number(forSale);
    const priceNum = Number(price);
    const softNum = Number(softCap) || 0;
    const hardNum =
      mode === MODE_FIXED
        ? Number.isFinite(forSaleNum) && Number.isFinite(priceNum)
          ? forSaleNum * priceNum
          : 0
        : Number(hardCap) || 0;

    const listAt = (raiseKoin: number) => {
      if (!raiseKoin) return null;
      const listing = (raiseKoin * (pct / 100)) / tokensNum;
      let vs = "";
      if (mode === MODE_FIXED && priceNum > 0) {
        const diff = ((listing - priceNum) / priceNum) * 100;
        vs = ` (${diff >= 0 ? "+" : ""}${diff.toFixed(0)}% vs launch price)`;
      } else if (mode === MODE_POOL && forSaleNum > 0) {
        const launchPrice = raiseKoin / forSaleNum;
        const diff = ((listing - launchPrice) / launchPrice) * 100;
        vs = ` (${diff >= 0 ? "+" : ""}${diff.toFixed(0)}% vs the pool price at that raise)`;
      }
      return {
        price: listing.toLocaleString("en-US", { maximumSignificantDigits: 4 }),
        vs,
      };
    };
    return {
      soft: softNum > 0 ? listAt(softNum) : null,
      full: hardNum > 0 ? listAt(hardNum) : null,
    };
  }, [liqEnabled, liqPercent, liqTokens, formToken, forSale, price, softCap, hardCap, mode]);

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
        liquidityBps: liqEnabled ? Math.round(Number(liqPercent) * 100) : 0,
        liquidityTokens: liqEnabled
          ? parseUnits(liqTokens || "0", decimals)
          : 0n,
        lpUnlockTime: new Date(lpUnlockAt).getTime(),
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
      if (logoDataUrl) {
        // best-effort: a failed logo upload never fails the launch
        try {
          await uploadTokenLogo({
            token: launchToken,
            logo: logoDataUrl,
            sessionToken: authMethod === "google" ? getSessionToken() : null,
            kondorAddress: authMethod === "google" ? null : account,
          });
        } catch (logoError: any) {
          pushToast({
            kind: "info",
            title: "Logo not saved",
            detail: logoError?.message || "You can retry from the create page later.",
          });
        }
      }
      // attach the project links to the new launch (its id = the newest one
      // by this creator); best-effort, editable later from the launch page
      const linkValues = Object.values(links).some((v) => v && v.trim());
      if (linkValues) {
        try {
          const { fetchLaunches, saveLaunchLinks } = await import(
            "../../lib/launchpad"
          );
          const all = await fetchLaunches();
          const minted = all.find((l) => l.creator === account);
          if (minted) {
            await saveLaunchLinks({
              launchId: minted.id,
              links: links as any,
              sessionToken: getSessionToken(),
              kondorAddress: getSessionToken() ? null : account,
            });
          }
        } catch {
          /* the launch page has an Edit links button for retries */
        }
      }
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

          <div className="mt-3 border-t border-ink-800 pt-3">
            <Field
              label="Token logo (optional)"
              hint="PNG/JPEG/GIF/WebP up to 1.5MB — shown on the launch page and the token's usekoinos page."
            >
              <div className="flex items-center gap-3">
                {logoDataUrl && (
                  <img
                    src={logoDataUrl}
                    alt="logo preview"
                    className="h-10 w-10 rounded-full border border-ink-600 object-cover"
                  />
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={(event) => onLogoFile(event.target.files?.[0] || null)}
                  className="text-xs text-ink-300 file:mr-3 file:rounded-md file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                />
              </div>
            </Field>
          </div>
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

        {/* ---- project links (optional) ---- */}
        <div className="mb-5 rounded-lg border border-ink-700 bg-ink-900 p-4">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-400">
            Project links (optional)
          </h2>
          <p className="mb-3 text-[11px] leading-relaxed text-ink-500">
            Shown as icons at the top of your launch page. You can add or
            change these later from the launch page while signed in.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {["website", "x", "telegram", "discord", "github", "facebook", "youtube"].map(
              (key) => (
                <input
                  key={key}
                  value={links[key] || ""}
                  onChange={(event) =>
                    setLinks({ ...links, [key]: event.target.value })
                  }
                  placeholder={key === "x" ? "X (Twitter) URL" : `${key} URL`}
                  className={inputClass}
                />
              )
            )}
          </div>
        </div>

        {/* ---- step 4: KoinDX liquidity ---- */}
        <div className="mb-5 rounded-lg border border-ink-700 bg-ink-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink-400">
              4 · KoinDX listing (optional)
            </h2>
            <button
              onClick={() => setLiqEnabled(!liqEnabled)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                liqEnabled ? "bg-up text-white" : "bg-ink-700 text-ink-300"
              }`}
            >
              {liqEnabled ? "On" : "Off"}
            </button>
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-ink-500">
            When the sale succeeds, part of the raised KOIN is automatically
            paired with tokens you set aside and listed on KoinDX. The LP
            tokens stay locked until the date you pick — visible to every
            buyer, so they know the liquidity cannot be pulled.
          </p>
          {liqEnabled && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="% of raised KOIN to liquidity">
                  <input
                    value={liqPercent}
                    onChange={(event) => setLiqPercent(event.target.value)}
                    inputMode="decimal"
                    placeholder="50"
                    className={inputClass}
                  />
                </Field>
                <Field label={`Tokens set aside (${formToken?.symbol || "tokens"})`}>
                  <input
                    value={liqTokens}
                    onChange={(event) => setLiqTokens(event.target.value)}
                    inputMode="decimal"
                    placeholder="100000"
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field
                label="Liquidity locked until"
                hint="The LP tokens are escrowed on-chain until this date, then delivered to you from the Locks page."
              >
                <input
                  type="datetime-local"
                  value={lpUnlockAt}
                  onChange={(event) => setLpUnlockAt(event.target.value)}
                  className={inputClass}
                />
              </Field>
              {listingPreview && (listingPreview.soft || listingPreview.full) && (
                <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-[11px] leading-relaxed text-ink-200">
                  <div className="mb-1 font-semibold uppercase tracking-wider text-ink-400">
                    Projected KoinDX list price
                  </div>
                  {listingPreview.soft && (
                    <div>
                      At the soft cap: ≈{" "}
                      <span className="font-mono text-white">
                        {listingPreview.soft.price}
                      </span>{" "}
                      KOIN per {formToken?.symbol}
                      {listingPreview.soft.vs}
                    </div>
                  )}
                  {listingPreview.full && (
                    <div>
                      At a full sale: ≈{" "}
                      <span className="font-mono text-white">
                        {listingPreview.full.price}
                      </span>{" "}
                      KOIN per {formToken?.symbol}
                      {listingPreview.full.vs}
                    </div>
                  )}
                  <div className="mt-1 text-ink-500">
                    A list price close to (or above) the launch price protects
                    your buyers from an instant drop at listing.
                  </div>
                </div>
              )}
            </div>
          )}
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
