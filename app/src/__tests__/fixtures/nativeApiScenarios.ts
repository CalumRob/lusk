/**
 * Compact observations for API-consumer tests only. These numbers are invented
 * regression inputs, not published values or a production-parity snapshot.
 * Resource identities, axes, units, eligibility, and source clocks continue to
 * come from the current producer catalogue and metadata.
 */
export const NATIVE_API_FIXTURE_NOTICE = {
  kind: 'synthetic_test_fixture',
  publication_parity: false,
  notice: 'Synthetic test-only observations; not real production data or publication parity.',
} as const

/** Named samples cover the UI contracts that need stable, independently-known values. */
export const NATIVE_API_SCENARIOS = {
  percentagePages: {
    territory: '22001',
    passoires: 0.13,
    unemployment: 0.07,
    housingMix: { principales: 0.72, secondaires: 0.12, vacants: 0.16 },
    dpe: { A: 0.01, B: 0.03, C: 0.46, D: 0.28, E: 0.09, F: 0.06, G: 0.07 },
  },
  pooledHousingPrice: {
    territory: '22001',
    value: 1604.33,
  },
  profileAbsence: {
    territory: '22006',
    resource: 'distribution_dpe',
    status: 'suppressed',
  },
  pooledSeriesSuppression: {
    territory: '22002',
    resource: 'prix_m2',
    status: 'suppressed',
  },
} as const
