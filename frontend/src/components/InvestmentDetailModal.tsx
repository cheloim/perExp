import { useState, useEffect, useRef } from "react";
import { DetailModal } from "./DetailModal";
import { getInvestmentHistory } from "../api/client";
import type { Investment } from "../types";

interface InvestmentDetailModalProps {
  isOpen: boolean;
  investment: Investment | null;
  allInvestments?: Investment[];
  onClose: () => void;
  onEdit: (inv: Investment, allInvs?: Investment[]) => void;
}

interface HistoryPoint {
  date: string;
  close: number;
}

function fmt(n: number, currency = "ARS"): string {
  if (currency === "USD")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(n);
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtQty(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

function EvolutionRow({
  label,
  price,
  currentPrice,
  currency,
}: {
  label: string;
  price: number | null;
  currentPrice: number | null;
  currency: string;
}) {
  if (price === null || currentPrice === null) {
    return (
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs text-[var(--text-tertiary)]">{label}</span>
        <span className="text-xs text-[var(--text-tertiary)]">—</span>
      </div>
    );
  }
  const change = currentPrice - price;
  const changePct = (change / price) * 100;
  const isPositive = change >= 0;
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-[var(--text-tertiary)]">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-primary)] font-medium">
          {fmt(price, currency)}
        </span>
        <span className={`text-xs font-medium ${isPositive ? "text-success" : "text-danger"}`}>
          {isPositive ? "+" : ""}
          {changePct.toFixed(2)}%
        </span>
        <span className={`text-xs ${isPositive ? "text-success" : "text-danger"}`}>
          {isPositive ? "↑" : "↓"}
        </span>
      </div>
    </div>
  );
}

export function InvestmentDetailModal({
  isOpen,
  investment,
  allInvestments,
  onClose,
  onEdit,
}: InvestmentDetailModalProps) {
  const [history1d, setHistory1d] = useState<HistoryPoint[]>([]);
  const [history7d, setHistory7d] = useState<HistoryPoint[]>([]);
  const [history30d, setHistory30d] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [showBrokers, setShowBrokers] = useState(false);
  const [showEditDropdown, setShowEditDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !investment) return;
    setLoading(true);
    setShowBrokers(false);
    setShowEditDropdown(false);
    Promise.all([
      getInvestmentHistory(investment.id, "1d"),
      getInvestmentHistory(investment.id, "7d"),
      getInvestmentHistory(investment.id, "30d"),
    ])
      .then(([h1d, h7d, h30d]) => {
        setHistory1d(h1d.history);
        setHistory7d(h7d.history);
        setHistory30d(h30d.history);
      })
      .finally(() => setLoading(false));
  }, [isOpen, investment]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowEditDropdown(false);
      }
    }
    if (showEditDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEditDropdown]);

  if (!investment) return null;

  const investments = allInvestments || [investment];
  const isCombined = investments.length > 1;
  const currency = investment.currency || "ARS";

  const totalQuantity = investments.reduce((s, i) => s + i.quantity, 0);
  const totalCostBasis = investments.reduce((s, i) => s + (i.cost_basis ?? 0), 0);
  const totalCurrentValue = investments.reduce(
    (s, i) => s + (i.current_value ?? i.cost_basis ?? 0),
    0,
  );
  const totalPnl = totalCurrentValue - totalCostBasis;
  const totalPnlPct = totalCostBasis ? (totalPnl / totalCostBasis) * 100 : 0;
  const avgCost = totalQuantity > 0 ? totalCostBasis / totalQuantity : 0;

  const price1d = history1d.length > 0 ? history1d[0].close : null;
  const price7d = history7d.length > 0 ? history7d[0].close : null;
  const price30d = history30d.length > 0 ? history30d[0].close : null;

  const subtitle = isCombined
    ? `${investments.length} posiciones`
    : `${investment.type || "—"} · ${investment.broker || "—"}`;

  const handleEditSelect = (inv: Investment) => {
    setShowEditDropdown(false);
    onClose();
    onEdit(inv, investments);
  };

  return (
    <DetailModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        investment.ticker
          ? `${investment.ticker} · ${investment.name || "—"}`
          : investment.name || "Inversión"
      }
      subtitle={subtitle}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-[var(--text-tertiary)] text-xs uppercase">Cantidad</dt>
            <dd className="text-[var(--text-primary)] font-medium">
              {fmtQty(totalQuantity)} unidades
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)] text-xs uppercase">Precio Promedio</dt>
            <dd className="text-[var(--text-primary)] font-medium">{fmt(avgCost, currency)}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)] text-xs uppercase">Precio Actual</dt>
            <dd className="text-[var(--text-primary)] font-medium">
              {investment.current_price !== null ? fmt(investment.current_price, currency) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)] text-xs uppercase">Valorización</dt>
            <dd className="text-[var(--text-primary)] font-medium">
              {fmt(totalCurrentValue, currency)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)] text-xs uppercase">Costo Total</dt>
            <dd className="text-[var(--text-primary)] font-medium">
              {fmt(totalCostBasis, currency)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)] text-xs uppercase">P&L</dt>
            <dd className={`font-medium ${totalPnl >= 0 ? "text-success" : "text-danger"}`}>
              {totalPnl >= 0 ? "+" : ""}
              {fmt(totalPnl, currency)}
              <span className="ml-1 text-xs">
                ({totalPnlPct >= 0 ? "+" : ""}
                {totalPnlPct.toFixed(2)}%)
              </span>
            </dd>
          </div>
        </div>

        {isCombined && (
          <div className="border-t border-[var(--border-color)] pt-3">
            <button
              onClick={() => setShowBrokers(!showBrokers)}
              className="flex items-center gap-2 text-sm text-secondary hover:text-[var(--text-primary)] transition-colors"
            >
              <span>{showBrokers ? "▲" : "▼"}</span>
              <span>{showBrokers ? "Ocultar" : "Ver"} posiciones por broker</span>
            </button>

            {showBrokers && (
              <div className="mt-3 border border-[var(--border-color)] rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-base-alt)]">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs uppercase text-secondary font-medium">
                        Broker
                      </th>
                      <th className="px-3 py-2 text-right text-xs uppercase text-secondary font-medium">
                        Cantidad
                      </th>
                      <th className="px-3 py-2 text-right text-xs uppercase text-secondary font-medium">
                        Valor
                      </th>
                      <th className="px-3 py-2 text-right text-xs uppercase text-secondary font-medium">
                        P&L
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {investments.map((inv) => {
                      const costBasis = inv.quantity * inv.avg_cost;
                      const currentValue = inv.current_value ?? inv.cost_basis ?? 0;
                      const pnl = currentValue - costBasis;
                      const pnlPct = costBasis ? (pnl / costBasis) * 100 : 0;
                      return (
                        <tr key={inv.id} className="hover:bg-[var(--color-base-alt)]/50">
                          <td className="px-3 py-2 text-[var(--text-primary)]">{inv.broker}</td>
                          <td className="px-3 py-2 text-right font-medium">
                            {fmtQty(inv.quantity)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {fmt(currentValue, inv.currency || "ARS")}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-medium ${
                              pnl >= 0 ? "text-success" : "text-danger"
                            }`}
                          >
                            {pnlPct.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-[var(--border-color)] mt-4" />

            <div className="mt-4">
              <p className="text-[var(--text-tertiary)] text-xs uppercase mb-2">
                Evolución (vs precio actual{" "}
                {investment.current_price !== null ? fmt(investment.current_price, currency) : "—"})
              </p>
              {loading ? (
                <p className="text-xs text-[var(--text-tertiary)] py-2">Cargando...</p>
              ) : (
                <div className="border border-[var(--border-color)] rounded-lg p-2 space-y-0.5">
                  <EvolutionRow
                    label="1 día"
                    price={price1d}
                    currentPrice={investment.current_price}
                    currency={currency}
                  />
                  <EvolutionRow
                    label="7 días"
                    price={price7d}
                    currentPrice={investment.current_price}
                    currency={currency}
                  />
                  <EvolutionRow
                    label="30 días"
                    price={price30d}
                    currentPrice={investment.current_price}
                    currency={currency}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {!isCombined && (
          <div className="border-t border-[var(--border-color)] pt-3">
            <p className="text-[var(--text-tertiary)] text-xs uppercase mb-2">
              Evolución (vs precio actual{" "}
              {investment.current_price !== null ? fmt(investment.current_price, currency) : "—"})
            </p>
            {loading ? (
              <p className="text-xs text-[var(--text-tertiary)] py-2">Cargando...</p>
            ) : (
              <div className="border border-[var(--border-color)] rounded-lg p-2 space-y-0.5">
                <EvolutionRow
                  label="1 día"
                  price={price1d}
                  currentPrice={investment.current_price}
                  currency={currency}
                />
                <EvolutionRow
                  label="7 días"
                  price={price7d}
                  currentPrice={investment.current_price}
                  currency={currency}
                />
                <EvolutionRow
                  label="30 días"
                  price={price30d}
                  currentPrice={investment.current_price}
                  currency={currency}
                />
              </div>
            )}
          </div>
        )}

        {investment.notes && !isCombined && (
          <div className="border-t border-[var(--border-color)] pt-3">
            <p className="text-[var(--text-tertiary)] text-xs uppercase mb-1">Notas</p>
            <p className="text-sm text-[var(--text-primary)]">{investment.notes}</p>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t border-[var(--border-color)]">
          {isCombined ? (
            <div className="flex-1 relative" ref={dropdownRef}>
              <button
                onClick={() => setShowEditDropdown(!showEditDropdown)}
                className="gnome-btn-primary w-full text-sm flex items-center justify-center gap-2"
              >
                <span>Editar</span>
                <span className="text-xs">{showEditDropdown ? "▲" : "▼"}</span>
              </button>
              {showEditDropdown && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--color-base)] border border-[var(--border-color)] rounded-lg shadow-md overflow-hidden z-10">
                  <div className="px-3 py-2 text-xs text-secondary border-b border-[var(--border-color)]">
                    Seleccionar posición a editar
                  </div>
                  {investments.map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => handleEditSelect(inv)}
                      className="w-full px-3 py-2 text-sm text-left hover:bg-[var(--color-base-alt)] flex items-center justify-between"
                    >
                      <span>{inv.broker}</span>
                      <span className="text-xs text-secondary">{inv.ticker || inv.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => {
                onClose();
                onEdit(investment, investments);
              }}
              className="gnome-btn-primary flex-1 text-sm"
            >
              Editar
            </button>
          )}
          <button onClick={onClose} className="gnome-btn-secondary flex-1 text-sm">
            Cerrar
          </button>
        </div>
      </div>
    </DetailModal>
  );
}
