import type { Provenance } from "@atlas/core";
import { computeFreshness } from "@atlas/core";
import {
	DocRepository,
	type DocumentRecord,
	type ManifestRecord,
	ManifestRepository,
	type ModuleRecord,
	ModuleRepository,
	type PackageRecord,
	PackageRepository,
	type RepoRecord,
	RepoRepository,
	type SectionRecord,
	SectionRepository,
	type SkillArtifactRecord,
	type SkillArtifactSummary,
	type SkillRecord,
	SkillRepository,
	type StoreDatabase,
	type SummaryRecord,
	SummaryRepository,
} from "@atlas/store";

/** Creates provenance from a stored document and optional heading/skill overrides. */
export function provenanceFromDocument(
	document: DocumentRecord,
	headingPath?: readonly string[],
	skillId?: string,
): Provenance {
	const effectiveSkillId = skillId ?? document.skillId;
	return {
		repoId: document.repoId,
		...(document.packageId === undefined
			? {}
			: { packageId: document.packageId }),
		...(document.moduleId === undefined ? {} : { moduleId: document.moduleId }),
		...(effectiveSkillId === undefined ? {} : { skillId: effectiveSkillId }),
		docId: document.docId,
		path: document.path,
		...(headingPath === undefined ? {} : { headingPath: [...headingPath] }),
		sourceVersion: document.sourceVersion,
		authority: document.authority,
	};
}

/** Returns repository metadata by ID. */
export function getRepo(
	db: StoreDatabase,
	repoId: string,
): RepoRecord | undefined {
	return new RepoRepository(db).get(repoId);
}

/** Returns manifest metadata by repo ID. */
export function getManifest(
	db: StoreDatabase,
	repoId: string,
): ManifestRecord | undefined {
	return new ManifestRepository(db).get(repoId);
}

export interface IndexedCoverageItem {
	repoId: string;
	indexedRevision?: string | undefined;
	compilerVersion?: string | undefined;
	status: "indexed";
	freshness: ReturnType<typeof computeFreshness>;
	packageCount: number;
	moduleCount: number;
	documentCount: number;
}

/** Lists manifests for all known repos. */
export function listManifests(db: StoreDatabase): ManifestRecord[] {
	return new RepoRepository(db).list().flatMap((repo) => {
		const manifest = new ManifestRepository(db).get(repo.repoId);
		return manifest === undefined ? [] : [manifest];
	});
}

/** Lists compact local indexed-repository coverage for MCP discovery. */
export function listIndexedCoverage(db: StoreDatabase): IndexedCoverageItem[] {
	const manifestRepository = new ManifestRepository(db);
	const packageRepository = new PackageRepository(db);
	const moduleRepository = new ModuleRepository(db);
	const docRepository = new DocRepository(db);

	return new RepoRepository(db).list().flatMap((repo) => {
		const manifest = manifestRepository.get(repo.repoId);
		if (manifest === undefined) {
			return [];
		}
		return [
			{
				repoId: repo.repoId,
				...(manifest.indexedRevision === undefined
					? {}
					: { indexedRevision: manifest.indexedRevision }),
				...(manifest.compilerVersion === undefined
					? {}
					: { compilerVersion: manifest.compilerVersion }),
				status: "indexed" as const,
				freshness: computeFreshness({
					repoId: repo.repoId,
					repoRevision: repo.revision,
					indexedRevision: manifest.indexedRevision,
					lastSyncAt: manifest.buildTimestamp,
				}),
				packageCount: packageRepository.listByRepo(repo.repoId).length,
				moduleCount: moduleRepository.listByRepo(repo.repoId).length,
				documentCount: docRepository.listByRepo(repo.repoId).length,
			},
		];
	});
}

/** Presents local freshness from stored repository and manifest revisions. */
export function freshnessForRepo(
	repo: RepoRecord,
	manifest: ManifestRecord | undefined,
) {
	return {
		...computeFreshness({
			repoId: repo.repoId,
			repoRevision: repo.revision,
			indexedRevision: manifest?.indexedRevision,
			lastSyncAt: manifest?.buildTimestamp,
		}),
		manifest,
	};
}

/** Returns package metadata by ID. */
export function getPackage(
	db: StoreDatabase,
	packageId: string,
): PackageRecord | undefined {
	return new PackageRepository(db).get(packageId);
}

