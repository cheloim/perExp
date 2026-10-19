import { useQuery } from "@tanstack/react-query";
import { getInvestments } from "../../api/client";
import type { Investment } from "../../types";
import { AssistantShell } from "./AssistantShell";
import { ASSISTANT_CONFIGS } from "./configs";
import type { AssistantDomain } from "./types";

export const DRAWER_OPEN_KEY = "ai_drawer_open";

export function readDrawerOpen(): boolean {
  try {
    return localStorage.getItem(DRAWER_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function persistDrawerOpen(open: boolean): void {
  try {
    localStorage.setItem(DRAWER_OPEN_KEY, open ? "true" : "false");
  } catch {
    /* ignore */
  }
}

function fmt(n: number): string {
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Portfolio snapshot handed to the investments endpoint as `context`. */
export function buildPortfolioContext(investments: Investment[]): string {
  const header = "=== CARTERA ACTUAL ===";
  // Never a silent blank. An empty portfolio is a fact the model must be told,
  // or it answers about positions it cannot see and sounds certain doing it.
  if (!investments.length) return `${header}\n(sin posiciones cargadas)`;
  const ars = investments.filter((i) => i.currency === "ARS");
  const usd = investments.filter((i) => i.currency === "USD");
  const arsV = ars.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0);
  const usdV = usd.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0);
  const arsC = ars.reduce((s, i) => s + i.cost_basis, 0);
  const usdC = usd.reduce((s, i) => s + i.cost_basis, 0);
  const sym = (c?: string) => (c === "USD" ? "u$s" : "$");
  const lines = [
    header,
    `ARS: $${fmt(arsV)} (costo $${fmt(arsC)}, P&L $${fmt(arsV - arsC)})`,
    `USD: u$s${fmt(usdV)} (costo u$s${fmt(usdC)}, P&L u$s${fmt(usdV - usdC)})`,
    "POSICIONES:",
    ...investments.map((inv) => {
      const v = inv.current_value ?? inv.cost_basis;
      const pnl =
        inv.pnl !== null
          ? ` P&L ${sym(inv.currency)}${fmt(inv.pnl)}${
              inv.pnl_pct !== null
                ? ` (${inv.pnl_pct >= 0 ? "+" : ""}${inv.pnl_pct.toFixed(2)}%)`
                : ""
            }`
          : "";
      const price =
        inv.current_price !== null ? sym(inv.currency) + fmt(inv.current_price) : "sin precio";
      return `- [${inv.ticker || inv.name}] ${inv.type} ${inv.broker} ${
        inv.quantity
      }u avg ${sym(inv.currency)}${fmt(inv.avg_cost)} actual ${price} valor ${sym(
        inv.currency,
      )}${fmt(v)}${pnl}`;
    }),
    "=== FIN CARTERA ===",
  ];
  return lines.join("\n");
}

/**
 * The one assistant.
 *
 * `AssistantShell` owns the session store and resolves the domain from the live
 * thread; this wrapper only supplies the config map, the route seed and the
 * extra request context. Keeping the store down there is deliberate: two hook
 * instances would keep independent state and the chrome would follow a frozen
 * mount-time snapshot instead of the thread.
 *
 * The floating trigger is route chrome — App decides *whether* to show it — but
 * it is labelled from the config of the domain the route seeded.
 */
export default function Assistant({
  open,
  onToggle,
  initialDomain,
  showTrigger = false,
}: {
  open: boolean;
  onToggle: () => void;
  initialDomain: AssistantDomain;
  /** Whether this surface owns the floating trigger. */
  showTrigger?: boolean;
}) {
  // The investments endpoint wants a portfolio snapshot the spending endpoint
  // ignores. Only fetched while the drawer is open — it is request context, not
  // app state, and fetching it on every route charged every spending user for it.
  const { data: investments } = useQuery<Investment[]>({
    queryKey: ["investments"],
    queryFn: () => getInvestments(),
    enabled: open,
  });

  // Persistence is the owner's job (App wires `onToggle` to the drawer flag and
  // the one localStorage writer), exactly as the Escape path expects.

  const triggerLabel = ASSISTANT_CONFIGS[initialDomain].triggerLabel;

  return (
    <>
      {showTrigger && !open && (
        <button
          onClick={onToggle}
          title={triggerLabel}
          aria-label={triggerLabel}
          className="fixed right-4 bottom-[calc(3.5rem+var(--browser-bottom-inset,0px))] md:bottom-6 z-50 w-10 h-10 bg-[var(--color-primary)] hover:brightness-110 rounded-full shadow-lg flex items-center justify-center text-[var(--color-on-primary)] transition-all duration-200"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </button>
      )}
      <AssistantShell
        configs={ASSISTANT_CONFIGS}
        initialDomain={initialDomain}
        open={open}
        onToggle={onToggle}
        buildContext={() =>
          investments === undefined
            ? "=== CARTERA ACTUAL ===\n(el resumen de posiciones no está disponible)"
            : buildPortfolioContext(investments)
        }
      />
    </>
  );
}
