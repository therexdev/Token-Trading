import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import {
  estimateCreateMarketMana,
  fetchAvailableMana,
  isKondorAvailable,
  probeToken,
  type ProbedTokenMeta,
} from "../lib/koinos";
import { formatUnits, parseUnits, shortAddress } from "../lib/format";
import type { TokenConfig } from "../config/tokens";
import { RETIRED_ADDRESSES } from "../config/tokens";

const CUSTOM = "__custom__";

// base58check account addresses (same alphabet Koinos uses)
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{25,35}$/;

// mirror of the contract-side ceiling on min_base_amount
const MAX_MIN_WHOLE_TOKENS = 1_000_000;

interface SideValue {
  address: string;
  symbol: string;
  decimals: number;
  known: TokenConfig | null;
}

interface TokenFieldProps {
  label: string;
  tokens: TokenConfig[];
  choice: string;
  customAddress: string;
  onChoice: (choice: string) => void;
  onCustomAddress: (address: string) => void;
  probing: boolean;
  probed: ProbedTokenMeta | null;
  probeError: string | null;
  /** address selected on the other side, hidden from this dropdown */
  excludeAddress: string | null;
}

function TokenField({
  label,
  tokens,
  choice,
  customAddress,
  onChoice,
  onCustomAddress,
  probing,
  probed,
  probeError,
  excludeAddress,
}: TokenFieldProps) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </div>
      <select
        value={choice}
        onChange={(event) => onChoice(event.target.value)}
        className="w-full rounded-md border border-ink-600 bg-ink-850 px-3 py-2.5 text-base text-white outline-none transition focus:border-accent lg:py-2 lg:text-sm"
      >
        <option value="">Select a token…</option>
        {tokens
          .filter((token) => token.address !== excludeAddress)
          .map((token) => (
            <option key={token.address} value={token.address}>
              {token.symbol} — {token.name}
              {token.dynamic ? ` (${shortAddress(token.address)})` : ""}
            </option>
          ))}
        <option value={CUSTOM}>Custom token address…</option>
      </select>
      {choice === CUSTOM && (
        <>
          <input
            value={customAddress}
            onChange={(event) => onCustomAddress(event.target.value.trim())}
            placeholder="Token contract address (base58)"
            spellCheck={false}
            className="mt-2 w-full rounded-md border border-ink-600 bg-ink-850 px-3 py-2.5 font-mono text-sm text-white outline-none transition placeholder:text-ink-500 focus:border-accent lg:py-2"
          />
          <div className="mt-1 min-h-[1rem] text-[11px]">
            {probing ? (
              <span className="text-ink-400">checking the contract…</span>
            ) : probeError ? (
              <span className="text-down">{probeError}</span>
            ) : probed ? (
              <span className="text-up">
                ✓ {probed.symbol || "(no symbol)"} — {probed.decimals} decimals
                {probed.allowances ? "" : ", no allowances"}
              </span>
            ) : null}
          </div>
        </>
      )}
    </label>
  );
}

/**
 * Modal for listing a new trading pair. Anyone can create a market: the
 * transaction is signed by the connected account, whose mana pays for it.
 */
