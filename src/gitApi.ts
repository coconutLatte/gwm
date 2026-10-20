import type * as vscode from 'vscode';

// Read-only subset of vscode.git's version 1 API. All Git edits stay in the native UI.
export interface GitChange {
  readonly uri: vscode.Uri;
}

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly HEAD?: { readonly name?: string };
    readonly indexChanges: readonly GitChange[];
    readonly workingTreeChanges: readonly GitChange[];
    readonly untrackedChanges: readonly GitChange[];
    readonly mergeChanges: readonly GitChange[];
    readonly onDidChange: vscode.Event<void>;
  };
  status(): Promise<void>;
}

export interface GitApi {
  readonly repositories: readonly GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
}

export interface GitExtension {
  getAPI(version: 1): GitApi;
}

export function changedFileCount(repository: GitRepository): number {
  const state = repository.state;
  return new Set([
    ...state.indexChanges, ...state.workingTreeChanges,
    ...state.untrackedChanges, ...state.mergeChanges,
  ].map(change => change.uri.toString())).size;
}
