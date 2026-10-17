# Third-Party Licenses

This project uses the following open-source components:

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

## Live2D Cubism Core (runtime) — NOT included
- **License:** Live2D Proprietary Software License Agreement
- **Copyright:** (c) Live2D Inc.
- **Agreement:** https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html
- **Licence overview (free use, publication licence, "Expandable Application"):** https://www.live2d.com/en/sdk/license/
- **Usage:** Live2D (Cubism 3/4) model runtime, `live2dcubismcore.min.js`
- **Note:** This repository and the `@prometheusavatar/core` npm package do **not** contain or redistribute Cubism Core.
  You add it to your page yourself (script tag, or the `cubismCoreUrl` option) and by doing so accept Live2D's licence.
  Whether your project needs a paid licence depends on you and your app; check Live2D's licence page. See the README section "Live2D runtime".

## Next.js (apps/demo only)
- **License:** MIT
- **Copyright:** (c) Vercel, Inc.
- **URL:** https://github.com/vercel/next.js

## Supabase (apps/demo only)
- **License:** Apache 2.0
- **Copyright:** (c) Supabase Inc.
- **URL:** https://github.com/supabase/supabase

---

## Sample Live2D Models (Haru, Shizuku, Koharu) — NOT included
- **License:** Live2D Free Material License Agreement
- **Copyright:** (c) Live2D Inc.
- **Agreement:** https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html
- **Sample model terms:** https://www.live2d.com/en/learn/sample/model-terms/
- **Note:** No model files are bundled with the npm package. The README examples load the Haru sample from the
  pixi-live2d-display test assets on jsDelivr; check the terms above before using it in a published project.
