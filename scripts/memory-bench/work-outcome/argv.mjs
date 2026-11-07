/**
 * Plan 209 Task 6: the argv of one work-outcome child. A leaf module (no imports), so `campaign.mjs` can build it
 * synchronously without loading the screen module, which itself imports the campaign.
 */
/** The work-outcome child's argv (the campaign adds `timeout` and `bun`). */
export function screen209WorkArgv(job, { output, maxInput }) {
  return [
    "scripts/memory-bench/work-outcome/live.mjs",
    "--job",
    job.id,
    "--model",
    `${job.provider}/${job.model}`,
    "--arm",
    job.arm,
    "--simulator",
    job.simulator,
    "--judges",
    job.judges,
    "--partition",
    job.subset,
    "--max-input-tokens",
    String(maxInput),
    "--concurrency",
    String(job.concurrency),
    "--judge-calls",
    String(job.judgeCalls),
    "--output",
    output,
    ...(job.personaLimit ? ["--personas", String(job.personaLimit)] : []),
    ...(job.freeOnly ? ["--free-only"] : []),
    ...(job.simulatorPaid ? ["--simulator-paid"] : []),
    ...(job.judgesPaid ? ["--judges-paid"] : []),
    ...(job.fabricOverlay ? ["--fabric-overlay", JSON.stringify(job.fabricOverlay)] : []),
  ];
}
