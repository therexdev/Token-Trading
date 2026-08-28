
˜%
assembly/proto/launchpad.proto	launchpadkoinos/options.proto"È
launch_object
id (Rid
creator (BÄµRcreator
token (BÄµRtoken
mode (Rmode
price (B0Rprice*
for_sale_amount (B0RforSaleAmount'
locked_amount (B0RlockedAmount#
unlock_time (B0R
unlockTime!

start_time	 (B0R	startTime
end_time
 (B0RendTime
soft_cap (B0RsoftCap
hard_cap (B0RhardCap#
unsold_action (RunsoldAction
status (Rstatus
raised (B0Rraised
sold (B0Rsold
buyer_count (R
buyerCount
cursor (Rcursor$
distributed (B0Rdistributed
refunded (B0Rrefunded%
locked_claimed (RlockedClaimed!

created_at (B0R	createdAt#
liquidity_bps (RliquidityBps-
liquidity_tokens (B0RliquidityTokens(
lp_unlock_time (B0RlpUnlockTime'
liquidity_state (RliquidityState
pair (BÄµRpair
	lp_amount (B0RlpAmount

lp_claimed (R	lpClaimed)
liquidity_koin (B0RliquidityKoin"Æ
contribution_object
	launch_id (RlaunchId
buyer (BÄµRbuyer
koin (B0Rkoin
tokens (B0Rtokens
settled (Rsettled
seq (Rseq"4
global_state$
next_launch_id (RnextLaunchId"†
create_launch_arguments
creator (BÄµRcreator
token (BÄµRtoken
mode (Rmode
price (B0Rprice*
for_sale_amount (B0RforSaleAmount'
locked_amount (B0RlockedAmount#
unlock_time (B0R
unlockTime!

start_time (B0R	startTime
end_time	 (B0RendTime
soft_cap
 (B0RsoftCap
hard_cap (B0RhardCap#
unsold_action (RunsoldAction#
liquidity_bps (RliquidityBps-
liquidity_tokens (B0RliquidityTokens(
lp_unlock_time (B0RlpUnlockTime"3
create_launch_result
	launch_id (RlaunchId"k
contribute_arguments
	launch_id (RlaunchId
buyer (BÄµRbuyer
amount (B0Ramount"G
contribute_result
paid (B0Rpaid
tokens (B0Rtokens"1
finalize_arguments
	launch_id (RlaunchId")
finalize_result
status (Rstatus"F
process_arguments
	launch_id (RlaunchId
limit (Rlimit"\
process_result
settled (Rsettled
pending (Rpending
status (Rstatus"5
claim_locked_arguments
	launch_id (RlaunchId"
claim_locked_result":
provide_liquidity_arguments
	launch_id (RlaunchId"d
provide_liquidity_result'
liquidity_state (RliquidityState
	lp_amount (B0RlpAmount"8
claim_liquidity_arguments
	launch_id (RlaunchId"
claim_liquidity_result":
reclaim_liquidity_arguments
	launch_id (RlaunchId"
reclaim_liquidity_result"D
get_launches_arguments
start (Rstart
limit (Rlimit"K
get_launches_result4
launches (2.launchpad.launch_objectRlaunches"3
get_launch_arguments
	launch_id (RlaunchId"C
get_launch_result.
value (2.launchpad.launch_objectRvalue"U
get_contribution_arguments
	launch_id (RlaunchId
buyer (BÄµRbuyer"O
get_contribution_result4
value (2.launchpad.contribution_objectRvalue"_
get_buyers_arguments
	launch_id (RlaunchId
start (Rstart
limit (Rlimit"Y
get_buyers_resultD
contributions (2.launchpad.contribution_objectRcontributions"H
launch_created_event0
launch (2.launchpad.launch_objectRlaunch"ù
contribution_event
	launch_id (RlaunchId
buyer (BÄµRbuyer
paid (B0Rpaid
tokens (B0Rtokens
raised (B0Rraised"Å
launch_finalized_event
	launch_id (RlaunchId
status (Rstatus
raised (B0Rraised
sold (B0Rsold"K
launch_settled_event
	launch_id (RlaunchId
status (Rstatus"o
locked_claimed_event
	launch_id (RlaunchId
creator (BÄµRcreator
amount (B0Ramount"¶
liquidity_provided_event
	launch_id (RlaunchId
pair (BÄµRpair
	lp_amount (B0RlpAmount
koin (B0Rkoin
tokens (B0Rtokens"X
liquidity_reclaimed_event
	launch_id (RlaunchId
creator (BÄµRcreator"p
lp_claimed_event
	launch_id (RlaunchId
creator (BÄµRcreator
	lp_amount (B0RlpAmount"A
dex_pair_call
token_a (	RtokenA
token_b (	RtokenB")
dex_address
value (BÄµRvalue"Æ
dex_add_liquidity_call
from (BÄµRfrom 
receiver (BÄµRreceiver
token_a (	RtokenA
token_b (	RtokenB,
amount_a_desired (B0RamountADesired,
amount_b_desired (B0RamountBDesired$
amount_a_min (B0R
amountAMin$
amount_b_min (B0R
amountBMin"z
dex_add_liquidity_answer 
	liquidity (B0R	liquidity
amount_a (B0RamountA
amount_b (B0RamountBbproto3