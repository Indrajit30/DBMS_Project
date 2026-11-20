import type { Product } from "../fixtures/catalog";
export default function ProductArt({
  product,
  large = false,
}: {
  product: Product;
  large?: boolean;
}) {
  return (
    <div
      className={`product-art ${large ? "large" : ""}`}
      style={{ background: product.color }}
    >
      <svg
        viewBox="0 0 320 240"
        role="img"
        aria-label={`${product.name} illustration`}
      >
        <defs>
          <linearGradient id={`body-${product.id}`} x2="1" y2="1">
            <stop stopColor="#fafbf8" />
            <stop offset="1" stopColor="#b9c1bd" />
          </linearGradient>
          <filter id={`shadow-${product.id}`}>
            <feDropShadow dx="4" dy="12" stdDeviation="8" floodOpacity=".18" />
          </filter>
        </defs>
        <ellipse
          cx="161"
          cy="200"
          rx="78"
          ry="10"
          fill="#182c28"
          opacity=".08"
        />
        <g
          filter={`url(#shadow-${product.id})`}
          stroke="#7d8983"
          strokeWidth="1.3"
        >
          {product.art === "mouse" && (
            <g transform="rotate(-24 160 120)">
              <rect
                x="111"
                y="36"
                width="98"
                height="157"
                rx="49"
                fill={`url(#body-${product.id})`}
              />
              <path d="M160 38v70m-48-8h96" fill="none" />
              <rect
                x="155"
                y="62"
                width="10"
                height="27"
                rx="5"
                fill="#4b5750"
              />
              <path d="M130 163q28 13 59 0" opacity=".3" fill="none" />
            </g>
          )}
          {product.art === "headphones" && (
            <g transform="rotate(14 160 120)">
              <path
                d="M99 137v-34a61 61 0 01122 0v34"
                fill="none"
                stroke="#303a37"
                strokeWidth="20"
              />
              <path
                d="M101 92a60 60 0 01118 0"
                fill="none"
                stroke="#e0e3dc"
                strokeWidth="12"
              />
              <rect
                x="78"
                y="108"
                width="46"
                height="78"
                rx="20"
                fill="#343e3b"
              />
              <rect
                x="196"
                y="108"
                width="46"
                height="78"
                rx="20"
                fill="#343e3b"
              />
              <rect
                x="102"
                y="116"
                width="25"
                height="60"
                rx="10"
                fill="#7e8981"
              />
              <rect
                x="193"
                y="116"
                width="25"
                height="60"
                rx="10"
                fill="#7e8981"
              />
            </g>
          )}
          {product.art === "hub" && (
            <g transform="rotate(-22 160 120)">
              <path
                d="M206 109h20q35 0 35-38V50"
                fill="none"
                stroke="#39423f"
                strokeWidth="7"
              />
              <rect
                x="251"
                y="34"
                width="21"
                height="29"
                rx="4"
                fill="#bec5c1"
              />
              <rect
                x="72"
                y="88"
                width="147"
                height="69"
                rx="13"
                fill={`url(#body-${product.id})`}
              />
              <path
                d="M90 134h27m12 0h27m12 0h30"
                stroke="#38413d"
                strokeWidth="7"
              />
              <text
                x="118"
                y="116"
                stroke="none"
                fill="#56635b"
                fontSize="10"
                letterSpacing="3"
              >
                FIELDWORK
              </text>
            </g>
          )}
          {product.art === "keyboard" && (
            <g transform="rotate(-15 160 120)">
              <rect
                x="45"
                y="75"
                width="230"
                height="103"
                rx="10"
                fill="#4c605c"
              />
              {Array.from({ length: 4 }, (_, r) =>
                Array.from({ length: 12 }, (_, c) => (
                  <rect
                    key={`${r}-${c}`}
                    x={54 + c * 18}
                    y={84 + r * 19}
                    width="15"
                    height="15"
                    rx="2"
                    fill={r === 3 && c > 3 && c < 8 ? "#d0cfc0" : "#dfe5dc"}
                  />
                )),
              )}
              <rect
                x="126"
                y="141"
                width="69"
                height="15"
                rx="2"
                fill="#bdc6b8"
              />
            </g>
          )}
          {product.art === "charger" && (
            <g transform="rotate(-18 160 120)">
              <path d="M139 52V31m29 21V31" stroke="#7d8580" strokeWidth="10" />
              <rect
                x="110"
                y="51"
                width="95"
                height="127"
                rx="22"
                fill={`url(#body-${product.id})`}
              />
              <rect
                x="129"
                y="136"
                width="21"
                height="7"
                rx="3"
                fill="#39423f"
              />
              <rect
                x="166"
                y="136"
                width="21"
                height="7"
                rx="3"
                fill="#39423f"
              />
              <text x="139" y="97" fill="#6a766f" stroke="none" fontSize="13">
                65W
              </text>
            </g>
          )}
          {product.art === "speaker" && (
            <g>
              <rect
                x="98"
                y="51"
                width="124"
                height="136"
                rx="37"
                fill="#777a6b"
              />
              {Array.from({ length: 18 }, (_, i) => (
                <path
                  key={i}
                  d={`M${105 + i * 6} 78v80`}
                  stroke="#b5b6a4"
                  strokeWidth="2"
                  opacity=".5"
                />
              ))}
              <ellipse cx="160" cy="65" rx="48" ry="14" fill="#b8bca9" />
              <path d="M145 65h9m6-4v8m12-8v8" stroke="#5f695c" />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
