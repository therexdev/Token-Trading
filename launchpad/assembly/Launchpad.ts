import {
  System,
  Protobuf,
  authority,
  chain,
  kcs4,
  Token,
  Base58,
  u128,
} from "@koinos/sdk-as";
import { launchpad } from "./proto/launchpad";

// Sale modes
const MODE_FIXED: u32 = 0;
const MODE_POOL: u32 = 1;

// What happens to unsold tokens / pro-rata dust on a successful launch
const UNSOLD_RETURN: u32 = 0;
const UNSOLD_BURN: u32 = 1;

// Launch statuses
const STATUS_ACTIVE: u32 = 0;
const STATUS_DISTRIBUTING: u32 = 1;
const STATUS_COMPLETED: u32 = 2;
const STATUS_REFUNDING: u32 = 3;
const STATUS_CANCELED: u32 = 4;

// Prices are expressed in KOIN units per 1e8 token base units (the same
// convention the orderbook uses)
const PRICE_SCALE: u64 = 100000000;

// Payment token: mainnet KOIN. Baked in deliberately - accepting an arbitrary
// "payment token" per launch would let a creator take payment in a token whose
// transfers lie.
const KOIN_B58: string = "19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK";

// KoinDX periphery (router) on mainnet, and its entry points - taken from
// @koindx/v2-sdk 1.3.0. Token addresses travel as base58 STRINGS there.
const DEX_PERIPHERY_B58: string = "17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s";
const DEX_GET_PAIR_ENTRY: u32 = 4024190401;
const DEX_CREATE_PAIR_ENTRY: u32 = 678105445;
const DEX_ADD_LIQUIDITY_ENTRY: u32 = 117856717;

// Liquidity lifecycle
const LIQ_NONE: u32 = 0;
const LIQ_PENDING: u32 = 1;
const LIQ_PROVIDED: u32 = 2;
const LIQ_RECLAIMED: u32 = 3;

// A fresh pair takes the deposit at exactly the desired ratio; the 2% slack
// only matters when someone pre-seeded the pair at a nearby price.
const LIQ_MIN_BPS: u64 = 9800;

// How long provide_liquidity gets retried before the creator may reclaim the
// earmarked KOIN + tokens (a pre-seeded hostile pair could block adds forever)
const RECLAIM_GRACE_MS: u64 = 604800000; // 7 days

// KCS-4 decimals() entry point id (see @koinos/sdk-as Token)
const TOKEN_DECIMALS_ENTRY: u32 = 0xee80fd2f;

// Bound the amount of transfer work a single process() call can do
const DEFAULT_PROCESS_LIMIT: u32 = 20;
const MAX_PROCESS_LIMIT: u32 = 30;

// Read limits
const DEFAULT_LIST_LIMIT: u32 = 50;
const MAX_LIST_LIMIT: u32 = 100;

// Sanity bounds on schedules, in milliseconds (block timestamps are ms)
const MS_PER_DAY: u64 = 86400000;
const MAX_SALE_DURATION: u64 = 365 * MS_PER_DAY;
const MAX_LOCK_AFTER_END: u64 = 3650 * MS_PER_DAY; // 10 years

// Storage space ids
const SPACE_GLOBAL: u32 = 0;
const SPACE_LAUNCHES: u32 = 1;
const SPACE_CONTRIBUTIONS: u32 = 2;
const SPACE_BUYERS: u32 = 3;

const GLOBAL_KEY: Uint8Array = new Uint8Array(0);

function u32ToBytesBE(value: u32): Uint8Array {
  const buffer = new Uint8Array(4);
  buffer[0] = u8((value >> 24) & 0xff);
  buffer[1] = u8((value >> 16) & 0xff);
  buffer[2] = u8((value >> 8) & 0xff);
  buffer[3] = u8(value & 0xff);
  return buffer;
}

