import { Writer, Reader } from "as-proto";

export namespace launchpad {
  export class launch_object {
    static encode(message: launch_object, writer: Writer): void {
      if (message.id != 0) {
        writer.uint32(8);
        writer.uint32(message.id);
      }

      const unique_name_creator = message.creator;
      if (unique_name_creator !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_creator);
      }

      const unique_name_token = message.token;
      if (unique_name_token !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token);
      }

      if (message.mode != 0) {
        writer.uint32(32);
        writer.uint32(message.mode);
      }

      if (message.price != 0) {
        writer.uint32(40);
        writer.uint64(message.price);
      }

      if (message.for_sale_amount != 0) {
        writer.uint32(48);
        writer.uint64(message.for_sale_amount);
      }

      if (message.locked_amount != 0) {
        writer.uint32(56);
        writer.uint64(message.locked_amount);
      }

      if (message.unlock_time != 0) {
        writer.uint32(64);
        writer.uint64(message.unlock_time);
      }

      if (message.start_time != 0) {
        writer.uint32(72);
        writer.uint64(message.start_time);
      }

      if (message.end_time != 0) {
        writer.uint32(80);
        writer.uint64(message.end_time);
      }

      if (message.soft_cap != 0) {
        writer.uint32(88);
        writer.uint64(message.soft_cap);
      }

      if (message.hard_cap != 0) {
        writer.uint32(96);
        writer.uint64(message.hard_cap);
      }

      if (message.unsold_action != 0) {
        writer.uint32(104);
        writer.uint32(message.unsold_action);
      }

      if (message.status != 0) {
        writer.uint32(112);
        writer.uint32(message.status);
      }

      if (message.raised != 0) {
        writer.uint32(120);
        writer.uint64(message.raised);
      }

      if (message.sold != 0) {
        writer.uint32(128);
        writer.uint64(message.sold);
      }

      if (message.buyer_count != 0) {
        writer.uint32(136);
        writer.uint32(message.buyer_count);
      }

      if (message.cursor != 0) {
        writer.uint32(144);
        writer.uint32(message.cursor);
      }

      if (message.distributed != 0) {
        writer.uint32(152);
        writer.uint64(message.distributed);
      }

      if (message.refunded != 0) {
        writer.uint32(160);
        writer.uint64(message.refunded);
      }

      if (message.locked_claimed != false) {
        writer.uint32(168);
        writer.bool(message.locked_claimed);
      }

