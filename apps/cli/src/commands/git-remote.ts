export function repoIdFromGitRemote(remote: string): string | undefined {
	const scp = remote.match(/^git@([^:/\s]+):([^/\s]+)\/([^/\s]+)$/i);
	if (scp) return normalize(scp[1]!, scp[2]!, scp[3]!);

	try {
		const url = new URL(remote);
		if (!["ssh:", "http:", "https:"].includes(url.protocol)) {
			return undefined;
		}
		const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
		if (!url.hostname || parts.length !== 2 || !parts[0] || !parts[1]) {
			return undefined;
		}
		return normalize(url.hostname, parts[0], parts[1]);
	} catch {
		return undefined;
	}
}

function normalize(host: string, owner: string, name: string): string | undefined {
	const normalizedName = name.replace(/\.git$/i, "");
	if (!normalizedName) return undefined;
	return `${host.toLowerCase()}/${owner.toLowerCase()}/${normalizedName.toLowerCase()}`;
}
