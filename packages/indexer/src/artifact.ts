import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	copyFile,
	mkdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type AtlasStoreClient,
	countRepoCorpusRows,
	DocRepository,
	deleteRepoCorpus,
	getCurrentSchemaVersion,
	ManifestRepository,
	ModuleRepository,
	migrateStore,
	openStore,
	PackageRepository,
	SkillRepository,
	STORE_SCHEMA_VERSION,
	type StoreDatabase,
} from "@atlas/store";

export const MOXEL_ATLAS_ARTIFACT_SCHEMA = "moxel-atlas-artifact/v1";
export const MOXEL_ATLAS_ARTIFACT_VERSION = 1;
export const MOXEL_ATLAS_ARTIFACT_FILES = [
	"manifest.json",
	"corpus.db",
	"checksums.json",
	"docs.index.json",
] as const;
export const MOXEL_ATLAS_CHECKSUMS_SCHEMA = "moxel-atlas-checksums/v1";

export interface MoxelAtlasArtifactManifest {
	schema: typeof MOXEL_ATLAS_ARTIFACT_SCHEMA;
	repoId: string;
	host: string;
	owner: string;
	name: string;
	ref: string;
	indexedRevision: string;
	createdAt: string;
	atlasVersion: string;
	format: {
		version: typeof MOXEL_ATLAS_ARTIFACT_VERSION;
		files: typeof MOXEL_ATLAS_ARTIFACT_FILES;
		corpusDbSchemaVersion: number;
	};
	profiles: {
		default: "public";
		available: string[];
		applied: string;
	};
}

export interface BuildArtifactManifestInput {
	repoId: string;
	ref: string;
	indexedRevision?: string | undefined;
	createdAt?: string | undefined;
	atlasVersion?: string | undefined;
	corpusDbSchemaVersion?: number | undefined;
	profile?: string | undefined;
	availableProfiles?: string[] | undefined;
}

export interface MoxelAtlasDocsIndex {
	schema: "moxel-atlas-docs-index/v1";
	repoId: string;
	generatedAt: string;
	counts: {
		documents: number;
		skills: number;
		packages: number;
		modules: number;
	};
	documents: MoxelAtlasDocsIndexDocument[];
}

export interface MoxelAtlasDocsIndexDocument {
	path: string;
	docId: string;
	title?: string | undefined;
	kind: string;
	authority: string;
	packageId?: string | undefined;
	moduleId?: string | undefined;
	skillId?: string | undefined;
	description?: string | undefined;
	audience: string[];
	purpose: string[];
	visibility: string;
	order?: number | undefined;
	profile?: string | undefined;
	contentHash: string;
	sourceVersion: string;
	tags: string[];
	scopes: unknown[];
}

export interface ArtifactDiagnostic {
	code: string;
	path?: string | undefined;
	message: string;
}

export interface ArtifactChecksumEntry {
	path: string;
	sha256: string;
	sizeBytes: number;
}
export interface ArtifactChecksumResult {
	valid: boolean;
	files: ArtifactChecksumEntry[];
	diagnostics: ArtifactDiagnostic[];
}

export interface ArtifactCorpusImportCounts {
	repos: number;
	packages: number;
	modules: number;
	documents: number;
	sections: number;
	chunks: number;
	summaries: number;
	skills: number;
	manifests: number;
	ftsRows: number;
}

export interface ArtifactCorpusImportDiagnostic {
	code: string;
	message: string;
	path?: string | undefined;
}

export interface ArtifactCorpusImportInput {
	repoId: string;
	artifactDbPath: string;
	manifestPath: string;
	expectedSchemaVersion: number;
	globalDbPath?: string | undefined;
	globalDb?: StoreDatabase | undefined;
	importedAt?: string | undefined;
}

export interface ArtifactCorpusImportResult {
	repoId: string;
	artifactDbPath: string;
	globalDbPath: string;
	importedAt: string;
	replaced: ArtifactCorpusImportCounts;
	counts: ArtifactCorpusImportCounts;
	diagnostics: ArtifactCorpusImportDiagnostic[];
}

export interface ArtifactVerificationInput {
	artifactDir: string;
	expectedRepoId?: string | undefined;
	freshRef?: string | undefined;
	requireFresh?: boolean | undefined;
	importCheckDbPath?: string | undefined;
}

