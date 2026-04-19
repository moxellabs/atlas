// No argv parsing lives here; commander owns parsing.
// Temporary option-reader helpers remain for command internals that consume
// reconstructed commander option bags during the hard-cut migration.

export type CliOptionBag = Record<string, string | boolean | string[]>;

/** Reads a boolean flag from command options. */
export function readBooleanOption(
	options: CliOptionBag,
	name: string,
): boolean {
	return options[name] === true;
}

/** Reads an optional string flag from command options. */
export function readStringOption(
	options: CliOptionBag,
	name: string,
): string | undefined {
	const value = options[name];
	if (value === undefined || typeof value !== "string") {
		return undefined;
	}
	return value;
}

/** Reads a repeatable string flag from command options. */
export function readStringListOption(
	options: CliOptionBag,
	name: string,
): string[] {
	const value = options[name];
	if (value === undefined) {
		return [];
	}
	return Array.isArray(value) ? value : [String(value)];
}
