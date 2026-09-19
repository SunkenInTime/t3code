type WorkspaceMode = "local" | "worktree";

export function resolveNewTaskWorkspaceLabel(input: {
  readonly workspaceMode: WorkspaceMode;
  readonly worktreePath: string | null;
}): "Current checkout" | "Current worktree" | "New worktree" {
  if (input.workspaceMode === "worktree") {
    return "New worktree";
  }
  return input.worktreePath ? "Current worktree" : "Current checkout";
}

export function resolveNewTaskBranchWorktreePath(input: {
  readonly workspaceMode: WorkspaceMode;
  readonly projectCwd: string;
  readonly branchWorktreePath: string | null | undefined;
}): string | null {
  if (
    input.workspaceMode === "worktree" ||
    !input.branchWorktreePath ||
    input.branchWorktreePath === input.projectCwd
  ) {
    return null;
  }
  return input.branchWorktreePath;
}

export function resolveNewTaskLocalWorkspaceSelection(input: {
  readonly branches: ReadonlyArray<{
    readonly name: string;
    readonly current: boolean;
    readonly worktreePath?: string | null;
  }>;
  readonly projectCwd: string;
}): {
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly awaitsCurrentBranch: boolean;
} {
  const currentBranch = input.branches.find((branch) => branch.current) ?? null;
  if (!currentBranch) {
    return {
      branch: null,
      worktreePath: null,
      awaitsCurrentBranch: true,
    };
  }

  return {
    branch: currentBranch.name,
    worktreePath: resolveNewTaskBranchWorktreePath({
      workspaceMode: "local",
      projectCwd: input.projectCwd,
      branchWorktreePath: currentBranch.worktreePath,
    }),
    awaitsCurrentBranch: false,
  };
}

export function resolveNewTaskBranchLabel(input: {
  readonly branchName: string | null;
  readonly startFromOrigin: boolean;
  readonly workspaceMode: WorkspaceMode;
}): string {
  if (!input.branchName) {
    return "Choose branch";
  }

  if (input.workspaceMode === "local") {
    return input.branchName;
  }

  const baseRef = input.startFromOrigin ? `origin/${input.branchName}` : input.branchName;
  return `From ${baseRef}`;
}

/**
 * Whether the worktree default still needs a base branch. Reads the draft's
 * live selection rather than the rendered one: the route that carries a
 * thread's branch writes its local selection in the same commit this effect
 * runs, and a stale worktree/null view of the draft must not overwrite it.
 */
export function shouldAutoSelectWorktreeBaseBranch(input: {
  readonly defaultWorkspaceModeSettled: boolean;
  readonly workspaceMode: WorkspaceMode;
  readonly selectedBranchName: string | null;
  readonly liveWorkspaceSelection:
    | { readonly mode: WorkspaceMode; readonly branch: string | null }
    | undefined;
}): boolean {
  if (
    !input.defaultWorkspaceModeSettled ||
    input.workspaceMode !== "worktree" ||
    input.selectedBranchName !== null
  ) {
    return false;
  }
  const live = input.liveWorkspaceSelection;
  return live === undefined || (live.mode === "worktree" && live.branch === null);
}

export function shouldCheckoutNewTaskBranch(input: {
  readonly branchIsCurrent: boolean;
  readonly branchWorktreePath: string | null | undefined;
  readonly workspaceMode: WorkspaceMode;
}): boolean {
  return input.workspaceMode === "local" && !input.branchIsCurrent && !input.branchWorktreePath;
}