export interface ArtifactVerificationResult {
	valid: boolean;
	artifactDir: string;
	repoId?: string | undefined;
	manifest?: MoxelAtlasArtifactManifest | undefined;
	diagnostics: ArtifactDiagnostic[];
	checksum: ArtifactChecksumResult;
	safety: { valid: boolean; diagnostics: ArtifactDiagnostic[] };
	importable: boolean;
	counts: ArtifactCorpusImportCounts;
	fresh?: boolean | undefined;
	expectedRevision?: string | undefined;
	indexedRevision?: string | undefined;
}

export interface ArtifactInspectionResult {
	artifactDir: string;
	manifest?: MoxelAtlasArtifactManifest | undefined;
	files: ArtifactChecksumEntry[];
	docsIndex?: MoxelAtlasDocsIndex | undefined;
	checksumStatus: ArtifactChecksumResult;
	safetyStatus: { valid: boolean; diagnostics: ArtifactDiagnostic[] };
	diagnostics: ArtifactDiagnostic[];
}

export function buildArtifactManifest(
	input: BuildArtifactManifestInput,
): MoxelAtlasArtifactManifest {
	const segments = input.repoId.split("/");
	if (segments.length !== 3 || segments.some((part) => part.length === 0)) {
		const error = new Error(
			"ATLAS_ARTIFACT_INVALID_REPO_ID: repoId must be host/owner/name",
		);
		(error as Error & { code?: string }).code =
			"ATLAS_ARTIFACT_INVALID_REPO_ID";
		throw error;
	}
	const [host, owner, name] = segments as [string, string, string];
	return {
		schema: MOXEL_ATLAS_ARTIFACT_SCHEMA,
		repoId: input.repoId,
		host,
		owner,
		name,
		ref: input.ref,
		indexedRevision: input.indexedRevision ?? input.ref,
		createdAt: input.createdAt ?? new Date().toISOString(),
		atlasVersion: input.atlasVersion ?? "0.0.0",
		format: {
			version: MOXEL_ATLAS_ARTIFACT_VERSION,
			files: MOXEL_ATLAS_ARTIFACT_FILES,
			corpusDbSchemaVersion:
				input.corpusDbSchemaVersion ?? STORE_SCHEMA_VERSION,
		},
		profiles: {
			default: "public",
			available: input.availableProfiles ?? ["public"],
			applied: input.profile ?? "public",
		},
	};
}

export function buildDocsIndex(
	db: StoreDatabase,
	repoId: string,
	generatedAt = new Date().toISOString(),
): MoxelAtlasDocsIndex {
	const docs = new DocRepository(db).listByRepo(repoId);
	const skills = new SkillRepository(db).listByRepo(repoId);
	const packages = new PackageRepository(db).listByRepo(repoId);
	const modules = new ModuleRepository(db).listByRepo(repoId);
	return {
		schema: "moxel-atlas-docs-index/v1",
		repoId,
		generatedAt,
		counts: {
			documents: docs.length,
			skills: skills.length,
			packages: packages.length,
			modules: modules.length,
		},
		documents: docs
			.map((doc) => ({
				path: doc.path,
				docId: doc.docId,
				...(doc.title === undefined ? {} : { title: doc.title }),
				kind: doc.kind,
				authority: doc.authority,
				...(doc.packageId === undefined ? {} : { packageId: doc.packageId }),
				...(doc.moduleId === undefined ? {} : { moduleId: doc.moduleId }),
				...(doc.skillId === undefined ? {} : { skillId: doc.skillId }),
				...(doc.description === undefined
					? {}
					: { description: doc.description }),
				audience: doc.audience,
				purpose: doc.purpose,
				visibility: doc.visibility,
				...(doc.order === undefined ? {} : { order: doc.order }),
				...(doc.profile === undefined ? {} : { profile: doc.profile }),
				contentHash: doc.contentHash,
				sourceVersion: doc.sourceVersion,
				tags: doc.tags,
				scopes: doc.scopes,
			}))
			.sort((left, right) => left.path.localeCompare(right.path)),
	};
}

