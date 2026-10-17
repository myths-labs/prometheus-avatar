# Basic Example

The simplest way to use Prometheus Avatar — zero build tools, just HTML.

## Usage

Browsers block ES modules opened straight from disk (`file://`), so serve the folder:

1. `npx serve examples/basic` (or `python3 -m http.server -d examples/basic`) and open the printed address
2. Click "Say Hello!" to hear the avatar speak (speech needs a click first, and a browser voice for the language)

It needs internet access: the SDK comes from the ESM CDN `esm.sh`, the sample model from jsDelivr
and Live2D's runtime from Live2D's server.

## What it demonstrates

- Loading the SDK from ESM CDN (`esm.sh`), pinned to a release
- Loading Live2D's Cubism Core through the `cubismCoreUrl` option (see below)
- Creating an avatar with `createAvatar()`
- Making the avatar speak with auto-detected emotion
- Listening to emotion change events
- Showing the error on the page when the avatar cannot start

## Live2D's runtime is not part of the SDK

`live2dcubismcore.min.js` is Live2D Inc.'s proprietary software. This example loads it from
Live2D's own server, so by running it you accept
[Live2D's licence](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html);
for coursework and personal projects see the [licence overview](https://www.live2d.com/en/sdk/license/).
To pin the file instead, download it yourself ([download page](https://www.live2d.com/en/sdk/download/web/)),
put it next to `index.html` and change `CUBISM_CORE_URL`. More in
[packages/sdk/README.md](../../packages/sdk/README.md#live2d-runtime-required-not-included).

The SDK contains no LLM: this example speaks a fixed sentence. To drive the avatar from a
chat model, call the model yourself (with your own key) and pass its reply to `avatar.speak()`.

## Code Highlight

```html
<script type="module">
  import { createAvatar } from 'https://esm.sh/@prometheusavatar/core@0.11.5';

  const avatar = await createAvatar({
    container: document.getElementById('avatar'),
    modelUrl: 'path/to/model.model3.json',
    cubismCoreUrl: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
  });

  await avatar.speak('Hello! 😊');
</script>
```
