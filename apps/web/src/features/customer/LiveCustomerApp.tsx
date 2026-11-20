import { useEffect, useRef, useState, type FormEvent } from "react";
import ProductArt from "./components/ProductArt";
import { money, type Product } from "./fixtures/catalog";
import {
  createCustomerApi,
  type ProductSummary,
  type OrderDetail,
  type OrderSummary,
  type Availability,
  type CreateOrderRequest,
} from "./adapters/http";
import "./styles/customer.css";
import "./styles/live.css";
type Page =
  | "catalog"
  | "product"
  | "cart"
  | "checkout"
  | "login"
  | "orders"
  | "order"
  | "confirmation";
interface Line {
  product: ProductSummary;
  quantity: number;
}
const cents = (decimal: string) => {
  const [whole, fraction = "00"] = decimal.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
};
function illustration(p: ProductSummary): Product {
  const lower = p.name.toLowerCase();
  const art = lower.includes("mouse")
    ? "mouse"
    : lower.includes("keyboard")
      ? "keyboard"
      : lower.includes("headphone")
        ? "headphones"
        : lower.includes("speaker")
          ? "speaker"
          : lower.includes("charger")
            ? "charger"
            : "hub";
  return {
    id: String(p.product_id),
    name: p.name,
    category: p.category,
    priceCents: cents(p.list_price),
    color: {
      mouse: "#ceddca",
      keyboard: "#cddde6",
      headphones: "#d3cce2",
      speaker: "#d8c6bc",
      charger: "#e5dfb9",
      hub: "#ead5bf",
    }[art],
    art,
    description: "",
    stocks: [0, 0, 0],
    tag: "",
  };
}
const readable = (s: string) => s.replaceAll("_", " ");
export default function LiveCustomerApp() {
  const [page, setPage] = useState<Page>("catalog");
  const [catalog, setCatalog] = useState<ProductSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [sort, setSort] = useState("featured");
  const [categories, setCategories] = useState<string[]>([]);
  const [selected, setSelected] = useState<ProductSummary | null>(null),
    [availability, setAvailability] = useState<Availability | null>(null),
    [quantity, setQuantity] = useState(1);
  const [cart, setCart] = useState<Line[]>([]),
    [orders, setOrders] = useState<OrderSummary[]>([]),
    [order, setOrder] = useState<OrderDetail | null>(null);
  const [token, setToken] = useState<string | null>(null),
    [email, setEmail] = useState("customer@local.test"),
    [password, setPassword] = useState(""),
    [register, setRegister] = useState(false);
  const [firstName, setFirstName] = useState(""),
    [lastName, setLastName] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState<
    CreateOrderRequest["destination"]
  >({
    name: "",
    line1: "",
    city: "",
    region: "east",
    postal_code: "",
    country_code: "US",
  });
  const [service, setService] = useState<"standard" | "expedited">("standard");
  const [cancelItem, setCancelItem] = useState<number | null>(null),
    [cancelQty, setCancelQty] = useState(1);
  const [returnItem, setReturnItem] = useState<number | null>(null),
    [returnQty, setReturnQty] = useState(1),
    [reason, setReason] = useState("");
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const [api] = useState(() =>
    createCustomerApi(
      () => tokenRef.current,
      () => {
        setToken(null);
        setPage("login");
        setError("Your session expired. Sign in again to continue.");
      },
    ),
  );
  const placementKey = useRef(crypto.randomUUID()),
    cancelKey = useRef(crypto.randomUUID()),
    returnKey = useRef(crypto.randomUUID());
  const actionLock = useRef(false),
    main = useRef<HTMLElement>(null);
  function go(next: Page) {
    setPage(next);
    setError("");
    setNotice("");
    setCancelItem(null);
    setReturnItem(null);
  }
  useEffect(() => {
    main.current?.focus();
    window.scrollTo({ top: 0 });
  }, [page]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      api
        .products(
          new URLSearchParams({ q, category, sort, limit: "24" }).toString(),
          controller.signal,
        )
        .then((r) => {
          setCatalog(r.data);
          setCursor(r.page.next_cursor);
          setCategories((c) =>
            [...new Set([...c, ...r.data.map((p) => p.category)])].sort(),
          );
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, q, category, sort]);
  async function action(work: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  async function openProduct(p: ProductSummary) {
    go("product");
    setSelected(p);
    setAvailability(null);
    setQuantity(1);
    await action(async () => {
      setAvailability(await api.availability(p.product_id));
    });
  }
  async function loadHistory() {
    if (!token) {
      go("login");
      return;
    }
    go("orders");
    await action(async () => {
      const result = await api.orders();
      setOrders(result.data);
      setHistoryCursor(result.page.next_cursor);
    });
  }
  async function openOrder(id: number) {
    await action(async () => {
      setOrder(await api.order(id));
      go("order");
    });
  }
  function add() {
    if (!selected) return;
    const existing =
      cart.find((l) => l.product.product_id === selected.product_id)
        ?.quantity ?? 0;
    const available =
      availability?.available_quantity ?? selected.available_quantity;
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      existing + quantity > available
    ) {
      setError("Choose a quantity within the currently shown availability.");
      return;
    }
    setCart((c) =>
      c.some((l) => l.product.product_id === selected.product_id)
        ? c.map((l) =>
            l.product.product_id === selected.product_id
              ? { ...l, quantity: l.quantity + quantity }
              : l,
          )
        : [...c, { product: selected, quantity }],
    );
    placementKey.current = crypto.randomUUID();
    setNotice(
      "Added to your bag. Availability will be rechecked at order placement.",
    );
  }
  async function login(e: FormEvent) {
    e.preventDefault();
    await action(async () => {
      const result = register
        ? await api.register({
            email,
            password,
            first_name: firstName,
            last_name: lastName,
            region: destination.region,
          })
        : await api.login(email, password);
      if (result.user.role !== "customer")
        throw new Error("Use a customer account for this shopping module.");
      tokenRef.current = result.access_token;
      setToken(result.access_token);
      setPassword("");
      go(cart.length ? "checkout" : "orders");
      if (!cart.length) {
        const r = await api.orders();
        setOrders(r.data);
        setHistoryCursor(r.page.next_cursor);
      }
    });
  }
  async function place(e: FormEvent) {
    e.preventDefault();
    await action(async () => {
      const result = await api.place(
        {
          destination,
          service_level: service,
          items: cart.map((l) => ({
            product_id: l.product.product_id,
            quantity: l.quantity,
          })),
        },
        placementKey.current,
      );
      setOrder(result);
      setCart([]);
      placementKey.current = crypto.randomUUID();
      go("confirmation");
    });
  }
  async function cancel(e: FormEvent) {
    e.preventDefault();
    if (!order || !cancelItem) return;
    await action(async () => {
      const result = await api.cancel(
        order.order_id,
        { items: [{ order_item_id: cancelItem, quantity: cancelQty }] },
        cancelKey.current,
      );
      setOrder(result);
      setCancelItem(null);
      setNotice("Unshipped quantities canceled. Reservations were released.");
    });
  }
  async function requestReturn(e: FormEvent) {
    e.preventDefault();
    if (!order || !returnItem) return;
    await action(async () => {
      const result = await api.returnItems(
        {
          items: [
            { shipment_item_id: returnItem, quantity: returnQty, reason },
          ],
        },
        returnKey.current,
      );
      setOrder(await api.order(order.order_id));
      setReturnItem(null);
      setNotice(
        `Return ${result.rma_code} requested. Warehouse authorization, receipt and inspection happen separately.`,
      );
    });
  }
  const total = cart.reduce(
    (n, l) => n + cents(l.product.list_price) * l.quantity,
    0,
  );
  const planned =
    order?.allocations.filter(
      (a) => a.allocated_quantity > a.shipped_quantity + a.released_quantity,
    ) ?? [];
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="announcement">
        Fieldwork customer module{" "}
        <span>
          Connected to the team API · Payments and carrier events are simulated
        </span>
      </div>
      <header className="header">
        <button className="brand" onClick={() => go("catalog")}>
          fieldwork.
        </button>
        <nav aria-label="Main navigation">
          <button onClick={() => go("catalog")}>Shop essentials</button>
          <button onClick={loadHistory} disabled={busy}>
            My orders
          </button>
        </nav>
        <div className="live-account">
          {token ? (
            <button
              onClick={() =>
                action(async () => {
                  await api.logout();
                  tokenRef.current = null;
                  setToken(null);
                  setOrders([]);
                  setOrder(null);
                  go("catalog");
                })
              }
            >
              Sign out
            </button>
          ) : (
            <button onClick={() => go("login")}>Sign in</button>
          )}
          <button className="bag" onClick={() => go("cart")}>
            Bag <span>{cart.reduce((n, l) => n + l.quantity, 0)}</span>
          </button>
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
        {page === "catalog" && (
          <section className="collection">
            <div className="eyebrow">
              EVERYDAY ESSENTIALS / THREE WAREHOUSES
            </div>
            <h1>
              Good tools.
              <br />A clear way home.
            </h1>
            <p>
              Browse the team catalog. Every order is reserved together, with
              each shipment in view.
            </p>
            <div className="catalog-controls">
              <label className="search">
                Search
                <input
                  aria-label="Search products"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Product name or SKU"
                />
              </label>
              <label>
                Category{" "}
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Sort{" "}
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="featured">Featured</option>
                  <option value="price_asc">Price: low to high</option>
                  <option value="price_desc">Price: high to low</option>
                </select>
              </label>
            </div>
            {loading ? (
              <div className="empty" role="status">
                Loading products…
              </div>
            ) : !catalog.length ? (
              <div className="empty">
                <h2>
                  {error
                    ? "The catalog is unavailable."
                    : "No products match your search."}
                </h2>
                <p>
                  {error
                    ? "Check that the backend is running, then retry."
                    : "Try a broader search or clear your filters."}
                </p>
                <button
                  className="secondary"
                  onClick={() => {
                    setQ("");
                    setCategory("");
                    setSort("featured");
                    action(async () => {
                      const r = await api.products("limit=24");
                      setCatalog(r.data);
                      setCursor(r.page.next_cursor);
                    });
                  }}
                >
                  Reload collection
                </button>
              </div>
            ) : (
              <div className="product-grid">
                {catalog.map((p) => (
                  <button
                    key={p.product_id}
                    data-testid={`product-${p.product_id}`}
                    className="product-card"
                    disabled={busy}
                    onClick={() => openProduct(p)}
                  >
                    <ProductArt product={illustration(p)} />
                    <div className="product-category">{p.category}</div>
                    <div className="product-title">
                      <h3>{p.name}</h3>
                      <span>{money(cents(p.list_price))}</span>
                    </div>
                    <p>{p.sku}</p>
                    <span
                      className={
                        p.available_quantity ? "availability" : "sold-out"
                      }
                    >
                      {p.available_quantity
                        ? `${p.available_quantity} available`
                        : "Currently unavailable"}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {cursor && (
              <button
                className="secondary more"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    const r = await api.products(
                      new URLSearchParams({
                        q,
                        category,
                        sort,
                        limit: "24",
                        cursor,
                      }).toString(),
                    );
                    setCatalog((c) => [...c, ...r.data]);
                    setCursor(r.page.next_cursor);
                  })
                }
              >
                Load more products
              </button>
            )}
          </section>
        )}
        {page === "product" && selected && (
          <section className="page-shell">
            <button className="text-button" onClick={() => go("catalog")}>
              Shop / {selected.category}
            </button>
            <div className="detail-grid">
              <ProductArt product={illustration(selected)} large />
              <div className="detail-copy">
                <div className="eyebrow">{selected.sku}</div>
                <h1>{selected.name}</h1>
                <div className="detail-price">
                  {money(cents(selected.list_price))}
                </div>
                <p>
                  Current availability across eligible active warehouses. Your
                  cart does not reserve inventory.
                </p>
                <div className="stock-box">
                  <strong>
                    {availability
                      ? `${availability.available_quantity} units available`
                      : "Checking availability…"}
                  </strong>
                  {availability?.warehouses.map((w) => (
                    <div className="stock-row" key={w.warehouse_id}>
                      <span>{w.name}</span>
                      <b>{w.available_quantity} available</b>
                    </div>
                  ))}
                  {availability && (
                    <small>
                      As of {new Date(availability.as_of).toLocaleString()}.
                      Rechecked when you order.
                    </small>
                  )}
                </div>
                <label className="quantity-label">
                  Quantity
                  <input
                    type="number"
                    min="1"
                    max={availability?.available_quantity || 1}
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  />
                </label>
                <button
                  className="primary full"
                  disabled={busy || !availability?.available_quantity}
                  onClick={add}
                >
                  Add to bag
                </button>
                {notice && (
                  <button
                    className="secondary full more"
                    onClick={() => go("cart")}
                  >
                    View bag
                  </button>
                )}
                <p className="small more">
                  Product illustration is indicative. No manufacturer image or
                  specifications have been supplied.
                </p>
              </div>
            </div>
          </section>
        )}
        {(page === "cart" || page === "checkout") && (
          <section className="page-shell">
            <div className="eyebrow">YOUR FIELDWORK</div>
            <h1>
              {page === "cart"
                ? "Your everyday, collected."
                : "Where should we send it?"}
            </h1>
            {!cart.length ? (
              <div className="empty">
                <h2>Your bag is empty.</h2>
                <button className="primary" onClick={() => go("catalog")}>
                  Explore essentials
                </button>
              </div>
            ) : (
              <div className="checkout-grid">
                <div>
                  {page === "cart" ? (
                    cart.map((l) => (
                      <div className="cart-line" key={l.product.product_id}>
                        <ProductArt product={illustration(l.product)} />
                        <div>
                          <h3>{l.product.name}</h3>
                          <p>
                            {money(cents(l.product.list_price))} each ·
                            Indicative price
                          </p>
                          <label>
                            Quantity{" "}
                            <input
                              aria-label={`Quantity for ${l.product.name}`}
                              type="number"
                              min="1"
                              max="1000000"
                              value={l.quantity}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                if (
                                  Number.isSafeInteger(n) &&
                                  n > 0 &&
                                  n <= 1000000
                                ) {
                                  setCart((c) =>
                                    c.map((x) =>
                                      x.product.product_id ===
                                      l.product.product_id
                                        ? { ...x, quantity: n }
                                        : x,
                                    ),
                                  );
                                  placementKey.current = crypto.randomUUID();
                                }
                              }}
                            />
                          </label>
                          <button
                            className="text-button"
                            onClick={() => {
                              setCart((c) => c.filter((x) => x !== l));
                              placementKey.current = crypto.randomUUID();
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <form
                      id="live-checkout"
                      className="form-panel"
                      onSubmit={place}
                    >
                      <h2>Delivery details</h2>
                      {(
                        [
                          "name",
                          "line1",
                          "line2",
                          "city",
                          "postal_code",
                        ] as const
                      ).map((field) => (
                        <label key={field}>
                          {
                            {
                              name: "Recipient name",
                              line1: "Address line 1",
                              line2: "Address line 2 (optional)",
                              city: "City",
                              postal_code: "Postal code",
                            }[field]
                          }
                          <input
                            required={field !== "line2"}
                            maxLength={
                              field === "postal_code"
                                ? 20
                                : field === "city"
                                  ? 100
                                  : field === "name"
                                    ? 120
                                    : 200
                            }
                            value={destination[field] ?? ""}
                            onChange={(e) => {
                              setDestination((d) => ({
                                ...d,
                                [field]: e.target.value,
                              }));
                              placementKey.current = crypto.randomUUID();
                            }}
                          />
                        </label>
                      ))}
                      <label>
                        Region
                        <select
                          value={destination.region}
                          onChange={(e) => {
                            setDestination((d) => ({
                              ...d,
                              region: e.target.value,
                            }));
                            placementKey.current = crypto.randomUUID();
                          }}
                        >
                          <option value="east">East</option>
                          <option value="central">Central</option>
                          <option value="west">West</option>
                        </select>
                      </label>
                      <label>
                        Service level
                        <select
                          value={service}
                          onChange={(e) => {
                            setService(e.target.value as typeof service);
                            placementKey.current = crypto.randomUUID();
                          }}
                        >
                          <option value="standard">Standard</option>
                          <option value="expedited">Expedited</option>
                        </select>
                      </label>
                      <div className="stock-box">
                        <strong>
                          United States delivery · Simulated payment
                        </strong>
                        <p>
                          No payment is collected. This baseline has no tax or
                          shipping charge calculation, service-level surcharge
                          or carrier ETA. Active warehouses serve all three
                          regions until the team defines service eligibility.
                        </p>
                      </div>
                    </form>
                  )}
                </div>
                <aside className="summary">
                  <h2>Your bag</h2>
                  {cart.map((l) => (
                    <div className="summary-row" key={l.product.product_id}>
                      <span>
                        {l.product.name} × {l.quantity}
                      </span>
                      <span>
                        {money(cents(l.product.list_price) * l.quantity)}
                      </span>
                    </div>
                  ))}
                  <div className="summary-total">
                    <span>Merchandise estimate</span>
                    <span>{money(total)}</span>
                  </div>
                  {page === "cart" ? (
                    <button
                      key="live-next"
                      type="button"
                      className="primary full"
                      onClick={(e) => {
                        e.preventDefault();
                        go(token ? "checkout" : "login");
                      }}
                    >
                      Continue to checkout
                    </button>
                  ) : (
                    <button
                      key="live-place"
                      form="live-checkout"
                      type="submit"
                      className="primary full"
                      disabled={busy}
                    >
                      {busy
                        ? "Reserving all items…"
                        : "Place order · Simulated payment"}
                    </button>
                  )}
                  <p className="small more">
                    Final purchase prices and allocations are confirmed by the
                    server. Stock shortages leave your bag intact.
                  </p>
                </aside>
              </div>
            )}
          </section>
        )}
        {page === "login" && (
          <section className="page-shell narrow">
            <div className="eyebrow">YOUR ORDERS, YOUR ACCOUNT</div>
            <h1>{register ? "Make yourself at home." : "Welcome back."}</h1>
            <p>
              Sign in through the team authentication service. Your token stays
              in memory and expires after 15 minutes.
            </p>
            <form className="form-panel" onSubmit={login}>
              {register && (
                <>
                  <label>
                    First name
                    <input
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </label>
                  <label>
                    Last name
                    <input
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </label>
                </>
              )}
              <label>
                Email
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  required
                  autoComplete={register ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="primary" type="submit" disabled={busy}>
                {busy
                  ? "Connecting…"
                  : register
                    ? "Create customer account"
                    : "Sign in"}
              </button>
              <button
                type="button"
                className="text-button more"
                onClick={() => setRegister((r) => !r)}
              >
                {register
                  ? "Use an existing account"
                  : "Create a customer account"}
              </button>
            </form>
            <p className="small more">
              Use purpose-created demo credentials from the team setup. Do not
              enter personal credentials into an untrusted deployment.
            </p>
          </section>
        )}
        {page === "orders" && (
          <section className="page-shell">
            <div className="eyebrow">YOUR FIELDWORK</div>
            <h1>Your orders, in view.</h1>
            {busy ? (
              <p role="status">Loading your orders…</p>
            ) : !orders.length ? (
              <div className="empty">
                <h2>No orders yet.</h2>
                <button className="primary" onClick={() => go("catalog")}>
                  Explore essentials
                </button>
              </div>
            ) : (
              orders.map((o) => (
                <button
                  className="order-row"
                  key={o.order_id}
                  onClick={() => openOrder(o.order_id)}
                >
                  <div>
                    <strong>Order #{o.order_id}</strong>
                    <p>
                      {new Date(o.placed_at).toLocaleString()} · {o.quantity}{" "}
                      units
                    </p>
                  </div>
                  <span className="status-pill">{readable(o.status)}</span>
                  <strong>{money(cents(o.total))}</strong>
                  <span>View order</span>
                </button>
              ))
            )}
            {historyCursor && (
              <button
                className="secondary more"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    const r = await api.orders(historyCursor);
                    setOrders((o) => [...o, ...r.data]);
                    setHistoryCursor(r.page.next_cursor);
                  })
                }
              >
                Load older orders
              </button>
            )}
          </section>
        )}
        {(page === "order" || page === "confirmation") && order && (
          <section className="page-shell">
            <div className="eyebrow">
              ORDER #{order.order_id} / {readable(order.status).toUpperCase()}
            </div>
            <h1>
              {page === "confirmation"
                ? "Every item, reserved."
                : "Your order, in view."}
            </h1>
            <p>
              {order.destination_name} · {order.destination_line1},{" "}
              {order.destination_city} ·{" "}
              {new Date(order.placed_at).toLocaleString()}
            </p>
            <p>
              <strong>
                Purchase-time merchandise total:{" "}
                {money(
                  order.items.reduce(
                    (n, i) => n + cents(i.unit_price) * i.quantity,
                    0,
                  ),
                )}
              </strong>
            </p>
            {page === "confirmation" && (
              <div className="notice">
                Every item in your order is reserved. Fulfillment plans below
                show where it will come from. Tracking appears after warehouse
                fulfillment. No real payment was collected.
              </div>
            )}
            {planned.length > 0 && (
              <>
                <h2 className="more">Reserved fulfillment plans</h2>
                <div className="shipment-grid">
                  {[...new Set(planned.map((a) => a.warehouse_id))].map((w) => (
                    <article className="shipment-card" key={w}>
                      <div className="eyebrow">NOT YET SHIPPED</div>
                      <h2>
                        {
                          planned.find((a) => a.warehouse_id === w)!
                            .warehouse_name
                        }
                      </h2>
                      {planned
                        .filter((a) => a.warehouse_id === w)
                        .map((a) => (
                          <div className="manage-line" key={a.allocation_id}>
                            <strong>
                              {
                                order.items.find(
                                  (i) => i.product_id === a.product_id,
                                )?.name
                              }
                            </strong>
                            <p>
                              {a.allocated_quantity -
                                a.shipped_quantity -
                                a.released_quantity}{" "}
                              reserved · Lot {a.lot_code}
                            </p>
                          </div>
                        ))}
                    </article>
                  ))}
                </div>
              </>
            )}
            <h2 className="more">Shipment tracking</h2>
            {!order.shipments.length ? (
              <p>
                No shipments have been created yet. Tracking appears when the
                warehouse team records fulfillment.
              </p>
            ) : (
              <div className="shipment-grid">
                {order.shipments.map((s) => (
                  <article className="shipment-card" key={s.shipment_id}>
                    <div className="eyebrow">SHIPMENT #{s.shipment_id}</div>
                    <h2>{s.warehouse_name}</h2>
                    <span className="status-pill">{readable(s.status)}</span>
                    {s.tracking_code && (
                      <p className="more">
                        Tracking code: {s.tracking_code} · Simulated carrier
                      </p>
                    )}
                    {s.items.map((i) => (
                      <div className="manage-line" key={i.shipment_item_id}>
                        <strong>
                          {
                            order.items.find(
                              (l) => l.order_item_id === i.order_item_id,
                            )?.name
                          }
                        </strong>
                        <p>
                          {i.quantity} shipped · Lot {i.lot_code}
                        </p>
                        {i.returnable_quantity > 0 && (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => {
                              setReturnItem(i.shipment_item_id);
                              setReturnQty(1);
                              setReason("");
                              returnKey.current = crypto.randomUUID();
                            }}
                          >
                            Return delivered units ({i.returnable_quantity})
                          </button>
                        )}
                      </div>
                    ))}
                    <ol className="timeline">
                      {s.events.map((e, i) => (
                        <li className="done" key={i}>
                          <strong>{readable(e.event_type)}</strong>
                          <span>
                            {new Date(e.occurred_at).toLocaleString()} ·
                            Simulated
                          </span>
                        </li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
            )}
            <div className="management">
              <div>
                <h2>Manage your quantities</h2>
                {order.items.map((i) => (
                  <div className="manage-line" key={i.order_item_id}>
                    <strong>{i.name}</strong>
                    <p>
                      {i.quantity} ordered · {i.shipped_quantity} shipped ·{" "}
                      {i.delivered_quantity} delivered · {i.cancelled_quantity}{" "}
                      canceled
                    </p>
                    <p>{money(cents(i.unit_price))} per unit at purchase</p>
                    {i.cancellable_quantity > 0 && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setCancelItem(i.order_item_id);
                          setCancelQty(1);
                          cancelKey.current = crypto.randomUUID();
                        }}
                      >
                        Cancel unshipped units ({i.cancellable_quantity})
                      </button>
                    )}
                  </div>
                ))}
                {cancelItem && (
                  <form className="form-panel" onSubmit={cancel}>
                    <label>
                      Quantity to cancel
                      <input
                        type="number"
                        required
                        min="1"
                        max={
                          order.items.find(
                            (i) => i.order_item_id === cancelItem,
                          )!.cancellable_quantity
                        }
                        value={cancelQty}
                        onChange={(e) => {
                          setCancelQty(Number(e.target.value));
                          cancelKey.current = crypto.randomUUID();
                        }}
                      />
                    </label>
                    <button type="submit" className="primary" disabled={busy}>
                      Confirm cancellation
                    </button>
                    <button
                      type="button"
                      className="text-button more"
                      onClick={() => setCancelItem(null)}
                    >
                      Keep items
                    </button>
                  </form>
                )}
              </div>
              <aside>
                <h2>Return requests</h2>
                {order.returns.length ? (
                  order.returns.map((r) => (
                    <div className="manage-line" key={r.return_id}>
                      <strong>{r.rma_code}</strong>
                      <p>
                        {readable(r.status)} ·{" "}
                        {r.items.reduce(
                          (n, i) =>
                            n + (i.requested_quantity ?? i.quantity ?? 0),
                          0,
                        )}{" "}
                        units
                      </p>
                    </div>
                  ))
                ) : (
                  <p>
                    No return requests. Delivered shipment items show an
                    eligible return action above.
                  </p>
                )}
                {returnItem && (
                  <form className="form-panel" onSubmit={requestReturn}>
                    <label>
                      Return quantity
                      <input
                        type="number"
                        required
                        min="1"
                        max={
                          order.shipments
                            .flatMap((s) => s.items)
                            .find((i) => i.shipment_item_id === returnItem)!
                            .returnable_quantity
                        }
                        value={returnQty}
                        onChange={(e) => {
                          setReturnQty(Number(e.target.value));
                          returnKey.current = crypto.randomUUID();
                        }}
                      />
                    </label>
                    <label>
                      Reason
                      <textarea
                        required
                        maxLength={500}
                        value={reason}
                        onChange={(e) => {
                          setReason(e.target.value);
                          returnKey.current = crypto.randomUUID();
                        }}
                      />
                    </label>
                    <p className="small">
                      A request does not receive, inspect, restock, refund or
                      replace an item.
                    </p>
                    <button type="submit" className="primary" disabled={busy}>
                      Submit return request
                    </button>
                    <button
                      type="button"
                      className="text-button more"
                      onClick={() => setReturnItem(null)}
                    >
                      Keep item
                    </button>
                  </form>
                )}
              </aside>
            </div>
            <button
              className="secondary more"
              disabled={busy}
              onClick={() => openOrder(order.order_id)}
            >
              Refresh order & tracking
            </button>
          </section>
        )}
      </main>
      <footer>
        <div>
          <span className="footer-brand">fieldwork.</span>
          <p>One order. Every quantity accounted for.</p>
        </div>
        <p>
          Team database mode · Shared authentication
          <br />
          Payments and carrier events are simulated.
        </p>
        <a href="?mode=mock">Open fictional midterm prototype</a>
      </footer>
    </>
  );
}
