# AEDAR package human decision

`record_aedar_package_approval.py` records one explicit whole-package decision. It neither
renders nor uploads. Point it only at an owned/staged package whose exact contents you intend
to authorize; the command does not claim that every image was individually inspected.

```powershell
python pipeline/maps/production/record_aedar_package_approval.py `
  --package-dir <explicit-package-directory> --reviewer "<name>" --outcome approved
# or --outcome rejected
```

All three arguments are required. The command refuses incomplete technical QA, changed or
unbound full/upload manifests, incorrect AEDAR namespace, partial or duplicate mode/profile
coverage against the preserved source plan and worker evidence, inconsistent omissions, paths
outside the package, and changed/invalid native WebP bytes (including decoded dimensions and
alpha). It records the original QA hash plus both manifest hashes, reviewer, outcome and time.
The exact original QA bytes are preserved at
`evidence/human-approval/full-qa-<sha256>.json`. The record is written before final QA promotion;
the uploader requires both to bind. Recovery of an interrupted write only proceeds when the
explicit retry repeats the same reviewer, outcome and snapshot. A different request never
changes either file. Rejected packages remain non-uploadable.

The original manifests, images and source QA evidence are not rewritten by packaging or approval.
Do not edit the approval record or QA manually. If a decision must change, prepare a new package
snapshot through the normal packaging path; this recorder does not provide an overwrite/force
option. Publication remains the existing uploader's separate operation and its dry-run/gates;
this command has no credentials, network, or PUT path.
