import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

export function normalizeConfiguredBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): Option.Option<string> {
  if (Option.isNone(input.t3Home)) {
    return Option.none();
  }
  const trimmed = input.t3Home.value.trim();
  // Agents of the official T3 Code service inherit its T3CODE_HOME.
  const official = input.joinPath(trimmed, ".") === input.joinPath(input.homeDirectory, ".t3");
  return trimmed.length > 0 && !official ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input), () =>
    input.joinPath(input.homeDirectory, ".t3-red"),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly homeDirectory: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  const useDevSubdir = input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
