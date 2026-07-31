import { runMcpRetrievalEvalMain } from "../../packages/eval/src/retrieval-cli/run";

await runMcpRetrievalEvalMain({
	argv: Bun.argv.slice(2),
	env: Bun.env,
	cwd: process.cwd(),
});
