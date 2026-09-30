export const aiProviders = ['openai', 'anthropic'] as const;
export type AIProviderName = (typeof aiProviders)[number];
export const aiProviderLabels: Record<AIProviderName, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};
export type AISettings = { configured: boolean; provider?: AIProviderName; model?: string };
export type AICredential = { provider: AIProviderName; model: string; apiKey: string };
