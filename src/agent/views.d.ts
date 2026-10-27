import type { Agent, SkillInfo, ToolInfo } from "../contracts.js";
/** Tools after `disable`, each with the package that registered it (`host` for the host's own). */
export declare function toolInfos(agent: Agent): readonly ToolInfo[];
/** Skills after `disable`, each with the package that registered it (`host` for the host's own). */
export declare function skillInfos(agent: Agent): readonly SkillInfo[];
