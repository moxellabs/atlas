import { stdin as processStdin, stdout as processStdout } from "node:process";
import {
	cancel,
	confirm,
	intro,
	isCancel,
	outro,
	select,
	spinner,
	text,
} from "@clack/prompts";
import type { CliCommandContext } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";

/** CLI prompt adapter used by interactive commands. */
export interface CliPrompts {
	intro(title: string): void;
	outro(message: string): void;
	input(question: string, fallback?: string): Promise<string>;
	confirm(question: string, defaultValue?: boolean): Promise<boolean>;
	select(
		question: string,
		options: readonly { label: string; value: string }[],
	): Promise<string>;
	spinner(): { start(message?: string): void; stop(message?: string): void };
}

/** Creates prompt helpers backed by Clack. */
export function createPrompts(): CliPrompts {
	return {
		intro(title: string): void {
			intro(title);
		},
		outro(message: string): void {
			outro(message);
		},
		async input(question: string, fallback = ""): Promise<string> {
			const answer = await text({ message: question, defaultValue: fallback });
			return handleCancel(answer, fallback);
		},
		async confirm(question: string, defaultValue = false): Promise<boolean> {
			const answer = await confirm({
				message: question,
				initialValue: defaultValue,
			});
			return handleCancel(answer, defaultValue);
		},
		async select(
			question: string,
			options: readonly { label: string; value: string }[],
		): Promise<string> {
			const answer = await select({
				message: question,
				options: options.map(({ label, value }) => ({ label, value })),
			});
			return handleCancel(answer, "");
		},
		spinner(): { start(message?: string): void; stop(message?: string): void } {
			return spinner();
		},
	};
}

/** Returns whether current process can safely prompt interactively. */
export function canPrompt(
	context?: CliCommandContext,
	flags: { interactive?: boolean; nonInteractive?: boolean } = {},
): boolean {
	if (context?.output.json || flags.nonInteractive) return false;
	if (context?.env.CI === "true" && !flags.interactive) return false;
	return Boolean(
		(context?.stdin ?? processStdin).isTTY &&
			(context?.stdout ?? processStdout).isTTY,
	);
}

/** Alias for Clack-specific UI checks. */
export function canUseInteractiveUi(
	context?: CliCommandContext,
	flags: { interactive?: boolean; nonInteractive?: boolean } = {},
): boolean {
	return canPrompt(context, flags);
}

function handleCancel<T>(answer: T | symbol, fallback: T): T {
	if (isCancel(answer)) {
		cancel("Operation cancelled.");
		throw new CliError("Operation cancelled.", {
			code: "CLI_CANCELLED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	if (typeof answer === "string" && answer.length === 0) return fallback;
	return answer as T;
}