function concat2(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * floor(a * b / den) with 128-bit intermediate math
 */
function mulDivFloor(a: u64, b: u64, den: u64): u64 {
  const product = u128.fromU64(a) * u128.fromU64(b);
  const quotient = product / u128.fromU64(den);
  System.require(quotient.hi == 0, "launchpad: amount overflow");
  return quotient.lo;
}

/**
 * ceil(a * b / den) with 128-bit intermediate math
 */
function mulDivCeil(a: u64, b: u64, den: u64): u64 {
  const product = u128.fromU64(a) * u128.fromU64(b) + u128.fromU64(den - 1);
  const quotient = product / u128.fromU64(den);
  System.require(quotient.hi == 0, "launchpad: amount overflow");
  return quotient.lo;
}

export class Launchpad {
  contractId: Uint8Array = System.getContractId();

  private space(id: u32): chain.object_space {
    return new chain.object_space(false, this.contractId, id);
  }

  private koin(): Token {
    return new Token(Base58.decode(KOIN_B58));
  }

  // -------------------------------------------------------------------------
  // State helpers
  // -------------------------------------------------------------------------

  private getGlobalState(): launchpad.global_state {
    const state = System.getObject<Uint8Array, launchpad.global_state>(
      this.space(SPACE_GLOBAL),
      GLOBAL_KEY,
      launchpad.global_state.decode
    );
    if (state) return state;

    const fresh = new launchpad.global_state();
    fresh.next_launch_id = 1;
    return fresh;
  }

  private saveGlobalState(state: launchpad.global_state): void {
    System.putObject(
      this.space(SPACE_GLOBAL),
      GLOBAL_KEY,
      state,
      launchpad.global_state.encode
    );
  }

  private getLaunch(id: u32): launchpad.launch_object | null {
    return System.getObject<Uint8Array, launchpad.launch_object>(
      this.space(SPACE_LAUNCHES),
      u32ToBytesBE(id),
      launchpad.launch_object.decode
    );
  }

  private saveLaunch(launch: launchpad.launch_object): void {
    System.putObject(
      this.space(SPACE_LAUNCHES),
      u32ToBytesBE(launch.id),
      launch,
      launchpad.launch_object.encode
    );
  }

  private contributionKey(launchId: u32, buyer: Uint8Array): Uint8Array {
    return concat2(u32ToBytesBE(launchId), buyer);
  }

  private getContribution(
    launchId: u32,
    buyer: Uint8Array
  ): launchpad.contribution_object | null {
    return System.getObject<Uint8Array, launchpad.contribution_object>(
      this.space(SPACE_CONTRIBUTIONS),
      this.contributionKey(launchId, buyer),
      launchpad.contribution_object.decode
    );
  }

  private saveContribution(entry: launchpad.contribution_object): void {
    System.putObject(
      this.space(SPACE_CONTRIBUTIONS),
      this.contributionKey(entry.launch_id, entry.buyer!),
      entry,
      launchpad.contribution_object.encode
    );
  }

  private buyerKey(launchId: u32, seq: u32): Uint8Array {
    return concat2(u32ToBytesBE(launchId), u32ToBytesBE(seq));
  }

  private getBuyerAt(launchId: u32, seq: u32): Uint8Array | null {
    return System.getBytes(this.space(SPACE_BUYERS), this.buyerKey(launchId, seq));
  }

  private blockTimestamp(): u64 {
    const field = System.getBlockField("header.timestamp");
    if (!field) return 0;
    return field.uint64_value;
  }

  /**
   * decimals() of a token contract, failing the transaction with a clear
   * message when the address does not answer like one (no contract there,
   * a non-token contract, or a retired system-locked token).
   */
  private requireTokenDecimals(token: Uint8Array): u32 {
    const callRes = System.call(token, TOKEN_DECIMALS_ENTRY, new Uint8Array(0));
    System.require(
      callRes.code == 0,
      "launchpad: token does not answer decimals() - not a live token contract"
    );
    const buffer = callRes.res.object;
    if (!buffer) return 0;
    return Protobuf.decode<kcs4.decimals_result>(
      buffer,
      kcs4.decimals_result.decode
    ).value;
  }

  /**
   * Dispose of unsold tokens / pro-rata dust per the launch's unsold_action.
   * Burning needs the token contract to implement KCS-4 burn; when it does
   * not (burn returns false), the tokens go back to the creator instead of
   * bricking settlement.
   */
  private disposeUnsold(launch: launchpad.launch_object, amount: u64): void {
    if (amount == 0) return;
    const token = new Token(launch.token!);
    if (launch.unsold_action == UNSOLD_BURN) {
      if (token.burn(this.contractId, amount)) return;
    }
    System.require(
      token.transfer(this.contractId, launch.creator!, amount),
      "launchpad: unsold token return failed"
    );
  }

  // -------------------------------------------------------------------------
  // Entry points
  // -------------------------------------------------------------------------

  create_launch(
    args: launchpad.create_launch_arguments
  ): launchpad.create_launch_result {
    System.require(
      args.creator != null && args.creator!.length > 0,
      "launchpad: missing creator"
    );
    System.require(
      args.token != null && args.token!.length > 0,
      "launchpad: missing token"
    );
    const creator = args.creator!;
    const tokenAddress = args.token!;

    System.require(
      args.mode == MODE_FIXED || args.mode == MODE_POOL,
      "launchpad: invalid mode"
    );
    System.require(
      args.unsold_action == UNSOLD_RETURN || args.unsold_action == UNSOLD_BURN,
      "launchpad: invalid unsold_action"
    );
    System.require(
      args.for_sale_amount > 0,
      "launchpad: for_sale_amount must be positive"
    );

    // the sale token must behave like a live token contract, and cannot be
    // KOIN itself (selling KOIN for KOIN is at best confusion)
    const koinAddress = Base58.decode(KOIN_B58);
    let sameAsKoin = tokenAddress.length == koinAddress.length;
    if (sameAsKoin) {
      for (let i = 0; i < tokenAddress.length; i++) {
        if (tokenAddress[i] != koinAddress[i]) {
          sameAsKoin = false;
          break;
        }
      }
    }
    System.require(!sameAsKoin, "launchpad: the sale token cannot be KOIN");
    this.requireTokenDecimals(tokenAddress);

    // schedule sanity (timestamps in ms; start may be past = live now)
    const now = this.blockTimestamp();
    System.require(args.end_time > now, "launchpad: end_time is in the past");
    System.require(
      args.end_time > args.start_time,
      "launchpad: end_time must be after start_time"
    );
    const effectiveStart = args.start_time > now ? args.start_time : now;
    System.require(
      args.end_time - effectiveStart <= MAX_SALE_DURATION,
      "launchpad: sale cannot run longer than a year"
    );
    if (args.locked_amount > 0) {
      System.require(
        args.unlock_time >= args.end_time,
        "launchpad: unlock_time must not be before end_time"
      );
      System.require(
        args.unlock_time - args.end_time <= MAX_LOCK_AFTER_END,
        "launchpad: lock cannot run longer than 10 years past the end"
      );
    }

    // price / cap rules per mode
    let hardCap = args.hard_cap;
    if (args.mode == MODE_FIXED) {
      System.require(args.price > 0, "launchpad: FIXED mode needs a price");
      // the KOIN value of selling everything - stored as the hard cap so the
      // UI can show progress; also the ceiling any soft cap must fit under
      hardCap = mulDivCeil(args.for_sale_amount, args.price, PRICE_SCALE);
      System.require(
        hardCap > 0,
        "launchpad: for_sale_amount is worth less than one KOIN unit"
      );
    } else {
      System.require(args.price == 0, "launchpad: POOL mode takes no price");
    }
    if (args.soft_cap > 0 && hardCap > 0) {
      System.require(
        args.soft_cap <= hardCap,
        "launchpad: soft_cap above the hard cap can never be reached"
      );
    }

    // auto-liquidity terms
    System.require(
      args.liquidity_bps <= 10000,
      "launchpad: liquidity_bps cannot exceed 10000 (100%)"
    );
    if (args.liquidity_bps > 0) {
      System.require(
        args.liquidity_tokens > 0,
        "launchpad: liquidity needs a token amount"
      );
      System.require(
        args.lp_unlock_time >= args.end_time,
        "launchpad: lp_unlock_time must not be before end_time"
      );
      System.require(
        args.lp_unlock_time - args.end_time <= MAX_LOCK_AFTER_END,
        "launchpad: LP lock cannot run longer than 10 years past the end"
      );
    } else {
      System.require(
        args.liquidity_tokens == 0,
        "launchpad: liquidity_tokens without liquidity_bps"
      );
    }

    // the creator must have authorized this call: their tokens are escrowed
    System.requireAuthority(authority.authorization_type.contract_call, creator);

    let escrowTotal = args.for_sale_amount + args.locked_amount;
    System.require(
      escrowTotal >= args.for_sale_amount,
      "launchpad: escrow overflow"
    );
    escrowTotal += args.liquidity_tokens;
    System.require(
      escrowTotal >= args.liquidity_tokens,
      "launchpad: escrow overflow"
    );
    const token = new Token(tokenAddress);
    System.require(
      token.transfer(creator, this.contractId, escrowTotal),
      "launchpad: token escrow transfer failed (check balance/authority)"
    );

    const state = this.getGlobalState();
    const launch = new launchpad.launch_object();
    launch.id = state.next_launch_id;
    state.next_launch_id += 1;
    launch.creator = creator;
    launch.token = tokenAddress;
    launch.mode = args.mode;
    launch.price = args.price;
    launch.for_sale_amount = args.for_sale_amount;
    launch.locked_amount = args.locked_amount;
    launch.unlock_time = args.locked_amount > 0 ? args.unlock_time : 0;
    launch.start_time = args.start_time;
    launch.end_time = args.end_time;
    launch.soft_cap = args.soft_cap;
    launch.hard_cap = hardCap;
    launch.unsold_action = args.unsold_action;
    launch.status = STATUS_ACTIVE;
    launch.raised = 0;
    launch.sold = 0;
    launch.buyer_count = 0;
    launch.cursor = 0;
    launch.distributed = 0;
    launch.refunded = 0;
    launch.locked_claimed = false;
    launch.created_at = now;
    launch.liquidity_bps = args.liquidity_bps;
    launch.liquidity_tokens = args.liquidity_tokens;
    launch.lp_unlock_time = args.liquidity_bps > 0 ? args.lp_unlock_time : 0;
    launch.liquidity_state = args.liquidity_bps > 0 ? LIQ_PENDING : LIQ_NONE;
    launch.pair = new Uint8Array(0);
    launch.lp_amount = 0;
    launch.lp_claimed = false;
    launch.liquidity_koin = 0;

    this.saveLaunch(launch);
    this.saveGlobalState(state);

    const createdEvent = new launchpad.launch_created_event();
    createdEvent.launch = launch;
    const impacted: Uint8Array[] = [creator];
    System.event(
      "launchpad.launch_created",
      Protobuf.encode(createdEvent, launchpad.launch_created_event.encode),
      impacted
    );

    const result = new launchpad.create_launch_result();
    result.launch_id = launch.id;
    return result;
  }

  contribute(
    args: launchpad.contribute_arguments
  ): launchpad.contribute_result {
    System.require(
      args.buyer != null && args.buyer!.length > 0,
      "launchpad: missing buyer"
    );
    const buyer = args.buyer!;
    System.require(args.amount > 0, "launchpad: amount must be positive");

    const found = this.getLaunch(args.launch_id);
    System.require(found != null, "launchpad: unknown launch");
    const launch = found!;

    System.require(
      launch.status == STATUS_ACTIVE,
      "launchpad: launch is not accepting contributions"
    );
    const now = this.blockTimestamp();
    System.require(
      now >= launch.start_time,
      "launchpad: launch has not started yet"
    );
    System.require(now < launch.end_time, "launchpad: launch has ended");

    System.requireAuthority(authority.authorization_type.contract_call, buyer);

    let paid: u64 = 0;
    let tokensOut: u64 = 0;

    if (launch.mode == MODE_FIXED) {
      const remaining = launch.for_sale_amount - launch.sold;
      System.require(remaining > 0, "launchpad: sold out");
      // tokens the offered KOIN can buy at the flat price, capped by stock;
      // charge the exact ceil cost of what is granted (never more than the
      // offer: floor(amount*S/p) tokens cost at most `amount` even ceiled)
      tokensOut = mulDivFloor(args.amount, PRICE_SCALE, launch.price);
      System.require(
        tokensOut > 0,
        "launchpad: amount buys less than one token unit"
      );
      if (tokensOut > remaining) tokensOut = remaining;
      paid = mulDivCeil(tokensOut, launch.price, PRICE_SCALE);
      launch.sold += tokensOut;
    } else {
      paid = args.amount;
      if (launch.hard_cap > 0) {
        const room = launch.hard_cap - launch.raised;
        System.require(room > 0, "launchpad: hard cap reached");
        if (paid > room) paid = room;
      }
    }

    System.require(
      this.koin().transfer(buyer, this.contractId, paid),
      "launchpad: KOIN transfer failed (check balance/authority)"
    );
    launch.raised += paid;

    let entry = this.getContribution(launch.id, buyer);
    if (!entry) {
      entry = new launchpad.contribution_object();
      entry.launch_id = launch.id;
      entry.buyer = buyer;
      entry.koin = 0;
      entry.tokens = 0;
      entry.settled = false;
      entry.seq = launch.buyer_count;
      System.putBytes(
        this.space(SPACE_BUYERS),
        this.buyerKey(launch.id, launch.buyer_count),
        buyer
      );
      launch.buyer_count += 1;
    }
    entry.koin += paid;
    entry.tokens += tokensOut;
    this.saveContribution(entry);
    this.saveLaunch(launch);

    const event = new launchpad.contribution_event();
    event.launch_id = launch.id;
    event.buyer = buyer;
    event.paid = paid;
    event.tokens = tokensOut;
    event.raised = launch.raised;
    const impacted: Uint8Array[] = [buyer];
    System.event(
      "launchpad.contribution",
      Protobuf.encode(event, launchpad.contribution_event.encode),
      impacted
    );

    const result = new launchpad.contribute_result();
    result.paid = paid;
    result.tokens = tokensOut;
    return result;
  }

  finalize(args: launchpad.finalize_arguments): launchpad.finalize_result {
    const found = this.getLaunch(args.launch_id);
    System.require(found != null, "launchpad: unknown launch");
    const launch = found!;

    System.require(
      launch.status == STATUS_ACTIVE,
      "launchpad: launch already finalized"
    );

    const now = this.blockTimestamp();
    const soldOut =
      launch.mode == MODE_FIXED && launch.sold >= launch.for_sale_amount;
    System.require(
      now >= launch.end_time || soldOut,
      "launchpad: launch is still running"
    );

    const succeeded = launch.raised > 0 && launch.raised >= launch.soft_cap;

    if (succeeded) {
      // the creator receives the raise minus the share earmarked for KoinDX
      // liquidity (paired later by provide_liquidity); no platform fee.
      // KOIN is a system token, so this cannot re-enter user code
      if (launch.liquidity_bps > 0) {
        launch.liquidity_koin = mulDivFloor(
          launch.raised,
          u64(launch.liquidity_bps),
          10000
        );
      }
      const creatorKoin = launch.raised - launch.liquidity_koin;
      if (creatorKoin > 0) {
        System.require(
          this.koin().transfer(this.contractId, launch.creator!, creatorKoin),
          "launchpad: KOIN payout to creator failed"
        );
      }
      if (launch.mode == MODE_FIXED) {
        const unsold = launch.for_sale_amount - launch.sold;
        this.disposeUnsold(launch, unsold);
      }
      launch.status =
        launch.buyer_count > 0 ? STATUS_DISTRIBUTING : STATUS_COMPLETED;
    } else {
      // canceled: every escrowed token goes straight back to the creator
      // (for-sale, locked AND the liquidity earmark - a canceled launch
      // holds nothing hostage); the buyers' KOIN goes back through
      // process() batches
      const escrowTotal =
        launch.for_sale_amount + launch.locked_amount + launch.liquidity_tokens;
      System.require(
        new Token(launch.token!).transfer(
          this.contractId,
          launch.creator!,
          escrowTotal
        ),
        "launchpad: token return to creator failed"
      );
      launch.locked_claimed = true; // nothing left to claim later
      launch.liquidity_state = LIQ_NONE; // earmark returned with the rest
      launch.status =
        launch.buyer_count > 0 ? STATUS_REFUNDING : STATUS_CANCELED;
    }
    launch.cursor = 0;
    this.saveLaunch(launch);

    const event = new launchpad.launch_finalized_event();
    event.launch_id = launch.id;
    event.status = launch.status;
    event.raised = launch.raised;
    event.sold = launch.sold;
    const impacted: Uint8Array[] = [launch.creator!];
    System.event(
      "launchpad.launch_finalized",
      Protobuf.encode(event, launchpad.launch_finalized_event.encode),
      impacted
    );

    const result = new launchpad.finalize_result();
    result.status = launch.status;
    return result;
  }

  process(args: launchpad.process_arguments): launchpad.process_result {
    const found = this.getLaunch(args.launch_id);
    System.require(found != null, "launchpad: unknown launch");
    const launch = found!;

    System.require(
      launch.status == STATUS_DISTRIBUTING ||
        launch.status == STATUS_REFUNDING,
      "launchpad: nothing to process"
    );

    let limit = args.limit == 0 ? DEFAULT_PROCESS_LIMIT : args.limit;
    if (limit > MAX_PROCESS_LIMIT) limit = MAX_PROCESS_LIMIT;

    const distributing = launch.status == STATUS_DISTRIBUTING;
    const token = new Token(launch.token!);
    let settled: u32 = 0;

    while (settled < limit && launch.cursor < launch.buyer_count) {
      const buyer = this.getBuyerAt(launch.id, launch.cursor);
      System.require(buyer != null, "launchpad: corrupt buyer index");
      const entryFound = this.getContribution(launch.id, buyer!);
      System.require(entryFound != null, "launchpad: corrupt contribution");
      const entry = entryFound!;

      // advance and PERSIST state before the external transfer: a token
      // contract that re-enters process() mid-batch then reads the already-
      // updated cursor and settled flags instead of replaying payouts (it
      // could only over-draw its own escrow and fail its own launch, but
      // there is no reason to even allow that). A failed transfer still
      // reverts the whole batch atomically.
      launch.cursor += 1;

      if (!entry.settled) {
        entry.settled = true;
        let owed: u64 = 0;
        if (distributing) {
          if (launch.mode == MODE_FIXED) {
            owed = entry.tokens;
          } else {
            // pro-rata: this buyer's share of the pool, floored; the dust
            // left by flooring follows unsold_action at the end
            owed = mulDivFloor(
              launch.for_sale_amount,
              entry.koin,
              launch.raised
            );
            entry.tokens = owed;
          }
          launch.distributed += owed;
        } else {
          launch.refunded += entry.koin;
        }
        this.saveContribution(entry);
        this.saveLaunch(launch);

        if (distributing) {
          if (owed > 0) {
            System.require(
              token.transfer(this.contractId, entry.buyer!, owed),
              "launchpad: token payout failed"
            );
          }
        } else if (entry.koin > 0) {
          System.require(
            this.koin().transfer(this.contractId, entry.buyer!, entry.koin),
            "launchpad: KOIN refund failed"
          );
        }
        settled += 1;
      } else {
        this.saveLaunch(launch);
      }
    }

    if (launch.cursor >= launch.buyer_count) {
      if (distributing) {
        // pro-rata flooring leaves dust; FIXED leaves none (unsold was
        // handled at finalize)
        const dust = launch.for_sale_amount > launch.distributed &&
          launch.mode == MODE_POOL
          ? launch.for_sale_amount - launch.distributed
          : 0;
        this.disposeUnsold(launch, dust);
        launch.status = STATUS_COMPLETED;
      } else {
        launch.status = STATUS_CANCELED;
      }
      const done = new launchpad.launch_settled_event();
      done.launch_id = launch.id;
      done.status = launch.status;
      const impacted: Uint8Array[] = [launch.creator!];
      System.event(
        "launchpad.launch_settled",
        Protobuf.encode(done, launchpad.launch_settled_event.encode),
        impacted
      );
    }
    this.saveLaunch(launch);

    const result = new launchpad.process_result();
    result.settled = settled;
    result.pending =
      launch.buyer_count > launch.cursor
        ? launch.buyer_count - launch.cursor
        : 0;
    result.status = launch.status;
    return result;
  }

  claim_locked(
    args: launchpad.claim_locked_arguments
  ): launchpad.claim_locked_result {
    const found = this.getLaunch(args.launch_id);
    System.require(found != null, "launchpad: unknown launch");
    const launch = found!;

    System.require(
      launch.status == STATUS_COMPLETED,
      "launchpad: launch is not completed"
    );
    System.require(
      launch.locked_amount > 0 && !launch.locked_claimed,
      "launchpad: nothing locked to claim"
    );
    System.require(
      this.blockTimestamp() >= launch.unlock_time,
      "launchpad: still locked"
    );

    // callable by anyone (the keeper auto-delivers); the destination is
    // always the creator, so there is nothing a stranger can redirect
    launch.locked_claimed = true;
    this.saveLaunch(launch);
    System.require(
      new Token(launch.token!).transfer(
        this.contractId,
        launch.creator!,
        launch.locked_amount
      ),
      "launchpad: locked token transfer failed"
    );

    const event = new launchpad.locked_claimed_event();
    event.launch_id = launch.id;
    event.creator = launch.creator;
    event.amount = launch.locked_amount;
    const impacted: Uint8Array[] = [launch.creator!];
    System.event(
      "launchpad.locked_claimed",
      Protobuf.encode(event, launchpad.locked_claimed_event.encode),
      impacted
    );

    return new launchpad.claim_locked_result();
  }

  cancel_launch(
    args: launchpad.cancel_launch_arguments
  ): launchpad.cancel_launch_result {
    const found = this.getLaunch(args.launch_id);
    System.require(found != null, "launchpad: unknown launch");
    const launch = found!;

    System.require(
      launch.status == STATUS_ACTIVE,
      "launchpad: launch already settled"
    );
    // once the window has closed the sale settles by its published terms -
    // a creator cannot yank a successful raise away from its buyers
    System.require(
      this.blockTimestamp() < launch.end_time,
      "launchpad: the sale has ended - it settles by its terms now"
    );
    System.requireAuthority(
      authority.authorization_type.contract_call,
      launch.creator!
    );

    // identical to the below-soft-cap path of finalize: every escrowed token
    // straight back to the creator, buyers refunded through process() batches
    const escrowTotal =
      launch.for_sale_amount + launch.locked_amount + launch.liquidity_tokens;
    System.require(
      new Token(launch.token!).transfer(
        this.contractId,
        launch.creator!,
        escrowTotal
      ),
      "launchpad: token return to creator failed"
    );
    launch.locked_claimed = true;
    launch.liquidity_state = LIQ_NONE;
    launch.status =
      launch.buyer_count > 0 ? STATUS_REFUNDING : STATUS_CANCELED;
    launch.cursor = 0;
    this.saveLaunch(launch);

    const event = new launchpad.launch_finalized_event();
    event.launch_id = launch.id;
    event.status = launch.status;
    event.raised = launch.raised;
    event.sold = launch.sold;
    const impacted: Uint8Array[] = [launch.creator!];
    System.event(
      "launchpad.launch_finalized",
      Protobuf.encode(event, launchpad.launch_finalized_event.encode),
      impacted
    );

    const result = new launchpad.cancel_launch_result();
    result.status = launch.status;
    return result;
  }

  provide_liquidity(
    args: launchpad.provide_liquidity_arguments
  ): launchpad.provide_liquidity_result {
    const found = this.getLaunch(args.launch_id);
    System.require(found != null, "launchpad: unknown launch");
    const launch = found!;

    System.require(
      launch.liquidity_state == LIQ_PENDING,
      "launchpad: no liquidity pending on this launch"
    );
    System.require(
      launch.status == STATUS_DISTRIBUTING ||
        launch.status == STATUS_COMPLETED,
      "launchpad: launch has not settled successfully"
    );
    System.require(
      launch.liquidity_koin > 0,
      "launchpad: nothing was raised for liquidity"
    );

    const periphery = Base58.decode(DEX_PERIPHERY_B58);
    const tokenB58 = Base58.encode(launch.token!);
    const token = new Token(launch.token!);

    // allow the router to pull both sides from this contract
    System.require(
      this.koin().approve(this.contractId, periphery, launch.liquidity_koin),
      "launchpad: KOIN approve for KoinDX failed"
    );
    System.require(
      token.approve(this.contractId, periphery, launch.liquidity_tokens),
      "launchpad: token approve for KoinDX failed"
    );

    // create the pair if it does not exist yet (idempotent on KoinDX's side;
    // a failure here only matters if add_liquidity then fails too)
    const pairArgs = new launchpad.dex_pair_call();
    pairArgs.token_a = KOIN_B58;
    pairArgs.token_b = tokenB58;
    const pairArgsBytes = Protobuf.encode(
      pairArgs,
      launchpad.dex_pair_call.encode
    );
    System.call(periphery, DEX_CREATE_PAIR_ENTRY, pairArgsBytes);

    // pair the earmarked KOIN with the escrowed tokens; a fresh pair takes
    // the exact ratio, the min guards only bite if someone pre-seeded it
    const addArgs = new launchpad.dex_add_liquidity_call();
    addArgs.from = this.contractId;
    addArgs.receiver = this.contractId;
    addArgs.token_a = KOIN_B58;
    addArgs.token_b = tokenB58;
    addArgs.amount_a_desired = launch.liquidity_koin;
    addArgs.amount_b_desired = launch.liquidity_tokens;
    addArgs.amount_a_min = mulDivFloor(launch.liquidity_koin, LIQ_MIN_BPS, 10000);
    addArgs.amount_b_min = mulDivFloor(
      launch.liquidity_tokens,
      LIQ_MIN_BPS,
      10000
    );
    const addRes = System.call(
      periphery,
      DEX_ADD_LIQUIDITY_ENTRY,
      Protobuf.encode(addArgs, launchpad.dex_add_liquidity_call.encode)
    );
    System.require(
      addRes.code == 0,
      "launchpad: KoinDX add_liquidity failed - retry later"
    );
    let lpAmount: u64 = 0;
    const addBuffer = addRes.res.object;
    if (addBuffer) {
      lpAmount = Protobuf.decode<launchpad.dex_add_liquidity_answer>(
        addBuffer,
        launchpad.dex_add_liquidity_answer.decode
      ).liquidity;
    }
    System.require(lpAmount > 0, "launchpad: KoinDX returned no liquidity");

    // remember the pair (= the LP token contract) for the lock + claim
    const getRes = System.call(periphery, DEX_GET_PAIR_ENTRY, pairArgsBytes);
    System.require(getRes.code == 0, "launchpad: KoinDX get_pair failed");
    const getBuffer = getRes.res.object;
    System.require(getBuffer != null, "launchpad: KoinDX returned no pair");
    const pair = Protobuf.decode<launchpad.dex_address>(
      getBuffer!,
      launchpad.dex_address.decode
    ).value;
    System.require(
      pair != null && pair!.length > 0,
      "launchpad: KoinDX returned an empty pair"
    );

    launch.pair = pair;
    launch.lp_amount = lpAmount;
    launch.liquidity_state = LIQ_PROVIDED;
    this.saveLaunch(launch);

    const event = new launchpad.liquidity_provided_event();
    event.launch_id = launch.id;
    event.pair = pair;
    event.lp_amount = lpAmount;
    event.koin = launch.liquidity_koin;
    event.tokens = launch.liquidity_tokens;
    const impacted: Uint8Array[] = [launch.creator!];
    System.event(
      "launchpad.liquidity_provided",
      Protobuf.encode(event, launchpad.liquidity_provided_event.encode),
      impacted
    );

    const result = new launchpad.provide_liquidity_result();
    result.liquidity_state = launch.liquidity_state;
    result.lp_amount = lpAmount;
    return result;
  }

  claim_liquidity(
    args: launchpad.claim_liquidity_arguments
  ): launchpad.claim_liquidity_result {
    const found = this.getLaunch(args.launch_id);
    System.require(found != null, "launchpad: unknown launch");
    const launch = found!;

    System.require(
      launch.liquidity_state == LIQ_PROVIDED && !launch.lp_claimed,
      "launchpad: no locked liquidity to claim"
    );
    System.require(
      this.blockTimestamp() >= launch.lp_unlock_time,
      "launchpad: liquidity is still locked"
    );

    // callable by anyone (the keeper auto-delivers); the destination is
    // always the creator
    launch.lp_claimed = true;
    this.saveLaunch(launch);
    System.require(
      new Token(launch.pair!).transfer(
        this.contractId,
        launch.creator!,
        launch.lp_amount
      ),
      "launchpad: LP transfer failed"
    );

    const event = new launchpad.lp_claimed_event();
    event.launch_id = launch.id;
    event.creator = launch.creator;
    event.lp_amount = launch.lp_amount;
    const impacted: Uint8Array[] = [launch.creator!];
    System.event(
      "launchpad.lp_claimed",
      Protobuf.encode(event, launchpad.lp_claimed_event.encode),
      impacted
    );

    return new launchpad.claim_liquidity_result();
  }

  reclaim_liquidity(
    args: launchpad.reclaim_liquidity_arguments
  ): launchpad.reclaim_liquidity_result {
    const found = this.getLaunch(args.launch_id);
    System.require(found != null, "launchpad: unknown launch");
    const launch = found!;

    System.require(
      launch.liquidity_state == LIQ_PENDING,
      "launchpad: liquidity is not stuck"
    );
    System.require(
      launch.status == STATUS_DISTRIBUTING ||
        launch.status == STATUS_COMPLETED,
      "launchpad: launch has not settled successfully"
    );
    // only after the keeper has had a week of retries: the stuck state is
    // publicly visible on the launch page that whole time
    System.require(
      this.blockTimestamp() >= launch.end_time + RECLAIM_GRACE_MS,
      "launchpad: give the keeper its 7-day grace period first"
    );
    System.requireAuthority(
      authority.authorization_type.contract_call,
      launch.creator!
    );

    launch.liquidity_state = LIQ_RECLAIMED;
    this.saveLaunch(launch);
    if (launch.liquidity_koin > 0) {
      System.require(
        this.koin().transfer(
          this.contractId,
          launch.creator!,
          launch.liquidity_koin
        ),
        "launchpad: KOIN reclaim failed"
      );
    }
    if (launch.liquidity_tokens > 0) {
      System.require(
        new Token(launch.token!).transfer(
          this.contractId,
          launch.creator!,
          launch.liquidity_tokens
        ),
        "launchpad: token reclaim failed"
      );
    }

    const event = new launchpad.liquidity_reclaimed_event();
    event.launch_id = launch.id;
    event.creator = launch.creator;
    const impacted: Uint8Array[] = [launch.creator!];
    System.event(
      "launchpad.liquidity_reclaimed",
      Protobuf.encode(event, launchpad.liquidity_reclaimed_event.encode),
      impacted
    );

    return new launchpad.reclaim_liquidity_result();
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  get_launches(
    args: launchpad.get_launches_arguments
  ): launchpad.get_launches_result {
    const result = new launchpad.get_launches_result();
    let limit = args.limit == 0 ? DEFAULT_LIST_LIMIT : args.limit;
    if (limit > MAX_LIST_LIMIT) limit = MAX_LIST_LIMIT;

    const state = this.getGlobalState();
    let count: u32 = 0;
    for (let id: u32 = args.start + 1; id < state.next_launch_id; id++) {
      if (count >= limit) break;
      const launch = this.getLaunch(id);
      if (launch) {
        result.launches.push(launch);
        count += 1;
      }
    }
    return result;
  }

  get_launch(args: launchpad.get_launch_arguments): launchpad.get_launch_result {
    const result = new launchpad.get_launch_result();
    result.value = this.getLaunch(args.launch_id);
    return result;
  }

  get_contribution(
    args: launchpad.get_contribution_arguments
  ): launchpad.get_contribution_result {
    const result = new launchpad.get_contribution_result();
    if (args.buyer == null || args.buyer!.length == 0) return result;
    result.value = this.getContribution(args.launch_id, args.buyer!);
    return result;
  }

  get_buyers(args: launchpad.get_buyers_arguments): launchpad.get_buyers_result {
    const result = new launchpad.get_buyers_result();
    const found = this.getLaunch(args.launch_id);
    if (!found) return result;
    const launch = found!;

    let limit = args.limit == 0 ? DEFAULT_LIST_LIMIT : args.limit;
    if (limit > MAX_LIST_LIMIT) limit = MAX_LIST_LIMIT;

    let seq = args.start;
    let count: u32 = 0;
    while (count < limit && seq < launch.buyer_count) {
      const buyer = this.getBuyerAt(launch.id, seq);
      if (buyer) {
        const entry = this.getContribution(launch.id, buyer);
        if (entry) {
          result.contributions.push(entry);
          count += 1;
        }
      }
      seq += 1;
    }
    return result;
  }
}
