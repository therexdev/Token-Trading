interface ConfirmationProvider {
  wait: (id: string, type: "byTransactionId", timeout: number) => Promise<{ blockNumber?: number; blockId?: string }>;
  getHeadInfo: () => Promise<{ head_topology?: { id?: string } }>;
  getBlocks: (height: number, count: number, headId: string, options: { returnBlock: boolean; returnReceipt: boolean }) => Promise<{
    block_id?: string;
    block_height?: string;
    block?: { id?: string; header?: { height?: string }; transactions?: { id?: string }[] };
    receipt?: { id?: string; transaction_receipts?: { id?: string; reverted?: boolean; logs?: string[] }[] };
  }[]>;
}

export class TransactionRevertedError extends Error {
  constructor(public readonly txId: string, detail?: string) {
    super(detail || "The transaction reverted. Its changes were not applied.");
    this.name = "TransactionRevertedError";
  }
}

export class ConfirmationPendingError extends Error {
  constructor(public readonly txId: string, public readonly checkStatus: () => Promise<{ blockNumber: number }>) {
    super("Confirmation is unavailable. Check this transaction before submitting another one.");
    this.name = "ConfirmationPendingError";
  }
}

export async function waitForInclusion(provider: ConfirmationProvider, id: string): Promise<{ blockNumber: number }> {
  if (!id) throw new Error("The wallet returned no transaction ID.");
  try {
    // Transaction lookup also finds blocks produced before this check began.
    const result = await provider.wait(id, "byTransactionId", 60000);
    if (!result?.blockId || !Number.isSafeInteger(result.blockNumber) || result.blockNumber! <= 0) {
      throw new Error("Missing inclusion evidence");
    }
    // koilib's wait checks canonical inclusion, but the chain can reorganize
    // before receipt lookup. Read the block and receipt together on a fresh
    // head's branch instead of accepting a retained receipt by block ID.
    const head = (await provider.getHeadInfo())?.head_topology;
    if (typeof head?.id !== "string" || !head.id) throw new Error("Head is unavailable");
    const blocks = await provider.getBlocks(result.blockNumber!, 1, head.id,
      { returnBlock: true, returnReceipt: true });
    const block = blocks.find((item) => item.block_id === result.blockId);
    if (!block || block.block?.id !== result.blockId || block.receipt?.id !== result.blockId
        || Number(block.block_height) !== result.blockNumber
        || Number(block.block.header?.height) !== result.blockNumber
        || block.block.transactions?.filter((transaction) => transaction.id === id).length !== 1) {
      throw new Error("Canonical inclusion evidence is unavailable");
    }
    const receipts = block.receipt.transaction_receipts?.filter((transaction) => transaction.id === id);
    if (receipts?.length !== 1) throw new Error("Transaction receipt is unavailable");
    const receipt = receipts[0];
    // Protobuf JSON may omit false. Other non-boolean values cannot establish
    // either success or a canonical revert, so keep the transaction pending.
    if (receipt.reverted !== undefined && typeof receipt.reverted !== "boolean") {
      throw new Error("Transaction receipt is malformed");
    }
    if (receipt.reverted) throw new TransactionRevertedError(id, receipt.logs?.slice(-1)[0]);
    return { blockNumber: result.blockNumber! };
  } catch (error) {
    if (error instanceof TransactionRevertedError) throw error;
    throw new ConfirmationPendingError(id, () => waitForInclusion(provider, id));
  }
}

export function transactionErrorToast(error: unknown, failureTitle: string, detail?: string) {
  if (error instanceof ConfirmationPendingError) {
    return {
      kind: "info" as const,
      title: "Submitted — confirmation pending",
      detail: error.message,
      txId: error.txId,
      checkStatus: error.checkStatus,
    };
  }
  return {
    kind: "error" as const,
    title: failureTitle,
    detail: detail || (error instanceof Error ? error.message : String(error)),
    txId: error instanceof TransactionRevertedError ? error.txId : undefined,
  };
}
