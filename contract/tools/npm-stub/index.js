// somap declares the npm CLI as a dependency but never requires it, so this
// module standing in for it should never be loaded. Fail loudly if it is.
throw new Error(
  "the npm CLI is stubbed out in contract/ — see contract/tools/npm-stub/README.md"
);
