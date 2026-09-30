'use client';
import { useState } from 'react';
import { KeyRound, Sparkles, Check, Trash2, LoaderCircle } from 'lucide-react';
import { AISettings, AIProviderName, aiProviderLabels, aiProviders } from '@/lib/byok-types';

export function AISettingsCard({
  signedIn,
  settings,
  onChange,
  onConnect,
}: {
  signedIn: boolean;
  settings: AISettings;
  onChange: () => Promise<void>;
  onConnect: () => void;
}) {
  const [provider, setProvider] = useState<AIProviderName>(settings.provider || 'openai');
  const [model, setModel] = useState(settings.model || '');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const hasKey = Boolean(apiKey.trim() || (settings.configured && settings.provider === provider));
  async function act(operation: 'models' | 'save' | 'remove') {
    setBusy(operation);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation,
          provider,
          model,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI settings could not be updated.');
      if (operation === 'models') {
        setModels(data.models);
        setMessage(
          data.models.length
            ? 'Key accepted. Choose a model below, then save.'
            : 'Key accepted. Enter a text-generation model ID from your provider.',
        );
      } else {
        setApiKey('');
        if (operation === 'remove') {
          setModel('');
          setModels([]);
        }
        await onChange();
        setMessage(
          operation === 'remove'
            ? 'Key removed. Generation will use the workspace default.'
            : 'AI is ready for your next README. Your existing draft is unchanged.',
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="settings-card ai-settings" aria-labelledby="ai-settings-heading">
      <div className="settings-heading">
        <KeyRound size={24} />
        <div>
          <h3 id="ai-settings-heading">Bring your own AI key</h3>
          <p>Give the writing a stronger voice, grounded in what your project actually does.</p>
        </div>
        <span className={`status-badge ${settings.configured ? 'green' : 'yellow'}`}>
          {settings.configured ? 'AI connected' : 'Optional'}
        </span>
      </div>
      {settings.configured && (
        <p className="ai-active">
          <Check size={15} /> Active: {aiProviderLabels[settings.provider!]} · {settings.model}
        </p>
      )}
      {!signedIn ? (
        <>
          <p>
            Connect GitHub to save an encrypted API key to your account. The local writer remains
            available without a key.
          </p>
          <button className="button" onClick={onConnect}>
            Connect GitHub <KeyRound size={14} />
          </button>
        </>
      ) : (
        <>
          <div className="ai-fields">
            <label>
              AI provider
              <select
                aria-label="AI provider"
                value={provider}
                disabled={!!busy}
                onChange={(e) => {
                  const next = e.target.value as AIProviderName;
                  setProvider(next);
                  setModel(next === settings.provider ? settings.model || '' : '');
                  setApiKey('');
                  setModels([]);
                  setError('');
                  setMessage('');
                }}
              >
                {aiProviders.map((p) => (
                  <option key={p} value={p}>
                    {aiProviderLabels[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              API key
              <input
                type="password"
                value={apiKey}
                autoComplete="new-password"
                spellCheck={false}
                maxLength={4096}
                disabled={!!busy}
                placeholder={
                  settings.configured && provider === settings.provider
                    ? 'Saved key — enter a new one to replace'
                    : 'Paste your API key'
                }
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setModels([]);
                  setMessage('');
                }}
              />
            </label>
          </div>
          <button className="button" disabled={!!busy || !hasKey} onClick={() => act('models')}>
            {busy === 'models' ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{' '}
            Check key & load models
          </button>
          <label className="ai-model">
            Model
            <input
              list="ai-models"
              value={model}
              disabled={!!busy}
              maxLength={150}
              placeholder="Choose an available model or enter its ID"
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <datalist id="ai-models">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </datalist>
          <p className="ai-fineprint">
            {provider === 'openai'
              ? 'Choose a model supporting the Responses API and JSON output.'
              : 'Choose a text-generation model supporting the Messages API.'}{' '}
            Checking access does not generate text; model availability depends on your provider
            account.
          </p>
          <div className="ai-actions">
            <button
              className="button primary"
              disabled={!!busy || !hasKey || !model.trim()}
              onClick={() => act('save')}
            >
              {busy === 'save' ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Sparkles size={15} />
              )}{' '}
              Save AI settings
            </button>
            {settings.configured && (
              <button className="button" disabled={!!busy} onClick={() => act('remove')}>
                <Trash2 size={14} /> Remove key
              </button>
            )}
          </div>
          <p className="ai-fineprint">
            Your key is stored encrypted on the server and is never saved in browser storage.
            Generating or rewriting sends project evidence and bounded source excerpts to your
            provider. API usage is billed to your account; a quality repair can make one additional
            request. Chat subscriptions do not supply an API key.
          </p>
          {message && (
            <p className="ai-feedback" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="ai-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
