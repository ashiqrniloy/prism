# Warm replay mechanism exercise (plan 188.7 Task 3)

Read-only classification of `task6/replays-v2.json`; no new calls. `exercised` means at
least one component metric moved, `insensitive` means the source transform changed but
no metric moved, `unexercised` means offline replay never invokes that path.

| Arm | Status | Changed metrics |
| --- | --- | --- |
| baseline | baseline | none |
| fabric-stem-off | exercised | scopeAccuracy |
| fabric-multiQuery-off | unexercised | none |
| fabric-snippetBudget-600 | unexercised | none |
| fabric-snippetBudget-1200 | unexercised | none |
| fabric-snippetBudget-2400 | unexercised | none |
| fabric-keyWeight-off | unexercised | none |
| om-dates-off | unexercised | none |
| om-taskState-off | unexercised | none |
| om-replaceOnReflect-off | unexercised | none |
| fabric-crossSourceDedup-off | unexercised | none |
| lifecycle-verification-retrieval | exercised | graveyardIndex |
| lifecycle-promotion-every-reflection | exercised | promotionRecall, graveyardIndex, scopeAccuracy |
| lifecycle-capacity-off | insensitive | none |
| lifecycle-merge-off | insensitive | none |
| lifecycle-clock-calendar | exercised | graveyardIndex |
| lifecycle-decayMode-exponential | exercised | scopeAccuracy |
| promote-signal-explicit-off | insensitive | none |
| promote-signal-correction-off | exercised | promotionRecall, graveyardIndex, scopeAccuracy |
| promote-signal-outcome-off | insensitive | none |
| promote-signal-recurrence-off | insensitive | none |
| promote-signal-generality-off | exercised | promotionRecall, archiveRegret, graveyardIndex, scopeAccuracy |
| promote-signal-ephemerality-off | exercised | promotionPrecision, graveyardIndex, scopeAccuracy |
| promote-signal-derivability-off | insensitive | none |
| lifecycle-scope-flat | unexercised | promotionRecall, archiveRegret, graveyardIndex, scopeAccuracy |
| core-off | policy | none |
| cues-off | policy | none |
| capacity-2 | policy | archiveRegret, graveyardIndex, scopeAccuracy |
| capacity-5 | policy | none |
| capacity-10 | policy | none |
| capacity-20 | policy | none |
| capacity-50 | policy | none |
| capacity-100 | policy | none |
| capacity-200 | policy | none |
| capacity-500 | policy | none |

Counts: {"baseline":1,"exercised":8,"insensitive":6,"unexercised":10,"policy":10}.