export async function writePrettyJson(
	path: string,
	value: unknown,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const CHECKSUM_FILE_PATHS = [
	"corpus.db",
	"docs.index.json",
	"manifest.json",
] as const;

export async function writeArtifactChecksums(
	artifactDir: string,
): Promise<void> {
	const files = await checksumEntries(artifactDir);
	await writePrettyJson(join(artifactDir, "checksums.json"), {
		schema: MOXEL_ATLAS_CHECKSUMS_SCHEMA,
		algorithm: "sha256",
		files,
	});
}

export async function validateArtifactChecksums(
	artifactDir: string,
): Promise<ArtifactChecksumResult> {
	const diagnostics: ArtifactDiagnostic[] = [];
	let expected: { files?: ArtifactChecksumEntry[] };
	try {
		expected = JSON.parse(
			await readFile(join(artifactDir, "checksums.json"), "utf8"),
		) as { files?: ArtifactChecksumEntry[] };
	} catch {
		return {
			valid: false,
			files: [],
			diagnostics: [
				{
					code: "ATLAS_ARTIFACT_FILE_MISSING",
					path: "checksums.json",
					message: "checksums.json is missing or unreadable.",
				},
			],
		};
	}
	const files: ArtifactChecksumEntry[] = [];
	for (const entry of expected.files ?? []) {
		try {
			const actual = await checksumEntry(artifactDir, entry.path);
			files.push(actual);
			if (
				actual.sha256 !== entry.sha256 ||
				actual.sizeBytes !== entry.sizeBytes
			) {
				diagnostics.push({
					code: "ATLAS_ARTIFACT_CHECKSUM_MISMATCH",
					path: entry.path,
					message: `${entry.path} checksum mismatch.`,
				});
			}
		} catch {
			diagnostics.push({
				code: "ATLAS_ARTIFACT_FILE_MISSING",
				path: entry.path,
				message: `${entry.path} is missing.`,
			});
		}
	}
	return { valid: diagnostics.length === 0, files, diagnostics };
}

async function checksumEntries(
	artifactDir: string,
): Promise<ArtifactChecksumEntry[]> {
	const entries = await Promise.all(
		CHECKSUM_FILE_PATHS.map((path) => checksumEntry(artifactDir, path)),
	);
	return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function checksumEntry(
	artifactDir: string,
	path: string,
): Promise<ArtifactChecksumEntry> {
	const bytes = await readFile(join(artifactDir, path));
	const size = await stat(join(artifactDir, path));
	return {
		path,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		sizeBytes: size.size,
	};
}

export async function scanArtifactSafety(
	artifactDir: string,
): Promise<{ valid: boolean; diagnostics: ArtifactDiagnostic[] }> {
	const diagnostics: ArtifactDiagnostic[] = [];
	const files = ["manifest.json", "docs.index.json", "checksums.json"];
	const absolutePathPattern =
		/(?:\/home\/|\/Users\/|\/tmp\/|\/var\/|[A-Za-z]:\\\\)/;
	const secretPattern =
		/(?:authorization\s*:|password\s*:|secret\s*:|api[_-]?key\s*:|tokenEnvVar|ATLAS_GHES_TOKEN\s*=|GH_TOKEN\s*=)/i;
	for (const path of files) {
		let text = "";
		try {
			text = await readFile(join(artifactDir, path), "utf8");
		} catch {
			continue;
		}
		if (absolutePathPattern.test(text)) {
			diagnostics.push({
				code: "ATLAS_ARTIFACT_ABSOLUTE_PATH",
				path,
				message: `${path} contains an absolute local path.`,
			});
		}
		if (secretPattern.test(text)) {
			diagnostics.push({
				code: "ATLAS_ARTIFACT_SECRET_FIELD",
				path,
				message: `${path} contains secret-like material.`,
			});
		}
	}
	return { valid: diagnostics.length === 0, diagnostics };
}

export async function exportCorpusDbSnapshot(
	sourceDbPath: string,
	targetDbPath: string,
): Promise<void> {
	await mkdir(dirname(targetDbPath), { recursive: true });
	await rm(targetDbPath, { force: true });
	await rm(`${targetDbPath}-wal`, { force: true });
	await rm(`${targetDbPath}-shm`, { force: true });
	await rm(`${targetDbPath}-journal`, { force: true });
	let checkpointDb: AtlasStoreClient | undefined;
	try {
		checkpointDb = openStore({ path: sourceDbPath, migrate: false });
		checkpointDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	} finally {
		checkpointDb?.close();
	}
	await copyFile(sourceDbPath, targetDbPath);
	await rm(`${targetDbPath}-wal`, { force: true });
	await rm(`${targetDbPath}-shm`, { force: true });
	await rm(`${targetDbPath}-journal`, { force: true });
}

export function manifestFromStore(
	db: StoreDatabase,
	repoId: string,
	ref: string,
	profile = "public",
): MoxelAtlasArtifactManifest {
	const manifest = new ManifestRepository(db).get(repoId);
	return buildArtifactManifest({
		repoId,
		ref,
		indexedRevision: manifest?.indexedRevision ?? ref,
		corpusDbSchemaVersion: manifest?.schemaVersion ?? STORE_SCHEMA_VERSION,
		profile,
		availableProfiles: [profile],
	});
}

export const MOXEL_ATLAS_REPO_ARTIFACT_PATH = ".moxel/atlas";
export const MOXEL_ATLAS_REMOTE_ARTIFACT_FILES = [
	"manifest.json",
	"corpus.db",
	"docs.index.json",
	"checksums.json",
] as const;

export interface RemoteArtifactDiagnostic {
	code: string;
	message: string;
	path?: string | undefined;
}
export interface RemoteArtifactFetchInput {
	apiUrl: string;
	owner: string;
	name: string;
	ref: string;
	repoId: string;
	artifactDir: string;
	token?: string | undefined;
	artifactRoot?: string | undefined;
}
export interface RemoteArtifactFetchResult {
	ok: boolean;
	code?: string | undefined;
	repoId: string;
	host: string;
	owner: string;
	name: string;
	ref: string;
	artifactDir: string;
	files: string[];
	indexedRevision?: string | undefined;
	remoteHeadRevision?: string | undefined;
	stale?: boolean | undefined;
	diagnostics: RemoteArtifactDiagnostic[];
}
export interface RemoteArtifactHeadResult {
	ok: boolean;
	code?: string | undefined;
	ref: string;
	remoteHeadRevision?: string | undefined;
	diagnostics: RemoteArtifactDiagnostic[];
}
export type FetchLike = (
	input: string,
	init?: RequestInit,
) => Promise<Response>;

function parseArtifactRepoId(repoId: string): [string, string, string] {
	const segments = repoId.split("/");
	if (segments.length !== 3 || segments.some((part) => part.length === 0)) {
		const error = new Error(
			"ATLAS_ARTIFACT_INVALID_REPO_ID: repoId must be host/owner/name",
		);
		(error as Error & { code?: string }).code =
			"ATLAS_ARTIFACT_INVALID_REPO_ID";
		throw error;
	}
	return segments as [string, string, string];
}

export function artifactStorageDir(
	homeDir: string,
	repoId: string,
	artifactRoot = MOXEL_ATLAS_REPO_ARTIFACT_PATH,
): string {
	const [host, owner, name] = parseArtifactRepoId(repoId);
	return join(homeDir, "repos", host, owner, name, artifactRoot);
}

function rawContentsUrl(
	apiUrl: string,
	owner: string,
	name: string,
	file: string,
	ref: string,
	artifactRoot = MOXEL_ATLAS_REPO_ARTIFACT_PATH,
): string {
	return `${apiUrl.replace(/\/+$/, "")}/repos/${owner}/${name}/contents/${artifactRoot}/${file}?ref=${encodeURIComponent(ref)}`;
}

function githubHeaders(token?: string): HeadersInit {
	return token
		? { Accept: "application/vnd.github.raw", Authorization: `Bearer ${token}` }
		: { Accept: "application/vnd.github.raw" };
}

export async function fetchRemoteArtifact(
	input: RemoteArtifactFetchInput,
	deps: { fetchImpl?: FetchLike } = {},
): Promise<RemoteArtifactFetchResult> {
	const [host] = parseArtifactRepoId(input.repoId);
	await mkdir(input.artifactDir, { recursive: true });
	for (const file of MOXEL_ATLAS_REMOTE_ARTIFACT_FILES)
		await rm(join(input.artifactDir, file), { force: true });
	const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
	const files: string[] = [];
	for (const file of MOXEL_ATLAS_REMOTE_ARTIFACT_FILES) {
		let response: Response;
		try {
			response = await fetchImpl(
				rawContentsUrl(
					input.apiUrl,
					input.owner,
					input.name,
					file,
					input.ref,
					input.artifactRoot,
				),
				{ method: "GET", headers: githubHeaders(input.token) },
			);
		} catch {
			return {
				ok: false,
				code: "CLI_ARTIFACT_NOT_FOUND",
				repoId: input.repoId,
				host,
				owner: input.owner,
				name: input.name,
				ref: input.ref,
				artifactDir: input.artifactDir,
				files,
				diagnostics: [
					{
						code: "CLI_ARTIFACT_NOT_FOUND",
						path: file,
						message: `${file} not found in remote artifact.`,
					},
				],
			};
		}
		if (response.status === 404)
			return {
				ok: false,
				code: "CLI_ARTIFACT_NOT_FOUND",
				repoId: input.repoId,
				host,
				owner: input.owner,
				name: input.name,
				ref: input.ref,
				artifactDir: input.artifactDir,
				files,
				diagnostics: [
					{
						code: "CLI_ARTIFACT_NOT_FOUND",
						path: file,
						message: `${file} not found in remote artifact.`,
					},
				],
			};
		if (!response.ok)
			return {
				ok: false,
				code: "CLI_ARTIFACT_FETCH_FAILED",
				repoId: input.repoId,
				host,
				owner: input.owner,
				name: input.name,
				ref: input.ref,
				artifactDir: input.artifactDir,
				files,
				diagnostics: [
					{
						code: "CLI_ARTIFACT_FETCH_FAILED",
						path: file,
						message: `Failed to fetch ${file}: HTTP ${response.status}.`,
					},
				],
			};
		await writeFile(
			join(input.artifactDir, file),
			Buffer.from(await response.arrayBuffer()),
		);
		files.push(file);
	}
	return {
		ok: true,
		repoId: input.repoId,
		host,
		owner: input.owner,
		name: input.name,
		ref: input.ref,
		artifactDir: input.artifactDir,
		files,
		diagnostics: [],
	};
}

export async function fetchRemoteHeadRevision(
	input: {
		apiUrl: string;
		owner: string;
		name: string;
		ref: string;
		token?: string | undefined;
	},
	deps: { fetchImpl?: FetchLike } = {},
): Promise<RemoteArtifactHeadResult> {
	if (/^[0-9a-f]{40}$/i.test(input.ref))
		return {
			ok: true,
			ref: input.ref,
			remoteHeadRevision: input.ref,
			diagnostics: [],
		};
	const branch = input.ref.replace(/^refs\/heads\//, "");
	const url = `${input.apiUrl.replace(/\/+$/, "")}/repos/${input.owner}/${input.name}/branches/${encodeURIComponent(branch)}`;
	const response = await (deps.fetchImpl ?? globalThis.fetch.bind(globalThis))(
		url,
		{ method: "GET", headers: githubHeaders(input.token) },
	);
	if (response.status === 404)
		return {
			ok: false,
			code: "CLI_REMOTE_REF_NOT_FOUND",
			ref: input.ref,
			diagnostics: [
				{
					code: "CLI_REMOTE_REF_NOT_FOUND",
					message: `Remote ref ${input.ref} not found.`,
				},
			],
		};
	if (!response.ok)
		return {
			ok: false,
			code: "CLI_REMOTE_REF_LOOKUP_FAILED",
			ref: input.ref,
			diagnostics: [
				{
					code: "CLI_REMOTE_REF_LOOKUP_FAILED",
					message: `Failed to resolve remote ref: HTTP ${response.status}.`,
				},
			],
		};
	const body = (await response.json()) as { commit?: { sha?: string } };
	return {
		ok: true,
		ref: input.ref,
		remoteHeadRevision: body.commit?.sha,
		diagnostics: [],
	};
}

export function validateArtifactCorpusDb(
	input: ArtifactCorpusImportInput,
): ArtifactCorpusImportResult {
	const importedAt = input.importedAt ?? new Date().toISOString();
	const diagnostics: ArtifactCorpusImportDiagnostic[] = [];
	let manifest: MoxelAtlasArtifactManifest | undefined;
	try {
		manifest = JSON.parse(
			readFileSync(input.manifestPath, "utf8"),
		) as MoxelAtlasArtifactManifest;
	} catch {
		diagnostics.push({
			code: "ATLAS_ARTIFACT_CORPUS_SCHEMA_MISMATCH",
			path: input.manifestPath,
			message: "Artifact manifest is missing or unreadable.",
		});
	}
	if (
		manifest?.schema !== MOXEL_ATLAS_ARTIFACT_SCHEMA ||
		manifest.repoId !== input.repoId
	) {
		diagnostics.push({
			code: "ATLAS_ARTIFACT_REPO_ID_MISMATCH",
			message: "Artifact manifest identity does not match repoId.",
		});
	}
	if (manifest?.format.corpusDbSchemaVersion !== input.expectedSchemaVersion) {
		diagnostics.push({
			code: "ATLAS_ARTIFACT_CORPUS_SCHEMA_MISMATCH",
			message: "Artifact corpus schema version does not match expected schema.",
		});
	}
	let db: AtlasStoreClient | undefined;
	try {
		db = openStore({ path: input.artifactDbPath, migrate: false });
		let schemaVersion = input.expectedSchemaVersion;
		try {
			schemaVersion = getCurrentSchemaVersion(db);
		} catch {
			// Older artifact snapshots may omit schema_migrations while still having the expected tables.
		}
		if (schemaVersion !== input.expectedSchemaVersion)
			diagnostics.push({
				code: "ATLAS_ARTIFACT_CORPUS_SCHEMA_MISMATCH",
				message:
					"Artifact corpus database schema version does not match expected schema.",
			});
		const counts = countRepoCorpusRows(
			db,
			input.repoId,
		) as ArtifactCorpusImportCounts;
		const mixed = db.get<{ repoId: string }>(
			"SELECT repo_id AS repoId FROM repos WHERE repo_id <> $repoId LIMIT 1",
			{ $repoId: input.repoId },
		);
		const docMixed = db.get<{ repoId: string }>(
			"SELECT repo_id AS repoId FROM documents WHERE repo_id <> $repoId LIMIT 1",
			{ $repoId: input.repoId },
		);
		const ftsMixed = db.get<{ repoId: string }>(
			"SELECT repo_id AS repoId FROM fts_entries WHERE repo_id <> $repoId LIMIT 1",
			{ $repoId: input.repoId },
		);
		if (mixed || docMixed || ftsMixed)
			diagnostics.push({
				code: "ATLAS_ARTIFACT_REPO_ID_MISMATCH",
				message: "Artifact corpus contains rows for a different repoId.",
			});
		return {
			repoId: input.repoId,
			artifactDbPath: input.artifactDbPath,
			globalDbPath:
				input.globalDbPath ??
				(input.globalDb as { path?: string } | undefined)?.path ??
				"",
			importedAt,
			replaced: emptyImportCounts(),
			counts,
			diagnostics,
		};
	} catch (error) {
		diagnostics.push({
			code: "ATLAS_ARTIFACT_CORPUS_SCHEMA_MISMATCH",
			message:
				error instanceof Error
					? error.message
					: "Artifact corpus could not be opened.",
		});
		return {
			repoId: input.repoId,
			artifactDbPath: input.artifactDbPath,
			globalDbPath:
				input.globalDbPath ??
				(input.globalDb as { path?: string } | undefined)?.path ??
				"",
			importedAt,
			replaced: emptyImportCounts(),
			counts: emptyImportCounts(),
			diagnostics,
		};
	} finally {
		db?.close();
	}
}

export async function verifyMoxelAtlasArtifact(
	input: ArtifactVerificationInput,
): Promise<ArtifactVerificationResult> {
	const diagnostics: ArtifactDiagnostic[] = [];
	let manifest: MoxelAtlasArtifactManifest | undefined;
	try {
		manifest = JSON.parse(
			await readFile(join(input.artifactDir, "manifest.json"), "utf8"),
		) as MoxelAtlasArtifactManifest;
	} catch {
		diagnostics.push({
			code: "ATLAS_ARTIFACT_SCHEMA_INVALID",
			path: "manifest.json",
			message: "manifest.json is missing or invalid.",
		});
	}
	if (manifest !== undefined) {
		if (manifest.schema !== MOXEL_ATLAS_ARTIFACT_SCHEMA) {
			diagnostics.push({
				code: "ATLAS_ARTIFACT_SCHEMA_INVALID",
				path: "manifest.json",
				message: "Artifact manifest schema is invalid.",
			});
		}
		const segments = manifest.repoId.split("/");
		if (
			segments.length !== 3 ||
			segments.some((segment) => segment.length === 0)
		) {
			diagnostics.push({
				code: "ATLAS_ARTIFACT_REPO_ID_INVALID",
				path: "manifest.json",
				message: "Artifact repoId must be host/owner/name.",
			});
		}
		if (
			input.expectedRepoId !== undefined &&
			manifest.repoId !== input.expectedRepoId
		) {
			diagnostics.push({
				code: "ATLAS_ARTIFACT_REPO_ID_MISMATCH",
				path: "manifest.json",
				message: "Artifact repoId does not match expected repoId.",
			});
		}
	}
	for (const file of MOXEL_ATLAS_ARTIFACT_FILES) {
		try {
			await stat(join(input.artifactDir, file));
		} catch {
			diagnostics.push({
				code: "ATLAS_ARTIFACT_FILE_MISSING",
				path: file,
				message: `${file} is missing.`,
			});
		}
	}
	const checksum = await validateArtifactChecksums(input.artifactDir);
	diagnostics.push(...checksum.diagnostics);
	const safety = await scanArtifactSafety(input.artifactDir);
	diagnostics.push(...safety.diagnostics);
	let importable = false;
	let counts = emptyImportCounts();
	if (manifest !== undefined) {
		const imported = validateArtifactCorpusDb({
			repoId: manifest.repoId,
			artifactDbPath: join(input.artifactDir, "corpus.db"),
			manifestPath: join(input.artifactDir, "manifest.json"),
			expectedSchemaVersion:
				manifest.format?.corpusDbSchemaVersion ?? STORE_SCHEMA_VERSION,
			globalDbPath: input.importCheckDbPath ?? "",
		});
		counts = imported.counts;
		importable = imported.diagnostics.length === 0;
		if (!importable) {
			diagnostics.push(
				...imported.diagnostics.map((diagnostic) => ({
					code: "ATLAS_ARTIFACT_CORPUS_UNIMPORTABLE",
					path: diagnostic.path ?? "corpus.db",
					message: diagnostic.message,
				})),
			);
		}
	}
	let fresh: boolean | undefined;
	let expectedRevision: string | undefined;
	let indexedRevision: string | undefined;
	if (input.requireFresh === true) {
		expectedRevision = input.freshRef;
		indexedRevision = manifest?.indexedRevision;
		fresh =
			expectedRevision !== undefined && indexedRevision === expectedRevision;
		if (!fresh) {
			diagnostics.push({
				code: "ATLAS_ARTIFACT_STALE",
				path: "manifest.json",
				message: "Artifact is stale; run atlas build and commit .moxel/atlas.",
			});
		}
	}
	return {
		valid: diagnostics.length === 0,
		artifactDir: input.artifactDir,
		repoId: manifest?.repoId,
		manifest,
		diagnostics,
		checksum,
		safety,
		importable,
		counts,
		...(fresh === undefined ? {} : { fresh }),
		...(expectedRevision === undefined ? {} : { expectedRevision }),
		...(indexedRevision === undefined ? {} : { indexedRevision }),
	};
}

export async function inspectMoxelAtlasArtifact(input: {
	artifactDir: string;
}): Promise<ArtifactInspectionResult> {
	const diagnostics: ArtifactDiagnostic[] = [];
	let manifest: MoxelAtlasArtifactManifest | undefined;
	let docsIndex: MoxelAtlasDocsIndex | undefined;
	try {
		manifest = JSON.parse(
			await readFile(join(input.artifactDir, "manifest.json"), "utf8"),
		) as MoxelAtlasArtifactManifest;
	} catch {
		diagnostics.push({
			code: "ATLAS_ARTIFACT_SCHEMA_INVALID",
			path: "manifest.json",
			message: "manifest.json is missing or invalid.",
		});
	}
	try {
		docsIndex = JSON.parse(
			await readFile(join(input.artifactDir, "docs.index.json"), "utf8"),
		) as MoxelAtlasDocsIndex;
	} catch {
		diagnostics.push({
			code: "ATLAS_ARTIFACT_DOCS_INDEX_INVALID",
			path: "docs.index.json",
			message: "docs.index.json is missing or invalid.",
		});
	}
	const checksumStatus = await validateArtifactChecksums(input.artifactDir);
	const safetyStatus = await scanArtifactSafety(input.artifactDir);
	const files: ArtifactChecksumEntry[] = [];
	for (const file of MOXEL_ATLAS_ARTIFACT_FILES) {
		try {
			files.push(await checksumEntry(input.artifactDir, file));
		} catch {
			diagnostics.push({
				code: "ATLAS_ARTIFACT_FILE_MISSING",
				path: file,
				message: `${file} is missing.`,
			});
		}
	}
	return {
		artifactDir: input.artifactDir,
		manifest,
		files,
		docsIndex,
		checksumStatus,
		safetyStatus,
		diagnostics,
	};
}

export function importArtifactCorpus(
	input: ArtifactCorpusImportInput,
): ArtifactCorpusImportResult {
	const validation = validateArtifactCorpusDb(input);
	if (validation.diagnostics.length > 0) return validation;
	const importedAt = input.importedAt ?? new Date().toISOString();
	const globalDb =
		input.globalDb ??
		openStore({ path: input.globalDbPath ?? "", migrate: true });
	const closeGlobal = input.globalDb === undefined;
	try {
		migrateStore(globalDb);
		const replaced = countRepoCorpusRows(
			globalDb,
			input.repoId,
		) as ArtifactCorpusImportCounts;
		globalDb.run("ATTACH DATABASE $artifactDbPath AS artifact_import", {
			$artifactDbPath: input.artifactDbPath,
		});
		try {
			globalDb.transaction(() => {
				deleteRepoCorpus(globalDb, input.repoId);
				copyAttachedArtifactTables(globalDb);
			});
		} finally {
			globalDb.exec("DETACH DATABASE artifact_import");
		}
		return {
			...validation,
			globalDbPath:
				input.globalDbPath ?? (globalDb as { path?: string }).path ?? "",
			importedAt,
			replaced,
			counts: countRepoCorpusRows(
				globalDb,
				input.repoId,
			) as ArtifactCorpusImportCounts,
			diagnostics: [],
		};
	} catch (error) {
		return {
			...validation,
			globalDbPath:
				input.globalDbPath ?? (globalDb as { path?: string }).path ?? "",
			importedAt,
			diagnostics: [
				{
					code: "ATLAS_ARTIFACT_CORPUS_IMPORT_FAILED",
					message:
						error instanceof Error
							? error.message
							: "Artifact corpus import failed.",
				},
			],
		};
	} finally {
		if (closeGlobal) globalDb.close();
	}
}

function copyAttachedArtifactTables(db: StoreDatabase): void {
	db.run("INSERT INTO repos SELECT * FROM artifact_import.repos");
	db.run("INSERT INTO packages SELECT * FROM artifact_import.packages");
	db.run("INSERT INTO modules SELECT * FROM artifact_import.modules");
	db.run("INSERT INTO documents SELECT * FROM artifact_import.documents");
	db.run(
		"INSERT INTO document_scopes SELECT * FROM artifact_import.document_scopes",
	);
	db.run("INSERT INTO sections SELECT * FROM artifact_import.sections");
	db.run("INSERT INTO chunks SELECT * FROM artifact_import.chunks");
	db.run("INSERT INTO summaries SELECT * FROM artifact_import.summaries");
	db.run("INSERT INTO skills SELECT * FROM artifact_import.skills");
	db.run(
		"INSERT INTO skill_artifacts SELECT * FROM artifact_import.skill_artifacts",
	);
	db.run("INSERT INTO manifests SELECT * FROM artifact_import.manifests");
	db.run("INSERT INTO fts_entries SELECT * FROM artifact_import.fts_entries");
}

function emptyImportCounts(): ArtifactCorpusImportCounts {
	return {
		repos: 0,
		packages: 0,
		modules: 0,
		documents: 0,
		sections: 0,
		chunks: 0,
		summaries: 0,
		skills: 0,
		manifests: 0,
		ftsRows: 0,
	};
}

export async function validateFetchedArtifact(
	artifactDir: string,
	expected: { repoId: string; host: string; owner: string; name: string },
): Promise<{
	valid: boolean;
	manifest?: MoxelAtlasArtifactManifest | undefined;
	diagnostics: ArtifactDiagnostic[];
}> {
	const diagnostics: ArtifactDiagnostic[] = [];
	let manifest: MoxelAtlasArtifactManifest | undefined;
	try {
		manifest = JSON.parse(
			await readFile(join(artifactDir, "manifest.json"), "utf8"),
		) as MoxelAtlasArtifactManifest;
	} catch {
		diagnostics.push({
			code: "CLI_ARTIFACT_SCHEMA_INVALID",
			path: "manifest.json",
			message: "manifest.json missing or invalid.",
		});
	}
	if (manifest) {
		if (manifest.schema !== MOXEL_ATLAS_ARTIFACT_SCHEMA)
			diagnostics.push({
				code: "CLI_ARTIFACT_SCHEMA_INVALID",
				path: "manifest.json",
				message: "Artifact manifest schema is invalid.",
			});
		if (
			manifest.repoId !== expected.repoId ||
			manifest.host !== expected.host ||
			manifest.owner !== expected.owner ||
			manifest.name !== expected.name
		)
			diagnostics.push({
				code: "CLI_ARTIFACT_ID_MISMATCH",
				path: "manifest.json",
				message: "Artifact manifest identity does not match requested repo.",
			});
	}
	const checksums = await validateArtifactChecksums(artifactDir);
	if (!checksums.valid)
		diagnostics.push(
			...checksums.diagnostics.map((d) => ({
				...d,
				code: "CLI_ARTIFACT_CHECKSUM_INVALID",
			})),
		);
	const safety = await scanArtifactSafety(artifactDir);
	if (!safety.valid)
		diagnostics.push(
			...safety.diagnostics.map((d) => ({
				...d,
				code: "CLI_ARTIFACT_SAFETY_INVALID",
			})),
		);
	return { valid: diagnostics.length === 0, manifest, diagnostics };
}
