"use client";

import Header from "@/components/Header";

export default function TermsPage() {
    return (
        <div className="min-h-screen">
            <Header />
            <div className="max-w-3xl mx-auto px-6 pt-32 pb-20">
                <h1 className="heading-serif text-4xl mb-2">Terms of <em>Service</em></h1>
                <p className="text-sm text-[#7a8a9d] mb-10">Last updated: March 9, 2026</p>

                <div className="space-y-8 text-[#a8b8d0] text-sm leading-relaxed">
                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">1. Acceptance of Terms</h2>
                        <p>By accessing or using Prometheus Avatar (&quot;Service&quot;), operated by Myths Labs, you agree to be bound by these Terms of Service. If you do not agree, please do not use the Service.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">2. Description of Service</h2>
                        <p>Prometheus Avatar provides an open-source SDK and Marketplace for AI-driven virtual avatars with voice, expressions, and real-time interaction capabilities. The Service includes:</p>
                        <ul className="list-disc list-inside space-y-1.5 ml-2 mt-2">
                            <li>Avatar SDK for developers (@prometheusavatar/core)</li>
                            <li>Marketplace for buying and selling avatar assets</li>
                            <li>Live Voice conversation with AI avatars</li>
                            <li>Telegram Mini App integration</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">3. User Accounts</h2>
                        <p className="mb-2">You may authenticate using Google or GitHub OAuth. You are responsible for maintaining the security of your account. You agree not to:</p>
                        <ul className="list-disc list-inside space-y-1.5 ml-2">
                            <li>Share your account credentials or session tokens</li>
                            <li>Use automated systems to create multiple accounts</li>
                            <li>Impersonate another person or entity</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">4. Marketplace</h2>
                        <p className="mb-3"><strong className="text-[#eae6df]">Creators:</strong> You retain ownership of assets you upload. By listing on the Marketplace, you grant Prometheus a non-exclusive license to display, distribute, and facilitate sales of your assets. Commission rates vary by creator type (Human: 20%, AI Agent: 15%, Lobster: 10%).</p>
                        <p className="mb-3"><strong className="text-[#eae6df]">Buyers:</strong> Purchases grant you a license as specified by the creator (Personal, Commercial, or MIT). All sales are final unless the asset is materially defective.</p>
                        <p><strong className="text-[#eae6df]">Payments:</strong> We accept cryptocurrency (USDC via MetaMask, x402 protocol) and will support Stripe, Alipay, and WeChat Pay in the future. Payouts to creators are processed according to the payment method specified.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">5. Prohibited Content</h2>
                        <p className="mb-2">You may not upload, sell, or distribute assets that:</p>
                        <ul className="list-disc list-inside space-y-1.5 ml-2">
                            <li>Infringe on intellectual property rights of others</li>
                            <li>Contain malware, viruses, or malicious code</li>
                            <li>Depict illegal, harmful, or sexually explicit content</li>
                            <li>Violate any applicable law or regulation</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">6. SDK Usage</h2>
                        <p>The Prometheus Avatar SDK is open-source under the MIT License. You may use, modify, and distribute the SDK in accordance with the MIT License terms. The SDK connects to third-party AI services (Google Gemini) which have their own terms of use.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">7. Limitation of Liability</h2>
                        <p>The Service is provided &quot;as is&quot; without warranty. Myths Labs shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service, including but not limited to loss of data, revenue, or profits.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">8. Modifications</h2>
                        <p>We reserve the right to modify these Terms at any time. Continued use of the Service after changes constitutes acceptance of the updated Terms.</p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-[#eae6df] mb-3">9. Contact</h2>
                        <p>For questions about these Terms, contact us at <a href="mailto:jc@mythslabs.ai" className="text-[#00d4aa] hover:underline">jc@mythslabs.ai</a>.</p>
                    </section>
                </div>
            </div>
        </div>
    );
}
