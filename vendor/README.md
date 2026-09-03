# vendor/

`tetravox-module-sdk-1-0.3.4-pr18.tgz` — the module SDK this repository builds against
(host API 1, core 0.3.4), taken from Tetravox PR #18 before that core release was cut. It carries
`scene.sampleVolume(datasetId, worldPoints, { order })` — §4.3's third read shape beside the probe
and the bounded box, capped at 2,000,000 points — which is what makes the 0.25 mm template slide in
`src/modelsnap.ts` one batch read instead of thousands of round trips. **The pin moves to
`1.0.0-core.0.3.5` once that release exists**, and this tarball goes with it.

`tetravox-module-sdk-1-0.3.1.tgz` — the previous one (host API 1, core 0.3.1). It carries §13.10's
additions: `ModuleHost.ui.placement/setPlacement/onPlacement` and the manifest's optional `ui` block.

`tetravox-module-sdk-1-0.2.0.tgz` — older still, at commit `53072d7` (host API 1, core 0.2.0), kept
only so a checkout of an older tag still installs.

It is here rather than pinned by URL because the SDK release asset does not exist yet: it is attached
to a Tetravox release, and the first release that carries it has not been cut. `package.json` depends
on this file, so `pnpm install` works with no network and CI needs no secret.

**This directory is temporary.** At the next Tetravox release the dependency becomes the asset URL —

```json
"@tetravox/module-sdk": "https://github.com/idossha/tetravox/releases/download/v<core>/tetravox-module-sdk-1-<core>.tgz"
```

— and the tarball is deleted. Nothing else in this repository refers to it.
