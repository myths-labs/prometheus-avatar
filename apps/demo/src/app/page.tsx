import dynamic from "next/dynamic";

const HomeClient = dynamic(() => import("@/components/HomeClient"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a0f" }}>
      <div className="text-center">
        <div className="text-4xl mb-4">🔥</div>
        <p style={{ color: "#a855f7", fontWeight: 600 }}>Loading Prometheus...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return <HomeClient />;
}
