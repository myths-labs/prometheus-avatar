# Basic Example

The simplest way to use Prometheus Avatar — zero build tools, just HTML.

## Usage

1. Open `index.html` in a browser
2. Click "Say Hello!" to hear the avatar speak

## What it demonstrates

- Loading the SDK from ESM CDN (`esm.sh`)
- Creating an avatar with `createAvatar()`
- Making the avatar speak with auto-detected emotion
- Listening to emotion change events

## Code Highlight

```html
<script type="module">
  import { createAvatar } from 'https://esm.sh/@prometheusavatar/core@0.8.0';

  const avatar = await createAvatar({
    container: document.getElementById('avatar'),
    modelUrl: 'path/to/model.model3.json',
  });

  await avatar.speak('Hello! 😊');
</script>
```
