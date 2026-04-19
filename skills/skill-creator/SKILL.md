---
name: skill-creator
title: Skill Creator
description: Research Atlas docs and source structure, recommend useful skills, discuss specs, and create approved skill assets.
visibility: public
audience: [contributor, maintainer]
purpose: [workflow]
order: 110
---

# Skill Creator

Use this skill to discover useful Atlas skills, refine them with a user, and create only assets that the user explicitly approves.

## When To Use

Use this skill when a user or maintainer wants to:

- Find repeated Atlas workflows that deserve a reusable skill.
- Turn vague skill ideas into concrete, reviewable specs.
- Compare proposed skills against existing `skills/**` and package-local skills.
- Create approved `SKILL.md` files plus approved references, scripts, templates, or checklists.
- Prepare first-party or repo-local skill changes for self-indexing.

Do not use this skill to bypass normal implementation, testing, or approval flow.

## Non-Negotiable Safety Boundary

No files may be written during research, recommendation, or discussion.

Only create or modify files after the user explicitly approves exact skill names and exact target paths. Vague enthusiasm such as "sounds good", "looks useful", "nice idea", or "go on" is not approval. Ask for explicit approval again if the approval does not name the skill and path.

Never overwrite or update an existing skill unless the user explicitly approves that exact existing path.

## Workflow

1. **Research before recommending.**
   - Inspect `README.md`, active `docs/**`, `apps/*/docs`, `packages/*/docs`, existing `skills/**`, and package-local skill folders such as `apps/*/docs/skills/**` or `packages/*/docs/skills/**`.
   - Identify repeated workflows, risky change areas, domain terms, package boundaries, runtime surfaces, validation gates, and places where agent mistakes repeat.
   - Check overlap with existing skills such as `document-codebase`, `atlas-contributor`, package-local command/build skills, or other repo skills.
   - Keep research read-only.

2. **Recommend candidate skills.**
   - Present multiple candidates only when research supports them.
   - Include required fields from the recommendation format below.
   - Prefer small, triggerable skills over broad catch-all guidance.
   - Rank by usefulness, confidence, and risk.

3. **Discuss and refine.**
   - Let the user pick, reject, merge, split, rename, narrow, broaden, or request alternatives.
   - Ask follow-up questions when audience, trigger conditions, target path, assets, overwrite/update permission, or validation commands are unclear.
   - Repeat until a concrete skill spec exists.
   - Keep discussion read-only.

4. **Approval gate.**
   - Before writing, restate exact approved skill names and exact target paths.
   - Ask for explicit approval to create or update those exact paths.
   - Stop if approval is unclear.

5. **Create approved assets.**
   - Write only assets named in approved spec.
   - Validate, summarize, and provide self-indexing handoff.

## Recommendation Format

For each candidate, provide:

- `skill name`: proposed invocation-friendly name.
- `target users`: consumer, contributor, maintainer, internal, or specific team/persona.
- `trigger conditions`: prompts or tasks that should activate the skill.
- `why useful`: mistakes reduced, speed gained, or decisions standardized.
- `suggested files/folders`: exact target path and optional supporting folders.
- `confidence`: high/medium/low plus evidence.
- `risks`: scope creep, stale docs, overlap, wrong audience, unsafe automation, or maintenance burden.
- `overlap with existing skills`: existing skill names and why new skill is still needed or not needed.

## Discussion And Spec Refinement

Use `references/skill-spec-template.md` to turn a candidate into an approved spec.

During discussion:

- Accept user edits to name, audience, trigger conditions, scope, sections, and assets.
- Offer alternatives when overlap or target path risk appears.
- Ask follow-up questions before guessing missing details.
- Mark unresolved choices as open questions.
- Do not write files, stage files, rebuild artifacts, or run mutating generators.

## Approval Gate

Before creating anything, show an approval block:

```markdown
Approval needed before writes:

- Approved skill name: <name>
- Approved target path: <path>
- Supporting assets to create/update: <paths or none>
- Overwrite/update existing files: <yes/no and exact paths>

Reply with explicit approval naming the skill and target path.
```

Proceed only when reply clearly approves exact skill names and exact target paths. If user says only "sounds good" or similar vague enthusiasm, respond with a clarification request and keep all writes blocked.

## Creation Rules

- Default path for repo-wide skills: `skills/<skill-name>/SKILL.md`.
- Package-local path is allowed only with written justification that the trigger is scoped to one app/package/module.
- Create `SKILL.md`, references, scripts, templates, or checklists only when included in approved spec.
- Preserve public metadata when skill should be indexed: `visibility`, `audience`, and `purpose`.
- Use `visibility: internal` for private/internal-only skills.
- Do not create executable scripts unless approved spec names script path, purpose, and validation command.
- Do not install into external agent/editor folders unless user separately approves that external target path.

## Self-Indexing Handoff

After approved public skill changes, tell the maintainer to refresh Atlas public artifact:

```bash
bun apps/cli/src/index.ts build --profile public
bun apps/cli/src/index.ts artifact verify --fresh
```

Report which skill files changed, which validation commands ran, whether docs/index links changed, and whether `.moxel/atlas` needs review/commit.

## Resource Guide

- Use `references/skill-spec-template.md` for candidate recommendation and approved skill spec templates.
