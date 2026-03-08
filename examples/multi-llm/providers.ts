/**
 * Multi-LLM Provider Configuration Example
 *
 * Shows how to configure multiple LLM providers with automatic fallback.
 * All providers use OpenAI-compatible chat/completions format.
 */

import type { ILLMProvider, ILLMMessage } from '@prometheusavatar/core';

// ═══ Provider implementations ═══

class OpenAICompatProvider implements ILLMProvider {
    constructor(
        public readonly name: string,
        private url: string,
        private model: string,
        private apiKey: string,
    ) { }

    available(): boolean {
        return !!this.apiKey;
    }

    async *stream(messages: ILLMMessage[]): AsyncIterable<string> {
        const response = await fetch(this.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages,
                stream: true,
            }),
        });

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') return;

                try {
                    const json = JSON.parse(data);
                    const token = json.choices?.[0]?.delta?.content;
                    if (token) yield token;
                } catch { /* skip */ }
            }
        }
    }
}

// ═══ Configure providers ═══

const providers: ILLMProvider[] = [
    // 🌍 Global providers
    new OpenAICompatProvider('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini-2.0-flash', process.env.GEMINI_API_KEY!),
    new OpenAICompatProvider('openai', 'https://api.openai.com/v1/chat/completions', 'gpt-4o-mini', process.env.OPENAI_API_KEY!),
    new OpenAICompatProvider('groq', 'https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile', process.env.GROQ_API_KEY!),
    new OpenAICompatProvider('grok', 'https://api.x.ai/v1/chat/completions', 'grok-3-mini-fast', process.env.XAI_API_KEY!),

    // 🇨🇳 China market providers
    new OpenAICompatProvider('deepseek', 'https://api.deepseek.com/chat/completions', 'deepseek-chat', process.env.DEEPSEEK_API_KEY!),
    new OpenAICompatProvider('qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-plus', process.env.DASHSCOPE_API_KEY!),
    new OpenAICompatProvider('kimi', 'https://api.moonshot.cn/v1/chat/completions', 'moonshot-v1-8k', process.env.MOONSHOT_API_KEY!),
    new OpenAICompatProvider('minimax', 'https://api.minimax.chat/v1/text/chatcompletion_v2', 'MiniMax-Text-01', process.env.MINIMAX_API_KEY!),
];

// ═══ Usage: try providers in order, auto-fallback ═══

async function chat(userMessage: string): Promise<string> {
    const messages: ILLMMessage[] = [
        { role: 'system', content: 'You are a helpful avatar companion.' },
        { role: 'user', content: userMessage },
    ];

    const available = providers.filter(p => p.available());
    if (available.length === 0) throw new Error('No LLM providers configured');

    for (const provider of available) {
        try {
            let response = '';
            for await (const token of provider.stream(messages)) {
                response += token;
                process.stdout.write(token); // Stream to console
            }
            console.log(`\n[Used: ${provider.name}]`);
            return response;
        } catch (err) {
            console.warn(`[${provider.name}] failed, trying next...`);
        }
    }

    throw new Error('All providers failed');
}

// Run
chat('Tell me about the myth of Prometheus in 2 sentences.').catch(console.error);
