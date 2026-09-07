/**
 * Minimal ambient declarations for the couple of Node builtins a
 * source-inspection smoke test needs (reading CreateBriefFlow.tsx's own text
 * to assert no bespoke picker Modal remains in it).
 *
 * @types/node is present in this workspace only as a transitive dependency
 * and is not wired into tsc's module resolution here, so this stands in
 * rather than adding a new top-level dependency in a worktree where `pnpm
 * install` cannot run (see AGENTS.md / the task brief on this worktree).
 */
declare module "fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
declare module "path" {
  export function resolve(...segments: string[]): string;
}
declare const __dirname: string;
