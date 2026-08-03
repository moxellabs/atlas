export function ghesConfig(baseUrl: string): string {
  return `
version: 1
cacheDir: .cache/atlas
logLevel: info
server:
  transport: http
repos:
  - repoId: github.mycorp.com/platform/ghes
    mode: ghes-api
    github:
      baseUrl: ${baseUrl}
      owner: moxellabs
      name: atlas
      ref: main
      tokenEnvVar: ATLAS_GHES_TOKEN
    workspace:
      packageGlobs:
        - packages/*
      packageManifestFiles:
        - package.json
    topology:
      - id: repo-docs
        kind: repo-doc
        match:
          include:
            - docs/**/*.md
        ownership:
          attachTo: repo
        authority: canonical
        priority: 10
`;
}
