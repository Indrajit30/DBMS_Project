import { useEffect, useRef, useState } from "react";
import { products, warehouses, money } from "./fixtures/catalog";
import ProductArt from "./components/ProductArt";
import {
  createMockAdapter,
  type CartLine,
  type DemoOrder,
} from "./adapters/mock";
import "./styles/customer.css";
type Page =
  | "catalog"
  | "product"
  | "cart"
  | "checkout"
  | "confirmation"
  | "orders"
  | "order"
  | "returns";
const demoOrder: DemoOrder = {
  id: "FW-1038",
  lines: [{ productId: "p1", quantity: 5 }],
  allocations: [
    { productId: "p1", warehouse: 0, lot: "DEMO-p1-1", quantity: 3 },
    { productId: "p1", warehouse: 1, lot: "DEMO-p1-2", quantity: 2 },
  ],
  prices: { p1: 3900 },
  address: "42 Sample Street, Brooklyn, NY 11201",
  region: "Northeast",
  canceled: {},
  returns: {},
};
export default function CustomerApp() {
  const [page, setPage] = useState<Page>("catalog");
  const [selected, setSelected] = useState(products[0]);
  const [quantity, setQuantity] = useState(1);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All essentials");
  const [sort, setSort] = useState("featured");
  const [orders, setOrders] = useState<DemoOrder[]>([
    structuredClone(demoOrder),
  ]);
  const [orderId, setOrderId] = useState(demoOrder.id);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [address, setAddress] = useState(
    "42 Sample Street, Brooklyn, NY 11201",
  );
  const [region, setRegion] = useState("Northeast");
  const [returnItem, setReturnItem] = useState("");
  const [returnQuantity, setReturnQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const [cancelId, setCancelId] = useState("");
  const [cancelQty, setCancelQty] = useState(1);
  const [scenario, setScenario] = useState("normal");
  const adapter = useRef(createMockAdapter());
  const requestKey = useRef(crypto.randomUUID());
  const main = useRef<HTMLElement>(null);
  const order = orders.find((o) => o.id === orderId)!;
  const total = cart.reduce(
    (n, l) =>
      n + products.find((p) => p.id === l.productId)!.priceCents * l.quantity,
    0,
  );
  const count = cart.reduce((n, l) => n + l.quantity, 0);
  function go(next: Page) {
    setPage(next);
    setError("");
    setMessage("");
    setCancelId("");
    setScenario("normal");
  }
  useEffect(() => {
    main.current?.focus();
    window.scrollTo({ top: 0 });
  }, [page]);
  function add() {
    const existing =
      cart.find((l) => l.productId === selected.id)?.quantity ?? 0;
    if (existing + quantity > selected.stocks.reduce((a, b) => a + b, 0)) {
      setError(
        "Only " +
          selected.stocks.reduce((a, b) => a + b, 0) +
          " units are shown available. Reduce your quantity.",
      );
      return;
    }
    setCart((c) =>
      c.some((l) => l.productId === selected.id)
        ? c.map((l) =>
            l.productId === selected.id
              ? { ...l, quantity: l.quantity + quantity }
              : l,
          )
        : [...c, { productId: selected.id, quantity }],
    );
    requestKey.current = crypto.randomUUID();
    setError("");
    setMessage(`${quantity} × ${selected.name} added to your bag.`);
  }
  async function place(event: React.FormEvent) {
    event.preventDefault();
    if (!cart.length || loading) return;
    setLoading(true);
    setError("");
    await new Promise((resolve) => setTimeout(resolve, 650));
    try {
      if (scenario === "error")
        throw new Error(
          "Stock changed. We could not reserve every item. Your cart has been kept; no order was placed.",
        );
      const created = await adapter.current.place(
        cart,
        address,
        region,
        requestKey.current,
      );
      setOrders((o) => [created, ...o.filter((x) => x.id !== created.id)]);
      setOrderId(created.id);
      setCart([]);
      go("confirmation");
      requestKey.current = crypto.randomUUID();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  // The fixture journey has shipment 0 delivered and shipment 1 not yet dispatched.
  function shipped(o: DemoOrder, productId: string) {
    return o.allocations
      .filter((a) => a.productId === productId && a.warehouse === 0)
      .reduce((n, a) => n + a.quantity, 0);
  }
  function remaining(o: DemoOrder, productId: string) {
    return Math.max(
      0,
      o.lines.find((l) => l.productId === productId)!.quantity -
        shipped(o, productId) -
        (o.canceled[productId] ?? 0),
    );
  }
  function cancel(event: React.FormEvent) {
    event.preventDefault();
    if (
      !Number.isSafeInteger(cancelQty) ||
      cancelQty < 1 ||
      cancelQty > remaining(order, cancelId)
    ) {
      setError("Choose a quantity within the unshipped remainder.");
      return;
    }
    setOrders((os) =>
      os.map((o) =>
        o.id === order.id
          ? {
              ...o,
              canceled: {
                ...o.canceled,
                [cancelId]: (o.canceled[cancelId] ?? 0) + cancelQty,
              },
            }
          : o,
      ),
    );
    setCancelId("");
    setMessage(
      `${cancelQty} unshipped unit(s) canceled in this preview. Delivered units are unchanged.`,
    );
  }
  function submitReturn(event: React.FormEvent) {
    event.preventDefault();
    const [productId, warehouseIndex] = returnItem.split(":");
    const allocation = order.allocations.find(
      (a) =>
        a.productId === productId && a.warehouse === Number(warehouseIndex),
    );
    const eligible =
      (allocation?.warehouse === 0 ? allocation.quantity : 0) -
      (order.returns[returnItem] ?? 0);
    if (
      !reason ||
      !Number.isSafeInteger(returnQuantity) ||
      returnQuantity < 1 ||
      returnQuantity > eligible
    ) {
      setError(
        "Select a delivered item, an eligible quantity, and a return reason.",
      );
      return;
    }
    setOrders((os) =>
      os.map((o) =>
        o.id === order.id
          ? {
              ...o,
              returns: {
                ...o.returns,
                [returnItem]: (o.returns[returnItem] ?? 0) + returnQuantity,
              },
            }
          : o,
      ),
    );
    go("order");
    setMessage(
      `Return RMA-${order.id.slice(3)} requested for ${returnQuantity} unit(s). Awaiting authorization; no stock has been restocked.`,
    );
  }
  const visible = products
    .filter(
      (p) =>
        (category === "All essentials" || p.category === category) &&
        `${p.name} ${p.category}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "low"
        ? a.priceCents - b.priceCents
        : sort === "high"
          ? b.priceCents - a.priceCents
          : 0,
    );
  const orderTotal = order.lines.reduce(
    (n, l) => n + order.prices[l.productId] * l.quantity,
    0,
  );
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="announcement">
        Thoughtfully chosen essentials. Clearly tracked, from our shelves to
        your door. <span>Fictional store · Customer prototype</span>
      </div>
      <header className="header">
        <button
          className="brand"
          onClick={() => go("catalog")}
          aria-label="Fieldwork home"
        >
          <span className="brand-mark">
            f<span>✳</span>
          </span>
          fieldwork<span className="brand-period">.</span>
        </button>
        <nav aria-label="Main navigation">
          <button
            className={page === "catalog" || page === "product" ? "active" : ""}
            onClick={() => go("catalog")}
          >
            Shop essentials
          </button>
          <button
            className={page === "orders" || page === "order" ? "active" : ""}
            onClick={() => go("orders")}
          >
            My orders
          </button>
        </nav>
        <button className="bag" onClick={() => go("cart")}>
          Bag <span>{count}</span>
        </button>
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        {message && (
          <div className="notice" role="status">
            {message}{" "}
            {page === "product" && (
              <button onClick={() => go("cart")}>View bag</button>
            )}
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {page === "catalog" && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">THE EVERYDAY, CONSIDERED</div>
                <h1>
                  Good tools.
                  <br />
                  Less friction.
                </h1>
                <p>
                  Meet the little things that make work and life flow.
                  <br className="desktop" /> Useful by design. Ready for your
                  everyday.
                </p>
                <a className="primary" href="#collection">
                  Explore the collection
                </a>
                <div className="hero-foot">
                  <span>01 / THE WORKDAY EDIT</span>
                  <span>Made for your kind of day</span>
                </div>
              </div>
              <div className="hero-art">
                <span className="hero-label">A LITTLE MORE FOCUS.</span>
                <ProductArt product={products[1]} large />
                <div className="hero-caption">
                  <div>
                    <small>YOUR SPACE, UPGRADED</small>
                    <strong>Still Over-Ear Headphones</strong>
                  </div>
                  <button
                    aria-label="Explore Still headphones"
                    onClick={() => {
                      setSelected(products[1]);
                      setQuantity(1);
                      go("product");
                    }}
                  >
                    Discover · $129
                  </button>
                </div>
              </div>
            </section>
            <section className="benefits" aria-label="Shopping benefits">
              <div>
                <span>▦</span>
                <strong>One store. Three warehouses.</strong>
                <small>Stock where you need it.</small>
              </div>
              <div>
                <span>✓</span>
                <strong>Availability you can understand</strong>
                <small>Confirmed when you place your order.</small>
              </div>
              <div>
                <span>◷</span>
                <strong>Every shipment, in view</strong>
                <small>Clear tracking. Simple returns.</small>
              </div>
            </section>
            <section id="collection" className="collection">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">LESS CLUTTER. MORE POSSIBILITY.</div>
                  <h2>Your everyday essentials</h2>
                </div>
                <p>A small collection. A better routine.</p>
              </div>
              <div className="catalog-controls">
                <div
                  className="tabs"
                  role="group"
                  aria-label="Product category"
                >
                  {["All essentials", "Workspace", "Audio", "Connectivity"].map(
                    (c) => (
                      <button
                        key={c}
                        aria-pressed={category === c}
                        className={category === c ? "selected" : ""}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ),
                  )}
                </div>
                <label className="search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    aria-label="Search products"
                    placeholder="Find your next essential"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              <div className="results-bar">
                <span>
                  {scenario === "empty" ? 0 : visible.length} considered
                  essentials
                </span>
                <label>
                  Sort by{" "}
                  <select
                    aria-label="Sort products"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="featured">Featured</option>
                    <option value="low">Price: low to high</option>
                    <option value="high">Price: high to low</option>
                  </select>
                </label>
              </div>
              {scenario === "loading" ? (
                <div className="empty" role="status">
                  Getting the collection ready…
                </div>
              ) : scenario === "error" ? (
                <div className="empty">
                  <h3>We couldn’t load the collection.</h3>
                  <button
                    className="primary"
                    onClick={() => setScenario("normal")}
                  >
                    Try again
                  </button>
                </div>
              ) : !visible.length || scenario === "empty" ? (
                <div className="empty">
                  <h3>No essentials found.</h3>
                  <p>Try another search or browse the full collection.</p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setQuery("");
                      setCategory("All essentials");
                      setScenario("normal");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="product-grid">
                  {visible.map((p) => (
                    <button
                      className="product-card"
                      key={p.id}
                      onClick={() => {
                        setSelected(p);
                        setQuantity(1);
                        go("product");
                      }}
                    >
                      <div className="art-wrap">
                        <ProductArt product={p} />
                        {p.id === "p1" && (
                          <span className="product-badge">
                            THE EVERYDAY FAVORITE
                          </span>
                        )}
                        {!p.stocks.some(Boolean) && (
                          <span className="product-badge">BACK SOON</span>
                        )}
                      </div>
                      <div className="product-category">{p.category}</div>
                      <div className="product-title">
                        <h3>{p.name}</h3>
                        <span>{money(p.priceCents)}</span>
                      </div>
                      <p>{p.tag}</p>
                      <span
                        className={
                          p.stocks.some(Boolean) ? "availability" : "sold-out"
                        }
                      >
                        {p.stocks.some(Boolean)
                          ? "Available to order"
                          : "Currently unavailable"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
        {page === "product" && (
          <section className="page-shell">
            <button className="text-button" onClick={() => go("catalog")}>
              Shop / {selected.category}
            </button>
            <div className="detail-grid">
              <ProductArt product={selected} large />
              <div className="detail-copy">
                <div className="eyebrow">
                  FIELDWORK / {selected.category.toUpperCase()}
                </div>
                <h1>{selected.name}</h1>
                <div className="detail-price">{money(selected.priceCents)}</div>
                <p>{selected.description}</p>
                <div className="stock-box">
                  <strong>
                    {selected.stocks.some(Boolean)
                      ? `${selected.stocks.reduce((a, b) => a + b, 0)} units available across our network`
                      : "Currently unavailable"}
                  </strong>
                  <p>
                    Sample availability. Stock is confirmed at order placement.
                  </p>
                  {warehouses.map((w, i) => (
                    <div className="stock-row" key={w}>
                      <span>{w}</span>
                      <b>{selected.stocks[i]} available</b>
                    </div>
                  ))}
                </div>
                <label className="quantity-label">
                  Quantity{" "}
                  <input
                    aria-label="Product quantity"
                    type="number"
                    min="1"
                    max={selected.stocks.reduce((a, b) => a + b, 0) || 1}
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  />
                </label>
                <button
                  className="primary full"
                  disabled={
                    !selected.stocks.some(Boolean) ||
                    !Number.isSafeInteger(quantity) ||
                    quantity < 1
                  }
                  onClick={add}
                >
                  Add to bag · {money(selected.priceCents * quantity || 0)}
                </button>
                <small>
                  Orders may arrive in separate shipments. You’ll see the
                  allocation after checkout.
                </small>
                <div className="detail-note">
                  <strong>Try the split-shipment story</strong>
                  <p>
                    Choose 5 Arc mice. Newark has 3 and Columbus has 2, so your
                    order travels in two shipments.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}
        {(page === "cart" || page === "checkout") && (
          <section className="page-shell">
            <div className="eyebrow">YOUR NEXT EVERYDAY</div>
            <h1>{page === "cart" ? "A few good things." : "Make it yours."}</h1>
            <div className="step-label">
              Bag <span>/</span> Delivery <span>/</span> Confirmation
            </div>
            {!cart.length ? (
              <div className="empty">
                <h2>Your bag has room for something good.</h2>
                <button className="primary" onClick={() => go("catalog")}>
                  Explore essentials
                </button>
              </div>
            ) : (
              <div className="checkout-grid">
                <div>
                  {page === "cart" ? (
                    cart.map((l) => {
                      const p = products.find((p) => p.id === l.productId)!;
                      return (
                        <div className="cart-line" key={p.id}>
                          <ProductArt product={p} />
                          <div>
                            <h3>{p.name}</h3>
                            <p>{money(p.priceCents)} each</p>
                            <label>
                              Quantity{" "}
                              <input
                                aria-label={`Quantity for ${p.name}`}
                                type="number"
                                min="1"
                                max={p.stocks.reduce((a, b) => a + b, 0)}
                                value={l.quantity}
                                onChange={(e) => {
                                  const q = Number(e.target.value);
                                  if (
                                    Number.isSafeInteger(q) &&
                                    q > 0 &&
                                    q <= p.stocks.reduce((a, b) => a + b, 0)
                                  ) {
                                    setCart((c) =>
                                      c.map((x) =>
                                        x.productId === p.id
                                          ? { ...x, quantity: q }
                                          : x,
                                      ),
                                    );
                                    requestKey.current = crypto.randomUUID();
                                  }
                                }}
                              />
                            </label>
                            <button
                              className="text-button"
                              onClick={() => {
                                setCart((c) =>
                                  c.filter((x) => x.productId !== p.id),
                                );
                                requestKey.current = crypto.randomUUID();
                              }}
                            >
                              Remove
                            </button>
                          </div>
                          <strong>{money(p.priceCents * l.quantity)}</strong>
                        </div>
                      );
                    })
                  ) : (
                    <form id="checkout" onSubmit={place} className="form-panel">
                      <h2>Where should we send it?</h2>
                      <p>
                        Fictional details are prefilled for this presentation.
                      </p>
                      <label>
                        Delivery address
                        <textarea
                          required
                          minLength={10}
                          value={address}
                          onChange={(e) => {
                            setAddress(e.target.value);
                            requestKey.current = crypto.randomUUID();
                          }}
                        />
                      </label>
                      <label>
                        Delivery region
                        <select
                          value={region}
                          onChange={(e) => {
                            setRegion(e.target.value);
                            requestKey.current = crypto.randomUUID();
                          }}
                        >
                          <option>Northeast</option>
                          <option>Midwest</option>
                          <option>West</option>
                        </select>
                      </label>
                      <div className="stock-box">
                        <strong>Payment · Simulated</strong>
                        <p>
                          No card details or money are collected. Shipping and
                          tax are $0 for this sample scenario.
                        </p>
                      </div>
                      <p>
                        We’ll try one eligible warehouse first, then split if
                        needed. Every item must be reserved for the order to
                        succeed.
                      </p>
                    </form>
                  )}
                </div>
                <aside className="summary">
                  <h2>Your order</h2>
                  {cart.map((l) => (
                    <div className="summary-row" key={l.productId}>
                      <span>
                        {products.find((p) => p.id === l.productId)!.name} ×{" "}
                        {l.quantity}
                      </span>
                      <span>
                        {money(
                          products.find((p) => p.id === l.productId)!
                            .priceCents * l.quantity,
                        )}
                      </span>
                    </div>
                  ))}
                  <div className="summary-row">
                    <span>Sample shipping & tax</span>
                    <span>$0.00</span>
                  </div>
                  <div className="summary-total">
                    <span>Total</span>
                    <span>{money(total)}</span>
                  </div>
                  {page === "cart" ? (
                    <button
                      key="continue-checkout"
                      type="button"
                      className="primary full"
                      onClick={(e) => {
                        e.preventDefault();
                        go("checkout");
                      }}
                    >
                      Continue to checkout
                    </button>
                  ) : (
                    <button
                      key="place-order"
                      className="primary full"
                      form="checkout"
                      type="submit"
                      disabled={loading}
                    >
                      {loading
                        ? "Confirming your sample order…"
                        : "Place sample order"}
                    </button>
                  )}
                  <p className="small">
                    Availability is indicative until confirmed. Your cart does
                    not reserve inventory.
                  </p>
                  {page === "checkout" && (
                    <button className="text-button" onClick={() => go("cart")}>
                      Edit bag
                    </button>
                  )}
                </aside>
              </div>
            )}
          </section>
        )}
        {page === "confirmation" && (
          <section className="page-shell">
            <div className="confirmation-head">
              <div className="success-icon">✓</div>
              <div className="eyebrow">
                ORDER {order.id} / SAMPLE CONFIRMATION
              </div>
              <h1>
                One order.
                <br />
                Thoughtfully on its way.
              </h1>
              <p>
                Your sample order is reserved.{" "}
                {new Set(order.allocations.map((a) => a.warehouse)).size > 1
                  ? "It will arrive in separate shipments, each with its own tracking."
                  : "It will ship from one warehouse."}
              </p>
            </div>
            <div className="shipment-grid">
              {[...new Set(order.allocations.map((a) => a.warehouse))].map(
                (w, i) => (
                  <article className="shipment-card" key={w}>
                    <div className="eyebrow">SHIPMENT {i + 1}</div>
                    <h2>{warehouses[w]}</h2>
                    <span className="status-pill">Reserved · Not shipped</span>
                    {order.allocations
                      .filter((a) => a.warehouse === w)
                      .map((a) => (
                        <div className="shipment-product" key={a.productId}>
                          <ProductArt
                            product={
                              products.find((p) => p.id === a.productId)!
                            }
                          />
                          <div>
                            <strong>
                              {products.find((p) => p.id === a.productId)!.name}
                            </strong>
                            <p>Quantity {a.quantity}</p>
                            <small>Lot {a.lot} · Sample trace</small>
                          </div>
                        </div>
                      ))}
                    <p className="small">
                      A tracking timeline will appear after dispatch.
                    </p>
                  </article>
                ),
              )}
            </div>
            <div className="confirmation-bottom">
              <p>
                <strong>{money(orderTotal)}</strong> sample total · Delivering
                to {order.address}
              </p>
              <button className="primary" onClick={() => go("order")}>
                View order & tracking
              </button>
              <button className="secondary" onClick={() => go("catalog")}>
                Continue exploring
              </button>
            </div>
          </section>
        )}
        {page === "orders" && (
          <section className="page-shell">
            <div className="eyebrow">YOUR FIELDWORK</div>
            <h1>Good things, accounted for.</h1>
            <p>
              Follow your shipments, manage unshipped items, and request a
              return.
            </p>
            {orders.map((o) => (
              <button
                key={o.id}
                className="order-row"
                onClick={() => {
                  setOrderId(o.id);
                  go("order");
                }}
              >
                <div>
                  <strong>{o.id}</strong>
                  <p>
                    {o.lines.reduce((n, l) => n + l.quantity, 0)} items ·{" "}
                    {o.id === "FW-1038"
                      ? "October 18, 2026 · Sample history"
                      : "Just placed · This session"}
                  </p>
                </div>
                <span className="status-pill">
                  {o.id === "FW-1038" ? "Partially delivered" : "Reserved"}
                </span>
                <strong>
                  {money(
                    o.lines.reduce(
                      (n, l) => n + o.prices[l.productId] * l.quantity,
                      0,
                    ),
                  )}
                </strong>
                <span>View order</span>
              </button>
            ))}
          </section>
        )}
        {page === "order" && (
          <section className="page-shell">
            <button className="text-button" onClick={() => go("orders")}>
              My orders / {order.id}
            </button>
            <div className="section-heading">
              <div>
                <div className="eyebrow">EVERY PART OF YOUR ORDER</div>
                <h1>Your order, in view.</h1>
              </div>
              <span className="status-pill">
                {order.id === "FW-1038" ? "Partially delivered" : "Reserved"}
              </span>
            </div>
            <p>
              {order.id} · {money(orderTotal)} original total · {order.address}
            </p>
            {order.id !== "FW-1038" && (
              <div className="notice">
                New sample orders remain reserved. To explore delivered tracking
                and returns,{" "}
                <button
                  onClick={() => {
                    setOrderId("FW-1038");
                    setMessage("");
                  }}
                >
                  open the sample delivery
                </button>
                .
              </div>
            )}
            <div className="shipment-grid">
              {[...new Set(order.allocations.map((a) => a.warehouse))].map(
                (w, i) => {
                  const delivered = order.id === "FW-1038" && w === 0;
                  return (
                    <article className="shipment-card" key={w}>
                      <div className="eyebrow">
                        SHIPMENT {i + 1} / {order.id}-S{w + 1}
                      </div>
                      <h2>{warehouses[w]}</h2>
                      <span className="status-pill">
                        {delivered
                          ? "Delivered"
                          : order.allocations
                                .filter((a) => a.warehouse === w)
                                .every(
                                  (a) =>
                                    (order.canceled[a.productId] ?? 0) >=
                                    order.lines.find(
                                      (l) => l.productId === a.productId,
                                    )!.quantity -
                                      (order.id === "FW-1038"
                                        ? shipped(order, a.productId)
                                        : 0),
                                )
                            ? "Canceled"
                            : "Reserved · Not shipped"}
                      </span>
                      {order.allocations
                        .filter((a) => a.warehouse === w)
                        .map((a) => (
                          <div className="shipment-product" key={a.productId}>
                            <ProductArt
                              product={
                                products.find((p) => p.id === a.productId)!
                              }
                            />
                            <div>
                              <strong>
                                {
                                  products.find((p) => p.id === a.productId)!
                                    .name
                                }
                              </strong>
                              <p>{a.quantity} originally allocated</p>
                              <small>Lot {a.lot}</small>
                            </div>
                          </div>
                        ))}
                      <ol className="timeline">
                        <li className="done">
                          <strong>Order reserved</strong>
                          <span>
                            {order.id === "FW-1038"
                              ? "Oct 18, 9:42 AM"
                              : "This session"}{" "}
                            · Sample event
                          </span>
                        </li>
                        <li className={delivered ? "done" : ""}>
                          <strong>
                            {delivered ? "Dispatched" : "Awaiting dispatch"}
                          </strong>
                          <span>
                            {delivered
                              ? "Oct 19, 2:10 PM · Simulated"
                              : "Unshipped units may be canceled"}
                          </span>
                        </li>
                        {delivered && (
                          <li className="done">
                            <strong>Delivered</strong>
                            <span>Oct 21, 11:24 AM · Simulated</span>
                          </li>
                        )}
                      </ol>
                    </article>
                  );
                },
              )}
            </div>
            <div className="management">
              <div>
                <h2>Manage your items</h2>
                {order.lines.map((l) => {
                  const delivered =
                    order.id === "FW-1038" ? shipped(order, l.productId) : 0;
                  const canCancel =
                    order.id === "FW-1038"
                      ? remaining(order, l.productId)
                      : l.quantity - (order.canceled[l.productId] ?? 0);
                  return (
                    <div className="manage-line" key={l.productId}>
                      <strong>
                        {products.find((p) => p.id === l.productId)!.name}
                      </strong>
                      <p>
                        {l.quantity} ordered · {delivered} delivered ·{" "}
                        {order.canceled[l.productId] ?? 0} canceled ·{" "}
                        {Object.entries(order.returns)
                          .filter(([k]) => k.startsWith(l.productId + ":"))
                          .reduce((n, [, q]) => n + q, 0)}{" "}
                        return requested
                      </p>
                      {canCancel > 0 && (
                        <button
                          className="secondary"
                          onClick={() => {
                            setCancelId(l.productId);
                            setCancelQty(1);
                          }}
                        >
                          Cancel unshipped units ({canCancel})
                        </button>
                      )}
                    </div>
                  );
                })}
                {cancelId && (
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      if (order.id !== "FW-1038") {
                        e.preventDefault();
                        const max =
                          order.lines.find((l) => l.productId === cancelId)!
                            .quantity - (order.canceled[cancelId] ?? 0);
                        if (
                          !Number.isSafeInteger(cancelQty) ||
                          cancelQty < 1 ||
                          cancelQty > max
                        ) {
                          setError("Choose an eligible unshipped quantity.");
                          return;
                        }
                        setOrders((os) =>
                          os.map((o) =>
                            o.id === order.id
                              ? {
                                  ...o,
                                  canceled: {
                                    ...o.canceled,
                                    [cancelId]:
                                      (o.canceled[cancelId] ?? 0) + cancelQty,
                                  },
                                }
                              : o,
                          ),
                        );
                        setCancelId("");
                        setMessage(
                          "Unshipped quantities canceled in this preview.",
                        );
                      } else cancel(e);
                    }}
                  >
                    <label>
                      Quantity to cancel
                      <input
                        type="number"
                        min="1"
                        max={
                          order.id === "FW-1038"
                            ? remaining(order, cancelId)
                            : order.lines.find((l) => l.productId === cancelId)!
                                .quantity - (order.canceled[cancelId] ?? 0)
                        }
                        value={cancelQty}
                        onChange={(e) => setCancelQty(Number(e.target.value))}
                      />
                    </label>
                    <button className="primary" type="submit">
                      Confirm cancellation
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setCancelId("")}
                    >
                      Keep items
                    </button>
                  </form>
                )}
              </div>
              <aside>
                <h2>Need to send something back?</h2>
                <p>
                  Request a return for delivered items. Receiving and inspection
                  happen separately.
                </p>
                <button
                  className="secondary"
                  disabled={
                    order.id !== "FW-1038" ||
                    !order.allocations.some(
                      (a) =>
                        a.warehouse === 0 &&
                        a.quantity >
                          (order.returns[`${a.productId}:${a.warehouse}`] ?? 0),
                    )
                  }
                  onClick={() => {
                    setReturnItem("");
                    setReturnQuantity(1);
                    setReason("");
                    go("returns");
                  }}
                >
                  Request a return
                </button>
                {Object.values(order.returns).some(Boolean) && (
                  <p className="small">
                    RMA-{order.id.slice(3)} · Requested · Awaiting authorization
                  </p>
                )}
              </aside>
            </div>
          </section>
        )}
        {page === "returns" && (
          <section className="page-shell narrow">
            <button className="text-button" onClick={() => go("order")}>
              Order {order.id} / Return request
            </button>
            <div className="eyebrow">A LITTLE HELP, WHEN YOU NEED IT</div>
            <h1>Let’s make it right.</h1>
            <p>
              Choose the delivered item you’d like to return. This request won’t
              restock any inventory.
            </p>
            <form className="form-panel" onSubmit={submitReturn}>
              <label>
                Delivered shipment item
                <select
                  required
                  value={returnItem}
                  onChange={(e) => {
                    setReturnItem(e.target.value);
                    setReturnQuantity(1);
                  }}
                >
                  <option value="">Select an eligible item</option>
                  {order.id === "FW-1038" &&
                    order.allocations
                      .filter(
                        (a) =>
                          a.warehouse === 0 &&
                          a.quantity >
                            (order.returns[`${a.productId}:${a.warehouse}`] ??
                              0),
                      )
                      .map((a) => (
                        <option
                          key={`${a.productId}:${a.warehouse}`}
                          value={`${a.productId}:${a.warehouse}`}
                        >
                          {products.find((p) => p.id === a.productId)!.name} · S
                          {a.warehouse + 1} ·{" "}
                          {a.quantity -
                            (order.returns[`${a.productId}:${a.warehouse}`] ??
                              0)}{" "}
                          eligible
                        </option>
                      ))}
                </select>
              </label>
              <label>
                Quantity
                <input
                  type="number"
                  required
                  min="1"
                  max={
                    returnItem
                      ? (order.allocations.find(
                          (a) => `${a.productId}:${a.warehouse}` === returnItem,
                        )?.quantity ?? 0) - (order.returns[returnItem] ?? 0)
                      : 1
                  }
                  value={returnQuantity}
                  onChange={(e) => setReturnQuantity(Number(e.target.value))}
                />
              </label>
              <label>
                Reason
                <select
                  aria-label="Reason"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  <option value="">Choose a reason</option>
                  <option value="damaged">Arrived damaged</option>
                  <option value="not-working">Not working as expected</option>
                  <option value="changed-mind">Changed my mind</option>
                </select>
              </label>
              <div className="stock-box">
                <strong>What happens next?</strong>
                <p>
                  Your request is reviewed, then receiving and inspection are
                  handled by the warehouse team. Refund and replacement policies
                  are pending team agreement.
                </p>
              </div>
              <button className="primary" type="submit">
                Submit sample return request
              </button>
            </form>
          </section>
        )}
      </main>
      <footer>
        <div>
          <span className="footer-brand">fieldwork.</span>
          <p>Useful things. A little more considered.</p>
        </div>
        <div>
          <strong>A clear path from shelf to doorstep.</strong>
          <p>3 warehouses · One connected customer experience</p>
        </div>
        <p className="small">
          Fictional products, prices and events.
          <br />
          Local prototype. Changes reset on reload.
        </p>
      </footer>
      <details className="demo-tools">
        <summary>Presentation controls</summary>
        <div>
          <p>
            Local fixtures only. No API, payment, database or sign-in
            connection.
          </p>
          <button
            onClick={() => {
              setSelected(products[0]);
              setQuantity(5);
              go("product");
            }}
          >
            Start 5-mouse split story
          </button>
          <button
            onClick={() => {
              setOrderId("FW-1038");
              go("order");
            }}
          >
            Open delivered sample
          </button>
          {(page === "catalog" || page === "checkout") && (
            <label>
              Preview state{" "}
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
              >
                <option value="normal">Normal</option>
                {page === "catalog" && (
                  <>
                    <option value="empty">Empty</option>
                    <option value="loading">Loading</option>
                  </>
                )}
                <option value="error">
                  {page === "checkout" ? "Stock conflict" : "Load error"}
                </option>
              </select>
            </label>
          )}
          <button onClick={() => window.location.reload()}>
            Reset sample session
          </button>
        </div>
      </details>
    </>
  );
}
