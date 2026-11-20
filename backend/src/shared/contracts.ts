export type AddressSnapshot = {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postal_code: string;
  country_code: string;
};

export type CreateOrderRequest = {
  service_level?: "standard" | "expedited";
  destination: AddressSnapshot;
  items: Array<{ product_id: number; quantity: number }>;
};

export type CancelOrderRequest = {
  items: Array<{ order_item_id: number; quantity: number }>;
};

export type CreateTransferRequest = {
  source_warehouse_id: number;
  destination_warehouse_id: number;
  items: Array<{ lot_id: number; quantity: number }>;
};

export type TransferReceiptRequest = {
  items: Array<{ transfer_item_id: number; received_quantity: number }>;
};

export type CreateReturnRequest = {
  items: Array<{ shipment_item_id: number; quantity: number; reason: string }>;
};

export type ReturnInspectionRequest = {
  outcome: "restockable" | "quarantine" | "damaged" | "discard";
  notes?: string;
};

export type AcknowledgeAlertRequest = {
  note?: string;
};

export type OperationAcceptedResponse = {
  data: { operation_id: number; status: string };
  request_id: string;
};

export type CursorPageQuery = {
  limit?: number;
  cursor?: string;
};
