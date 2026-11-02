# Observational memory role measurement — plan 202 Task 16

Offline `lifecycle` suite, seeds 7, 11, 19, 23, 29, 31, 37, zero model calls. The scripted provider
writes notes through the real fabric consolidation path, recalls them in later sessions, and cites the
ids it saw, so use-based verification is measured rather than assumed.

| Arm | Task success | Promoted | Notes/session | Verified share | Used share | Observer calls | Observer input tokens | Reflector calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fabric | 0.375 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| fabric+promotion | 0.392857 | 3 | 0.125 | 0 | 0 | 0 | 0 | 0 |
| om+fabric | 0.732143 | 0 | 0 | 0 | 0 | 224 | 827953.142857 | 1.285714 |
| om+fabric+promotion | 0.732143 | 6 | 0.25 | 0 | 0 | 224 | 827964.857143 | 1.285714 |

Comparisons: {
  "fabricPromotionMinusOff": 0.017857,
  "omFabricPromotionMinusOff": 0,
  "omFabricMinusFabric": 0.357143,
  "omFabricPromotionMinusFabricPromotion": 0.339286
}

**Decision:** promotion did not lower task success in this offline suite; it stays opt-in pending live confirmation because there is no positive accuracy claim.

Limitations:
- Synthetic one-persona lifecycle suite (3 projects x 8 sessions), not the powered 12-persona safety gate.
- Promotion is the real fabric consolidation path over OM observations/reflections; the mock provider writes and cites notes deterministically.
- Zero model calls: this measures the role and the mechanics, not live answer quality.
