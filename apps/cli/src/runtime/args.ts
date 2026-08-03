import type {
	CliCommandContext,
	CliOptionName,
} from "./types";

type OptionContext = Pick<CliCommandContext, "options">;

/** Reads a boolean flag from Commander options. */
export function readBooleanOption(
	context: OptionContext,
	name: CliOptionName,
): boolean {
	return context.options[name] === true;
}

/** Reads the first string value from Commander options. */
export function readStringOption(
	context: OptionContext,
	name: CliOptionName,
): string | undefined {
	const value = context.options[name];
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		const first = value.find((entry) => typeof entry === "string");
		return typeof first === "string" ? first : undefined;
	}
	return undefined;
}

/** Reads every string value from a repeatable Commander option. */
export function readStringListOption(
	context: OptionContext,
	name: CliOptionName,
): string[] {
	const value = context.options[name];
	if (value === undefined) {
		return [];
	}
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: typeof value === "string"
			? [value]
			: [];
}
