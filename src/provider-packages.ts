import type { AuthMethod, ProviderPackage, SystemPromptContribution } from "./contracts.js";

export function defineProviderPackage(providerPackage: ProviderPackage): ProviderPackage {
  if (!providerPackage.name.trim()) throw new Error("Provider package name is required");
  return providerPackage;
}

export function authMethodKey(method: AuthMethod): string {
  return `${method.provider}\0${method.name ?? method.kind}`;
}

export function systemPromptContributionKey(contribution: SystemPromptContribution): string {
  return contribution.id;
}
