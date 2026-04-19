import type {
	CliCommandFailure,
	CliCommandSuccess,
	CliOutputOptions,
} from "../runtime/types";

/** Stream-backed CLI console that enforces JSON/human output separation. */
export class CliConsole {
	constructor(
		private readonly options: CliOutputOptions,
		private readonly stdout: NodeJS.WriteStream,
		private readonly stderr: NodeJS.WriteStream,
	) {}

	/** Writes an informational line in human mode. */
	async info(message: string): Promise<void> {
		if (this.options.json || this.options.quiet) {
			return;
		}
		await writeLine(this.stdout, message);
	}

	/** Writes a success line in human mode. */
	async success(message: string): Promise<void> {
		if (this.options.json || this.options.quiet) {
			return;
		}
		await writeLine(this.stdout, message);
	}

	/** Writes a warning line in human mode. */
	async warn(message: string): Promise<void> {
		if (this.options.json) {
			return;
		}
		await writeLine(this.stderr, `WARN: ${message}`);
	}

	/** Writes an error line in human mode. */
	async error(message: string): Promise<void> {
		if (this.options.json) {
			return;
		}
		await writeLine(this.stderr, `ERROR: ${message}`);
	}

	/** Writes a verbose-only debug line in human mode. */
	async debug(message: string): Promise<void> {
		if (this.options.json || this.options.quiet || !this.options.verbose) {
			return;
		}
		await writeLine(this.stderr, `DEBUG: ${message}`);
	}

	/** Writes a machine-readable success envelope. */
	async jsonSuccess(result: CliCommandSuccess): Promise<void> {
		await writeLine(this.stdout, JSON.stringify(result, null, 2));
	}

	/** Writes a machine-readable failure envelope. */
	async jsonFailure(result: CliCommandFailure): Promise<void> {
		await writeLine(this.stdout, JSON.stringify(result, null, 2));
	}
}

function writeLine(stream: NodeJS.WriteStream, line: string): Promise<void> {
	return new Promise((resolve, reject) => {
		stream.write(`${line}\n`, (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}
