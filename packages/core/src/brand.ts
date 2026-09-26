/**
 * Every user-facing name derives from this constant. Rename the product here.
 */
export const BRAND = {
  name: 'Remit',
  slug: 'remit', // CLI bin, package scope, .remit.yml, label prefix, env prefix
  checkName: 'Remit',
  commentMarker: 'remit:summary',
  slashCommand: '/remit',
} as const;