      if (message.created_at != 0) {
        writer.uint32(176);
        writer.uint64(message.created_at);
      }
    }

    static decode(reader: Reader, length: i32): launch_object {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new launch_object();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.uint32();
            break;

          case 2:
            message.creator = reader.bytes();
            break;

          case 3:
            message.token = reader.bytes();
            break;

          case 4:
            message.mode = reader.uint32();
            break;

          case 5:
            message.price = reader.uint64();
            break;

          case 6:
            message.for_sale_amount = reader.uint64();
            break;

          case 7:
            message.locked_amount = reader.uint64();
            break;

          case 8:
            message.unlock_time = reader.uint64();
            break;

          case 9:
            message.start_time = reader.uint64();
            break;

          case 10:
            message.end_time = reader.uint64();
            break;

          case 11:
            message.soft_cap = reader.uint64();
            break;

          case 12:
            message.hard_cap = reader.uint64();
            break;

          case 13:
            message.unsold_action = reader.uint32();
            break;

          case 14:
            message.status = reader.uint32();
            break;

          case 15:
            message.raised = reader.uint64();
            break;

          case 16:
            message.sold = reader.uint64();
            break;

          case 17:
            message.buyer_count = reader.uint32();
            break;

          case 18:
            message.cursor = reader.uint32();
            break;

          case 19:
            message.distributed = reader.uint64();
            break;

          case 20:
            message.refunded = reader.uint64();
            break;

          case 21:
            message.locked_claimed = reader.bool();
            break;

          case 22:
            message.created_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: u32;
    creator: Uint8Array | null;
    token: Uint8Array | null;
    mode: u32;
    price: u64;
    for_sale_amount: u64;
    locked_amount: u64;
    unlock_time: u64;
    start_time: u64;
    end_time: u64;
    soft_cap: u64;
    hard_cap: u64;
    unsold_action: u32;
    status: u32;
    raised: u64;
    sold: u64;
    buyer_count: u32;
    cursor: u32;
    distributed: u64;
    refunded: u64;
    locked_claimed: bool;
    created_at: u64;

    constructor(
      id: u32 = 0,
      creator: Uint8Array | null = null,
      token: Uint8Array | null = null,
      mode: u32 = 0,
      price: u64 = 0,
      for_sale_amount: u64 = 0,
      locked_amount: u64 = 0,
      unlock_time: u64 = 0,
      start_time: u64 = 0,
      end_time: u64 = 0,
      soft_cap: u64 = 0,
      hard_cap: u64 = 0,
      unsold_action: u32 = 0,
      status: u32 = 0,
      raised: u64 = 0,
      sold: u64 = 0,
      buyer_count: u32 = 0,
      cursor: u32 = 0,
      distributed: u64 = 0,
      refunded: u64 = 0,
      locked_claimed: bool = false,
      created_at: u64 = 0
    ) {
      this.id = id;
      this.creator = creator;
      this.token = token;
      this.mode = mode;
      this.price = price;
      this.for_sale_amount = for_sale_amount;
      this.locked_amount = locked_amount;
      this.unlock_time = unlock_time;
      this.start_time = start_time;
      this.end_time = end_time;
      this.soft_cap = soft_cap;
      this.hard_cap = hard_cap;
      this.unsold_action = unsold_action;
      this.status = status;
      this.raised = raised;
      this.sold = sold;
      this.buyer_count = buyer_count;
      this.cursor = cursor;
      this.distributed = distributed;
      this.refunded = refunded;
      this.locked_claimed = locked_claimed;
      this.created_at = created_at;
    }
  }

  export class contribution_object {
    static encode(message: contribution_object, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }

      const unique_name_buyer = message.buyer;
      if (unique_name_buyer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_buyer);
      }

      if (message.koin != 0) {
        writer.uint32(24);
        writer.uint64(message.koin);
      }

      if (message.tokens != 0) {
        writer.uint32(32);
        writer.uint64(message.tokens);
      }

      if (message.settled != false) {
        writer.uint32(40);
        writer.bool(message.settled);
      }

      if (message.seq != 0) {
        writer.uint32(48);
        writer.uint32(message.seq);
      }
    }

    static decode(reader: Reader, length: i32): contribution_object {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new contribution_object();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          case 2:
            message.buyer = reader.bytes();
            break;

          case 3:
            message.koin = reader.uint64();
            break;

          case 4:
            message.tokens = reader.uint64();
            break;

          case 5:
            message.settled = reader.bool();
            break;

          case 6:
            message.seq = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;
    buyer: Uint8Array | null;
    koin: u64;
    tokens: u64;
    settled: bool;
    seq: u32;

    constructor(
      launch_id: u32 = 0,
      buyer: Uint8Array | null = null,
      koin: u64 = 0,
      tokens: u64 = 0,
      settled: bool = false,
      seq: u32 = 0
    ) {
      this.launch_id = launch_id;
      this.buyer = buyer;
      this.koin = koin;
      this.tokens = tokens;
      this.settled = settled;
      this.seq = seq;
    }
  }

  @unmanaged
  export class global_state {
    static encode(message: global_state, writer: Writer): void {
      if (message.next_launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.next_launch_id);
      }
    }

    static decode(reader: Reader, length: i32): global_state {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new global_state();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.next_launch_id = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    next_launch_id: u32;

    constructor(next_launch_id: u32 = 0) {
      this.next_launch_id = next_launch_id;
    }
  }

  export class create_launch_arguments {
    static encode(message: create_launch_arguments, writer: Writer): void {
      const unique_name_creator = message.creator;
      if (unique_name_creator !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_creator);
      }

      const unique_name_token = message.token;
      if (unique_name_token !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_token);
      }

      if (message.mode != 0) {
        writer.uint32(24);
        writer.uint32(message.mode);
      }

      if (message.price != 0) {
        writer.uint32(32);
        writer.uint64(message.price);
      }

      if (message.for_sale_amount != 0) {
        writer.uint32(40);
        writer.uint64(message.for_sale_amount);
      }

      if (message.locked_amount != 0) {
        writer.uint32(48);
        writer.uint64(message.locked_amount);
      }

      if (message.unlock_time != 0) {
        writer.uint32(56);
        writer.uint64(message.unlock_time);
      }

      if (message.start_time != 0) {
        writer.uint32(64);
        writer.uint64(message.start_time);
      }

      if (message.end_time != 0) {
        writer.uint32(72);
        writer.uint64(message.end_time);
      }

      if (message.soft_cap != 0) {
        writer.uint32(80);
        writer.uint64(message.soft_cap);
      }

      if (message.hard_cap != 0) {
        writer.uint32(88);
        writer.uint64(message.hard_cap);
      }

      if (message.unsold_action != 0) {
        writer.uint32(96);
        writer.uint32(message.unsold_action);
      }
    }

    static decode(reader: Reader, length: i32): create_launch_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new create_launch_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.creator = reader.bytes();
            break;

          case 2:
            message.token = reader.bytes();
            break;

          case 3:
            message.mode = reader.uint32();
            break;

          case 4:
            message.price = reader.uint64();
            break;

          case 5:
            message.for_sale_amount = reader.uint64();
            break;

          case 6:
            message.locked_amount = reader.uint64();
            break;

          case 7:
            message.unlock_time = reader.uint64();
            break;

          case 8:
            message.start_time = reader.uint64();
            break;

          case 9:
            message.end_time = reader.uint64();
            break;

          case 10:
            message.soft_cap = reader.uint64();
            break;

          case 11:
            message.hard_cap = reader.uint64();
            break;

          case 12:
            message.unsold_action = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    creator: Uint8Array | null;
    token: Uint8Array | null;
    mode: u32;
    price: u64;
    for_sale_amount: u64;
    locked_amount: u64;
    unlock_time: u64;
    start_time: u64;
    end_time: u64;
    soft_cap: u64;
    hard_cap: u64;
    unsold_action: u32;

    constructor(
      creator: Uint8Array | null = null,
      token: Uint8Array | null = null,
      mode: u32 = 0,
      price: u64 = 0,
      for_sale_amount: u64 = 0,
      locked_amount: u64 = 0,
      unlock_time: u64 = 0,
      start_time: u64 = 0,
      end_time: u64 = 0,
      soft_cap: u64 = 0,
      hard_cap: u64 = 0,
      unsold_action: u32 = 0
    ) {
      this.creator = creator;
      this.token = token;
      this.mode = mode;
      this.price = price;
      this.for_sale_amount = for_sale_amount;
      this.locked_amount = locked_amount;
      this.unlock_time = unlock_time;
      this.start_time = start_time;
      this.end_time = end_time;
      this.soft_cap = soft_cap;
      this.hard_cap = hard_cap;
      this.unsold_action = unsold_action;
    }
  }

  @unmanaged
  export class create_launch_result {
    static encode(message: create_launch_result, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }
    }

    static decode(reader: Reader, length: i32): create_launch_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new create_launch_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;

    constructor(launch_id: u32 = 0) {
      this.launch_id = launch_id;
    }
  }

  export class contribute_arguments {
    static encode(message: contribute_arguments, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }

      const unique_name_buyer = message.buyer;
      if (unique_name_buyer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_buyer);
      }

      if (message.amount != 0) {
        writer.uint32(24);
        writer.uint64(message.amount);
      }
    }

    static decode(reader: Reader, length: i32): contribute_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new contribute_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          case 2:
            message.buyer = reader.bytes();
            break;

          case 3:
            message.amount = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;
    buyer: Uint8Array | null;
    amount: u64;

    constructor(
      launch_id: u32 = 0,
      buyer: Uint8Array | null = null,
      amount: u64 = 0
    ) {
      this.launch_id = launch_id;
      this.buyer = buyer;
      this.amount = amount;
    }
  }

  @unmanaged
  export class contribute_result {
    static encode(message: contribute_result, writer: Writer): void {
      if (message.paid != 0) {
        writer.uint32(8);
        writer.uint64(message.paid);
      }

      if (message.tokens != 0) {
        writer.uint32(16);
        writer.uint64(message.tokens);
      }
    }

    static decode(reader: Reader, length: i32): contribute_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new contribute_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.paid = reader.uint64();
            break;

          case 2:
            message.tokens = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    paid: u64;
    tokens: u64;

    constructor(paid: u64 = 0, tokens: u64 = 0) {
      this.paid = paid;
      this.tokens = tokens;
    }
  }

  @unmanaged
  export class finalize_arguments {
    static encode(message: finalize_arguments, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }
    }

    static decode(reader: Reader, length: i32): finalize_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new finalize_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;

    constructor(launch_id: u32 = 0) {
      this.launch_id = launch_id;
    }
  }

  @unmanaged
  export class finalize_result {
    static encode(message: finalize_result, writer: Writer): void {
      if (message.status != 0) {
        writer.uint32(8);
        writer.uint32(message.status);
      }
    }

    static decode(reader: Reader, length: i32): finalize_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new finalize_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.status = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    status: u32;

    constructor(status: u32 = 0) {
      this.status = status;
    }
  }

  @unmanaged
  export class process_arguments {
    static encode(message: process_arguments, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }

      if (message.limit != 0) {
        writer.uint32(16);
        writer.uint32(message.limit);
      }
    }

    static decode(reader: Reader, length: i32): process_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new process_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          case 2:
            message.limit = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;
    limit: u32;

    constructor(launch_id: u32 = 0, limit: u32 = 0) {
      this.launch_id = launch_id;
      this.limit = limit;
    }
  }

  @unmanaged
  export class process_result {
    static encode(message: process_result, writer: Writer): void {
      if (message.settled != 0) {
        writer.uint32(8);
        writer.uint32(message.settled);
      }

      if (message.pending != 0) {
        writer.uint32(16);
        writer.uint32(message.pending);
      }

      if (message.status != 0) {
        writer.uint32(24);
        writer.uint32(message.status);
      }
    }

    static decode(reader: Reader, length: i32): process_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new process_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.settled = reader.uint32();
            break;

          case 2:
            message.pending = reader.uint32();
            break;

          case 3:
            message.status = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    settled: u32;
    pending: u32;
    status: u32;

    constructor(settled: u32 = 0, pending: u32 = 0, status: u32 = 0) {
      this.settled = settled;
      this.pending = pending;
      this.status = status;
    }
  }

  @unmanaged
  export class claim_locked_arguments {
    static encode(message: claim_locked_arguments, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }
    }

    static decode(reader: Reader, length: i32): claim_locked_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new claim_locked_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;

    constructor(launch_id: u32 = 0) {
      this.launch_id = launch_id;
    }
  }

  @unmanaged
  export class claim_locked_result {
    static encode(message: claim_locked_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): claim_locked_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new claim_locked_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  @unmanaged
  export class get_launches_arguments {
    static encode(message: get_launches_arguments, writer: Writer): void {
      if (message.start != 0) {
        writer.uint32(8);
        writer.uint32(message.start);
      }

      if (message.limit != 0) {
        writer.uint32(16);
        writer.uint32(message.limit);
      }
    }

    static decode(reader: Reader, length: i32): get_launches_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_launches_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.start = reader.uint32();
            break;

          case 2:
            message.limit = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    start: u32;
    limit: u32;

    constructor(start: u32 = 0, limit: u32 = 0) {
      this.start = start;
      this.limit = limit;
    }
  }

  export class get_launches_result {
    static encode(message: get_launches_result, writer: Writer): void {
      const unique_name_launches = message.launches;
      for (let i = 0; i < unique_name_launches.length; ++i) {
        writer.uint32(10);
        writer.fork();
        launch_object.encode(unique_name_launches[i], writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_launches_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_launches_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launches.push(
              launch_object.decode(reader, reader.uint32())
            );
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launches: Array<launch_object>;

    constructor(launches: Array<launch_object> = []) {
      this.launches = launches;
    }
  }

  @unmanaged
  export class get_launch_arguments {
    static encode(message: get_launch_arguments, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }
    }

    static decode(reader: Reader, length: i32): get_launch_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_launch_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;

    constructor(launch_id: u32 = 0) {
      this.launch_id = launch_id;
    }
  }

  export class get_launch_result {
    static encode(message: get_launch_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        launch_object.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_launch_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_launch_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = launch_object.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: launch_object | null;

    constructor(value: launch_object | null = null) {
      this.value = value;
    }
  }

  export class get_contribution_arguments {
    static encode(message: get_contribution_arguments, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }

      const unique_name_buyer = message.buyer;
      if (unique_name_buyer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_buyer);
      }
    }

    static decode(reader: Reader, length: i32): get_contribution_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_contribution_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          case 2:
            message.buyer = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;
    buyer: Uint8Array | null;

    constructor(launch_id: u32 = 0, buyer: Uint8Array | null = null) {
      this.launch_id = launch_id;
      this.buyer = buyer;
    }
  }

  export class get_contribution_result {
    static encode(message: get_contribution_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        contribution_object.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_contribution_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_contribution_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = contribution_object.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: contribution_object | null;

    constructor(value: contribution_object | null = null) {
      this.value = value;
    }
  }

  @unmanaged
  export class get_buyers_arguments {
    static encode(message: get_buyers_arguments, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }

      if (message.start != 0) {
        writer.uint32(16);
        writer.uint32(message.start);
      }

      if (message.limit != 0) {
        writer.uint32(24);
        writer.uint32(message.limit);
      }
    }

    static decode(reader: Reader, length: i32): get_buyers_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_buyers_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          case 2:
            message.start = reader.uint32();
            break;

          case 3:
            message.limit = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;
    start: u32;
    limit: u32;

    constructor(launch_id: u32 = 0, start: u32 = 0, limit: u32 = 0) {
      this.launch_id = launch_id;
      this.start = start;
      this.limit = limit;
    }
  }

  export class get_buyers_result {
    static encode(message: get_buyers_result, writer: Writer): void {
      const unique_name_contributions = message.contributions;
      for (let i = 0; i < unique_name_contributions.length; ++i) {
        writer.uint32(10);
        writer.fork();
        contribution_object.encode(unique_name_contributions[i], writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_buyers_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_buyers_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.contributions.push(
              contribution_object.decode(reader, reader.uint32())
            );
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    contributions: Array<contribution_object>;

    constructor(contributions: Array<contribution_object> = []) {
      this.contributions = contributions;
    }
  }

  export class launch_created_event {
    static encode(message: launch_created_event, writer: Writer): void {
      const unique_name_launch = message.launch;
      if (unique_name_launch !== null) {
        writer.uint32(10);
        writer.fork();
        launch_object.encode(unique_name_launch, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): launch_created_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new launch_created_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch = launch_object.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch: launch_object | null;

    constructor(launch: launch_object | null = null) {
      this.launch = launch;
    }
  }

  export class contribution_event {
    static encode(message: contribution_event, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }

      const unique_name_buyer = message.buyer;
      if (unique_name_buyer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_buyer);
      }

      if (message.paid != 0) {
        writer.uint32(24);
        writer.uint64(message.paid);
      }

      if (message.tokens != 0) {
        writer.uint32(32);
        writer.uint64(message.tokens);
      }

      if (message.raised != 0) {
        writer.uint32(40);
        writer.uint64(message.raised);
      }
    }

    static decode(reader: Reader, length: i32): contribution_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new contribution_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          case 2:
            message.buyer = reader.bytes();
            break;

          case 3:
            message.paid = reader.uint64();
            break;

          case 4:
            message.tokens = reader.uint64();
            break;

          case 5:
            message.raised = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;
    buyer: Uint8Array | null;
    paid: u64;
    tokens: u64;
    raised: u64;

    constructor(
      launch_id: u32 = 0,
      buyer: Uint8Array | null = null,
      paid: u64 = 0,
      tokens: u64 = 0,
      raised: u64 = 0
    ) {
      this.launch_id = launch_id;
      this.buyer = buyer;
      this.paid = paid;
      this.tokens = tokens;
      this.raised = raised;
    }
  }

  @unmanaged
  export class launch_finalized_event {
    static encode(message: launch_finalized_event, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }

      if (message.status != 0) {
        writer.uint32(16);
        writer.uint32(message.status);
      }

      if (message.raised != 0) {
        writer.uint32(24);
        writer.uint64(message.raised);
      }

      if (message.sold != 0) {
        writer.uint32(32);
        writer.uint64(message.sold);
      }
    }

    static decode(reader: Reader, length: i32): launch_finalized_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new launch_finalized_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          case 2:
            message.status = reader.uint32();
            break;

          case 3:
            message.raised = reader.uint64();
            break;

          case 4:
            message.sold = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;
    status: u32;
    raised: u64;
    sold: u64;

    constructor(
      launch_id: u32 = 0,
      status: u32 = 0,
      raised: u64 = 0,
      sold: u64 = 0
    ) {
      this.launch_id = launch_id;
      this.status = status;
      this.raised = raised;
      this.sold = sold;
    }
  }

  @unmanaged
  export class launch_settled_event {
    static encode(message: launch_settled_event, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }

      if (message.status != 0) {
        writer.uint32(16);
        writer.uint32(message.status);
      }
    }

    static decode(reader: Reader, length: i32): launch_settled_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new launch_settled_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          case 2:
            message.status = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;
    status: u32;

    constructor(launch_id: u32 = 0, status: u32 = 0) {
      this.launch_id = launch_id;
      this.status = status;
    }
  }

  export class locked_claimed_event {
    static encode(message: locked_claimed_event, writer: Writer): void {
      if (message.launch_id != 0) {
        writer.uint32(8);
        writer.uint32(message.launch_id);
      }

      const unique_name_creator = message.creator;
      if (unique_name_creator !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_creator);
      }

      if (message.amount != 0) {
        writer.uint32(24);
        writer.uint64(message.amount);
      }
    }

    static decode(reader: Reader, length: i32): locked_claimed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new locked_claimed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.launch_id = reader.uint32();
            break;

          case 2:
            message.creator = reader.bytes();
            break;

          case 3:
            message.amount = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    launch_id: u32;
    creator: Uint8Array | null;
    amount: u64;

    constructor(
      launch_id: u32 = 0,
      creator: Uint8Array | null = null,
      amount: u64 = 0
    ) {
      this.launch_id = launch_id;
      this.creator = creator;
      this.amount = amount;
    }
  }
}
