import { describe, expect, it } from "vite-plus/test";

import {
  resolveNewTaskBranchWorktreePath,
  resolveNewTaskBranchLabel,
  resolveNewTaskLocalWorkspaceSelection,
  shouldAutoSelectWorktreeBaseBranch,
} from "./new-task-context-presentation";

describe("resolveNewTaskLocalWorkspaceSelection", () => {
  it("waits for refs instead of carrying a worktree base into Current checkout", () => {
    expect(
      resolveNewTaskLocalWorkspaceSelection({
        branches: [],
        projectCwd: "/repo",
      }),
    ).toEqual({
      branch: null,
      worktreePath: null,
      awaitsCurrentBranch: true,
    });
  });

  it("adopts the checkout's current branch once refs load", () => {
    expect(
      resolveNewTaskLocalWorkspaceSelection({
        branches: [
          { name: "feature/worktree-base", current: false, worktreePath: "/worktree" },
          { name: "main", current: true, worktreePath: "/repo" },
        ],
        projectCwd: "/repo",
      }),
    ).toEqual({
      branch: "main",
      worktreePath: null,
      awaitsCurrentBranch: false,
    });
  });

  it("carries the worktree path when the current branch lives in another worktree", () => {
    expect(
      resolveNewTaskLocalWorkspaceSelection({
        branches: [
          { name: "feature/split", current: true, worktreePath: "/repo/.t3/worktrees/split" },
          { name: "main", current: false, worktreePath: "/repo" },
        ],
        projectCwd: "/repo",
      }),
    ).toEqual({
      branch: "feature/split",
      worktreePath: "/repo/.t3/worktrees/split",
      awaitsCurrentBranch: false,
    });
  });
});

describe("resolveNewTaskBranchWorktreePath", () => {
  it("moves Current checkout to the selected existing worktree", () => {
    expect(
      resolveNewTaskBranchWorktreePath({
        workspaceMode: "local",
        projectCwd: "/repo",
        branchWorktreePath: "/repo/.t3/worktrees/feature",
      }),
    ).toBe("/repo/.t3/worktrees/feature");
  });

  it("keeps the project checkout represented by a null override", () => {
    expect(
      resolveNewTaskBranchWorktreePath({
        workspaceMode: "local",
        projectCwd: "/repo",
        branchWorktreePath: "/repo",
      }),
    ).toBeNull();
  });

  it("does not reuse an existing worktree while creating a new one", () => {
    expect(
      resolveNewTaskBranchWorktreePath({
        workspaceMode: "worktree",
        projectCwd: "/repo",
        branchWorktreePath: "/repo/.t3/worktrees/feature",
      }),
    ).toBeNull();
  });
});

describe("resolveNewTaskBranchLabel", () => {
  it("shows the checked-out branch without a base-ref prefix", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "feature/mobile",
        startFromOrigin: true,
        workspaceMode: "local",
      }),
    ).toBe("feature/mobile");
  });

  it("labels a local worktree base with From", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "main",
        startFromOrigin: false,
        workspaceMode: "worktree",
      }),
    ).toBe("From main");
  });

  it("labels a remote worktree base with From origin", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "main",
        startFromOrigin: true,
        workspaceMode: "worktree",
      }),
    ).toBe("From origin/main");
  });

  it("prompts when no branch is available", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: null,
        startFromOrigin: true,
        workspaceMode: "worktree",
      }),
    ).toBe("Choose branch");
  });
});

describe("shouldAutoSelectWorktreeBaseBranch", () => {
  const settledWorktreeDefault = {
    defaultWorkspaceModeSettled: true,
    workspaceMode: "worktree" as const,
    selectedBranchName: null,
  };

  it("picks a base branch for a fresh worktree draft", () => {
    expect(
      shouldAutoSelectWorktreeBaseBranch({
        ...settledWorktreeDefault,
        liveWorkspaceSelection: undefined,
      }),
    ).toBe(true);
    expect(
      shouldAutoSelectWorktreeBaseBranch({
        ...settledWorktreeDefault,
        liveWorkspaceSelection: { mode: "worktree", branch: null },
      }),
    ).toBe(true);
  });

  it("keeps a local selection written to the draft in the same commit", () => {
    expect(
      shouldAutoSelectWorktreeBaseBranch({
        ...settledWorktreeDefault,
        liveWorkspaceSelection: { mode: "local", branch: "t3code/0790af30" },
      }),
    ).toBe(false);
  });

  it("does nothing once a branch is selected or the mode is local", () => {
    expect(
      shouldAutoSelectWorktreeBaseBranch({
        ...settledWorktreeDefault,
        selectedBranchName: "main",
        liveWorkspaceSelection: { mode: "worktree", branch: "main" },
      }),
    ).toBe(false);
    expect(
      shouldAutoSelectWorktreeBaseBranch({
        ...settledWorktreeDefault,
        workspaceMode: "local",
        liveWorkspaceSelection: undefined,
      }),
    ).toBe(false);
    expect(
      shouldAutoSelectWorktreeBaseBranch({
        ...settledWorktreeDefault,
        defaultWorkspaceModeSettled: false,
        liveWorkspaceSelection: undefined,
      }),
    ).toBe(false);
  });
});
