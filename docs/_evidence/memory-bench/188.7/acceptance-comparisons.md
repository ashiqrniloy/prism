# 188.7 final acceptance comparisons

Required jobs: 56; completed: 6; missing: 50; attempts: 17.
Primary fabric vs full: verdict=inconclusive; powered=false; full-context non-inferior=false.

| Family | Candidate | Metric | n | Clusters | Diff | 95% CI | p | p-Holm |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: |
| Q | fabric | abstention | 20 | 20 | 0.0000 | [-0.2000, 0.2000] | 1.000e+0 | 1.000e+0 |
| Q | fabric | knowledge-update | 20 | 20 | -0.5000 | [-0.7500, -0.2500] | 6.348e-3 | 3.809e-2 |
| Q | fabric | multi-session | 20 | 20 | -0.5000 | [-0.7500, -0.2500] | 6.348e-3 | 3.809e-2 |
| Q | fabric | single-session-assistant | 20 | 20 | -0.0500 | [-0.1500, 0.0000] | 1.000e+0 | 1.000e+0 |
| Q | fabric | single-session-preference | 20 | 20 | -0.0500 | [-0.3500, 0.2500] | 1.000e+0 | 1.000e+0 |
| Q | fabric | single-session-user | 20 | 20 | -0.4500 | [-0.6500, -0.2500] | 3.906e-3 | 2.734e-2 |
| Q | fabric | temporal-reasoning | 20 | 20 | -0.3500 | [-0.5500, -0.1500] | 1.563e-2 | 6.250e-2 |
| Q | fabric | overall | 140 | 140 | -0.2714 | [-0.3643, -0.1786] | 9.999e-5 | 7.999e-4 |
| S | fabric-promote-off | taskSuccess | 24 | 1 | 0.4167 | [0.4167, 0.4167] | 1.000e+0 | 1.000e+0 |
| S | fabric-promote-off | crossProjectLeakage | 24 | 1 | 0.0000 | [0.0000, 0.0000] | 1.000e+0 | 1.000e+0 |
| S | fabric-promote-off | foreignContextExposure | 24 | 1 | 0.5417 | [0.5417, 0.5417] | 1.000e+0 | 1.000e+0 |
| S | fabric-promote-off | poisonStored | 24 | 1 | 0.0000 | [0.0000, 0.0000] | 1.000e+0 | 1.000e+0 |
| S | fabric-promote-off | poisonVisible | 24 | 1 | -0.2083 | [-0.2083, -0.2083] | 1.000e+0 | 1.000e+0 |
| S | fabric-promote-off | poisonReused | 24 | 1 | 0.0000 | [0.0000, 0.0000] | 1.000e+0 | 1.000e+0 |
| S | fabric-promote-off | poisonPersistence | 24 | 1 | -0.2083 | [-0.2083, -0.2083] | 1.000e+0 | 1.000e+0 |
| S | fabric-promote-off | attribution | 24 | 1 | 0.0000 | [0.0000, 0.0000] | 1.000e+0 | 1.000e+0 |
| S | fabric-promote-off | rightTimeRecall | 16 | 1 | 0.6125 | [0.6125, 0.6125] | 1.000e+0 | 1.000e+0 |
| S | fabric-promote-off | staleUseRate | 9 | 1 | 0.0000 | [0.0000, 0.0000] | 1.000e+0 | 1.000e+0 |
| S | fabric-promote-off | repeatedErrorRate | 3 | 1 | 0.0000 | [0.0000, 0.0000] | 1.000e+0 | 1.000e+0 |
| S | fabric-promote-off | abstentionCorrectness | 3 | 1 | 1.0000 | [1.0000, 1.0000] | 1.000e+0 | 1.000e+0 |
| Q | mab-fabric | conflict-resolution-single-hop | 20 | 4 | 0.1000 | [0.0000, 0.2222] | 5.000e-1 | 1.000e+0 |
| Q | mab-fabric | conflict-resolution-multi-hop | 20 | 4 | -0.1000 | [-0.2222, 0.0000] | 5.000e-1 | 1.000e+0 |
| Q | mab-fabric | overall | 40 | 8 | 0.0000 | [-0.0930, 0.1053] | 1.000e+0 | 1.000e+0 |

