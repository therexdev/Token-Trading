interface ConfirmationProvider {
  wait: (id: string, type: "byTransactionId", timeout: number) => Promise<{ blockNumber?: number; blockId?: string }>;
  getBlocksById: (ids: string[], options: { returnBlock: boolean; returnReceipt: boolean }) => Promise<{
    block_items: { block_id: string; receipt?: { transaction_receipts?: { id?: string; reverted?: boolean; logs?: string[] }[] } }[];
  }>;
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
    const blocks = await provider.getBlocksById([result.blockId], { returnBlock: false, returnReceipt: true });
    const receipt = blocks.block_items.find((block) => block.block_id === result.blockId)
      ?.receipt?.transaction_receipts?.find((transaction) => transaction.id === id);
    if (!receipt) throw new Error("Transaction receipt is unavailable");
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
