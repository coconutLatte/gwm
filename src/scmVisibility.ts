export const scmSelectionModeCommands = {
  single: 'single',
  multiple: 'multiple',
} as const;

/**
 * VS Code restores SCM repository visibility from workspace state. Toggling
 * multiple selection through single mode makes the SCM view select every
 * repository currently loaded, which is the scope the navigator owns.
 */
export function repositoryVisibilityResetCommands(selectionMode: string): readonly string[] {
  return selectionMode === 'multiple'
    ? [scmSelectionModeCommands.single, scmSelectionModeCommands.multiple]
    : [scmSelectionModeCommands.multiple];
}
