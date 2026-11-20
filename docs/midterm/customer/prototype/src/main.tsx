import React from "react";
import { createRoot } from "react-dom/client";
import LiveCustomerApp from "../../../../../apps/web/src/features/customer/LiveCustomerApp";
import CustomerApp from "../../../../../apps/web/src/features/customer/CustomerApp";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get("mode") === "live" ? (
      <LiveCustomerApp />
    ) : (
      <CustomerApp />
    )}
  </React.StrictMode>,
);
