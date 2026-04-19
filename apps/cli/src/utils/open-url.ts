/** Opens a local URL using the current platform default browser launcher. */
export async function openUrl(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  const processHandle = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe"
  });
  const exitCode = await processHandle.exited;
  if (exitCode === 0) {
    return;
  }

  const stderr = await new Response(processHandle.stderr).text();
  throw new Error(stderr.trim() || `Browser launcher exited with code ${exitCode}.`);
}
