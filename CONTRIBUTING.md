# Contributing to Prometheus Avatar

Thank you for your interest in contributing! 🎉

## Ways to Contribute

### 🎨 Create & Share Avatars
The easiest way to contribute — create Live2D or 3D avatars and share them on the Marketplace.

### 🧩 Build Plugins  
Extend Prometheus with plugins for different AI platforms (see `packages/openclaw-plugin` for reference).

### 🛠️ Improve the SDK
Fix bugs, add features, or improve documentation.

## Getting Started

```bash
# Fork & clone
git clone https://github.com/YOUR_USERNAME/prometheus-avatar.git
cd prometheus-avatar

# Install dependencies
pnpm install

# Start the demo
pnpm dev
```

## Development Workflow

1. **Fork** this repository
2. **Create a branch**: `git checkout -b feat/my-feature`
3. **Make changes** and test locally
4. **Commit**: Use [Conventional Commits](https://www.conventionalcommits.org/) format
   - `feat: add new emotion engine`
   - `fix: resolve lip-sync timing`
   - `docs: update API reference`
5. **Push** and open a **Pull Request**

## Project Structure

```
prometheus-avatar/
├── packages/
│   ├── sdk/              # Core SDK (@prometheus-avatar/core)
│   └── openclaw-plugin/  # OpenClaw integration
├── apps/
│   ├── demo/             # Interactive demo (Next.js)
│   └── marketplace/      # Avatar marketplace (Next.js)
```

## Creating a Plugin

Plugins follow this structure:

```typescript
// my-plugin/index.ts
import { createAvatar } from '@prometheus-avatar/core';

export function myPlugin(avatar: ReturnType<typeof createAvatar>) {
  // Your integration logic
}
```

See [packages/openclaw-plugin](./packages/openclaw-plugin) for a complete example.

## Creating an Avatar

1. Design a Live2D model (use [Live2D Cubism Editor](https://www.live2d.com/en/cubism/))
2. Export as `.model3.json` + textures
3. Test locally with the demo app
4. Upload to the Marketplace

## Code Style

- TypeScript strict mode
- ESM modules
- Descriptive variable names

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
