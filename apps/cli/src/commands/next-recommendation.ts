export type NextAction =
	| "setup"
	| "doctor"
	| "repo-doctor"
	| "init"
	| "build"
	| "artifact-verify"
	| "repo-add"
	| "repo-list"
	| "search";

export interface NextProbeIssue {
	scope: "runtime" | "target" | "checkout";
	code: string;
	message: string;
}

export interface NextTargetState {
	repoId: string;
	source: string;
	configured: boolean;
	mode?: "local-git" | "ghes-api" | undefined;
	registry?: {
		found: boolean;
		stale: boolean;
		importStatus?: "ready" | "imported" | "missing-artifact" | undefined;
	} | undefined;
	corpus: {
		status: "missing" | "ready" | "unavailable";
		documentCount?: number | undefined;
		repoFound?: boolean | undefined;
		manifestFound?: boolean | undefined;
	};
	checkout: {
		inside: boolean;
		repoMetadataFound: boolean;
		artifactFound: boolean;
		artifactFresh?: boolean | undefined;
	};
}

/** Compatibility summary plus target-scoped state used by the recommendation engine. */
export interface NextStepState {
	configFound: boolean;
	configPath?: string | undefined;
	runtimeRoot?: string | undefined;
	repoCount: number;
	registryCount: number;
	/** Global count retained for compatibility and diagnostics; never used to choose an action. */
	documentCount: number;
	insideGitCheckout: boolean;
	gitOrigin?: string | undefined;
	repoMetadataFound: boolean;
	artifactFound: boolean;
	staleArtifact: boolean;
	targetRepoId?: string | undefined;
	targetSource?: string | undefined;
	target?: NextTargetState | undefined;
	issues: NextProbeIssue[];
}

export interface NextStepCandidate {
	action: NextAction;
	command: string;
	score: number;
	reason: string;
	evidence: string[];
}

export interface NextStepRecommendation {
	action: NextAction;
	recommendedCommand: string;
	reason: string;
	evidence: string[];
	state: NextStepState;
	candidates: NextStepCandidate[];
	/** Retained for JSON consumers; normal output does not render alternatives. */
	alternatives: string[];
}

const SCORE = {
	diagnostic: 1000,
	setup: 900,
	checkout: 800,
	refresh: 700,
	build: 650,
	chooseTarget: 500,
	ready: 100,
} as const;

/**
 * Ranks independently-derived action candidates. The result is deterministic:
 * candidates sort by score, then command, so state never depends on probe order.
 */
