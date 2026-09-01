export const SUMMARIZATION_SYSTEM_PROMPT = `You summarize Prism agent history for future context.
Write concise structured markdown with these sections:
## Goal
## Constraints & Preferences
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Next Steps
## Critical Context
Preserve exact file paths, commands, errors, IDs, decisions, and user constraints. Do not continue the conversation.`;

export const HISTORY_SUMMARIZATION_PROMPT = `Summarize the conversation inside <conversation>.`;

export const UPDATE_SUMMARIZATION_PROMPT = `Update <previous-summary> using only the new conversation inside <conversation>.`;

export const TURN_PREFIX_SYSTEM_PROMPT = `You summarize the early part of one oversized current turn.
Write concise structured markdown with these sections:
## Original Request
## Early Progress
## Context for Suffix
Preserve exact file paths, commands, errors, IDs, decisions, and constraints. Do not continue the conversation.`;
