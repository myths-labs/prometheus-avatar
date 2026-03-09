import dynamic from "next/dynamic";

const HomeClient = dynamic(() => import("@/components/HomeClient"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#050508" }}>
      <div className="text-center">
        <div className="text-4xl mb-4">🔥</div>
        <p style={{ color: "#00d4aa", fontWeight: 600 }}>Loading Prometheus...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return <HomeClient />;
}
