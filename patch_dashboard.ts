import fs from "fs";

const uploadPageCode = fs.readFileSync("apps/demo/src/app/marketplace/upload/page.tsx", "utf-8");
let dashboardPageCode = fs.readFileSync("apps/demo/src/app/dashboard/page.tsx", "utf-8");

const identityOptionsRegex = /const IDENTITY_OPTIONS[\s\S]*?\];/;
const identityOptionsMatch = uploadPageCode.match(identityOptionsRegex);

if (!dashboardPageCode.includes("const IDENTITY_OPTIONS")) {
    dashboardPageCode = dashboardPageCode.replace(
        /interface DashboardData/,
        `import type { CreatorType } from "@/lib/supabase";

${identityOptionsMatch![0]}

interface DashboardData`
    );
}

// Extract verification state and handlers from upload page
const verificationStateRegex = /\/\/ ═══ Verification State ═══[\s\S]*?const commission/;
const verificationStateMatch = uploadPageCode.match(verificationStateRegex);

// We need to alter verification handlers slightly for the dashboard
let verificationLogic = verificationStateMatch![0].replace("const commission", "");

// Replace redirects 
verificationLogic = verificationLogic.replace(/returnTo=\/marketplace\/upload/g, "returnTo=/dashboard");

// Fix verifyOpenClaw to save xHandle for data fetch
verificationLogic = verificationLogic.replace(
    /if \(data.status === "verified"\) \{[\s\S]*?setVerified\(true\);/,
    `if (data.status === "verified") {
                setVerified(true);
                fetchDashboardData(xHandle);`
);

// Fix verifyAgent to save apiKey
verificationLogic = verificationLogic.replace(
    /if \(verifyData.status === "verified"\) \{[\s\S]*?setVerified\(true\);/,
    `if (verifyData.status === "verified") {
                setVerified(true);
                fetchDashboardData(agentApiKey);`
);

// Add fetchDashboardData helper
const fetchDashboardDataStr = `
    async function fetchDashboardData(userId: string) {
        setLoading(true);
        try {
            const res = await fetch(\`/api/dashboard?userId=\${userId}\`);
            const d = await res.json();
            setData(d);
        } catch (e) {
            console.error("Dashboard load error:", e);
        }
        setLoading(false);
    }
`;

// Insert into DashboardPage component
dashboardPageCode = dashboardPageCode.replace(
    /const \[withdrawing, setWithdrawing\] = useState\(false\);\n    const \[withdrawResult, setWithdrawResult\] = useState\(""\);/,
    `const [withdrawing, setWithdrawing] = useState(false);
    const [withdrawResult, setWithdrawResult] = useState("");

    const [identity, setIdentity] = useState<CreatorType | null>(null);
    const [verified, setVerified] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState("");
    const [agentApiKey, setAgentApiKey] = useState("");
    const [lobsterCode] = useState(() => \`PROM-\${Math.random().toString(36).substring(2, 8).toUpperCase()}\`);
    const [lobsterPosted, setLobsterPosted] = useState(false);

    function handleIdentityChange(id: CreatorType) {
        setIdentity(id);
        setVerified(false);
        setVerifying(false);
        setVerifyError("");
        setAgentApiKey("");
        setLobsterPosted(false);
    }

    function verifyHumanGoogle() {
        window.location.href = "/api/auth/google?returnTo=/dashboard";
    }

    function verifyHumanGithub() {
        window.location.href = "/api/auth/github?returnTo=/dashboard";
    }

    \${fetchDashboardDataStr}

    async function verifyAgent() {
        if (!agentApiKey.trim()) {
            setVerifyError("Please enter your Agent API Key");
            return;
        }
        setVerifying(true);
        setVerifyError("");
        try {
            const challengeRes = await fetch("/api/verify/agent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: agentApiKey, step: "challenge" }),
            });
            const challengeData = await challengeRes.json();

            if (!challengeRes.ok) {
                setVerifyError(challengeData.error || "Challenge failed");
                setVerifying(false);
                return;
            }

            const signature = challengeData.challenge;
            const verifyRes = await fetch("/api/verify/agent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: agentApiKey, step: "verify", signature }),
            });
            const verifyData = await verifyRes.json();

            if (verifyData.status === "verified") {
                setVerified(true);
                fetchDashboardData(agentApiKey);
            } else {
                setVerifyError(verifyData.error || "Verification failed");
            }
        } catch {
            setVerifyError("Network error during verification");
        }
        setVerifying(false);
    }

    async function verifyOpenClaw() {
        setVerifying(true);
        setVerifyError("");
        try {
            const xHandle = prompt("Enter your X (Twitter) handle (e.g. @myhandle):");
            if (!xHandle) {
                setVerifyError("X handle required for verification");
                setVerifying(false);
                return;
            }
            const res = await fetch("/api/verify/openclaw", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verificationCode: lobsterCode, xHandle }),
            });
            const data = await res.json();
            if (data.status === "verified") {
                setVerified(true);
                fetchDashboardData(xHandle);
            } else {
                setVerifyError(data.error || "Verification failed");
            }
        } catch {
            setVerifyError("Network error during verification");
        }
        setVerifying(false);
    }
`
);

// Fix initial load
dashboardPageCode = dashboardPageCode.replace(
    /useEffect\(\(\) => \{\n        async function load\(\) \{[\s\S]*?load\(\);\n    \}, \[\]\);/,
    `useEffect(() => {
        async function load() {
            try {
                const params = new URLSearchParams(window.location.search);
                if (params.get('verified') === 'github' || params.get('verified') === 'google') {
                    setIdentity('human');
                    setVerified(true);
                }

                const sessionRes = await fetch("/api/auth/session");
                const session = await sessionRes.json();
                if (!session?.user?.id) {
                    setLoading(false);
                    return;
                }
                
                setIdentity('human');
                setVerified(true);
                const res = await fetch(\`/api/dashboard?userId=\${session.user.id}\`);
                const d = await res.json();
                setData(d);
            } catch (e) {
                console.error("Dashboard load error:", e);
            }
            setLoading(false);
        }
        load();
    }, []);`
);

// Replace the JSX for unauthenticated state
const jsxReplacement = `
                {!loading && !data && !verified && (
                    <div className="max-w-2xl mx-auto">
                        <p className="text-[#a8b8d0] mb-8 text-center text-lg">Sign in to manage your points, withdraw revenue, and track your asset sales.</p>
                        
                        <div className="space-y-4">
                            {IDENTITY_OPTIONS.map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => handleIdentityChange(opt.id)}
                                    className={\`w-full text-left p-5 rounded-2xl border transition-all \${identity === opt.id
                                        ? "border-[#00d4aa]/40 bg-[#00d4aa]/5"
                                        : "border-white/5 bg-white/[0.02] hover:border-white/10"
                                        }\`}
                                >
                                    <div className="flex items-start gap-4">
                                        <span className="text-3xl">{opt.icon}</span>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-[#eae6df] font-semibold mb-0.5">{opt.label}</h3>
                                            </div>
                                            <p className="text-sm text-[#7a8a9d] mb-2">{opt.desc}</p>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {identity && !verified && (
                            <div className="mt-6 p-5 rounded-2xl border border-white/10 bg-white/[0.02]">
                                <h3 className="text-sm font-semibold text-[#eae6df] mb-4 flex items-center gap-2">
                                    🔐 Identity Verification
                                </h3>

                                {identity === "human" && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-[#a8b8d0] mb-3">Connect a social account to access your dashboard.</p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button onClick={verifyHumanGoogle} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-[#eae6df] hover:bg-white/10">Google ✓</button>
                                            <button onClick={verifyHumanGithub} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-[#eae6df] hover:bg-white/10">GitHub ✓</button>
                                        </div>
                                    </div>
                                )}

                                {identity === "agent" && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-[#a8b8d0] mb-2">Enter your Agent API Key to access your dashboard.</p>
                                        <input type="text" value={agentApiKey} onChange={e => setAgentApiKey(e.target.value)} placeholder="pak_xxxxxxxxxxxxxxxx" className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-sm" />
                                        <button onClick={verifyAgent} disabled={verifying || !agentApiKey} className="w-full py-3 rounded-xl bg-[#c9a84c]/15 text-[#c9a84c] text-sm font-semibold hover:bg-[#c9a84c]/25">{verifying ? "⏳ Verifying..." : "🔑 Verify API Key"}</button>
                                    </div>
                                )}

                                {identity === "openclaw" && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-[#a8b8d0] mb-2">Verify your openclaw identity to view earnings.</p>
                                        <div className="bg-black/30 rounded-xl p-4 border border-red-500/10">
                                            <code className="text-sm text-red-400 font-mono">🦞 {lobsterCode} — Verifying my openclaw identity on @PrometheusSDK #OpenClaw</code>
                                        </div>
                                        <label className="flex items-center gap-3 p-3 cursor-pointer">
                                            <input type="checkbox" checked={lobsterPosted} onChange={e => setLobsterPosted(e.target.checked)} className="accent-red-400 w-4 h-4" />
                                            <span className="text-sm text-[#eae6df]">I've posted the verification code on X</span>
                                        </label>
                                        <button onClick={verifyOpenClaw} disabled={verifying || !lobsterPosted} className="w-full py-3 rounded-xl bg-red-500/15 text-red-400 text-sm font-semibold hover:bg-red-500/25">{verifying ? "⏳ Scanning..." : "�� Verify OpenClaw Identity"}</button>
                                    </div>
                                )}
                                {verifyError && <div className="mt-3 p-3 rounded-xl bg-red-500/10 text-xs text-red-400">⚠️ {verifyError}</div>}
                            </div>
                        )}
                    </div>
                )}
`;

dashboardPageCode = dashboardPageCode.replace(
    /\{\!loading && \!data && \([\s\S]*?\}\)/,
    jsxReplacement
);

fs.writeFileSync("apps/demo/src/app/dashboard/page.tsx", dashboardPageCode);
console.log("Successfully patched DashboardPage");
