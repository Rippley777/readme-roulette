# How README Roulette introduces a project

Generation starts with product behavior. Dependencies are useful for setup and technical explanations; they cannot create a feature.

```text
Safe repository files
  → product interpretation + technical evidence
  → section plan + ranked claims
  → local draft
  → optional model writing with tone-specific instructions
  → editorial and factual checks
  → Markdown + separate evidence inspection
```

## Product interpretation

The normalized `ProductModel` keeps the project name/type, purpose, problem, audience, main workflow, supported actions, technical roles, terminology, motivation, screenshots, and explicit design tradeoffs. Unknown fields stay unknown. These fields guide writing; they are not pasted into the README.

JavaScript/TypeScript inspection uses the TypeScript parser to identify visible UI actions and follow named handlers. Actual call expressions distinguish implemented operations from text examples and comments. Other signals include CLI declarations, API handlers with matching operations, documented library exports, existing feature documentation, and author-written motivation. Test files, fixtures, empty handlers, and roadmap promises do not establish implemented features.

Every product claim carries an ID, source reference, optional excerpt/line, and provenance (`implemented`, `documented`, or `inferred`). Inference is limited to conversational pain points and audience framing. It cannot invent capabilities, technical decisions, comparative advantages, or personal history. The inspector labels these distinctions.

Current static coverage is strongest for JS/TS UI handlers, conventional HTTP handlers, Commander CLIs, documented exports, Python CLI descriptions, and explicit Markdown documentation. It is a bounded interpreter, not a proof of arbitrary application behavior. Obfuscated code, indirect bindings, unsupported languages, and undocumented business logic can leave gaps. With little evidence, a shorter introduction is preferable to a fabricated feature list.

## Writing and tone

**Personality** is the default. The other settings are Professional, Developer, and Unhinged. Tone affects the opening strategy, headings, feature presentation, and permitted asides. For an external provider it also changes the writing prompt, with separate directions for each tone. Documentation profiles control depth independently of tone.

The local writer composes from supported actions. Capability-specific wording is triggered by executable evidence, not a repository-name lookup. A project called Port Authority with no process-inspection implementation will not receive a port-scanning README.

The strongest capability comes first, followed by main workflows and conveniences. Dependency lists never become Features. Technical sections explain roles only where imports, commands, or implementation provide support. Source paths stay in the inspector, except where a path is part of an actual instruction or image reference.

## Sections and screenshots

The planner selects sections with useful content. For example, a CLI can receive Commands and Usage, a documented library can receive export behavior and examples, and an app can receive user actions and setup. Empty Architecture, Screenshots, Configuration, and Testing placeholders are omitted. A Why section uses author-supplied motivation, or an impersonal supported problem for a portfolio-oriented profile.

Existing local screenshots are discovered through Markdown image references and screenshot/demo asset paths. Logos, badges, avatars, missing paths, and arbitrary image assets are excluded. Overview/dashboard images rank before detail images. When no screenshot exists, the generated README contains only a hidden HTML checklist tied to the detected actions.

## Editorial checks

The internal pass removes duplicated sentences, boilerplate, dependency-as-feature bullets, and empty sections. It evaluates sentence length and aside count without presenting an arbitrary AI score.

Optional model responses must preserve the section plan, project identity, technical bodies, commands, versions, images, and author-authored motivation. Rewritten product copy cites allowed claim IDs internally. Validators check those references, unsupported capability/platform claims, invented numbers, personal stories, comparisons, and whether the introduction still explains an evidenced action.

These checks are deliberately conservative, but are not a general semantic verifier. The code cannot prove every possible natural-language paraphrase. Human review and the evidence inspector remain valuable. A candidate that fails gets one repair attempt; a second failure, malformed response, or provider error falls back to the local draft. The UI makes that fallback explicit. Publishing still requires a reviewed diff.

## Optional HTTP adapter

Set `AI_ENDPOINT` and optionally `AI_API_KEY`. Requests use `task: "readme_generation_v2"` with the product model, supported claims, tone strategy, constraints, baseline draft, and any repair findings. The adapter should return:

```json
{
  "draft": {
    "title": "Project name",
    "tagline": "Short product-specific line",
    "introduction": "Concrete product introduction.",
    "aside": "",
    "openingClaimIds": ["claim-1"],
    "sections": [
      {
        "id": "Features",
        "title": "What it does",
        "body": "- **User action** — What it makes possible.",
        "claimIds": ["claim-1"]
      }
    ],
    "badges": "Copy the baseline value",
    "screenshotComment": "Copy the baseline value"
  }
}
```

Copy unchanged fields and factual sections from the supplied baseline; the example is a schema illustration, not a valid response for every project. Existing adapters can continue returning `{ "text": "Markdown" }`. The request retains `text`, `instruction`, and `project`; text responses are parsed into the section plan and checked by the same gate. Selection rewrites keep the original text-response contract.

The HTTP adapter receives normalized evidence and bounded, redacted source excerpts, not entire source files or environment values. It has no ability to invoke tools, run repository code, or write to GitHub.

## Verification

`npm test` covers independent apps, a CLI, an API, a library, sparse evidence, false-positive signals, screenshot detection, all four tones, quality repairs, provider compatibility, and evidence retention. `npm run test:browser` checks tone switching, source inspection, section regeneration, version restoration, diff review, and mobile layout.

The generated Port Authority examples under `artifacts/generation/` come from the explicitly labeled demo source snapshots. The snapshots include supported process inspection, termination, browser opening, filtering, and refresh behavior. They do not contain restart support, so none of the generated tones promise it.
