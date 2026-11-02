// Quantity helpers shared by the grocery list (server) and the recipe scaler
// (browser). Pure functions, no imports, safe in either bundle.

const NICE: [number, string][] = [[0, ""], [0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, ""]];

/** 2.5 -> "2½", rounded to the nearest common fraction; 10 and up are whole numbers. */
export function niceNum(x: number): string {
  if (x >= 10) return String(Math.round(x));
  let whole = Math.floor(x);
  const rest = x - whole;
  let best = NICE[0];
  for (const n of NICE) if (Math.abs(n[0] - rest) < Math.abs(best[0] - rest)) best = n;
  if (best[0] === 1) whole += 1;
  const s = `${whole || ""}${best[1]}`;
  return s || (x > 0 ? "⅛" : "0");
}

const UNI: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

// "1 1/2", "1/2", "1½", "½", "2", "0.5" (in that order of preference)
const NUM = /(\d+\s+\d+\/\d+|\d+\/\d+|\d+\s*[¼½¾⅓⅔⅛]|[¼½¾⅓⅔⅛]|\d+(?:\.\d+)?)/g;

function value(tok: string): number {
  const t = tok.trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const uni = t.match(/^(\d*)\s*([¼½¾⅓⅔⅛])$/);
  if (uni) return Number(uni[1] || 0) + UNI[uni[2]];
  return Number(t);
}

/**
 * Multiply every quantity in a free-text amount: scaleText("1 1/2 cups (70 g)", 2)
 * -> "3 cups (140 g)". Words ("to taste", "pinch") pass through unchanged, and
 * cup/cups follows the new number ("1 cup", "1½ cups"). A factor of 1 still
 * tidies fractions ("1 1/2" -> "1½").
 */
export function scaleText(text: string, factor: number): string {
  return text
    .replace(NUM, (tok) => {
      const v = value(tok);
      // Leave plain whole numbers alone at 1x (e.g. "907 g" stays "907 g").
      if (factor === 1 && /^\d+$/.test(tok.trim())) return tok;
      return Number.isFinite(v) ? niceNum(v * factor) : tok;
    })
    .replace(/(^|[\s(])(1|[¼½¾⅓⅔⅛])\s+cups\b/g, "$1$2 cup")
    .replace(/(\d+[¼½¾⅓⅔⅛]?|\d*[¼½¾⅓⅔⅛])\s+cup\b/g, (m, n: string) => (n === "1" || /^[¼½¾⅓⅔⅛]$/.test(n) ? m : `${n} cups`));
}
