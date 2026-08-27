/**
 * Launchpad client: reads and writes against the launchpad contract, plus the
 * usekoinos token-mint bridge.
 *
 * The contract holds every launch; settlement (finalize, payouts, refunds,
 * lock delivery) is driven automatically by the usekoinos keeper, so this
 * client only ever needs two writes: create_launch and contribute. Both are
 * signed exactly like orders - Kondor or the usekoinos session signer - and
 * escrow pulls are preceded by KCS-4 approve ops the same way order escrow is.
 */
import { Contract, Transaction } from "koilib";
import type { SignerInterface } from "koilib";
import {
  provider,
  getTokenContract,
  getSignerFor,
  probeToken,
  sendOperations,
  type TxHandle,
  type ProbedTokenMeta,
} from "./koinos";
import { toKoilibAbi } from "./abi";
import launchpadAbiJson from "./launchpad-abi.json";
import { launchpadAddress } from "../config/launchpad";
import { TOKENS } from "../config/tokens";
import { SIGNER_API } from "../config/signer";

export const MODE_FIXED = 0;
export const MODE_POOL = 1;
export const UNSOLD_RETURN = 0;
export const UNSOLD_BURN = 1;

export const STATUS_ACTIVE = 0;
export const STATUS_DISTRIBUTING = 1;
export const STATUS_COMPLETED = 2;
export const STATUS_REFUNDING = 3;
export const STATUS_CANCELED = 4;

/** KOIN units per 1e8 token units - the contract's price convention */
export const LAUNCH_PRICE_SCALE = 100000000n;

export interface LaunchInfo {
  id: number;
  creator: string;
  token: string;
  tokenMeta: ProbedTokenMeta | null;
  mode: number;
  price: bigint;
  forSale: bigint;
  locked: bigint;
  unlockTime: number;
  startTime: number;
  endTime: number;
  softCap: bigint;
  hardCap: bigint;
  unsoldAction: number;
  status: number;
  raised: bigint;
  sold: bigint;
  buyerCount: number;
  cursor: number;
  distributed: bigint;
  refunded: bigint;
  lockedClaimed: boolean;
  createdAt: number;
}

export interface ContributionInfo {
  koin: bigint;
  tokens: bigint;
  settled: boolean;
}

/** UI phase, derived from on-chain status + the clock */
export type LaunchPhase =
  | "upcoming"
  | "live"
  | "ended" // past end, keeper has not finalized yet
  | "distributing"
  | "completed"
  | "refunding"
  | "canceled";

export function launchPhase(launch: LaunchInfo, now = Date.now()): LaunchPhase {
  switch (launch.status) {
    case STATUS_DISTRIBUTING:
      return "distributing";
    case STATUS_COMPLETED:
      return "completed";
    case STATUS_REFUNDING:
      return "refunding";
    case STATUS_CANCELED:
      return "canceled";
    default: {
      if (now < launch.startTime) return "upcoming";
      const soldOut =
        launch.mode === MODE_FIXED && launch.sold >= launch.forSale;
      if (now >= launch.endTime || soldOut) return "ended";
      return "live";
    }
  }
}

const launchpadAbi = toKoilibAbi(launchpadAbiJson as any);

