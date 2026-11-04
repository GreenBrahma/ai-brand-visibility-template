/**
 * Brand Visibility Tester — Configuration
 *
 * All models run through Cloudflare AI Gateway (Unified Billing).
 * Third-party models (OpenAI, Anthropic, Google) are billed via Unified Billing credits.
 * Workers AI models (@cf/ prefix) are billed via standard Workers AI pricing.
 * No external API keys required.
 */

export type ModelConfig = {
	/** Model ID — @cf/ for Workers AI, author/model for third-party via gateway */
	id: string;
	/** Display name */
	name: string;
	/** Provider label for badges */
	provider:
		| "openai"
		| "anthropic"
		| "google"
		| "meta"
		| "mistral"
		| "workers-ai";
	/** Max tokens to request */
	maxTokens?: number;
	/** Whether this is a Gemini model (different request/response format) */
	isGemini?: boolean;
	/** Whether this is an Anthropic model (no system role in messages) */
	isAnthropic?: boolean;
};

/**
 * All models — run via env.AI.run() with gateway: { id: "default" }
 * Third-party models use Unified Billing (no API keys).
 * Workers AI models use standard pricing.
 */
/**
 * Model IDs go stale. The upstream template shipped `anthropic/claude-sonnet-4`,
 * which the gateway now rejects outright ("Model deprecated"), silently turning
 * a fifth of every run into false non-mentions. These IDs are taken from
 * Cloudflare's current live catalog. When a run shows errors on one model,
 * check here first — the error text names its replacement.
 */
export const MODELS: ModelConfig[] = [
	{
		id: "openai/gpt-5.5",
		name: "GPT-5.5",
		provider: "openai",
		maxTokens: 800,
	},
	{
		id: "anthropic/claude-sonnet-4.6",
		name: "Claude Sonnet 4.6",
		provider: "anthropic",
		maxTokens: 800,
		isAnthropic: true,
	},
	{
		id: "google/gemini-3.8-flash",
		name: "Gemini 3.8 Flash",
		provider: "google",
		maxTokens: 800,
		isGemini: true,
	},
	{
		id: "@cf/zai-org/glm-5.2",
		name: "GLM 5.2",
		provider: "workers-ai",
		maxTokens: 800,
	},
	{
		id: "@cf/qwen/qwen3.8-27b",
		name: "Qwen3.8 27B",
		provider: "workers-ai",
		maxTokens: 800,
	},
];

/** Model used for AI prompt generation in /api/setup */
export const SETUP_MODEL = "openai/gpt-5.5";

export const RETENTION_DAYS = 30;

/**
 * Repeat runs per model×prompt pair.
 *
 * One run tells you nothing about reliability. Models are stochastic: the same
 * question can mention a brand on one pass and omit it on the next. Three runs
 * lets us report a range alongside the mean, which is the difference between a
 * measurement and an anecdote.
 */
export const RUNS_PER_PROMPT = 3;

/** Characters of each response retained for auditing. */
export const STORED_RESPONSE_CHARS = 2000;

/**
 * Neutral system prompt.
 *
 * The upstream template shipped: "…mention specific companies, products, and
 * websites by name when relevant. Include URLs when you know them." That
 * instruction inflates every mention rate it measures — it asks the model to do
 * the exact thing being scored, so the number says more about the harness than
 * about the brand's standing. We ask nothing, and measure what the model
 * volunteers on its own.
 */
export const SYSTEM_PROMPT =
	"You are a helpful assistant. Answer the user's question directly and concisely.";
