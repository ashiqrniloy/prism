/** Repository operations family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from repository.ts; public surface unchanged behind the barrel. */
import type { RepositoryLimitOptions, RepositoryOperations } from "./types.js";
import { resolveRepositoryLimits } from "./types.js";
import type { RepositoryWalk } from "./walk.js";
import { walkRepository } from "./walk.js";
import { globLocal } from "./glob.js";
import { listLocal } from "./list.js";
import { searchLocal } from "./search.js";

export function createLocalRepositoryOperations(
  limits?: RepositoryLimitOptions,
  walk: RepositoryWalk = walkRepository,
): RepositoryOperations {
  const resolved = resolveRepositoryLimits(limits);
  return {
    list: (request) => listLocal(request, resolved, walk),
    search: (request) => searchLocal(request, resolved, walk),
    glob: (request) => globLocal(request, resolved, walk),
  };
}
