import type { Abi } from "koilib";
import abiJson from "./orderbook-abi.json";

/**
 * `koinos-abi-proto-gen` emits camelCase method fields (entryPoint, input,
 * output, readOnly) while koilib expects snake_case (entry_point, argument,
 * return, read_only). Normalize once at load time.
 */
interface GeneratedMethod {
  entryPoint?: number;
  "entry-point"?: string;
  entry_point?: number;
  input?: string;
  argument?: string;
  output?: string;
  return?: string;
  readOnly?: boolean;
  "read-only"?: boolean;
  read_only?: boolean;
  description?: string;
}

export function toKoilibAbi(generated: {
  methods: Record<string, GeneratedMethod>;
  types: unknown;
}): Abi {
  const methods: Abi["methods"] = {};
  for (const [name, method] of Object.entries(generated.methods)) {
    const entryPoint =
      method.entry_point ??
      method.entryPoint ??
      (method["entry-point"] !== undefined
        ? parseInt(method["entry-point"], 16)
        : undefined);
    methods[name] = {
      entry_point: entryPoint,
      argument: method.argument ?? method.input,
      return: method.return ?? method.output,
      read_only: method.read_only ?? method.readOnly ?? method["read-only"],
      description: method.description,
    } as Abi["methods"][string];
  }
  return { methods, koilib_types: generated.types as Abi["koilib_types"] };
}

export const orderbookAbi: Abi = toKoilibAbi(abiJson as any);
