# Skill Spec Template

Use these templates after read-only research. Do not create or modify files until an approved spec names exact paths.

## Candidate Recommendation

```markdown
### Candidate: <skill name>

- skill name: <short kebab-case name>
- target users: <consumer | contributor | maintainer | internal | team/persona>
- trigger conditions: <when an agent/user should use this skill>
- why useful: <mistakes avoided, decisions standardized, time saved>
- suggested files/folders: <target path such as skills/<skill-name>/SKILL.md plus optional folders>
- confidence: <high | medium | low> - <evidence from docs/source>
- risks: <scope, stale docs, safety, maintenance, or automation risks>
- overlap with existing skills: <existing skill names and overlap/justification>
```

Recommendation notes:

- Prefer one clear trigger per skill.
- Prefer root `skills/<skill-name>/SKILL.md` for repo-wide workflows.
- Suggest package-local paths only when package scope is justified by research evidence.
- Reject candidates that duplicate an existing skill without adding useful distinction.

## Approved Skill Spec

```markdown
### Approved Skill Spec: <approved skill name>

- approved skill name: <exact skill name approved by user>
- approved target path: <exact SKILL.md path approved by user>
- purpose: <what this skill helps with>
- audience: <frontmatter audience values and human personas>
- frontmatter: <exact YAML keys/values to write>
- sections to create: <section headings and required content>
- supporting assets: <references/scripts/templates/checklists paths or none>
- overwrite/update permission: <none | exact paths approved for update>
- docs/index updates: <paths to update or none>
- validation commands: <commands to run after writing>
- self-index rebuild instructions: <whether to run build --profile public and artifact verify --fresh>
```

Approval statement required before writes:

```markdown
I approve creating/updating:

- <approved skill name> at <approved target path>
- <supporting asset paths or none>
```

## Path Rules

- Default root path: `skills/<skill-name>/SKILL.md`.
- Package-local path requires written justification explaining why repo-wide skill scope is wrong.
- Supporting references belong under `references/` beside the skill unless approved spec names another path.
- Supporting scripts belong under `scripts/` beside the skill and need an approved validation command.
- Templates or checklists belong under `templates/` or `checklists/` beside the skill unless another path is approved.
- No overwrite/update unless user approves exact path.
- No file writes during research, recommendation, or discussion.

## Self-Index Rebuild Instructions

For public skill changes in Atlas, tell maintainers to run:

```bash
bun apps/cli/src/index.ts build --profile public
bun apps/cli/src/index.ts artifact verify --fresh
```

Then review `.moxel/atlas/manifest.json`, `.moxel/atlas/docs.index.json`, `.moxel/atlas/checksums.json`, and `.moxel/atlas/corpus.db` before commit.
