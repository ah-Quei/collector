import { type Tool } from '@openai/agents';
import type { Config } from '../../config/Config.js';
import type { SkillLoader } from '../SkillLoader.js';
import type { ImageInputRegistry } from '../ImageInputRegistry.js';
import { openCliTool } from './OpenCliTool.js';
import { fetchUrlTool } from './FetchUrlTool.js';
import { readImageTool } from './ReadImageTool.js';
import { readTextTool } from './ReadTextTool.js';
import { listDirectoryTool } from './ListDirectoryTool.js';
import { bashTool } from './BashTool.js';
import { getSkillDetailTool } from './GetSkillDetailTool.js';
import { submitOutputTool, type OutputCapture } from './SubmitOutputTool.js';

export function createTools(config: Config, skillLoader?: SkillLoader, imageInputRegistry?: ImageInputRegistry, outputCapture?: OutputCapture) {
    const skillEnv = config.getEnabledSkillEnv();
    const tools: Tool[] = [
        openCliTool(config.opencli, config.storage.dataDir, skillEnv),
        fetchUrlTool(config),
        readTextTool(config.storage.dataDir),
        listDirectoryTool(config.storage.dataDir),
        bashTool(config.storage.dataDir, skillEnv),
        getSkillDetailTool(skillLoader ?? null),
    ];

    if (config.llm.vision) {
        tools.push(readImageTool(config.storage.dataDir, imageInputRegistry));
    }

    if (outputCapture) {
        tools.push(submitOutputTool(outputCapture));
    }

    return tools;
}