export function recommendNextStep(state: NextStepState): NextStepRecommendation {
	const candidates: NextStepCandidate[] = [];
	const target = state.target;
	const add = (
		action: NextAction,
		command: string,
		score: number,
		reason: string,
		evidence: string[],
	) => candidates.push({ action, command, score, reason, evidence });

	if (!state.configFound) {
		add(
			"setup",
			"atlas setup",
			SCORE.setup,
			"No Atlas runtime config was found.",
			["runtime config: missing"],
		);
		return selectCandidate(state, candidates);
	}

	const runtimeIssue = state.issues.find((issue) => issue.scope === "runtime");
	if (runtimeIssue !== undefined && !target?.checkout.repoMetadataFound) {
		add(
			"doctor",
			"atlas doctor",
			SCORE.diagnostic,
			"Atlas could not inspect the local runtime safely.",
			[runtimeIssue.message],
		);
	}
	const targetIssue = state.issues.find((issue) => issue.scope === "target");
	if (
		target !== undefined &&
		targetIssue !== undefined &&
		!target.checkout.repoMetadataFound
	) {
		add(
			"repo-doctor",
			`atlas repo doctor --repo ${target.repoId}`,
			SCORE.diagnostic,
			"Atlas found inconsistent state for the selected repository.",
			[targetIssue.message],
		);
	}
	const checkoutIssue = state.issues.find(
		(issue) => issue.scope === "checkout",
	);
	if (target !== undefined && checkoutIssue !== undefined) {
		add(
			"artifact-verify",
			"atlas artifact verify --fresh",
			SCORE.diagnostic,
			"Atlas could not validate this checkout's knowledge bundle.",
			[checkoutIssue.message],
		);
	}

	if (target?.checkout.inside && !target.checkout.repoMetadataFound) {
		add(
			"init",
			"atlas init",
			SCORE.checkout,
			"This Git checkout has not been initialized for publishing an Atlas knowledge bundle.",
			["checkout: detected", "repo metadata: missing"],
		);
	}
	if (target?.checkout.repoMetadataFound && !target.checkout.artifactFound) {
		add(
			"build",
			"atlas build",
			SCORE.checkout,
			"This checkout has Atlas metadata but no published knowledge bundle yet.",
			["repo metadata: present", "bundle manifest: missing"],
		);
	}
	if (target?.checkout.artifactFresh === false) {
		add(
			"build",
			"atlas build",
			SCORE.checkout,
			"This checkout's knowledge bundle is behind the current Git revision.",
			["bundle manifest: present", "bundle revision: stale"],
		);
	}
	if (
		target?.checkout.repoMetadataFound &&
		target.checkout.artifactFound &&
		target.checkout.artifactFresh === true
	) {
		add(
			"artifact-verify",
			"atlas artifact verify --fresh",
			SCORE.checkout,
			"This checkout has a current knowledge bundle ready for verification.",
			["bundle manifest: present", "bundle revision: current"],
		);
	}

	if (target === undefined) {
		if (state.repoCount === 0 && state.registryCount === 0) {
			add(
				"repo-add",
				"atlas repo add <repo>",
				SCORE.chooseTarget,
				"Atlas is set up but no repositories are configured.",
				["configured repositories: 0"],
			);
		} else if (state.repoCount > 1) {
			add(
				"repo-list",
				"atlas repo list",
				SCORE.chooseTarget,
				"Several repositories are configured and none is selected by this directory.",
				[`configured repositories: ${state.repoCount}`],
			);
		} else {
			add(
				"doctor",
				"atlas doctor",
				SCORE.diagnostic,
				"Atlas could not resolve a repository from the configured runtime state.",
				["repository target: unavailable"],
			);
		}
	} else {
		if (target.registry?.stale === true) {
			add(
				"repo-add",
				`atlas repo add ${target.repoId}`,
				SCORE.refresh,
				"The imported knowledge bundle is marked stale and should be refreshed.",
				["imported bundle: stale"],
			);
		}
		if (
			target.registry?.importStatus === "ready" ||
			target.registry?.importStatus === "missing-artifact"
		) {
			add(
				"repo-add",
				`atlas repo add ${target.repoId}`,
				SCORE.refresh,
				"A repository artifact is available but has not been imported into the local corpus.",
				[`import status: ${target.registry.importStatus}`],
			);
		}
		if (target.corpus.status === "missing" && target.configured) {
			add(
				"build",
				`atlas build --repo ${target.repoId}`,
				SCORE.build,
				"The selected repository is configured but has no local corpus documents.",
				["configured repository: present", "target corpus: empty"],
			);
		}
		if (target.corpus.status === "ready") {
			add(
				"search",
				`atlas search <query> --repo ${target.repoId}`,
				SCORE.ready,
				"The selected repository has local documentation ready to search.",
				[`target documents: ${target.corpus.documentCount ?? 0}`],
			);
		}
	}

	return selectCandidate(state, candidates);
}

function selectCandidate(
	state: NextStepState,
	candidates: NextStepCandidate[],
): NextStepRecommendation {
	const sorted = [...candidates].sort(
		(left, right) => right.score - left.score || left.command.localeCompare(right.command),
	);
	const selected = sorted[0] ?? {
		action: "doctor" as const,
		command: "atlas doctor",
		score: SCORE.diagnostic,
		reason: "Atlas could not determine a safe next action.",
		evidence: ["recommendation candidates: none"],
	};
	return {
		action: selected.action,
		recommendedCommand: selected.command,
		reason: selected.reason,
		evidence: selected.evidence,
		state,
		candidates: sorted,
		alternatives: sorted
			.filter((candidate) => candidate.command !== selected.command)
			.slice(0, 2)
			.map((candidate) => candidate.command),
	};
}
