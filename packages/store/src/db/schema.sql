-- ATLAS local corpus schema v1.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
  repo_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packages (
  package_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(repo_id) ON DELETE CASCADE,
  UNIQUE (repo_id, path)
);

CREATE INDEX IF NOT EXISTS idx_packages_repo ON packages(repo_id);

CREATE TABLE IF NOT EXISTS modules (
  module_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  package_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(repo_id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES packages(package_id) ON DELETE SET NULL,
  UNIQUE (repo_id, path)
);

CREATE INDEX IF NOT EXISTS idx_modules_repo ON modules(repo_id);
CREATE INDEX IF NOT EXISTS idx_modules_package ON modules(package_id);

CREATE TABLE IF NOT EXISTS documents (
  doc_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  path TEXT NOT NULL,
  source_version TEXT NOT NULL,
  kind TEXT NOT NULL,
  authority TEXT NOT NULL,
  title TEXT,
  content_hash TEXT NOT NULL,
  package_id TEXT,
  module_id TEXT,
  skill_id TEXT,
  description TEXT,
  audience_json TEXT NOT NULL DEFAULT '["consumer"]',
  purpose_json TEXT NOT NULL DEFAULT '["guide"]',
  visibility TEXT NOT NULL DEFAULT 'public',
  order_value INTEGER,
  profile TEXT,
  tags_json TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(repo_id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES packages(package_id) ON DELETE SET NULL,
  FOREIGN KEY (module_id) REFERENCES modules(module_id) ON DELETE SET NULL,
  UNIQUE (repo_id, path)
);

CREATE INDEX IF NOT EXISTS idx_documents_repo ON documents(repo_id);
CREATE INDEX IF NOT EXISTS idx_documents_kind ON documents(kind);
CREATE INDEX IF NOT EXISTS idx_documents_authority ON documents(authority);
CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
CREATE INDEX IF NOT EXISTS idx_documents_package ON documents(package_id);
CREATE INDEX IF NOT EXISTS idx_documents_module ON documents(module_id);
CREATE INDEX IF NOT EXISTS idx_documents_skill ON documents(skill_id);
CREATE INDEX IF NOT EXISTS idx_documents_visibility ON documents(visibility);
CREATE INDEX IF NOT EXISTS idx_documents_profile ON documents(profile);

CREATE TABLE IF NOT EXISTS document_scopes (
  doc_id TEXT NOT NULL,
  scope_level TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  package_id TEXT,
  module_id TEXT,
  skill_id TEXT,
  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE,
  FOREIGN KEY (repo_id) REFERENCES repos(repo_id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES packages(package_id) ON DELETE SET NULL,
  FOREIGN KEY (module_id) REFERENCES modules(module_id) ON DELETE SET NULL,
  PRIMARY KEY (doc_id, scope_level, repo_id, package_id, module_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_document_scopes_repo ON document_scopes(repo_id);
CREATE INDEX IF NOT EXISTS idx_document_scopes_package ON document_scopes(package_id);
CREATE INDEX IF NOT EXISTS idx_document_scopes_module ON document_scopes(module_id);
CREATE INDEX IF NOT EXISTS idx_document_scopes_skill ON document_scopes(skill_id);

CREATE TABLE IF NOT EXISTS sections (
  section_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  heading_path_json TEXT NOT NULL,
  text TEXT NOT NULL,
  code_blocks_json TEXT NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE,
  UNIQUE (doc_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_sections_doc ON sections(doc_id, ordinal);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  package_id TEXT,
  module_id TEXT,
  skill_id TEXT,
  section_id TEXT,
  kind TEXT NOT NULL,
  authority TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  heading_path_json TEXT NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE,
  FOREIGN KEY (repo_id) REFERENCES repos(repo_id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE SET NULL,
  UNIQUE (doc_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_chunks_repo ON chunks(repo_id);
CREATE INDEX IF NOT EXISTS idx_chunks_package ON chunks(package_id);
CREATE INDEX IF NOT EXISTS idx_chunks_module ON chunks(module_id);
CREATE INDEX IF NOT EXISTS idx_chunks_skill ON chunks(skill_id);

CREATE TABLE IF NOT EXISTS summaries (
  summary_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  level TEXT NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  UNIQUE (target_type, target_id, level)
);

CREATE INDEX IF NOT EXISTS idx_summaries_target ON summaries(target_type, target_id);

CREATE TABLE IF NOT EXISTS skills (
  skill_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  package_id TEXT,
  module_id TEXT,
  source_doc_id TEXT NOT NULL,
  source_doc_path TEXT NOT NULL,
  title TEXT,
  description TEXT,
  headings_json TEXT NOT NULL,
  key_sections_json TEXT NOT NULL,
  topics_json TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(repo_id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES packages(package_id) ON DELETE SET NULL,
  FOREIGN KEY (module_id) REFERENCES modules(module_id) ON DELETE SET NULL,
  FOREIGN KEY (source_doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_skills_repo ON skills(repo_id);
CREATE INDEX IF NOT EXISTS idx_skills_package ON skills(package_id);
CREATE INDEX IF NOT EXISTS idx_skills_module ON skills(module_id);

CREATE TABLE IF NOT EXISTS skill_artifacts (
  skill_id TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT,
  content TEXT,
  FOREIGN KEY (skill_id) REFERENCES skills(skill_id) ON DELETE CASCADE,
  PRIMARY KEY (skill_id, path)
);

CREATE INDEX IF NOT EXISTS idx_skill_artifacts_skill ON skill_artifacts(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_artifacts_kind ON skill_artifacts(kind);

CREATE TABLE IF NOT EXISTS manifests (
  repo_id TEXT PRIMARY KEY,
  indexed_revision TEXT,
  build_timestamp TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  partial_revision TEXT,
  partial_build_timestamp TEXT,
  partial_selector_json TEXT,
  compiler_version TEXT,
  FOREIGN KEY (repo_id) REFERENCES repos(repo_id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_entries USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  doc_id UNINDEXED,
  section_id UNINDEXED,
  chunk_id UNINDEXED,
  repo_id UNINDEXED,
  path,
  title,
  headings,
  body
);
