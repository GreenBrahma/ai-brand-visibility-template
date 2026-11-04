/**
 * Queue consumer — processes individual model×prompt×run jobs via AI Gateway.
 * Each job writes its result to a separate KV key to avoid race conditions.
 *
 * Scoring is delegated to src/measure.ts so it can be unit-tested outside a Worker.
 */
import {
	RETENTION_DAYS,
	STORED_RESPONSE_CHARS,
	SYSTEM_PROMPT,
} from "../src/config";
import { analyzeResponse, type ScoredCitation } from "../src/measure";
import type { QueueJob } from "./api";

type Env = {
	AI: Ai;
	AEO_KV: KVNamespace;
};

export async function queueConsumer(
	batch: MessageBatch<QueueJob>,
	env: Env,
): Promise<void> {
	for (const msg of batch.messages) {
		const job = msg.body;
		try {
			const citation = await executeJob(env, job);
			const citeKey = `test:${job.testId}:cite:${crypto.randomUUID().slice(0, 8)}`;
			await env.AEO_KV.put(citeKey, JSON.stringify(citation), {
				expirationTtl: RETENTION_DAYS * 86400,
			});
			msg.ack();
		} catch (err) {
			console.error(`Job failed: ${err}`);
			msg.retry();
		}
	}
}

function emptyCitation(job: QueueJob, response: string, error: string): ScoredCitation {
	return {
		model: job.modelName,
		provider: job.provider,
		prompt: job.prompt,
		promptTag: job.promptTag,
		run: job.run,
		mentioned: false,
		rank: null,
		brandCount: 0,
		shareOfVoice: 0,
		competitors: (job.competitors ?? []).map((name) => ({
			name,
			matched: false,
			count: 0,
		})),
		excerpt: null,
		response,
		error,
	};
}

async function executeJob(env: Env, job: QueueJob): Promise<ScoredCitation> {
	try {
		const text = await callModel(env, job);

		const a = analyzeResponse({
			text,
			brandName: job.brandName,
			domain: job.domain,
			brandAliases: job.brandAliases ?? [],
			competitors: job.competitors ?? [],
		});

		return {
			model: job.modelName,
			provider: job.provider,
			prompt: job.prompt,
			promptTag: job.promptTag,
			run: job.run,
			mentioned: a.brand.matched,
			rank: a.rank,
			brandCount: a.brand.count,
			shareOfVoice: a.shareOfVoice,
			competitors: a.competitors.map((cmp) => ({
				name: cmp.name,
				matched: cmp.matched,
				count: cmp.count,
			})),
			excerpt: a.excerpt,
			response: text.slice(0, STORED_RESPONSE_CHARS),
			error: null,
		};
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		const isBillingError =
			/billing|credit|payment|insufficient|quota|budget/i.test(errMsg);
		const response = isBillingError
			? "Unified Billing credits required. Load credits at dash.cloudflare.com → AI Gateway → Billing."
			: `Error: ${errMsg}`;

		return emptyCitation(job, response, errMsg);
	}
}

/**
 * Universal model caller — all models go through env.AI.run() with AI Gateway.
 * Handles OpenAI/Anthropic (messages format) and Gemini (contents format).
 */
async function callModel(env: Env, job: QueueJob): Promise<string> {
	if (!env.AI) {
		throw new Error("AI binding not available");
	}

	let input: any;

	if (job.isGemini) {
		input = {
			contents: [
				{
					role: "user",
					parts: [{ text: `${SYSTEM_PROMPT}\n\n${job.prompt}` }],
				},
			],
			generationConfig: { maxOutputTokens: job.maxTokens },
		};
	} else if (job.isAnthropic) {
		input = {
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: job.prompt }],
			max_tokens: job.maxTokens,
		};
	} else {
		input = {
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: job.prompt },
			],
			max_tokens: job.maxTokens,
		};
	}

	const r = await env.AI.run(job.modelId as Parameters<Ai["run"]>[0], input, {
		gateway: { id: "default" },
	});

	return extractText(r);
}

/** Extract text from any AI response format */
function extractText(r: any): string {
	if (typeof r === "string") return r;
	if (!r || typeof r !== "object") return String(r);

	if ("response" in r && typeof r.response === "string") return r.response;

	if (r.choices && Array.isArray(r.choices)) {
		for (const choice of r.choices) {
			const msg = choice.message ?? choice.delta;
			if (msg?.content && typeof msg.content === "string") return msg.content;
			if (msg?.reasoning_content && typeof msg.reasoning_content === "string")
				return msg.reasoning_content;
		}
	}

	if (r.candidates && Array.isArray(r.candidates)) {
		const text = r.candidates[0]?.content?.parts?.[0]?.text;
		if (text) return text;
	}

	if (Array.isArray(r.content)) {
		const tb = r.content.find((b: any) => b.type === "text" && b.text);
		if (tb) return tb.text;
	}

	const s = JSON.stringify(r);
	const m = s.match(/"(?:content|text)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
	if (m) return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
	return s;
}
