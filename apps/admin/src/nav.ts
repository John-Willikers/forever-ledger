export interface NavItem {
  /** Path under /admin/ ('' is the index). */
  path: string;
  label: string;
  /** One line shown on the placeholder until the page ships. */
  summary: string;
  /** Plan phase that builds the page. */
  phase: number;
}

/** The panel's pages, in sidebar order (see project-plans/forever-ledger-admin-panel.md). */
export const NAV: readonly NavItem[] = [
  { path: '', label: 'Overview', phase: 2, summary: 'Uploads, records and health at a glance.' },
  {
    path: 'characters',
    label: 'Characters',
    phase: 3,
    summary: 'Characters, owners and level over time.',
  },
  { path: 'quests', label: 'Quests', phase: 3, summary: 'Quest XP offered vs paid, rewards.' },
  { path: 'loot', label: 'Loot', phase: 4, summary: 'Drop rates, items across builds.' },
  { path: 'dungeons', label: 'Dungeons', phase: 4, summary: 'Runs, clear times, boss splits.' },
  {
    path: 'professions',
    label: 'Professions',
    phase: 5,
    summary: 'Recipes, gathering, skill-ups.',
  },
  {
    path: 'vendors',
    label: 'Vendors & trainers',
    phase: 5,
    summary: 'Prices, recipe vendors, trainer catalogs.',
  },
  { path: 'builds', label: 'Builds', phase: 6, summary: 'What changed between client builds.' },
  { path: 'health', label: 'Health', phase: 2, summary: 'Diagnostics, ingest errors, samples.' },
  { path: 'access', label: 'Access', phase: 2, summary: 'Users and upload tokens.' },
];
