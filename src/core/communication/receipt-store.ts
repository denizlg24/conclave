import { Effect } from "effect";

export interface ReceiptStoreShape {
  readonly tryAcquire: (
    eventId: string,
    reactorName: string,
  ) => Effect.Effect<boolean>;

  readonly hasReceipt: (
    eventId: string,
    reactorName: string,
  ) => Effect.Effect<boolean>;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function createReceiptStore(options?: {
  ttlMs?: number;
}): Effect.Effect<ReceiptStoreShape> {
  return Effect.sync(() => {
    const ttl = options?.ttlMs ?? DEFAULT_TTL_MS;
    const receipts = new Map<string, number>();

    function makeKey(eventId: string, reactorName: string): string {
      return `${reactorName}::${eventId}`;
    }

    function cleanupExpired(): void {
      const now = Date.now();
      for (const [key, timestamp] of receipts) {
        if (now - timestamp > ttl) {
          receipts.delete(key);
        }
      }
    }

    const tryAcquire: ReceiptStoreShape["tryAcquire"] = (
      eventId,
      reactorName,
    ) =>
      Effect.sync(() => {
        cleanupExpired();
        const key = makeKey(eventId, reactorName);
        if (receipts.has(key)) return false;
        receipts.set(key, Date.now());
        return true;
      });

    const hasReceipt: ReceiptStoreShape["hasReceipt"] = (
      eventId,
      reactorName,
    ) =>
      Effect.sync(() => {
        const key = makeKey(eventId, reactorName);
        const timestamp = receipts.get(key);
        if (timestamp === undefined) return false;
        if (Date.now() - timestamp > ttl) {
          receipts.delete(key);
          return false;
        }
        return true;
      });

    return { tryAcquire, hasReceipt } satisfies ReceiptStoreShape;
  });
}
