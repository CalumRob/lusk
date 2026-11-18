/** Shared route identities used by the screen router and the inert export router. */
export const CAHIER_EXPORT_ROUTES = {
  indicateurs: '/indicateurs',
  indicateur: '/indicateurs/:theme/:indicator',
  territoire: '/territoire/:type/:id',
} as const
