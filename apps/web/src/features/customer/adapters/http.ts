import type {
  CreateOrderRequest,
  CancelOrderRequest,
  CreateReturnRequest,
} from "../../../../../../backend/src/shared/contracts";
import type {
  LoginResponse,
  ListResponse,
} from "../../../../../../backend/src/shared/types";
import type {
  ProductSummary,
  OrderDetail,
  OrderSummary,
  Availability,
  ReturnResource,
} from "../../../../../../backend/src/modules/orders/dto";
export type { ProductSummary, OrderDetail, OrderSummary, Availability };
export type { CreateOrderRequest };
export class CustomerHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function createCustomerApi(
  getToken: () => string | null,
  onExpired: () => void,
) {
  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = getToken();
    const response = await fetch("/api" + path, {
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && token) onExpired();
      throw new CustomerHttpError(
        response.status,
        data.error?.message ?? `Request failed (${response.status})`,
      );
    }
    return data as T;
  }
  return {
    login: (email: string, password: string) =>
      request<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    register: (input: {
      email: string;
      password: string;
      first_name: string;
      last_name: string;
      region: string;
    }) =>
      request<LoginResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    products: (query: string, signal?: AbortSignal) =>
      request<ListResponse<ProductSummary>>("/products?" + query, { signal }),
    product: (id: number) => request<ProductSummary>(`/products/${id}`),
    availability: (id: number) =>
      request<Availability>(`/products/${id}/availability`),
    orders: (cursor?: string) =>
      request<ListResponse<OrderSummary>>(
        "/orders?limit=20" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      ),
    order: (id: number) => request<OrderDetail>(`/orders/${id}`),
    place: (input: CreateOrderRequest, key: string) =>
      request<OrderDetail>("/orders", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(input),
      }),
    cancel: (id: number, input: CancelOrderRequest, key: string) =>
      request<OrderDetail>(`/orders/${id}/cancellations`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(input),
      }),
    returnItems: (input: CreateReturnRequest, key: string) =>
      request<ReturnResource>("/returns", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(input),
      }),
    logout: async () => {
      const token = getToken();
      if (token)
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
    },
  };
}
