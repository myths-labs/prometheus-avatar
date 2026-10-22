# Third-Party Licenses

This project uses the following open-source components:

---

## Live2D: you need a licence of your own

This repository's MIT licence covers this repository's code only. It does not include a licence from Live2D Inc.

- The 2D model renderer in `@prometheusavatar/core` (also used by `@prometheusavatar/openclaw-plugin`) loads Live2D model files (`.model3.json`) through `pixi-live2d-display`.
- Drawing such a model needs the Live2D Cubism runtime (Cubism Core). These packages do not include it: your page has to load it, as the [pixi-live2d-display README](https://github.com/guansss/pixi-live2d-display#cubism) explains.
- Anyone who uses a Live2D model or the Cubism runtime, the sample models listed below included, must get the licence they require from Live2D Inc. themselves and follow its terms. Prometheus does not sell, sublicense or vouch for a Live2D licence.
- Live2D Inc.'s terms, at the source: the [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) (Cubism Core); the [SDK Release License (Publication License Agreement)](https://www.live2d.com/en/sdk/license/) for publishing content that uses the SDK, with its own rules for [Expandable Applications](https://www.live2d.com/en/sdk/license/expandable/); and, for Live2D's sample models, the [Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) together with the [Terms of Use for Live2D Cubism Sample Data](https://www.live2d.com/en/learn/sample/model-terms/).

---

## pixi-live2d-display
- **License:** MIT
- **Copyright:** (c) guansss
- **URL:** https://github.com/guansss/pixi-live2d-display
- **Usage:** Live2D model rendering in browser

## PixiJS
- **License:** MIT
- **Copyright:** (c) Mathew Groves, PixiJS contributors
- **URL:** https://github.com/pixijs/pixijs
- **Usage:** 2D WebGL rendering engine

## Live2D Cubism SDK
- **License:** [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)
- **Release licence:** [SDK Release License (Publication License Agreement)](https://www.live2d.com/en/sdk/license/); [Expandable Applications](https://www.live2d.com/en/sdk/license/expandable/)
- **Copyright:** (c) Live2D Inc.
- **URL:** https://www.live2d.com/en/sdk/about/
- **Usage:** Live2D model core runtime
- **Note:** The terms depend on who you are and what you publish. Live2D Inc.'s published terms exempt individuals and small-scale enterprises from the release licence and payment, except for an "Expandable Application", which has to be reviewed and needs a special Publication License Agreement before release. Read Live2D Inc.'s terms, and ask Live2D Inc. if you are unsure which side you are on.

## Next.js
- **License:** MIT
- **Copyright:** (c) Vercel, Inc.
- **URL:** https://github.com/vercel/next.js

## Supabase
- **License:** Apache 2.0
- **Copyright:** (c) Supabase Inc.
- **URL:** https://github.com/supabase/supabase

---

## Sample Live2D Models (Haru, Shizuku, Koharu)
- **License:** [Live2D Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) and [Terms of Use for Live2D Cubism Sample Data](https://www.live2d.com/en/learn/sample/model-terms/)
- **Copyright:** (c) Live2D Inc.
- **URL:** https://www.live2d.com/en/learn/sample/
- **Note:** The terms depend on who you are and how you use the material. Live2D Inc. lists these three among its original characters, which are used under both documents above; read both for the terms that apply to you.
