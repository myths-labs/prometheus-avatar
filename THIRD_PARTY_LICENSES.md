# Third-Party Licenses

This project uses the following open-source components:

---

## Live2D: you need a licence of your own

This repository's MIT licence covers this repository's code only. It does not include a licence from Live2D Inc.

- The 2D model renderer in `@prometheusavatar/core` (also used by `@prometheusavatar/openclaw-plugin`) loads Live2D model files (`.model3.json`) through `pixi-live2d-display`.
- Drawing such a model needs the Live2D Cubism runtime (Cubism Core). These packages do not include it: your page has to load it, as the [pixi-live2d-display README](https://github.com/guansss/pixi-live2d-display#cubism) explains.
- Anyone who uses a Live2D model or the Cubism runtime, the sample models listed below included, must get the licence they require from Live2D Inc. themselves and follow its terms. Prometheus does not sell, sublicense or vouch for a Live2D licence.

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
- **License:** Live2D Proprietary License
- **Copyright:** (c) Live2D Inc.
- **URL:** https://www.live2d.com/en/sdk/about/
- **Usage:** Live2D model core runtime
- **Note:** Free for small-scale use. Commercial use requires a separate agreement with Live2D Inc.

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
- **License:** Live2D Free Material License
- **Copyright:** (c) Live2D Inc.
- **URL:** https://www.live2d.com/en/community/FreeModels/
- **Note:** Free for non-commercial and small-scale commercial use.