export function getLaunchpadContract(signer?: SignerInterface): Contract {
  return new Contract({
    id: launchpadAddress(),
    abi: launchpadAbi,
    provider,
    ...(signer ? { signer } : {}),
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function asBigInt(value: unknown): bigint {
  if (value === undefined || value === null || value === "") return 0n;
  return BigInt(String(value));
}

function asNumber(value: unknown): number {
  return Number(value ?? 0);
}

const tokenMetaCache = new Map<string, ProbedTokenMeta | null>();

async function tokenMetaFor(address: string): Promise<ProbedTokenMeta | null> {
  // curated tokens answer instantly; everything else is probed once
  const curated = TOKENS.find((token) => token.address === address);
  if (curated) {
    return {
      symbol: curated.symbol,
      name: curated.name,
      decimals: curated.decimals,
      allowances: curated.allowances,
    };
  }
  if (tokenMetaCache.has(address)) return tokenMetaCache.get(address)!;
  const meta = await probeToken(address);
  tokenMetaCache.set(address, meta);
  return meta;
}

async function parseLaunch(raw: any): Promise<LaunchInfo> {
  const token = String(raw.token || "");
  return {
    id: asNumber(raw.id),
    creator: String(raw.creator || ""),
    token,
    tokenMeta: await tokenMetaFor(token),
    mode: asNumber(raw.mode),
    price: asBigInt(raw.price),
    forSale: asBigInt(raw.forSaleAmount),
    locked: asBigInt(raw.lockedAmount),
    unlockTime: asNumber(raw.unlockTime),
    startTime: asNumber(raw.startTime),
    endTime: asNumber(raw.endTime),
    softCap: asBigInt(raw.softCap),
    hardCap: asBigInt(raw.hardCap),
    unsoldAction: asNumber(raw.unsoldAction),
    status: asNumber(raw.status),
    raised: asBigInt(raw.raised),
    sold: asBigInt(raw.sold),
    buyerCount: asNumber(raw.buyerCount),
    cursor: asNumber(raw.cursor),
    distributed: asBigInt(raw.distributed),
    refunded: asBigInt(raw.refunded),
    lockedClaimed: !!raw.lockedClaimed,
    createdAt: asNumber(raw.createdAt),
  };
}

export function launchpadEnabled(): boolean {
  return !!launchpadAddress();
}

export async function fetchLaunches(): Promise<LaunchInfo[]> {
  if (!launchpadEnabled()) return [];
  const contract = getLaunchpadContract();
  const all: LaunchInfo[] = [];
  let start = 0;
  for (;;) {
    const { result } = await contract.functions.get_launches({
      start,
      limit: 100,
    });
    const page: any[] = (result?.launches as any[]) || [];
    for (const raw of page) all.push(await parseLaunch(raw));
    if (page.length < 100) break;
    start = asNumber(page[page.length - 1].id);
  }
  // newest first
  all.sort((a, b) => b.id - a.id);
  return all;
}

export async function fetchLaunch(id: number): Promise<LaunchInfo | null> {
  if (!launchpadEnabled()) return null;
  const { result } = await getLaunchpadContract().functions.get_launch({
    launchId: id,
  });
  const raw = result?.value;
  if (!raw) return null;
  return parseLaunch(raw);
}

export async function fetchContribution(
  launchId: number,
  buyer: string
): Promise<ContributionInfo | null> {
  if (!launchpadEnabled()) return null;
  const { result } = await getLaunchpadContract().functions.get_contribution({
    launchId,
    buyer,
  });
  const raw: any = result?.value;
  if (!raw) return null;
  return {
    koin: asBigInt(raw.koin),
    tokens: asBigInt(raw.tokens),
    settled: !!raw.settled,
  };
}

// ---------------------------------------------------------------------------
// Writes (create + contribute; settlement is the keeper's job)
// ---------------------------------------------------------------------------

const KOIN = TOKENS.find((token) => token.symbol === "KOIN")!;

export interface CreateLaunchParams {
  creator: string;
  token: string;
  tokenAllowances: boolean;
  mode: number;
  /** KOIN units per 1e8 token units; 0 in POOL mode */
  price: bigint;
  forSale: bigint;
  locked: bigint;
  unlockTime: number; // ms epoch; ignored when locked == 0
  startTime: number; // ms epoch
  endTime: number; // ms epoch
  softCap: bigint;
  hardCap: bigint; // POOL only; FIXED computes its own
  unsoldAction: number;
}

export async function createLaunch(
  params: CreateLaunchParams
): Promise<TxHandle> {
  const launchpad = getLaunchpadContract();
  const escrow = params.forSale + params.locked;
  const operations: { pushTo: (tx: Transaction) => Promise<void> }[] = [];

  if (params.tokenAllowances) {
    const token = getTokenContract(params.token);
    operations.push({
      pushTo: async (tx) => {
        await tx.pushOperation(token.functions.approve, {
          owner: params.creator,
          spender: launchpadAddress(),
          value: escrow.toString(),
        });
      },
    });
  }
  operations.push({
    pushTo: async (tx) => {
      await tx.pushOperation(launchpad.functions.create_launch, {
        creator: params.creator,
        token: params.token,
        mode: params.mode,
        price: params.price.toString(),
        forSaleAmount: params.forSale.toString(),
        lockedAmount: params.locked.toString(),
        unlockTime: String(params.locked > 0n ? params.unlockTime : 0),
        startTime: String(params.startTime),
        endTime: String(params.endTime),
        softCap: params.softCap.toString(),
        hardCap: params.hardCap.toString(),
        unsoldAction: params.unsoldAction,
      });
    },
  });

  return sendOperations(params.creator, operations);
}

export async function contribute(
  buyer: string,
  launchId: number,
  amount: bigint
): Promise<TxHandle> {
  const launchpad = getLaunchpadContract();
  const koinToken = getTokenContract(KOIN.address);
  const operations: { pushTo: (tx: Transaction) => Promise<void> }[] = [];

  // KOIN is a KCS-4 allowance token: the contract's escrow pull needs approval
  operations.push({
    pushTo: async (tx) => {
      await tx.pushOperation(koinToken.functions.approve, {
        owner: buyer,
        spender: launchpadAddress(),
        value: amount.toString(),
      });
    },
  });
  operations.push({
    pushTo: async (tx) => {
      await tx.pushOperation(launchpad.functions.contribute, {
        launchId,
        buyer,
        amount: amount.toString(),
      });
    },
  });

  return sendOperations(buyer, operations);
}

// ---------------------------------------------------------------------------
// Token mint (via usekoinos - the sponsor deploys the token contract)
// ---------------------------------------------------------------------------

export interface MintTokenParams {
  name: string;
  symbol: string;
  decimals: number;
  supply: string; // whole tokens, as typed
  mintable: boolean;
  /** signer session token (Google users) - preferred */
  sessionToken?: string | null;
  /** Kondor users prove ownership by signing a message instead */
  kondorAddress?: string | null;
}

export interface MintedToken {
  address: string;
  txid: string;
}

export async function mintTokenViaUsekoinos(
  params: MintTokenParams
): Promise<MintedToken> {
  if (!SIGNER_API) throw new Error("Token minting is not configured");

  const body: Record<string, unknown> = {
    name: params.name,
    symbol: params.symbol,
    decimals: params.decimals,
    supply: params.supply,
    mintable: params.mintable,
  };

  if (params.sessionToken) {
    body.sessionToken = params.sessionToken;
  } else if (params.kondorAddress) {
    // the usekoinos proof: sha256(message) signed by the account key
    const ts = Date.now();
    const message = `discover-koinos:launch-token:${ts}`;
    const signer = getSignerFor(params.kondorAddress);
    const signature = await (signer as any).signMessage(message);
    body.address = params.kondorAddress;
    body.ts = ts;
    body.sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  } else {
    throw new Error("Sign in before minting a token");
  }

  let response: Response;
  try {
    response = await fetch(`${SIGNER_API}/api/launch-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000), // a deploy is two mined transactions
    });
  } catch {
    throw new Error("Could not reach the mint service — try again shortly");
  }
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    // fall through
  }
  if (!response.ok || !data?.address) {
    throw new Error(data?.error || "Token mint failed");
  }
  return { address: String(data.address), txid: String(data.txid || "") };
}
