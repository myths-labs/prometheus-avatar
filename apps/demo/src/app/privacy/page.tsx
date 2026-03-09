"use client";

import Header from "@/components/Header";

export default function PrivacyPage() {
    return (
        <div className="min-h-screen">
            <Header />
            <div className="max-w-3xl mx-auto px-6 pt-32 pb-20">
                <h1 className="heading-serif text-4xl mb-2">Privacy <em>Policy</em></h1>
                <p className="text-sm text-[#7a8a9d] mb-10">Last updated: March 9, 2026</p>

                <div className="space-y-8 text-[#a8b8d0] text-sm leading-relaxed">
                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">1. Introduction</h2>
                        <p>Prometheus Avatar (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is operated by Myths Labs. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our website at prometheus.mythslabs.ai, our SDK, Marketplace, and Telegram Mini App (collectively, the &quot;Service&quot;).</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">2. Information We Collect</h2>
                        <p className="mb-3"><strong className="text-[#eae6df]">Account Information:</strong> When you authenticate via Google or GitHub OAuth, we receive your name, email address, and profile picture. We do not store your OAuth tokens beyond the current session.</p>
                        <p className="mb-3"><strong className="text-[#eae6df]">Usage Data:</strong> We collect basic analytics including page views, feature usage, and error logs to improve the Service.</p>
                        <p className="mb-3"><strong className="text-[#eae6df]">Marketplace Data:</strong> If you upload assets or make purchases, we store transaction records, asset metadata, and payment information necessary to process payments.</p>
                        <p><strong className="text-[#eae6df]">Voice Data:</strong> When using Live Voice features, audio is streamed to Google&apos;s Gemini API for real-time processing. We do not store or retain your voice recordings.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">3. How We Use Your Information</h2>
                        <ul className="list-disc list-inside space-y-1.5 ml-2">
                            <li>To authenticate your identity and provide account access</li>
                            <li>To process marketplace transactions and payouts</li>
                            <li>To provide avatar, voice, and AI conversation features</li>
                            <li>To prevent fraud, abuse, and enforce our Terms of Service</li>
                            <li>To improve and develop new features based on usage patterns</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">4. Third-Party Services</h2>
                        <p className="mb-2">We integrate with the following third-party services:</p>
                        <ul className="list-disc list-inside space-y-1.5 ml-2">
                            <li><strong className="text-[#eae6df]">Google Gemini API</strong> — for AI conversation and voice features</li>
                            <li><strong className="text-[#eae6df]">Google/GitHub OAuth</strong> — for authentication</li>
                            <li><strong className="text-[#eae6df]">Vercel</strong> — for hosting and analytics</li>
                            <li><strong className="text-[#eae6df]">Blockchain networks (Base L2)</strong> — for crypto payments</li>
                        </ul>
                        <p className="mt-2">Each third-party service operates under its own privacy policy.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">5. Data Security</h2>
                        <p>We implement industry-standard security measures including HTTPS encryption, httpOnly session cookies, and secure OAuth flows. However, no method of electronic transmission or storage is 100% secure.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">6. Your Rights</h2>
                        <p>You may request access to, correction of, or deletion of your personal data by contacting us. You may also revoke OAuth access at any time through your Google or GitHub account settings.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">7. Contact</h2>
                        <p>For privacy-related inquiries, contact us at <a href="mailto:jc@mythslabs.ai" className="text-[#00d4aa] hover:underline">jc@mythslabs.ai</a>.</p>
                    </section>
                </div>
            </div>
        </div>
    );
}
