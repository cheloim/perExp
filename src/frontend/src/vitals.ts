import { onLCP, onINP, onCLS } from "web-vitals";

/**
 * Core Web Vitals monitoring.
 * In development, logs to console. In production, send to your analytics endpoint.
 *
 * Targets (Addy Osmani / Google):
 *   LCP ≤ 2.5s  |  INP ≤ 200ms  |  CLS ≤ 0.1
 */
export function initVitals() {
  const report = (metric: { name: string; value: number; rating: string }) => {
    if (import.meta.env.DEV) {
      console.log(`[Vitals] ${metric.name}: ${metric.value.toFixed(1)} (${metric.rating})`);
    }
    // TODO: Replace with your analytics endpoint in production
    // Example: navigator.sendBeacon('/api/vitals', JSON.stringify(metric));
  };

  onLCP(report);
  onINP(report);
  onCLS(report);
}