/** Lists packages for one repository in deterministic path order. */
export function listPackages(
	db: StoreDatabase,
	repoId: string,
): PackageRecord[] {
	return new PackageRepository(db).listByRepo(repoId);
}

/** Returns module metadata by ID. */
export function getModule(
	db: StoreDatabase,
	moduleId: string,
): ModuleRecord | undefined {
	return new ModuleRepository(db).get(moduleId);
}

/** Lists modules for one repository and optional package in deterministic path order. */
export function listModules(
	db: StoreDatabase,
	repoId: string,
	packageId?: string,
): ModuleRecord[] {
	return new ModuleRepository(db).listByRepo(repoId, packageId);
}

/** Returns document metadata by ID. */
export function getDocument(
	db: StoreDatabase,
	docId: string,
): DocumentRecord | undefined {
	return new DocRepository(db).get(docId);
}

/** Lists documents for one repository in deterministic path order. */
export function listDocumentsByRepo(
	db: StoreDatabase,
	repoId: string,
): DocumentRecord[] {
	return new DocRepository(db).listByRepo(repoId);
}

/** Lists documents for one package in deterministic path order. */
export function listDocumentsByPackage(
	db: StoreDatabase,
	repoId: string,
	packageId: string,
): DocumentRecord[] {
	return new DocRepository(db)
		.listByRepo(repoId)
		.filter((document) => document.packageId === packageId);
}

/** Lists documents for one module in deterministic path order. */
export function listDocumentsByModule(
	db: StoreDatabase,
	moduleId: string,
): DocumentRecord[] {
	return new DocRepository(db).listByModule(moduleId);
}

/** Returns section metadata by section ID or exact heading path. */
export function getSection(
	db: StoreDatabase,
	docId: string,
	options: { sectionId?: string; heading?: readonly string[] },
): SectionRecord | undefined {
	const sections = new SectionRepository(db).listByDocument(docId);
	if (options.sectionId !== undefined) {
		return sections.find((section) => section.sectionId === options.sectionId);
	}
	return sections.find((section) =>
		sameHeading(section.headingPath, options.heading ?? []),
	);
}

/** Lists sections for one document in source order. */
export function listSections(
	db: StoreDatabase,
	docId: string,
): SectionRecord[] {
	return new SectionRepository(db).listByDocument(docId);
}

/** Lists summaries for one target. */
export function listSummaries(
	db: StoreDatabase,
	targetType: SummaryRecord["targetType"],
	targetId: string,
): SummaryRecord[] {
	return new SummaryRepository(db).listForTarget(targetType, targetId);
}

/** Returns one skill by ID. */
export function getSkill(
	db: StoreDatabase,
	skillId: string,
): SkillRecord | undefined {
	return new SkillRepository(db).get(skillId);
}

/** Returns local freshness for a skill's owning repository. */
export function getFreshnessForSkillRepo(
	db: StoreDatabase,
	skill: SkillRecord,
) {
	const repo = new RepoRepository(db).get(skill.repoId);
	return repo === undefined
		? undefined
		: freshnessForRepo(repo, new ManifestRepository(db).get(skill.repoId));
}

/** Lists artifacts bundled with one skill. */
export function listSkillArtifacts(
	db: StoreDatabase,
	skillId: string,
): SkillArtifactRecord[] {
	return new SkillRepository(db).listArtifacts(skillId);
}

/** Summarizes artifacts bundled with one skill. */
export function summarizeSkillArtifacts(
	db: StoreDatabase,
	skillId: string,
): SkillArtifactSummary {
	return new SkillRepository(db).summarizeArtifacts(skillId);
}

/** Lists skills using optional repo/package/module filters. */
export function listSkills(
	db: StoreDatabase,
	filter: {
		repoId?: string;
		packageId?: string;
		moduleId?: string;
		limit?: number;
	},
): SkillRecord[] {
	const repoIds =
		filter.repoId === undefined
			? new RepoRepository(db).list().map((repo) => repo.repoId)
			: [filter.repoId];
	const skills = repoIds.flatMap((repoId) =>
		new SkillRepository(db).listByRepo(repoId, {
			...(filter.packageId === undefined
				? {}
				: { packageId: filter.packageId }),
			...(filter.moduleId === undefined ? {} : { moduleId: filter.moduleId }),
		}),
	);
	return skills.slice(0, filter.limit ?? skills.length);
}

function sameHeading(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}
