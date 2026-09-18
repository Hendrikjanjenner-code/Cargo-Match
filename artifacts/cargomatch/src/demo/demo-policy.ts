/** Same fail-closed environment policy as /api/demo; builds never expose shortcuts. */
export function demoUiEnabled(command: string, nodeEnv: string | undefined, enabled: string | undefined) {
  return command === "serve" && ["development", "test"].includes(nodeEnv ?? "") && enabled !== "false";
}