export function ListPairModal() {
  const open = useStore((state) => state.listPairOpen);
  const setListPairOpen = useStore((state) => state.setListPairOpen);
  const tokens = useStore((state) => state.tokens);
  const markets = useStore((state) => state.markets);
  const allPairs = useStore((state) => state.allPairs);
  const account = useStore((state) => state.account);
  const connect = useStore((state) => state.connect);
  const submitCreateMarket = useStore((state) => state.submitCreateMarket);
  const selectMarket = useStore((state) => state.selectMarket);

  const [baseChoice, setBaseChoice] = useState("");
  const [baseCustom, setBaseCustom] = useState("");
  const [baseProbing, setBaseProbing] = useState(false);
  const [baseProbed, setBaseProbed] = useState<ProbedTokenMeta | null>(null);
  const [baseProbeError, setBaseProbeError] = useState<string | null>(null);

  const [quoteChoice, setQuoteChoice] = useState("");
  const [quoteCustom, setQuoteCustom] = useState("");
  const [quoteProbing, setQuoteProbing] = useState(false);
  const [quoteProbed, setQuoteProbed] = useState<ProbedTokenMeta | null>(null);
  const [quoteProbeError, setQuoteProbeError] = useState<string | null>(null);

  const [minStr, setMinStr] = useState("0.1");
  const [submitting, setSubmitting] = useState(false);
  const [availableMana, setAvailableMana] = useState<bigint | null>(null);

  const baseProbeSeq = useRef(0);
  const quoteProbeSeq = useRef(0);

  // reset the form each time the modal opens
  useEffect(() => {
    if (!open) return;
    setBaseChoice("");
    setBaseCustom("");
    setBaseProbed(null);
    setBaseProbeError(null);
    setQuoteChoice("");
    setQuoteCustom("");
    setQuoteProbed(null);
    setQuoteProbeError(null);
    setMinStr("0.1");
    setSubmitting(false);
  }, [open]);

  // the estimate is compared against the signer's current mana
  useEffect(() => {
    if (!open || !account) {
      setAvailableMana(null);
      return;
    }
    let stale = false;
    fetchAvailableMana(account)
      .then((mana) => {
        if (!stale) setAvailableMana(mana);
      })
      .catch(() => {
        if (!stale) setAvailableMana(null);
      });
    return () => {
      stale = true;
    };
  }, [open, account]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setListPairOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setListPairOpen]);

  // probe custom addresses as they are typed (debounced)
  const probeSide = (
    address: string,
    seqRef: { current: number },
    setProbing: (value: boolean) => void,
    setProbed: (value: ProbedTokenMeta | null) => void,
    setError: (value: string | null) => void
  ) => {
    const seq = ++seqRef.current; // invalidate any in-flight probe
    setProbing(false);
    setProbed(null);
    setError(null);
    if (!address) return;
    if (!ADDRESS_RE.test(address)) {
      setError("not a valid Koinos address");
      return;
    }
    if (RETIRED_ADDRESSES.includes(address)) {
      setError(
        "this is a retired system-locked contract — use the live token address"
      );
      return;
    }
    setProbing(true);
    const timer = setTimeout(() => {
      void probeToken(address, true).then((meta) => {
        if (seqRef.current !== seq) return; // superseded by newer input
        setProbing(false);
        if (meta) {
          setProbed(meta);
        } else {
          setError("no token contract answered at this address");
        }
      });
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  };

  useEffect(() => {
    if (baseChoice !== CUSTOM) return;
    return probeSide(
      baseCustom,
      baseProbeSeq,
      setBaseProbing,
      setBaseProbed,
      setBaseProbeError
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseChoice, baseCustom]);

  useEffect(() => {
    if (quoteChoice !== CUSTOM) return;
    return probeSide(
      quoteCustom,
      quoteProbeSeq,
      setQuoteProbing,
      setQuoteProbed,
      setQuoteProbeError
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteChoice, quoteCustom]);

  const resolveSide = (
    choice: string,
    custom: string,
    probed: ProbedTokenMeta | null
  ): SideValue | null => {
    if (choice && choice !== CUSTOM) {
      const known = tokens.find((token) => token.address === choice);
      if (!known) return null;
      return {
        address: known.address,
        symbol: known.symbol,
        decimals: known.decimals,
        known,
      };
    }
    if (choice === CUSTOM && ADDRESS_RE.test(custom)) {
      // a pasted address that is already listed resolves to the known token
      const known = tokens.find((token) => token.address === custom);
      if (known) {
        return {
          address: known.address,
          symbol: known.symbol,
          decimals: known.decimals,
          known,
        };
      }
      if (probed) {
        return {
          address: custom,
          symbol: probed.symbol || shortAddress(custom),
          decimals: probed.decimals,
          known: null,
        };
      }
    }
    return null;
  };

  const base = useMemo(
    () => resolveSide(baseChoice, baseCustom, baseProbed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseChoice, baseCustom, baseProbed, tokens]
  );
  const quote = useMemo(
    () => resolveSide(quoteChoice, quoteCustom, quoteProbed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quoteChoice, quoteCustom, quoteProbed, tokens]
  );

  const existingMarket = useMemo(() => {
    if (!base || !quote) return null;
    return (
      markets.find(
        (market) =>
          (market.base.address === base.address &&
            market.quote.address === quote.address) ||
          (market.base.address === quote.address &&
            market.quote.address === base.address)
      ) || null
    );
  }, [markets, base, quote]);

  const duplicateHidden = useMemo(() => {
    if (!base || !quote || existingMarket) return false;
    return allPairs.some(
      (pair) =>
        (pair.base === base.address && pair.quote === quote.address) ||
        (pair.base === quote.address && pair.quote === base.address)
    );
  }, [allPairs, base, quote, existingMarket]);

  const manaEstimate = useMemo(
    () => estimateCreateMarketMana(allPairs.length),
    [allPairs.length]
  );

  const validation = useMemo((): string | null => {
    if (!base || !quote) return "choose both tokens";
    if (base.address === quote.address) return "base and quote must differ";
    if (existingMarket)
      return `${existingMarket.base.symbol}/${existingMarket.quote.symbol} is already listed`;
    if (duplicateHidden) return "this pair already exists on the contract";
    let minUnits: bigint;
    try {
      minUnits = parseUnits(minStr || "0", base.decimals);
    } catch {
      return "invalid minimum order size";
    }
    if (minUnits <= 0n) return "minimum order size must be positive";
    if (minUnits > BigInt(MAX_MIN_WHOLE_TOKENS) * 10n ** BigInt(base.decimals))
      return "minimum order size is too large";
    if (
      availableMana !== null &&
      account &&
      availableMana < manaEstimate
    )
      return "not enough mana right now — it regenerates over time";
    return null;
  }, [
    base,
    quote,
    existingMarket,
    duplicateHidden,
    minStr,
    availableMana,
    manaEstimate,
    account,
  ]);

  if (!open) return null;

  const submit = async () => {
    if (!base || !quote || validation) return;
    const minUnits = parseUnits(minStr, base.decimals);
    setSubmitting(true);
    await submitCreateMarket(base.address, quote.address, minUnits);
    setSubmitting(false);
  };

  const close = () => setListPairOpen(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-black/60"
        onClick={close}
      />
      <div className="relative flex max-h-[90dvh] w-full max-w-md animate-fade-in flex-col rounded-lg border border-ink-600 bg-ink-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-ink-700 px-4 py-3">
          <span className="text-sm font-bold text-white">List a new pair</span>
          <button
            onClick={close}
            aria-label="Close"
            className="-mr-1 flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <TokenField
            label="Base token (the asset being traded)"
            tokens={tokens}
            choice={baseChoice}
            customAddress={baseCustom}
            onChoice={setBaseChoice}
            onCustomAddress={setBaseCustom}
            probing={baseProbing}
            probed={baseProbed}
            probeError={baseProbeError}
            excludeAddress={quote?.address ?? null}
          />

          <TokenField
            label="Quote token (the asset it is priced in)"
            tokens={tokens}
            choice={quoteChoice}
            customAddress={quoteCustom}
            onChoice={setQuoteChoice}
            onCustomAddress={setQuoteCustom}
            probing={quoteProbing}
            probed={quoteProbed}
            probeError={quoteProbeError}
            excludeAddress={base?.address ?? null}
          />

          <label className="block">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-400">
              Minimum order size{base ? ` (${base.symbol})` : ""}
            </div>
            <input
              value={minStr}
              onChange={(event) => setMinStr(event.target.value)}
              inputMode="decimal"
              placeholder="0.1"
              className="w-full rounded-md border border-ink-600 bg-ink-850 px-3 py-2.5 font-mono text-base text-white outline-none transition focus:border-accent lg:py-2 lg:text-sm"
            />
            <div className="mt-1 text-[10px] leading-relaxed text-ink-500">
              Orders below this size are rejected; it keeps the book free of
              dust. 0.1 is a sensible default for most tokens.
            </div>
          </label>

          <div className="rounded-md border border-ink-700 bg-ink-850 px-3 py-2.5 text-[11px] leading-relaxed text-ink-400">
            <div className="flex justify-between">
              <span>Estimated network cost</span>
              <span className="font-mono text-white">
                ≈ {formatUnits(manaEstimate, 8, 2)} KOIN of mana
              </span>
            </div>
            {account && availableMana !== null && (
              <div className="mt-1 flex justify-between">
                <span>Your available mana</span>
                <span
                  className={`font-mono ${
                    availableMana < manaEstimate ? "text-down" : "text-ink-300"
                  }`}
                >
                  {formatUnits(availableMana, 8, 2)}
                </span>
              </div>
            )}
            <div className="mt-1.5 text-[10px] text-ink-500">
              Creating a pair is paid with your mana only — no KOIN is spent,
              and mana recharges on its own. Actual usage is usually below the
              estimate.
            </div>
          </div>

          {existingMarket && (
            <button
              onClick={() => {
                selectMarket(existingMarket.marketId);
                close();
              }}
              className="rounded-md border border-ink-600 py-2 text-xs font-semibold text-accent transition hover:border-accent"
            >
              Open {existingMarket.base.symbol}/{existingMarket.quote.symbol}{" "}
              instead
            </button>
          )}

          {!account ? (
            isKondorAvailable() ? (
              <button
                onClick={() => void connect()}
                className="rounded-md bg-accent py-3 text-sm font-bold text-white transition hover:brightness-110 lg:py-2.5"
              >
                Connect Kondor to list a pair
              </button>
            ) : (
              <a
                href="https://chromewebstore.google.com/detail/kondor/ghipkefkpgkladckmlmdnadmcchefhjl"
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-accent py-3 text-center text-sm font-bold text-white transition hover:brightness-110 lg:py-2.5"
              >
                Install Kondor to list a pair
              </a>
            )
          ) : (
            <button
              onClick={() => void submit()}
              disabled={!!validation || submitting}
              className="rounded-md bg-accent py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 lg:py-2.5"
            >
              {submitting
                ? "Submitting…"
                : validation
                  ? validation
                  : `List ${base!.symbol}/${quote!.symbol}`}
            </button>
          )}

          <div className="text-[10px] leading-relaxed text-ink-500">
            Listings are permissionless and permanent: anyone can trade the
            pair once it exists, and it cannot be delisted. Pairs between
            unknown tokens appear under the "Other" tab — always verify token
            addresses before trading.
          </div>
        </div>
      </div>
    </div>
  );
}
