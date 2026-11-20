import type { AuthenticatedUser } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      auth?: AuthenticatedUser;
    }
  }
}

export {};
