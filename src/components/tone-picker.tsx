import { Tone } from '@/lib/types';
import { tones, toneDescriptions } from '@/lib/generator';
export default function TonePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: Tone;
  onChange: (tone: Tone) => void;
  disabled?: boolean;
}) {
  return (
    <div className="tone-picker">
      <span className="tone-label">Writing tone</span>
      <div className="tone-options" role="group" aria-label="README writing tone">
        {tones.map((tone) => (
          <button
            type="button"
            key={tone}
            disabled={disabled}
            aria-pressed={value === tone}
            title={toneDescriptions[tone]}
            className={value === tone ? 'active' : ''}
            onClick={() => onChange(tone)}
          >
            {tone}
            {tone === 'Personality' && <span className="tone-dot" />}
          </button>
        ))}
      </div>
      <span className="tone-description">{toneDescriptions[value]}</span>
    </div>
  );
}
