import { describe, expect, test } from "bun:test";
import {
	type NextStepState,
	recommendNextStep,
} from "./next-recommendation";

function state(overrides: Partial<NextStepState> = {}): NextStepState {
	return {
		configFound: true,
		repoCount: 1,
		registryCount: 0,
		documentCount: 0,
		insideGitCheckout: false,
		repoMetadataFound: false,
		artifactFound: false,
		staleArtifact: false,
		issues: [],
		...overrides,
	};
}

function target(overrides: Partial<NonNullable<NextStepState["target"]>> = {}) {
	return {
		repoId: "github.com/moxellabs/atlas",
		source: "single-config",
		configured: true,
		mode: "local-git" as const,
		corpus: { status: "missing" as const, documentCount: 0 },
		checkout: {
			inside: false,
			repoMetadataFound: false,
			artifactFound: false,
		},
		...overrides,
	};
}

describe("next recommendation engine", () => {
	test("builds the selected configured repo even when another repo has documents", () => {
		const result = recommendNextStep(
			state({
				documentCount: 42,
				targetRepoId: "github.com/moxellabs/atlas",
				targetSource: "single-config",
				target: target(),
			}),
		);

		expect(result).toMatchObject({
			action: "build",
			recommendedCommand: "atlas build --repo github.com/moxellabs/atlas",
		});
	});

	test("lists repositories instead of guessing among multiple configured targets", () => {
		const result = recommendNextStep(
			state({ repoCount: 2, registryCount: 2, documentCount: 42 }),
		);

		expect(result).toMatchObject({
			action: "repo-list",
			recommendedCommand: "atlas repo list",
		});
	});

	test("refreshes a stale imported artifact instead of recommending sync", () => {
		const result = recommendNextStep(
			state({
				targetRepoId: "github.com/moxellabs/atlas",
				targetSource: "single-config",
				target: target({
				registry: { found: true, stale: true, importStatus: "imported" },
				corpus: { status: "ready", documentCount: 42 },
			}),
			}),
		);

		expect(result).toMatchObject({
			action: "repo-add",
			recommendedCommand: "atlas repo add github.com/moxellabs/atlas",
		});
		expect(result.recommendedCommand).not.toContain("sync");
	});

	test("uses the checkout publishing lifecycle before runtime search", () => {
		const init = recommendNextStep(
			state({
				target: target({
				checkout: {
					inside: true,
					repoMetadataFound: false,
					artifactFound: false,
				},
			}),
			}),
		);
		expect(init.recommendedCommand).toBe("atlas init");

		const build = recommendNextStep(
			state({
				target: target({
				checkout: {
					inside: true,
					repoMetadataFound: true,
					artifactFound: false,
				},
			}),
			}),
		);
		expect(build.recommendedCommand).toBe("atlas build");

		const verify = recommendNextStep(
			state({
				target: target({
				checkout: {
					inside: true,
					repoMetadataFound: true,
					artifactFound: true,
					artifactFresh: true,
				},
			}),
			}),
		);
		expect(verify.recommendedCommand).toBe("atlas artifact verify --fresh");
	});

	test("uses scoped diagnostics for unavailable target state", () => {
		const result = recommendNextStep(
			state({
				targetRepoId: "github.com/moxellabs/atlas",
				targetSource: "single-config",
				target: target({ corpus: { status: "unavailable" } }),
				issues: [
					{
						scope: "target",
						code: "NEXT_CORPUS_UNAVAILABLE",
						message: "Corpus schema is unavailable.",
					},
				],
			}),
		);

		expect(result).toMatchObject({
			action: "repo-doctor",
			recommendedCommand:
				"atlas repo doctor --repo github.com/moxellabs/atlas",
		});
	});

	test("does not let global runtime state block a checkout bundle rebuild", () => {
		const result = recommendNextStep(
			state({
				target: target({
				checkout: {
					inside: true,
					repoMetadataFound: true,
					artifactFound: true,
					artifactFresh: false,
				},
				corpus: { status: "unavailable" },
			}),
				issues: [
					{
						scope: "target",
						code: "NEXT_CORPUS_UNAVAILABLE",
						message: "Global corpus is unavailable.",
					},
				],
			}),
		);

		expect(result).toMatchObject({
			action: "build",
			recommendedCommand: "atlas build",
		});
	});
});
