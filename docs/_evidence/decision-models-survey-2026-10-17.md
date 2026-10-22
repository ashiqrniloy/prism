# Decision models: market survey (2026-10-17)

Evidence for plans 195–196 (roadmap Phase 18, in 0.13.0 scope by owner decision 2026-10-17). A decision model answers typed questions about a state in one forward pass: it returns calibrated probabilities and generates no text (`output_tokens: 0`). The category started with TypeSafe Jev on 2026-09-15. This survey lists every decision model found on 2026-10-17, the wire each one speaks, and what Prism should adopt.

Most scores below come from vendors. Different Decision Index versions (0.2.1, 0.3.1, Artificial Analysis v1.0) are not comparable with each other.

## 1. The two wire dialects

| Dialect | Path | Shape | Who speaks it |
| --- | --- | --- | --- |
| **System One** (TypeSafe Jev's format, the de facto standard) | `POST /v1/systemone` | `{ model, state, images?, questions: { <name>: { type: "noul" \| "choice" \| "score", instructions, criteria } } }` → `{ model, answers: { <name>: … }, usage }` | TypeSafe Jev, Liquid d1 / d1-ultra, Fastino GLiDE, Celeris-1 Decision, Microsoft-Decision-1 (Foundry: `/providers/microsoft/v1/systemone`), OpenRouter (`/api/v1/systemone`, many models), TrueFoundry gateway, Cloudflare Clef via TypeSafe's account, **llama.cpp `llama-server`** (any decision GGUF: d1-3B, Laya, Clef-flash, Kev-4B, OpenJev, …), `laya-serve`, Strands Decider local server, H2O-Lightning shim, Mapika `decider/serve.py` |
| **OpenAI Decisions** | `POST /v1/decisions` | `{ model, input, questions: [{ name, type: "predicate" \| "choice" \| "score", instructions, choices \| levels }] }` → `{ answers: [{ name, type, probability \| choice \| score, probabilities, confidence }] }`, plus a `refusal` answer type | OpenAI (`gpt-6-luna`, public beta), Inception Mercury Decide (native), Celeris (second endpoint), OpenRouter alpha (`/api/alpha/decisions`), TrueFoundry |

Other shapes: AutoTrust and AnyJev use `/v1/decide`, Cloudflare Workers AI uses its own `/ai/run` binding, and Contrastive-LM ships its own client. Gateways translate between the two main dialects: TrueFoundry documents the field mapping (`input`↔`state`, `predicate`↔`noul`, `levels`↔`criteria`, ordered answer list ↔ keyed map).

**What this means for Prism:** one System One codec reaches about 80% of the market, including every local option, by changing the base URL (and the path, for Foundry and Liquid). An OpenAI Decisions codec reaches the rest.

## 2. Hosted decision models

| Model | Vendor | Endpoint / wire | Price (input / 1M tokens, output free) | Independent score | Notes |
| --- | --- | --- | --- | --- | --- |
| d1-ultra | Liquid AI | Liquid API (System One), OpenRouter, Vercel | $0.042 | AA Decision Index v1.0: **65.2 (#1)**, 93 ms | Released 2026-10-15. Built on an unnamed "larger open-weight model". 44 languages. Text and images. |
| Jev 1.13 / 1.14 | TypeSafe | `api.typesafe.ai/v1/systemone` | $0.042 | AA 57.5 / 57.1. Jev DI 0.3.1: 60.11 | The reference API. Closed. 32k state, 64k total. Overconfident (ECE 0.074). Aliases move: pin versions. |
| GLiDE | Fastino | `api.fastino.ai/v1/systemone` (`fastino/glide`) | — (AA $119 per 1M tasks) | AA 53.9 | "Thinking" decision model, 40k context. |
| Microsoft-Decision-1 | Microsoft | Foundry `…/providers/microsoft/v1/systemone`, OpenRouter | $0.042 | AA 53.8 | 9B, post-trained from Qwen3.5. Low flip rate under perturbation (vendor). |
| Mercury Decide | Inception | Native `/v1/decisions`; OpenRouter System One | $0.02 (OpenRouter) | AA 52.7, 500 ms | Diffusion-based. |
| Celeris-1 Decision | Celeris | `inference.celeris.ai/celeris-1-decision/v1/systemone` and `/v1/decisions` | $0.04 | AA 52.3, 63 ms | Closed diffusion model. Released 2026-10-08. |
| d1 | Liquid AI | `api.liquid.ai/decisions/v1/systemone`, OpenRouter (`liquid/d1`), Vercel | $0.04 (Liquid methodology) / $0.02 (OpenRouter) | AA 50.3, 299 ms. Best AA-Omniscience accuracy (41) but 2% non-hallucination | Text and images (images on Liquid's API only, for now). Backbone undisclosed. |
| Clef / Clef-flash / Clef-Omni | Cloudflare | Workers AI (`/ai/run`); open weights also | $0.24 / $0.09 | AA 48.6 / 45.8 / 44.3 | Apache 2.0 weights. Workers AI truncates long state to about 2k tokens. |
| GPT-6 Luna (Decisions) | OpenAI | `/v1/decisions` only | $0.10 | AA 48.5 | Public beta. Own schema. ZDR and HIPAA available. |

## 3. Open-weight decision models

| Model | Vendor | Size / base | License | Context | Local serving | Score |
| --- | --- | --- | --- | --- | --- | --- |
| pplx-decider v1.1 ("Decider v1.1 27B") | Perplexity | 27B | Apache 2.0 | 8k | bundled code | Jev DI 0.3.1 **62.75 (#1)**. AA 53.1 |
| GEV-26B-Decide | AutoTrust | 26B-A4B | Apache 2.0 | 256k | `/v1/decide` | DI 56.17 (System One mode) |
| Decision 2.0 Vega | vLLM Semantic Router | 27B (0.6B–27B family) | Apache 2.0 | 32k | Transformers | DI 55.88 |
| JEV-27B-VL / JEV-9B | AutoTrust | distilled from Jev | Apache 2.0 | — | `/v1/decide` | DI 55.64 / 45.21 |
| Clef / Clef-flash | Cloudflare | 27B / 9.4B (Qwen3.8 / 3.5) | Apache 2.0 | 16k | `llama-server` `/v1/systemone` | DI 53.08 / 47.61 |
| H2O-Lightning-4B | H2O.ai | 4B (Qwen3.5) | Apache 2.0 | 40k | vLLM + `/v1/systemone` shim | JevBench open #1 (72.5) |
| **d1-3B** | Liquid AI | 3.12B (LFM2.5-VL-3B), text and images | LFM Open License 1.0 (free under $10M revenue) | 32k | `llama-server -hf LiquidAI/d1-3B-GGUF:Q8_0` → `/v1/systemone`; Transformers `system_one()` | Vendor DI 0.2.1: 48.57. **Community Jev DI 0.3.1: 40.08 (#53)**, public 48.99 vs new-domain 27.96. 16 ms median |
| Kev 9B / Kev-4B, lev, OpenJev, Julia-1 | various | 0.1B–27B | mixed (OpenJev CC BY-NC) | — | `llama-server` | Kev 9B DI 38.5 |
| Tev1-4B | Together AI | 4B | not final | — | Together serverless | DI 29.0 |
| Strands Decider 2B | AWS Strands Labs | 2B | Apache 2.0 | 4k | own local server, `/v1/systemone`, no auth | DI 21.75 |
| d1-omni-600M | Liquid AI | 587M encoder, text + image/audio | LFM Open License | 16k | Transformers | DI 9.45 (experimental) |
| CLM-v0.1-8B | Contrastive-LM | 8B | Apache 2.0 | — | own client | DI 6.24 |
| **Laya** | Convai Innovations | 421M (ModernBERT-large) | Apache 2.0 | 512 (1k–8k multilingual) | `laya-serve`, `llama-server` | **DI 4.43** (community 0.3.1). ECE 0.466 as shipped (0.081 after temperature refit). 6 ms |

## 4. Hosted d1 vs open d1-3B

Liquid has not said whether they are the same model. The docs list d1, d1-ultra, and d1-3B as separate rows. The d1 launch post names no backbone or size and calls open weights "coming soon". The d1-3B card and the open-d1 post never mention a hosted model. The "same weights" claim comes only from Ollama's listing. The gap in independent scores (AA 50.3 for hosted d1; community DI 40.08 for d1-3B; the two indexes differ) does not prove they are different, but it gives no support for treating them as interchangeable either. **Treat them as two catalog entries.**

Liquid's own decision-model guide calls hosted d1 through TypeSafe's SDK (`typesafe-sdk`, `TypeSafeClient`, base `https://api.liquid.ai`), so Liquid confirms the System One wire. The launch post gives the full path as `https://api.liquid.ai/decisions/v1/systemone`. The two base URLs disagree, and plan 196 Task 1 settles which one works.

## 5. d1-3B vs Laya for local experimentation

d1-3B scores 40.08 and Laya 4.43 on the same community board (Jev DI 0.3.1, 2026-10-10). d1-3B also has a 32k context against Laya's 512 and takes images. Its costs are about 3 GB of weights at Q8_0 against Laya's ~0.4B, 16 ms against 6 ms median latency, and a non-Apache license. For a dev machine, d1-3B served by `llama-server` is the better default. Keep Q8_0: decision heads lose calibration under imatrix quantization (Clef's card keeps its head at Q8_0, and Liquid's own bf16 vs low-precision test flipped 0.8% of top answers).

## 6. What Prism should adopt

1. **Decision calls as a model capability, not a disguise.** Today Jev and Laya sit behind `generate()` with `structuredOutput`. The renderer drops probabilities and confidence, and `askSystemOneDecisions` bypasses the registry, credentials slot, and redaction set. Add `capabilities.decisions`, `ModelProvider.decisions?()`, and `prism.models.decisions(ref)`, mirroring `embeddings` (plan 158).
2. **System One codec improvements:** `images` (data URLs), a configurable path (Liquid `/decisions/v1/systemone`, Foundry `/providers/microsoft/v1/systemone`), and the raw answers kept through the decision API. With these, OpenRouter, Fastino, Celeris, Foundry, TrueFoundry, and `llama-server` become config, not packages.
3. **`@arnilo/prism-provider-liquid`:** hosted `liquid/d1` and `liquid/d1-ultra`, plus `liquid-local/d1-3B` on `llama-server`.
4. **Defer:** the OpenAI Decisions dialect (beta, one model, schema not final). `/v1/decide` vendors and Workers AI wait until there is demand.
5. **Operational rules to bake in** (from §2–§3 failure reports): pin versioned model ids and log the returned `model`; keep thresholds per model (calibration differs widely); never put the question in the state; never use a decision model alone as a prompt-injection defense.

## Sources

- Liquid: [decision models](https://docs.liquid.ai/lfm/models/decision-models), [decision model guide](https://docs.liquid.ai/guides/decision-model-guide.md), [d1 blog](https://www.liquid.ai/blog/d1-decision-model), [open d1](https://huggingface.co/blog/LiquidAI/open-d1), [d1-3B card](https://huggingface.co/LiquidAI/d1-3B), [d1-3B GGUF](https://huggingface.co/LiquidAI/d1-3B-GGUF)
- llama.cpp: [decision models in llama.cpp](https://huggingface.co/blog/ggml-org/decision-models-in-llamacpp)
- Boards: [AA Decision Index v1.0](https://artificialanalysis.ai/articles/artificial-analysis-decision-index), [BenchLM AA snapshot 2026-10-15](https://benchlm.ai/benchmarks/artificial-analysis-decision-index), [open decision models survey (Jev DI 0.3.1)](https://redreamality.com/blog/open-decision-models-2026-survey-benchmarks/), [eesel decision models](https://www.eesel.ai/blog/decision-models)
- Wires: [TrueFoundry Decisions API](https://www.truefoundry.com/docs/ai-gateway/decisions), [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions), [OpenRouter Jev guide](https://openrouter.ai/docs/guides/community/jev), [Fastino System One](https://docs.fastino.ai/inference/systemone), [Inception decisions](https://docs.inceptionlabs.ai/capabilities/decisions), [Celeris-1 Decision](https://systemonemodels.org/models/celeris-1-decision/), [Clef](https://infoq.com/news/2026/10/clef-decision-models)
- Comparisons: [orcarouter d1 vs d1-3B](https://www.orcarouter.ai/blog/liquid-ai-d1-vs-liquid-ai-d1-3b), [orcarouter d1-ultra vs d1](https://www.orcarouter.ai/blog/liquid-ai-d1-ultra-vs-liquid-ai-d1), [Laya benchmark discussion](https://huggingface.co/convaiinnovations/laya/discussions/10)
