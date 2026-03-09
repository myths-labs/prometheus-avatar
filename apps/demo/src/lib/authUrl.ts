// Shared auth utility — sanitizes base URL for OAuth redirects
export function getBaseUrl(): string {
    const PRODUCTION_URL = "https://prometheus.mythslabs.ai";

    // Try NEXTAUTH_URL first, but sanitize it
    const raw = process.env.NEXTAUTH_URL;
    if (raw) {
        let cleaned = raw.trim();
        // Fix if env var value accidentally includes "NEXTAUTH_URL=" prefix
        if (cleaned.startsWith("NEXTAUTH_URL=")) {
            cleaned = cleaned.replace("NEXTAUTH_URL=", "");
        }
        // Remove trailing slashes and newlines
        cleaned = cleaned.replace(/[\n\r]+/g, "").replace(/\/+$/, "").trim();
        if (cleaned.startsWith("http")) {
            return cleaned;
        }
    }

    // Fallback to VERCEL_URL
    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL.trim()}`;
    }

    return PRODUCTION_URL;
}
