# vendor/

`tetravox-module-sdk-1-0.2.0.tgz` — the module SDK, emitted from the Tetravox tree by
`node scripts/emit-module-sdk.mjs` at commit `53072d7` (host API 1, core 0.2.0).

It is here rather than pinned by URL because the SDK release asset does not exist yet: it is attached
to a Tetravox release, and the first release that carries it has not been cut. `package.json` depends
on this file, so `pnpm install` works with no network and CI needs no secret.

**This directory is temporary.** At the next Tetravox release the dependency becomes the asset URL —

```json
"@tetravox/module-sdk": "https://github.com/idossha/tetravox/releases/download/v<core>/tetravox-module-sdk-1-<core>.tgz"
```

— and the tarball is deleted. Nothing else in this repository refers to it.