Cost is wire input/cache/output only. Currency is not available without authenticated rate semantics.
- lifecycle full: 1 personas, completed, 62019 input, 43776 cache-read.
- lifecycle fabric-promote-off: 1 personas, completed, 303201 input, 214592 cache-read.
- usage incomplete: accept-lme-full
- usage incomplete: accept-lme-fabric
- missing completed report: accept-lme-om
- missing completed report: accept-lme-fabric-agentic
- missing completed report: accept-lme-om+fabric
- missing completed report: accept-locomo-full
- missing completed report: accept-lifecycle-fabric-promote-on-p1887
- missing completed report: accept-lifecycle-om+fabric-p1887
- missing completed report: accept-lifecycle-full-p1888
- missing completed report: accept-lifecycle-fabric-promote-off-p1888
- missing completed report: accept-lifecycle-fabric-promote-on-p1888
- missing completed report: accept-lifecycle-om+fabric-p1888
- missing completed report: accept-lifecycle-full-p1889
- missing completed report: accept-lifecycle-fabric-promote-off-p1889
- missing completed report: accept-lifecycle-fabric-promote-on-p1889
- missing completed report: accept-lifecycle-om+fabric-p1889
- missing completed report: accept-lifecycle-full-p1890
- missing completed report: accept-lifecycle-fabric-promote-off-p1890
- missing completed report: accept-lifecycle-fabric-promote-on-p1890
- missing completed report: accept-lifecycle-om+fabric-p1890
- missing completed report: accept-lifecycle-full-p1891
- missing completed report: accept-lifecycle-fabric-promote-off-p1891
- missing completed report: accept-lifecycle-fabric-promote-on-p1891
- missing completed report: accept-lifecycle-om+fabric-p1891
- missing completed report: accept-lifecycle-full-p1892
- missing completed report: accept-lifecycle-fabric-promote-off-p1892
- missing completed report: accept-lifecycle-fabric-promote-on-p1892
- missing completed report: accept-lifecycle-om+fabric-p1892
- missing completed report: accept-lifecycle-full-p1893
- missing completed report: accept-lifecycle-fabric-promote-off-p1893
- missing completed report: accept-lifecycle-fabric-promote-on-p1893
- missing completed report: accept-lifecycle-om+fabric-p1893
- missing completed report: accept-lifecycle-full-p1894
- missing completed report: accept-lifecycle-fabric-promote-off-p1894
- missing completed report: accept-lifecycle-fabric-promote-on-p1894
- missing completed report: accept-lifecycle-om+fabric-p1894
- missing completed report: accept-lifecycle-full-p1895
- missing completed report: accept-lifecycle-fabric-promote-off-p1895
- missing completed report: accept-lifecycle-fabric-promote-on-p1895
- missing completed report: accept-lifecycle-om+fabric-p1895
- missing completed report: accept-lifecycle-full-p1896
- missing completed report: accept-lifecycle-fabric-promote-off-p1896
- missing completed report: accept-lifecycle-fabric-promote-on-p1896
- missing completed report: accept-lifecycle-om+fabric-p1896
- missing completed report: accept-lifecycle-full-p1897
- missing completed report: accept-lifecycle-fabric-promote-off-p1897
- missing completed report: accept-lifecycle-fabric-promote-on-p1897
- missing completed report: accept-lifecycle-om+fabric-p1897
- missing completed report: accept-lifecycle-full-p1898
- missing completed report: accept-lifecycle-fabric-promote-off-p1898
- missing completed report: accept-lifecycle-fabric-promote-on-p1898
- missing completed report: accept-lifecycle-om+fabric-p1898
