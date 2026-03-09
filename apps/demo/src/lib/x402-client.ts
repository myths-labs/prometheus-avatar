"use client";

/**
 * x402 Crypto Payment Hook
 * 
 * Connects to MetaMask and sends USDC payment on Base L2,
 * then verifies via our x402 API endpoint.
 */

export interface X402PaymentResult {
    success: boolean;
    txHash?: string;
    error?: string;
}

// Base Sepolia testnet config
const BASE_SEPOLIA = {
    chainId: "0x14a34", // 84532
    chainName: "Base Sepolia",
    rpcUrls: ["https://sepolia.base.org"],
    blockExplorerUrls: ["https://sepolia.basescan.org"],
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
};

// Base Mainnet config
const BASE_MAINNET = {
    chainId: "0x2105", // 8453
    chainName: "Base",
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"],
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
};

// USDC contract addresses
const USDC_ADDRESSES: Record<string, string> = {
    "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Circle's testnet USDC
};

// ERC-20 transfer function selector
const ERC20_TRANSFER = "0xa9059cbb";

/**
 * Check if MetaMask is available
 */
export function isMetaMaskAvailable(): boolean {
    return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
}

/**
 * Request MetaMask connection and return wallet address
 */
export async function connectWallet(): Promise<string | null> {
    if (!isMetaMaskAvailable()) return null;

    try {
        const accounts = await window.ethereum!.request({
            method: "eth_requestAccounts",
        }) as string[];
        return accounts[0] || null;
    } catch {
        return null;
    }
}

/**
 * Switch MetaMask to the correct Base network
 */
async function switchToBase(isTestnet: boolean): Promise<boolean> {
    const config = isTestnet ? BASE_SEPOLIA : BASE_MAINNET;

    try {
        await window.ethereum!.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: config.chainId }],
        });
        return true;
    } catch (switchError: unknown) {
        // Chain not added — add it
        const err = switchError as { code?: number };
        if (err.code === 4902) {
            try {
                await window.ethereum!.request({
                    method: "wallet_addEthereumChain",
                    params: [config],
                });
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }
}

/**
 * Send USDC payment via MetaMask
 * 
 * @param recipientAddress - Where to send the USDC
 * @param amountUSD - Dollar amount (e.g. 4.99)
 * @param isTestnet - Whether to use Base Sepolia
 */
export async function sendUSDCPayment(
    recipientAddress: string,
    amountUSD: number,
    isTestnet: boolean = true
): Promise<X402PaymentResult> {
    if (!isMetaMaskAvailable()) {
        return { success: false, error: "MetaMask not found. Please install MetaMask." };
    }

    try {
        // 1. Connect wallet
        const sender = await connectWallet();
        if (!sender) {
            return { success: false, error: "Failed to connect wallet" };
        }

        // 2. Switch to Base network
        const switched = await switchToBase(isTestnet);
        if (!switched) {
            return { success: false, error: "Failed to switch to Base network" };
        }

        // 3. Prepare USDC transfer
        const network = isTestnet ? "base-sepolia" : "base";
        const usdcAddress = USDC_ADDRESSES[network];

        // USDC has 6 decimals
        const amountInSmallestUnit = BigInt(Math.round(amountUSD * 1e6));
        const amountHex = amountInSmallestUnit.toString(16).padStart(64, "0");
        const recipientPadded = recipientAddress.slice(2).padStart(64, "0");
        const data = ERC20_TRANSFER + recipientPadded + amountHex;

        // 4. Send transaction
        const txHash = await window.ethereum!.request({
            method: "eth_sendTransaction",
            params: [{
                from: sender,
                to: usdcAddress,
                data: data,
                value: "0x0", // No ETH, just token transfer
            }],
        }) as string;

        return { success: true, txHash };

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Transaction failed";
        return { success: false, error: msg };
    }
}

/**
 * Full x402 payment flow:
 * 1. Get payment info from server (402 response)
 * 2. Send USDC via MetaMask
 * 3. Submit tx hash to server for verification
 * 4. Receive asset access
 */
export async function x402Checkout(
    assetId: string,
    assetName: string,
    price: number,
    creatorType: string,
    creatorWalletAddress?: string
): Promise<X402PaymentResult & { downloadUrl?: string }> {
    try {
        // Step 1: Get payment info
        const infoRes = await fetch("/api/marketplace/x402", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assetId, assetName, price, creatorType }),
        });

        if (infoRes.status !== 402) {
            return { success: false, error: "x402 protocol error" };
        }

        const paymentInfo = await infoRes.json();
        const recipientAddress = creatorWalletAddress || paymentInfo.payment.platformAddress;
        const isTestnet = (process.env.NEXT_PUBLIC_X402_NETWORK || "base-sepolia") === "base-sepolia";

        // Step 2: Send payment via MetaMask
        const payment = await sendUSDCPayment(recipientAddress, price, isTestnet);
        if (!payment.success || !payment.txHash) {
            return payment;
        }

        // Step 3: Verify with server
        const verifyRes = await fetch("/api/marketplace/x402", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                assetId,
                assetName,
                price,
                creatorType,
                txHash: payment.txHash,
                payerAddress: await connectWallet(),
                creatorWalletAddress,
            }),
        });

        const result = await verifyRes.json();

        if (result.success) {
            return {
                success: true,
                txHash: payment.txHash,
                downloadUrl: result.downloadUrl,
            };
        }

        return { success: false, txHash: payment.txHash, error: "Transaction verification failed" };

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "x402 checkout failed";
        return { success: false, error: msg };
    }
}

// TypeScript declaration for window.ethereum
declare global {
    interface Window {
        ethereum?: {
            request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
            isMetaMask?: boolean;
        };
    }
}
