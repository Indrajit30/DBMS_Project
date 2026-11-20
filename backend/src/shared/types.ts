export const USER_ROLES = ["customer", "warehouse_employee", "manager"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type AuthenticatedUser = {
  userId: string;
  role: UserRole;
  customerId: number | null;
  warehouseIds: number[];
};

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
    request_id: string;
    details?: unknown;
  };
};

export type LoginRequest = { email: string; password: string };
export type RegisterCustomerRequest = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  region: string;
};
export type AuthenticatedUserResponse = {
  user_id: string;
  role: UserRole;
  customer_id: number | null;
  warehouse_ids: number[];
};
export type LoginResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  user: AuthenticatedUserResponse;
};

export type ListResponse<T> = {
  data: T[];
  page: { limit: number; next_cursor: string | null };
};
