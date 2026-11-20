// Customer read DTO proposal, module-local until Member 1 promotes it to shared contracts.
export interface ProductSummary {
  product_id: number;
  sku: string;
  name: string;
  category: string;
  list_price: string;
  available_quantity: number;
}
export interface OrderItem {
  order_item_id: number;
  product_id: number;
  name: string;
  category: string;
  quantity: number;
  unit_price: string;
  cancelled_quantity: number;
  reserved_quantity: number;
  shipped_quantity: number;
  delivered_quantity: number;
  cancellable_quantity: number;
}
export interface Allocation {
  allocation_id: number;
  order_item_id: number;
  product_id: number;
  lot_id: number;
  lot_code: string;
  warehouse_id: number;
  warehouse_name: string;
  allocated_quantity: number;
  shipped_quantity: number;
  released_quantity: number;
  status: string;
}
export interface ShipmentItem {
  shipment_item_id: number;
  order_item_id: number;
  product_id: number;
  lot_code: string;
  quantity: number;
  returnable_quantity: number;
}
export interface Shipment {
  shipment_id: number;
  warehouse_id: number;
  warehouse_name: string;
  status: string;
  tracking_code: string | null;
  eta: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  items: ShipmentItem[];
  events: Array<{
    event_type: string;
    occurred_at: string;
    details: Record<string, unknown>;
  }>;
}
export interface ReturnResource {
  return_id: number;
  order_id?: number;
  rma_code: string;
  status: string;
  created_at?: string;
  items: Array<{
    shipment_item_id: number;
    requested_quantity?: number;
    quantity?: number;
    reason: string;
  }>;
}
export interface OrderDetail {
  order_id: number;
  status: string;
  service_level: string;
  placed_at: string;
  destination_name: string;
  destination_line1: string;
  destination_line2: string | null;
  destination_city: string;
  destination_region: string;
  destination_postal_code: string;
  destination_country_code: string;
  items: OrderItem[];
  allocations: Allocation[];
  shipments: Shipment[];
  returns: ReturnResource[];
}
export interface OrderSummary {
  order_id: number;
  status: string;
  placed_at: string;
  quantity: number;
  total: string;
}
export interface Availability {
  product_id: number;
  as_of: string;
  available_quantity: number;
  warehouses: Array<{
    warehouse_id: number;
    name: string;
    region: string;
    available_quantity: number;
  }>;
}
