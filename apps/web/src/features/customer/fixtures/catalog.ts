// Fictional, deterministic presentation data. These are not shared contract definitions.
export interface Product {
  id: string;
  name: string;
  category: string;
  priceCents: number;
  color: string;
  art: "mouse" | "headphones" | "hub" | "keyboard" | "charger" | "speaker";
  description: string;
  stocks: [number, number, number];
  tag: string;
}
export const warehouses = ["Newark, NJ", "Columbus, OH", "Reno, NV"] as const;
export const products: Product[] = [
  {
    id: "p1",
    name: "Arc Wireless Mouse",
    category: "Workspace",
    priceCents: 3900,
    color: "#ceddca",
    art: "mouse",
    description:
      "A quieter click. A more comfortable workday. A sculpted wireless mouse with a recycled shell, USB-C charging and three-device pairing.",
    stocks: [3, 2, 0],
    tag: "Small details. Better days.",
  },
  {
    id: "p2",
    name: "Still Over-Ear Headphones",
    category: "Audio",
    priceCents: 12900,
    color: "#d3cce2",
    art: "headphones",
    description:
      "Find your focus with soft ear cushions, balanced audio and up to 30 hours of listening.",
    stocks: [8, 4, 3],
    tag: "Make room for focus.",
  },
  {
    id: "p3",
    name: "Link 6-in-1 USB-C Hub",
    category: "Connectivity",
    priceCents: 5900,
    color: "#ead5bf",
    art: "hub",
    description:
      "One connection for your everyday essentials. HDMI, USB-A, card reader and pass-through charging.",
    stocks: [6, 12, 4],
    tag: "Everything, connected.",
  },
  {
    id: "p4",
    name: "Form Compact Keyboard",
    category: "Workspace",
    priceCents: 8900,
    color: "#cddde6",
    art: "keyboard",
    description:
      "A compact layout with tactile keys and a little more space for the things that matter.",
    stocks: [5, 3, 7],
    tag: "Space to do your thing.",
  },
  {
    id: "p5",
    name: "Pocket 65W Charger",
    category: "Connectivity",
    priceCents: 4500,
    color: "#e5dfb9",
    art: "charger",
    description:
      "A small, capable dual-port charger for your desk, your bag and everywhere between.",
    stocks: [0, 0, 0],
    tag: "Less to carry.",
  },
  {
    id: "p6",
    name: "Room Mini Speaker",
    category: "Audio",
    priceCents: 6900,
    color: "#d8c6bc",
    art: "speaker",
    description:
      "Warm sound in a compact speaker, with simple controls and a woven fabric finish.",
    stocks: [4, 8, 2],
    tag: "Good company.",
  },
];
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
