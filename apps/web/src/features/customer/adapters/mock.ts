import { products } from "../fixtures/catalog.ts";
// LOCAL PREVIEW interfaces only. Replace through an adapter after packages/contracts is approved.
export interface CartLine {
  productId: string;
  quantity: number;
}
export interface Allocation {
  productId: string;
  warehouse: number;
  lot: string;
  quantity: number;
}
export interface DemoOrder {
  id: string;
  lines: CartLine[];
  allocations: Allocation[];
  prices: Record<string, number>;
  address: string;
  region: string;
  canceled: Record<string, number>;
  returns: Record<string, number>;
}
export interface CustomerPreviewAdapter {
  place(
    lines: CartLine[],
    address: string,
    region: string,
    key: string,
  ): Promise<DemoOrder>;
}
export function allocate(
  lines: CartLine[],
  stock = products.map((p) => [...p.stocks]),
): Allocation[] {
  if (
    !lines.length ||
    new Set(lines.map((l) => l.productId)).size !== lines.length
  )
    throw new Error("Choose distinct product lines before checkout.");
  for (const line of lines) {
    if (
      !products.some((p) => p.id === line.productId) ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1
    )
      throw new Error("Choose a valid product and quantity.");
  }
  const eligibleSingle = [0, 1, 2].find((w) =>
    lines.every(
      (l) =>
        stock[products.findIndex((p) => p.id === l.productId)][w] >= l.quantity,
    ),
  );
  const result: Allocation[] = [];
  for (const line of lines) {
    const index = products.findIndex((p) => p.id === line.productId);
    let needed = line.quantity;
    const priority =
      eligibleSingle === undefined
        ? [0, 1, 2].sort((a, b) => stock[index][b] - stock[index][a] || a - b)
        : [eligibleSingle];
    for (const w of priority) {
      const quantity = Math.min(needed, stock[index][w]);
      if (quantity)
        result.push({
          productId: line.productId,
          warehouse: w,
          lot: `DEMO-${line.productId}-${w + 1}`,
          quantity,
        });
      needed -= quantity;
    }
    if (needed)
      throw new Error(
        "Stock changed. We could not reserve every item. Your cart has been kept; no order was placed.",
      );
  }
  return result;
}
export function createMockAdapter(): CustomerPreviewAdapter {
  let sequence = 1042;
  const stock = products.map((p) => [...p.stocks]);
  const requests = new Map<string, { payload: string; order: DemoOrder }>();
  return {
    async place(lines, address, region, key) {
      const payload = JSON.stringify({
        lines: [...lines].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        ),
        address,
        region,
      });
      const existing = requests.get(key);
      if (existing) {
        if (existing.payload !== payload)
          throw new Error(
            "This request key was already used for a different checkout.",
          );
        return structuredClone(existing.order);
      }
      if (!key || !address.trim() || !region)
        throw new Error("Complete your address and delivery region.");
      const allocations = allocate(lines, stock);
      // Simulates all-or-nothing behavior in one browser only; no database/concurrency guarantee.
      for (const a of allocations)
        stock[products.findIndex((p) => p.id === a.productId)][a.warehouse] -=
          a.quantity;
      const order: DemoOrder = {
        id: `FW-${sequence++}`,
        lines: structuredClone(lines),
        allocations,
        address,
        region,
        prices: Object.fromEntries(products.map((p) => [p.id, p.priceCents])),
        canceled: {},
        returns: {},
      };
      requests.set(key, { payload, order: structuredClone(order) });
      return order;
    },
  };
}
