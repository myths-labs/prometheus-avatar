# Prometheus Marketplace

Private commercial platform for the Prometheus Avatar ecosystem.

## Architecture

- **Next.js 14** app with App Router
- **Supabase** for database
- **Vercel** for deployment
- Uses `@prometheusavatar/core` SDK (published on npm)

## Getting Started

```bash
npm install
npm run dev
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:
- `GEMINI_API_KEY` — Google AI
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_URL` / `NEXTAUTH_SECRET`

## Deployment

```bash
npx vercel --prod
```
