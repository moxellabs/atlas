import { runProcess } from "./node-runtime";

/** Opens a local URL using the current platform default browser launcher. */
export async function openUrl(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  const { exitCode, stderr } = await runProcess(command);
  if (exitCode === 0) {
    return;
  }

  throw new Error(stderr.trim() || `Browser launcher exited with code ${exitCode}.`);
}
