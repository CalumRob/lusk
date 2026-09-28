# Scalar serving migration sequence

This sequence tracks additive serving-schema work for the scalar reader. Migration
004 establishes the shared scalar contract and is the foundation reused by the
service-share slice; it does not require a service-specific migration.

| Number | Scope | Status |
| --- | --- | --- |
| 004 | Shared scalar infrastructure and contract | Applied foundation |
| 005 | Reserved for service shares | Intentionally unused: #595 reuses 004; no no-op migration or fake applied record |
| 006 | Profile | Reserved for its implementation |
| 007 | Series | Reserved for its implementation |
| 008 | Building | Reserved for its implementation |
| 009 | Retirement | Reserved for its implementation |

Code merge and live rollout are separate milestones. Merging a migration or
reader implementation does not mean its DDL has been applied, its data published,
or its reader deployed. Live application remains guarded and serialized by the
operator/orchestrator; record each future migration as applied only after that
live step is verified. Keep #595 open through Pi performance measurements,
publication, deployment, reader-flag cutover, and legacy service retirement.
