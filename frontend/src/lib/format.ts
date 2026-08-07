/**
 * BigInt-safe unit and price math.
 *
 * On-chain amounts are integers in each token's smallest unit. Prices are
 * integers in quote units per 1e8 base units (PRICE_SCALE). Converting a
 * human price (quote tokens per base token) to a contract price:
 *
 *   contractPrice = humanPrice * 10^(8 + quoteDecimals - baseDecimals)
 */

export const PRICE_SCALE = 100000000n;
export const PRICE_SCALE_DIGITS = 8;

/** parse a decimal string into a bigint scaled by 10^scale (truncates) */
export function parseDecimalScaled(input: string, scale: number): bigint {
  const text = input.trim();
  if (!text || !/^\d*\.?\d*$/.test(text) || text === ".") {
    throw new Error(`invalid number: ${input}`);
  }
  const [wholeRaw, fracRaw = ""] = text.split(".");
  const whole = wholeRaw || "0";
  const frac = fracRaw.slice(0, scale).padEnd(scale, "0");
  return BigInt(whole + frac || "0");
}

/** format a scaled bigint back into a decimal string */
export function formatScaled(
  value: bigint,
  scale: number,
  maxFraction: number = scale,
  trimZeros: boolean = true
): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const text = absolute.toString().padStart(scale + 1, "0");
  const whole = text.slice(0, text.length - scale) || "0";
  let frac = scale > 0 ? text.slice(text.length - scale) : "";
  if (maxFraction < scale) frac = frac.slice(0, maxFraction);
  if (trimZeros) frac = frac.replace(/0+$/, "");
  const wholeGrouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${wholeGrouped}${frac ? "." + frac : ""}`;
}

export function parseUnits(input: string, decimals: number): bigint {
  return parseDecimalScaled(input, decimals);
}

export function formatUnits(
  value: bigint,
  decimals: number,
  maxFraction: number = decimals
): string {
  return formatScaled(value, decimals, maxFraction);
}

/** exponent applied to a human price to obtain the contract price */
export function priceExponent(baseDecimals: number, quoteDecimals: number): number {
  return PRICE_SCALE_DIGITS + quoteDecimals - baseDecimals;
}

/** convert human price string -> contract price (quote units / 1e8 base units) */
export function priceToContract(
  input: string,
  baseDecimals: number,
  quoteDecimals: number
): bigint {
  const exponent = priceExponent(baseDecimals, quoteDecimals);
  if (exponent >= 0) return parseDecimalScaled(input, exponent);
  // negative exponent: only prices divisible by 10^-exponent are representable
  if (input.includes(".") && /[1-9]/.test(input.split(".")[1] || "")) {
    throw new Error("price precision too small for this pair");
  }
  const divisor = 10n ** BigInt(-exponent);
  const whole = parseDecimalScaled(input, 0);
  if (whole % divisor !== 0n) {
    throw new Error("price precision too small for this pair");
  }
  return whole / divisor;
}

/** convert contract price -> human display string */
export function priceToHuman(
  price: bigint,
  baseDecimals: number,
  quoteDecimals: number,
  maxFraction?: number
): string {
  const exponent = priceExponent(baseDecimals, quoteDecimals);
  if (exponent >= 0) {
    return formatScaled(price, exponent, maxFraction ?? Math.min(exponent, 8));
  }
  return formatScaled(price * 10n ** BigInt(-exponent), 0);
}

/** contract price -> float (chart/display only, not for accounting) */
export function priceToNumber(
  price: bigint,
  baseDecimals: number,
  quoteDecimals: number
): number {
  return Number(price) / Math.pow(10, priceExponent(baseDecimals, quoteDecimals));
}

/** quote units owed for quantity at price (floor, mirrors the contract) */
export function quoteAmount(quantity: bigint, price: bigint): bigint {
  return (quantity * price) / PRICE_SCALE;
}

/** quote escrow pulled for a buy (ceil, mirrors the contract) */
export function quoteEscrow(quantity: bigint, price: bigint): bigint {
  return (quantity * price + PRICE_SCALE - 1n) / PRICE_SCALE;
}

export function clampBigInt(value: bigint, min: bigint, max: bigint): bigint {
  return value < min ? min : value > max ? max : value;
}

export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatCompact(value: number): string {
  if (!isFinite(value)) return "-";
  if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(2) + "B";
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(2) + "M";
  if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(2) + "K";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** decimal places that make sense for a price of this magnitude */
export function priceDisplayDecimals(price: number): number {
  if (!isFinite(price) || price <= 0) return 2;
  if (price < 0.0001) return 10;
  if (price < 0.01) return 8;
  if (price < 1) return 6;
  if (price < 100) return 4;
  if (price < 10000) return 2;
  return 2;
}

export function formatPriceNumber(price: number): string {
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: priceDisplayDecimals(price),
  });
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
