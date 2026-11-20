export type Balance = {
  lot_id: number;
  warehouse_id: number;
  product_id: number;
  available: number;
  received_at: Date | string;
};
export type RequestedLine = { product_id: number; quantity: number };
export type PlannedAllocation = {
  lot_id: number;
  warehouse_id: number;
  product_id: number;
  quantity: number;
};
export function planAllocation(
  lines: RequestedLine[],
  balances: Balance[],
): PlannedAllocation[] {
  const warehouses = [...new Set(balances.map((b) => b.warehouse_id))].sort(
    (a, b) => a - b,
  );
  const stock = (id: number, w: number) =>
    balances
      .filter((b) => b.product_id === id && b.warehouse_id === w)
      .reduce((n, b) => n + b.available, 0);
  const single = warehouses.find((w) =>
    lines.every((l) => stock(l.product_id, w) >= l.quantity),
  );
  const planned: PlannedAllocation[] = [];
  for (const line of [...lines].sort((a, b) => a.product_id - b.product_id)) {
    let needed = line.quantity;
    const sources =
      single === undefined
        ? [...warehouses].sort(
            (a, b) =>
              stock(line.product_id, b) - stock(line.product_id, a) || a - b,
          )
        : [single];
    for (const warehouse of sources) {
      const lots = balances
        .filter(
          (b) =>
            b.product_id === line.product_id && b.warehouse_id === warehouse,
        )
        .sort(
          (a, b) =>
            new Date(a.received_at).getTime() -
              new Date(b.received_at).getTime() || a.lot_id - b.lot_id,
        );
      for (const lot of lots) {
        const quantity = Math.min(needed, lot.available);
        if (quantity > 0)
          planned.push({
            lot_id: lot.lot_id,
            warehouse_id: warehouse,
            product_id: line.product_id,
            quantity,
          });
        needed -= quantity;
        if (!needed) break;
      }
      if (!needed) break;
    }
    if (needed)
      throw new Error(
        `Insufficient eligible stock for product ${line.product_id}`,
      );
  }
  return planned;
}
