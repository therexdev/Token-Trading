const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { Contract, Serializer, utils } = require("koilib");
function loadModules() {
  const cache = new Map(),
    signed = [];
  function load(file) {
    file = path.resolve(__dirname, "../src", file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = fs
      .readFileSync(file, "utf8")
      .replaceAll("import.meta.env", "({})");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText;
    const requireLocal = (name) => {
      if (name === "../koinos")
        return {
          getSignerFor: () => {
            throw new Error("Unexpected signer");
          },
        };
      if (name === "../bioWallet")
        return {
          getBioSigner: () => ({
            sendTransaction: async (tx) => {
              signed.push(tx);
              return { transaction: { id: "approved-tx" } };
            },
          }),
        };
      if (!name.startsWith(".")) return require(name);
      const target = path.resolve(path.dirname(file), name);
      return name.endsWith(".json") ? require(target) : load(target + ".ts");
    };
    new Function("require", "module", "exports", output)(
      requireLocal,
      module,
      module.exports,
    );
    return module.exports;
  }
  return {
    model: load("lib/koindx/model.ts"),
    client: load("lib/koindx/client.ts"),
    format: load("lib/format.ts"),
    signed,
  };
}
const { model: m, client: c, format: f } = loadModules();
const token = (address) => c.fallbackTokens.find((t) => t.address === address);
const pair = { base: token(m.KOIN), quote: token(m.VETH) };
const pool = {
  ...pair,
  address: "17e1q6Fh5RgnuA8K7v4KvXXH4k9qHgsT5s",
  baseIsA: false,
  reserveBase: 100000000000n,
  reserveQuote: 100000000n,
  fetchedAt: Date.now(),
};
const coreAbi = require("../src/lib/koindx/core-abi.json"),
  routerAbi = require("../src/lib/koindx/periphery-abi.json"),
  accountAbi = require("../src/lib/koindx/account-abi.json");

test("default and shared links support symbols, ETH alias, addresses and inverse pairs without symbol collisions", () => {
  assert.deepEqual(m.readPairKeys(""), ["KOIN", "vETH"]);
  assert.deepEqual(m.readPairKeys("#/market/KOIN_vETH"), ["KOIN", "vETH"]);
  for (const symbol of ["vETH", "vUSDT", "vUSDC"]) {
    const token = c.fallbackTokens.find(t => t.symbol === symbol);
    assert.equal(m.displaySymbol(token), symbol);
  }
  assert.deepEqual(m.readPairKeys("#/market/KOIN_ETH"), ["KOIN", "ETH"]);
  assert.deepEqual(m.readPairKeys("", "?pair=ETH_KOIN"), ["ETH", "KOIN"]);
  assert.equal(m.resolveToken("ETH", c.fallbackTokens).address, m.VETH);
  assert.equal(m.resolveToken(m.KOIN, c.fallbackTokens).address, m.KOIN);
  assert.equal(m.pairUrl(pair), `/koindx/#/market/${m.KOIN}_${m.VETH}`);
  assert.throws(() => m.readPairKeys("#/market/%ZZ"), /invalid/);
  assert.throws(
    () =>
      m.resolveToken("KOIN", [
        pair.base,
        { ...pair.base, key: "other", address: "other" },
      ]),
    /More than one/,
  );
});
test("amounts never use floating point or silently truncate precision", () => {
  assert.equal(m.parseAmount("184467440737.09551615", 8), m.UINT64_MAX);
  for (const text of [
    "184467440737.09551616",
    "0",
    "-1",
    "1e8",
    "1.000000001",
    "NaN",
  ])
    assert.throws(() => m.parseAmount(text, 8));
  assert.equal(m.parseAmount(".1", 8), 10000000n);
  assert.equal(m.amountOut(100000000n, 10000000000n, 20000000000n), 197529641n);
  assert.equal(m.minimumOut(1000n, 50), 995n);
  assert.throws(() => m.minimumOut(1n, 50), /too small/);
  assert.throws(() => m.minimumOut(1000n, 10000));
  assert.throws(() => m.amountOut(m.UINT64_MAX, 1n, 1n));
});
test("Kondor approves only the input amount, uses the koin namespace and sends to the connected wallet", async () => {
  const owner = m.KOIN;
  const ops = await c.swapOperations(
    owner,
    pool,
    false,
    100000000n,
    90000n,
    false,
  );
  assert.equal(ops.length, 2);
  const approve = await new Contract({
    id: m.KOIN,
    abi: utils.tokenAbi,
  }).decodeOperation(ops[0]);
  const swap = await new Contract({
    id: m.ROUTER,
    abi: routerAbi,
  }).decodeOperation(ops[1]);
  assert.equal(approve.args.value, "100000000");
  assert.equal(approve.args.spender, m.ROUTER);
  assert.equal(swap.args.amountOutMin, "90000");
  assert.equal(swap.args.from, owner);
  assert.equal(swap.args.receiver, owner);
  assert.deepEqual(swap.args.path, ["koin", m.VETH]);
  const reverse = await c.swapOperations(
    owner,
    pool,
    true,
    100000n,
    80000n,
    false,
  );
  assert.equal(reverse[0].call_contract.contract_id, m.VETH);
  assert.deepEqual(
    (
      await new Contract({ id: m.ROUTER, abi: routerAbi }).decodeOperation(
        reverse[1],
      )
    ).args.path,
    [m.VETH, "koin"],
  );
});
test("Vault wraps both calls through execute_user and never sends legacy-token approval at top level", async () => {
  const ops = await c.swapOperations(m.KOIN, pool, true, 100000n, 80000n, true);
  const account = new Contract({ id: m.KOIN, abi: accountAbi });
  const inner = await Promise.all(
    ops.map(async (op) => {
      assert.equal(op.call_contract.contract_id, m.KOIN);
      const decoded = await account.decodeOperation(op);
      assert.equal(decoded.name, "execute_user");
      return { call_contract: decoded.args.operation };
    }),
  );
  assert.equal(inner[0].call_contract.contract_id, m.VETH);
  assert.equal(inner[1].call_contract.contract_id, m.ROUTER);
  assert.equal(
    (
      await new Contract({ id: m.ROUTER, abi: routerAbi }).decodeOperation(
        inner[1],
      )
    ).args.amountOutMin,
    "80000",
  );
  await assert.rejects(
    c.swapOperations(m.KOIN, pool, true, 1n, 0n, true),
    /positive/,
  );
});
test("tokens without allowances do not receive unsupported approve operations", async () => {
  const noAllowancePool = {
    ...pool,
    base: { ...pair.base, allowances: false },
  };
  assert.equal(
    (await c.swapOperations(m.KOIN, noAllowancePool, false, 100n, 1n, false))
      .length,
    1,
  );
});
test("history uses ordered pool sync + swap events, ignores reverted receipts and liquidity-only events", async () => {
  const serializer = new Serializer(coreAbi.koilib_types);
  const event = async (name, data, source = pool.address) => ({
    name,
    source,
    data: utils.encodeBase64url(await serializer.serialize(data, name)),
  });
  const sync = await event("core.sync_event", {
    reserveA: "200000000",
    reserveB: "10000000000",
  });
  const swap = await event("core.swap_event", {
    to: m.KOIN,
    sender: m.ROUTER,
    amountInA: "100000000",
    amountOutB: "1000000000",
  });
  const row = (id, events, reverted = false) => ({
    seq_num: "9007199254740999",
    trx: { transaction: { id }, receipt: { events, reverted } },
  });
  const points = await c.decodeHistory(
    [
      row("good", [sync, swap]),
      row("bad", [sync, swap], true),
      row("liquidity", [sync]),
      row("other", [{ ...sync, source: m.VETH }, swap]),
      row("undated", [sync, swap]),
    ],
    pool,
    new Map([
      ["good", 100000],
      ["bad", 100000],
      ["liquidity", 100000],
      ["other", 100000],
    ]),
  );
  assert.equal(points.length, 1);
  assert.equal(points[0].price, 0.02);
  assert.equal(points[0].volume, 1);
  assert.equal(points[0].quantity, 1000000000n);
  assert.equal(points[0].buy, true);
  assert.equal(points[0].sequence, 9007199254740999n);
});
test("swap history preserves fractional EGG amounts and large token quantities exactly", async () => {
  const egg = token("1AFMFjbSzpnK58xbwt6cyAnhLF77qm5FeC");
  const serializer = new Serializer(coreAbi.koilib_types);
  const event = async (name, data) => ({
    name,
    source: pool.address,
    data: utils.encodeBase64url(await serializer.serialize(data, name)),
  });
  for (const baseIsA of [true, false]) {
    for (const buy of [true, false]) {
      for (const [units, expected] of [
        [1n, "0.00000001"],
        [123456n, "0.00123456"],
        [123456789n, "1.23456789"],
        [9007199254740993n, "90,071,992.54740993"],
      ]) {
        const baseSide = baseIsA ? "A" : "B";
        const quoteSide = baseIsA ? "B" : "A";
        const points = await c.decodeHistory([{
          seq_num: "1",
          trx: {
            transaction: { id: "egg-swap" },
            receipt: { events: [
              await event("core.sync_event", { reserveA: "100000000000", reserveB: "100000000000" }),
              await event("core.swap_event", {
                to: m.KOIN,
                sender: m.ROUTER,
                [`amount${buy ? "Out" : "In"}${baseSide}`]: units.toString(),
                [`amount${buy ? "In" : "Out"}${quoteSide}`]: "100000000",
              }),
            ] },
          },
        }], { ...pool, base: egg, quote: pair.base, baseIsA }, new Map([["egg-swap", 100000]]));
        assert.equal(points.length, 1);
        assert.equal(points[0].quantity, units);
        assert.equal(points[0].buy, buy);
        assert.equal(f.formatUnits(points[0].quantity, egg.decimals), expected);
      }
    }
  }
});
test("candles preserve previous close, merge duplicate events and start weekly candles Monday UTC", () => {
  const p = (id, timestamp, price, volume = 1) => ({
    id,
    timestamp: Date.parse(timestamp),
    price,
    volume,
    quantity: 100000000n,
    sequence: BigInt(id),
    event: 0,
    buy: true,
  });
  const points = [
    p("1", "2026-09-20T12:00:00Z", 10),
    p("2", "2026-09-21T12:00:00Z", 15),
  ];
  const candles = m.buildDexCandles([...points, points[0]], 604800);
  assert.equal(candles.length, 2);
  assert.equal(new Date(candles[0].time * 1000).getUTCDay(), 1);
  assert.equal(candles[1].open, 10);
  assert.equal(candles[1].close, 15);
  assert.equal(candles[0].volume, 1);
  const now = Date.parse("2026-09-21T18:00:00Z");
  assert.equal(m.dayStats(points, false, false, now).change, 50);
  assert.equal(m.dayStats([points[1]], false, false, now).volume, null);
  assert.equal(m.dayStats(points, true, true, now).volume, null);
});
test("pool ordering comes from get_tokens, and swaps recheck price, balance and wallet before requesting approval", async () => {
  const { client, signed } = loadModules();
  const core = new Serializer(coreAbi.koilib_types),
    router = new Serializer(routerAbi.koilib_types),
    standard = new Serializer(utils.tokenAbi.koilib_types);
  let balance = "10000000000000";
  const oldFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equal(method, "chain.read_contract");
    let serializer, type, data;
    if (params.entry_point === utils.tokenAbi.methods.decimals.entry_point) {
      serializer = standard;
      type = utils.tokenAbi.methods.decimals.return;
      data = { value: 8 };
    } else if (
      params.entry_point === utils.tokenAbi.methods.balanceOf.entry_point
    ) {
      serializer = standard;
      type = utils.tokenAbi.methods.balanceOf.return;
      data = { value: balance };
    } else if (params.entry_point === routerAbi.methods.get_pair.entry_point) {
      serializer = router;
      type = routerAbi.methods.get_pair.return;
      data = { value: pool.address };
    } else if (params.entry_point === coreAbi.methods.get_tokens.entry_point) {
      serializer = core;
      type = coreAbi.methods.get_tokens.return;
      data = { tokenA: m.VETH, tokenB: m.KOIN };
    } else if (
      params.entry_point === coreAbi.methods.get_reserves.entry_point
    ) {
      serializer = core;
      type = coreAbi.methods.get_reserves.return;
      data = { reserveA: "100000000", reserveB: "100000000000" };
    } else throw new Error("Unexpected RPC");
    return {
      ok: true,
      json: async () => ({
        result: {
          result: utils.encodeBase64url(await serializer.serialize(data, type)),
        },
      }),
    };
  };
  try {
    const result = await client.fetchPool(pair);
    assert.equal(result.baseIsA, false);
    assert.equal(result.reserveBase, 100000000000n);
    await assert.rejects(
      client.submitSwap(
        m.KOIN,
        pool,
        false,
        100000000n,
        999999999n,
        true,
        () => true,
      ),
      /price changed/,
    );
    await assert.rejects(
      client.submitSwap(m.KOIN, pool, false, 100000000n, 1n, true, () => false),
      /changed/,
    );
    balance = "0";
    await assert.rejects(
      client.submitSwap(m.KOIN, pool, false, 100000000n, 1n, true, () => true),
      /Insufficient/,
    );
    assert.equal(signed.length, 0);
    balance = "100000000000";
    assert.equal(
      await client.submitSwap(
        m.KOIN,
        pool,
        false,
        100000000n,
        90000n,
        true,
        () => true,
      ),
      "approved-tx",
    );
    assert.equal(signed.length, 1);
    assert.equal(signed[0].operations.length, 2);
  } finally {
    global.fetch = oldFetch;
  }
});
