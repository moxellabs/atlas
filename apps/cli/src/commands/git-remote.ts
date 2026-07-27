import { canonicalizeRepoId } from "@atlas/config";

export function repoIdFromGitRemote(remote: string): string | undefined {
	const scp = remote.match(/^git@([^:/\s]+):([^/\s]+)\/([^/\s]+)$/i);
	if (scp) return normalize(scp[1]!, scp[2]!, scp[3]!);

	try {
		const url = new URL(remote);
		if (!["ssh:", "http:", "https:"].includes(url.protocol)) {
			return undefined;
		}
		const parts = url.pathname.split("/");
		if (
			!url.hostname ||
			url.search ||
			url.hash ||
			parts.length !== 3 ||
			parts[0] !== "" ||
			!parts[1] ||
			!parts[2]
		) {
			return undefined;
		}
		return normalize(url.hostname, parts[1], parts[2]);
	} catch {
		return undefined;
	}
}

function normalize(host: string, owner: string, name: string): string | undefined {
	try {
		return canonicalizeRepoId(`${host}/${owner}/${name}`);
	} catch {
		return undefined;
	}
}
