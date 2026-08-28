import { System, Protobuf, authority } from "@koinos/sdk-as";
import { launchpad } from "./proto/launchpad";

export class Launchpad {
  create_launch(
    args: launchpad.create_launch_arguments
  ): launchpad.create_launch_result {
    // const creator = args.creator;
    // const token = args.token;
    // const mode = args.mode;
    // const price = args.price;
    // const for_sale_amount = args.for_sale_amount;
    // const locked_amount = args.locked_amount;
    // const unlock_time = args.unlock_time;
    // const start_time = args.start_time;
    // const end_time = args.end_time;
    // const soft_cap = args.soft_cap;
    // const hard_cap = args.hard_cap;
    // const unsold_action = args.unsold_action;
    // const liquidity_bps = args.liquidity_bps;
    // const liquidity_tokens = args.liquidity_tokens;
    // const lp_unlock_time = args.lp_unlock_time;

    // YOUR CODE HERE

    const res = new launchpad.create_launch_result();
    // res.launch_id = ;

    return res;
  }

  contribute(
    args: launchpad.contribute_arguments
  ): launchpad.contribute_result {
    // const launch_id = args.launch_id;
    // const buyer = args.buyer;
    // const amount = args.amount;

    // YOUR CODE HERE

    const res = new launchpad.contribute_result();
    // res.paid = ;
    // res.tokens = ;

    return res;
  }

  finalize(args: launchpad.finalize_arguments): launchpad.finalize_result {
    // const launch_id = args.launch_id;

    // YOUR CODE HERE

    const res = new launchpad.finalize_result();
    // res.status = ;

    return res;
  }

  process(args: launchpad.process_arguments): launchpad.process_result {
    // const launch_id = args.launch_id;
    // const limit = args.limit;

    // YOUR CODE HERE

    const res = new launchpad.process_result();
    // res.settled = ;
    // res.pending = ;
    // res.status = ;

    return res;
  }

  claim_locked(
    args: launchpad.claim_locked_arguments
  ): launchpad.claim_locked_result {
    // const launch_id = args.launch_id;

    // YOUR CODE HERE

    const res = new launchpad.claim_locked_result();

    return res;
  }

  provide_liquidity(
    args: launchpad.provide_liquidity_arguments
  ): launchpad.provide_liquidity_result {
    // const launch_id = args.launch_id;

    // YOUR CODE HERE

    const res = new launchpad.provide_liquidity_result();
    // res.liquidity_state = ;
    // res.lp_amount = ;

    return res;
  }

  claim_liquidity(
    args: launchpad.claim_liquidity_arguments
  ): launchpad.claim_liquidity_result {
    // const launch_id = args.launch_id;

    // YOUR CODE HERE

    const res = new launchpad.claim_liquidity_result();

    return res;
  }

  reclaim_liquidity(
    args: launchpad.reclaim_liquidity_arguments
  ): launchpad.reclaim_liquidity_result {
    // const launch_id = args.launch_id;

    // YOUR CODE HERE

    const res = new launchpad.reclaim_liquidity_result();

    return res;
  }

  get_launches(
    args: launchpad.get_launches_arguments
  ): launchpad.get_launches_result {
    // const start = args.start;
    // const limit = args.limit;

    // YOUR CODE HERE

    const res = new launchpad.get_launches_result();
    // res.launches = ;

    return res;
  }

  get_launch(
    args: launchpad.get_launch_arguments
  ): launchpad.get_launch_result {
    // const launch_id = args.launch_id;

    // YOUR CODE HERE

    const res = new launchpad.get_launch_result();
    // res.value = ;

    return res;
  }

  get_contribution(
    args: launchpad.get_contribution_arguments
  ): launchpad.get_contribution_result {
    // const launch_id = args.launch_id;
    // const buyer = args.buyer;

    // YOUR CODE HERE

    const res = new launchpad.get_contribution_result();
    // res.value = ;

    return res;
  }

  get_buyers(
    args: launchpad.get_buyers_arguments
  ): launchpad.get_buyers_result {
    // const launch_id = args.launch_id;
    // const start = args.start;
    // const limit = args.limit;

    // YOUR CODE HERE

    const res = new launchpad.get_buyers_result();
    // res.contributions = ;

    return res;
  }
}
