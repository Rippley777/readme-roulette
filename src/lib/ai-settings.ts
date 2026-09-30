import db, { AppDatabase } from './database';
import { AISettings, AICredential, AIProviderName } from './byok-types';
import { encryptSecret, decryptSecret } from './secret-crypto';
import { ProviderError } from './provider-error';

export class AISettingsStore {
  constructor(private database: AppDatabase = db) {}
  async publicSettings(userId: string): Promise<AISettings> {
    const row = (await this.database
      .prepare('SELECT provider,model FROM ai_credentials WHERE user_id=?')
      .get(userId)) as { provider: AIProviderName; model: string } | undefined;
    return row
      ? { configured: true, provider: row.provider, model: row.model }
      : { configured: false };
  }
  async credential(userId: string): Promise<AICredential | undefined> {
    const row = (await this.database
      .prepare('SELECT provider,model,api_key FROM ai_credentials WHERE user_id=?')
      .get(userId)) as { provider: AIProviderName; model: string; api_key: string } | undefined;
    if (!row) return undefined;
    try {
      return {
        provider: row.provider,
        model: row.model,
        apiKey: decryptSecret(row.api_key, `ai:${userId}:${row.provider}`),
      };
    } catch {
      throw new ProviderError(
        'saved-key-unavailable',
        'Your saved AI key could not be opened. Replace it in Settings.',
      );
    }
  }
  async save(userId: string, credential: AICredential) {
    await this.database
      .prepare('INSERT OR REPLACE INTO ai_credentials VALUES (?,?,?,?,?)')
      .run(
        userId,
        credential.provider,
        credential.model,
        encryptSecret(credential.apiKey, `ai:${userId}:${credential.provider}`),
        Date.now(),
      );
    return this.publicSettings(userId);
  }
  async remove(userId: string) {
    await this.database.prepare('DELETE FROM ai_credentials WHERE user_id=?').run(userId);
  }
}
export const aiSettingsStore = new AISettingsStore();
