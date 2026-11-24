import { yieldRateChange } from "@/lib/price-impact";
import type { PriceHistory } from "@/lib/types";

/** 価格の履歴に添える「使える割合 100% → 80%」（D-126）。使える割合を変えていない記録では何も出さない */
export function YieldChangeNote({ history }: { history: PriceHistory }) {
  const change = yieldRateChange(history);
  if (!change) return null;
  return (
    <span className="num block whitespace-nowrap text-xs text-muted">
      使える割合 {change.from}%<span className="mx-1 text-subtle">→</span>
      <span className="font-bold text-foreground">{change.to}%</span>
    </span>
  );
}
