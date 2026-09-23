/**
 * MODEL CATALOG — pure configuration.
 *
 * Adding a model is a config task: append an entry here (or through the admin
 * dashboard, which writes overrides into storage). No application logic reads
 * a model id directly; everything goes through the registry + router.
 *
 * Fields
 *   model_id        provider-qualified id passed to the provider adapter
 *   provider        key into PROVIDERS below
 *   runtime         'hosted' | 'local'   (where inference happens)
 *   display_name    shown in the UI
 *   family          grouping label (Qwen, DeepSeek, Kimi, GLM …)
 *   capabilities    { text, vision, tools, reasoning, coding, longContext, json }
 *   context_length  tokens
 *   speed           1 (slow) … 5 (fastest)
 *   quality         1 … 5   (general answer quality)
 *   cost            1 (cheap) … 5 (expensive)
 *   tags            router hints: fast | smart | reasoning | coding | vision | general
 *   enabled         default enablement (admin can flip)
 */

export const PROVIDERS = {
  alibaba:    { id: 'alibaba',    name: 'Alibaba Cloud (Qwen)', adapter: 'puter', region: 'CN', docs: 'https://qwen.ai' },
  deepseek:   { id: 'deepseek',   name: 'DeepSeek',             adapter: 'puter', region: 'CN', docs: 'https://deepseek.com' },
  moonshot:   { id: 'moonshot',   name: 'Moonshot AI (Kimi)',   adapter: 'puter', region: 'CN', docs: 'https://moonshot.ai' },
  zai:        { id: 'zai',        name: 'Z.AI (GLM)',           adapter: 'puter', region: 'CN', docs: 'https://z.ai' },
  minimax:    { id: 'minimax',    name: 'MiniMax',              adapter: 'puter', region: 'CN', docs: 'https://minimax.io' },
  inclusion:  { id: 'inclusion',  name: 'InclusionAI (Ling)',   adapter: 'puter', region: 'CN', docs: 'https://inclusionai.github.io' },
  openweight: { id: 'openweight', name: 'Open Weights',         adapter: 'puter', region: 'Global' },
  selfhosted: { id: 'selfhosted', name: 'Self-hosted (Ollama / vLLM)', adapter: 'openai-compat', region: 'Local' }
};

const cap = o => ({
  text: true, vision: false, tools: false, reasoning: false,
  coding: false, longContext: false, json: true, ...o
});

