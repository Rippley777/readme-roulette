import { GenerationInspection } from '@/lib/types';
import { FileText, ShieldCheck } from 'lucide-react';
export default function GenerationInspector({ inspection }: { inspection: GenerationInspection }) {
  return (
    <div className="generation-inspector">
      <div className="inspector-heading">
        <ShieldCheck size={17} />
        <div>
          <h4>Why did README Roulette say this?</h4>
          <p>Evidence for the last generation. Your subsequent edits are not revalidated here.</p>
        </div>
      </div>
      {inspection
        .filter((s) => s.claims.length)
        .map((section) => (
          <details key={section.section}>
            <summary>
              {section.section}
              <span>{section.claims.length} supporting claims</span>
            </summary>
            {section.claims.map((claim) => (
              <div className="inspector-claim" key={claim.id}>
                <strong>{claim.text}</strong>
                <small>
                  {claim.confidence === 'inferred'
                    ? 'Inferred pain point'
                    : claim.confidence === 'documented'
                      ? 'Documented by the project'
                      : 'Supported by implementation'}
                </small>
                {claim.sources.map((source, i) => (
                  <div className="claim-source" key={i}>
                    <span>
                      <FileText size={12} />
                      {source.path}
                      {source.line ? `:${source.line}` : ''}
                    </span>
                    {source.excerpt && <code>{source.excerpt}</code>}
                  </div>
                ))}
              </div>
            ))}
          </details>
        ))}
    </div>
  );
}