export const MODEL_CATALOG = [
  /* ---------------------------------------------------------------- Qwen */
  {
    model_id: 'qwen/qwen3-max', provider: 'alibaba', runtime: 'hosted',
    display_name: 'Qwen3 Max', family: 'Qwen',
    description: 'Alibaba’s flagship general model. Strong all-round reasoning and writing.',
    capabilities: cap({ tools: true, coding: true, reasoning: true, longContext: true }),
    context_length: 256000, speed: 3, quality: 5, cost: 3,
    tags: ['general', 'smart', 'coding'], enabled: true
  },
  {
    model_id: 'qwen/qwen-flash', provider: 'alibaba', runtime: 'hosted',
    display_name: 'Qwen Flash', family: 'Qwen',
    description: 'Very low latency model for short questions and quick edits.',
    capabilities: cap({ tools: true }),
    context_length: 128000, speed: 5, quality: 3, cost: 1,
    tags: ['fast', 'general'], enabled: true
  },
  {
    model_id: 'qwen/qwen3-235b-a22b-thinking-2507', provider: 'alibaba', runtime: 'hosted',
    display_name: 'Qwen3 235B Thinking', family: 'Qwen',
    description: 'Deliberate step-by-step reasoning for maths, logic and analysis.',
    capabilities: cap({ reasoning: true, tools: true, coding: true, longContext: true }),
    context_length: 131072, speed: 2, quality: 5, cost: 3,
    tags: ['reasoning', 'smart'], enabled: true
  },
  {
    model_id: 'qwen/qwen3-coder-plus', provider: 'alibaba', runtime: 'hosted',
    display_name: 'Qwen3 Coder Plus', family: 'Qwen',
    description: 'Code generation, refactoring and repository-scale edits.',
    capabilities: cap({ coding: true, tools: true, longContext: true }),
    context_length: 1000000, speed: 3, quality: 5, cost: 3,
    tags: ['coding', 'smart'], enabled: true
  },
  {
    model_id: 'qwen/qwen3-vl-plus', provider: 'alibaba', runtime: 'hosted',
    display_name: 'Qwen3 VL Plus', family: 'Qwen',
    description: 'Multimodal: screenshots, charts, UI review, documents and OCR.',
    capabilities: cap({ vision: true, tools: true, longContext: true }),
    context_length: 262144, speed: 3, quality: 4, cost: 3,
    tags: ['vision', 'general'], enabled: true
  },
  {
    model_id: 'qwen/qwen3-next-80b-a3b-instruct', provider: 'alibaba', runtime: 'hosted',
    display_name: 'Qwen3 Next 80B', family: 'Qwen',
    description: 'Efficient MoE model balancing speed and depth.',
    capabilities: cap({ tools: true, coding: true, longContext: true }),
    context_length: 262144, speed: 4, quality: 4, cost: 2,
    tags: ['general', 'fast'], enabled: true
  },

  /* ------------------------------------------------------------ DeepSeek */
  {
    model_id: 'deepseek/deepseek-chat-v3.1', provider: 'deepseek', runtime: 'hosted',
    display_name: 'DeepSeek V3.1', family: 'DeepSeek',
    description: 'General assistant with strong technical writing and coding.',
    capabilities: cap({ tools: true, coding: true, longContext: true }),
    context_length: 163840, speed: 4, quality: 4, cost: 1,
    tags: ['general', 'coding'], enabled: true
  },
  {
    model_id: 'deepseek/deepseek-r1', provider: 'deepseek', runtime: 'hosted',
    display_name: 'DeepSeek R1', family: 'DeepSeek',
    description: 'Chain-of-thought reasoning specialist for hard problems.',
    capabilities: cap({ reasoning: true, coding: true, longContext: true }),
    context_length: 163840, speed: 2, quality: 5, cost: 2,
    tags: ['reasoning', 'smart'], enabled: true
  },
  {
    model_id: 'deepseek/deepseek-v3.2', provider: 'deepseek', runtime: 'hosted',
    display_name: 'DeepSeek V3.2', family: 'DeepSeek',
    description: 'Newer general-purpose DeepSeek with long-context support.',
    capabilities: cap({ tools: true, coding: true, reasoning: true, longContext: true }),
    context_length: 163840, speed: 3, quality: 5, cost: 2,
    tags: ['general', 'smart', 'coding'], enabled: true
  },

  /* ---------------------------------------------------------------- Kimi */
  {
    model_id: 'moonshotai/kimi-k2-0905', provider: 'moonshot', runtime: 'hosted',
    display_name: 'Kimi K2', family: 'Kimi',
    description: 'Agentic, tool-using model with a very large context window.',
    capabilities: cap({ tools: true, coding: true, longContext: true }),
    context_length: 262144, speed: 3, quality: 4, cost: 2,
    tags: ['general', 'coding', 'longdoc'], enabled: true
  },
  {
    model_id: 'moonshotai/kimi-k2-thinking', provider: 'moonshot', runtime: 'hosted',
    display_name: 'Kimi K2 Thinking', family: 'Kimi',
    description: 'Long-horizon reasoning and multi-step document analysis.',
    capabilities: cap({ reasoning: true, tools: true, coding: true, longContext: true }),
    context_length: 262144, speed: 2, quality: 5, cost: 3,
    tags: ['reasoning', 'longdoc', 'smart'], enabled: true
  },

  /* ----------------------------------------------------------------- GLM */
  {
    model_id: 'z-ai/glm-4.6', provider: 'zai', runtime: 'hosted',
    display_name: 'GLM 4.6', family: 'GLM',
    description: 'Balanced generalist with solid tool use and coding.',
    capabilities: cap({ tools: true, coding: true, reasoning: true, longContext: true }),
    context_length: 200000, speed: 3, quality: 4, cost: 2,
    tags: ['general', 'coding'], enabled: true
  },
  {
    model_id: 'z-ai/glm-4.5-air', provider: 'zai', runtime: 'hosted',
    display_name: 'GLM 4.5 Air', family: 'GLM',
    description: 'Lightweight, fast GLM for everyday questions.',
    capabilities: cap({ tools: true }),
    context_length: 131072, speed: 5, quality: 3, cost: 1,
    tags: ['fast', 'general'], enabled: true
  },
  {
    model_id: 'z-ai/glm-4.5v', provider: 'zai', runtime: 'hosted',
    display_name: 'GLM 4.5V', family: 'GLM',
    description: 'GLM vision model for images, diagrams and screenshots.',
    capabilities: cap({ vision: true, tools: true }),
    context_length: 65536, speed: 4, quality: 4, cost: 2,
    tags: ['vision'], enabled: true
  },

  /* ------------------------------------------------------------- MiniMax */
  {
    model_id: 'minimax/minimax-m2', provider: 'minimax', runtime: 'hosted',
    display_name: 'MiniMax M2', family: 'MiniMax',
    description: 'Agentic coding and tool-calling model.',
    capabilities: cap({ tools: true, coding: true, reasoning: true, longContext: true }),
    context_length: 204800, speed: 4, quality: 4, cost: 2,
    tags: ['coding', 'general'], enabled: true
  },

  /* ---------------------------------------------------------------- Ling */
  {
    model_id: 'inclusionai/ling-3.0-flash', provider: 'inclusion', runtime: 'hosted',
    display_name: 'Ling 3.0 Flash', family: 'Ling',
    description: 'Fast open MoE model for light tasks.',
    capabilities: cap({ tools: true }),
    context_length: 131072, speed: 5, quality: 3, cost: 1,
    tags: ['fast'], enabled: true
  },

  /* -------------------------------------------------------- open weights */
  {
    model_id: 'openai/gpt-oss-120b', provider: 'openweight', runtime: 'hosted',
    display_name: 'GPT-OSS 120B', family: 'GPT-OSS',
    description: 'Open-weight reasoning model, useful as a neutral fallback.',
    capabilities: cap({ tools: true, reasoning: true, coding: true }),
    context_length: 131072, speed: 4, quality: 4, cost: 1,
    tags: ['general', 'reasoning'], enabled: true
  },
  {
    model_id: 'google/gemma-3-27b-it', provider: 'openweight', runtime: 'hosted',
    display_name: 'Gemma 3 27B', family: 'Gemma',
    description: 'Compact open-weight model with basic image understanding.',
    capabilities: cap({ vision: true }),
    context_length: 96000, speed: 4, quality: 3, cost: 1,
    tags: ['fast', 'vision'], enabled: true
  },
  {
    model_id: 'qwen/qwen3-32b', provider: 'openweight', runtime: 'hosted',
    display_name: 'Qwen3 32B (open weights)', family: 'Qwen',
    description: 'Self-hostable Qwen3 checkpoint, served here for parity testing.',
    capabilities: cap({ tools: true, coding: true }),
    context_length: 131072, speed: 4, quality: 3, cost: 1,
    tags: ['general', 'fast'], enabled: false
  }
];

/** Utility model roles — small jobs that shouldn't burn the main model. */
export const UTILITY_MODELS = {
  titler:   ['qwen/qwen-flash', 'z-ai/glm-4.5-air', 'deepseek/deepseek-chat-v3.1'],
  router:   ['qwen/qwen-flash', 'z-ai/glm-4.5-air'],
  memory:   ['qwen/qwen-flash', 'z-ai/glm-4.5-air'],
  summarize:['deepseek/deepseek-chat-v3.1', 'qwen/qwen3-next-80b-a3b-instruct']
};
