/**
 * Measurement engine — GreenBrahma AI Visibility
 *
 * Replaces the template's `text.toLowerCase().includes(domain)` check.
 *
 * What it measures, per model response:
 *   1. Whether the brand is mentioned, matched on name + aliases + domain forms,
 *      not a raw substring. Boundary-aware, so "Brahma" does not match
 *      "Brahmaputra" and "go" does not match "going".
 *   2. How many times, with overlapping alias hits merged so
 *      "greenbrahma" inside "greenbrahma.com" counts once.
 *   3. Where — character index of the first mention, which gives rank.
 *   4. Rank among every tracked entity (brand + competitors) by first mention.
 *   5. Share of voice — brand mentions over all tracked-entity mentions.
 *
 * Every function here is pure so the scoring can be tested without a Worker.
 */

export type Mention = { start: number; end: number; alias: string };

export type EntityResult = {
	/** Canonical display name */
	name: string;
	matched: boolean;
	/** Distinct mentions, overlapping alias hits merged */
	count: number;
	/** Character index of first mention, -1 when absent */
	firstIndex: number;
	/** Which alias produced the first hit */
	matchedVia: string | null;
};

export type ResponseAnalysis = {
	brand: EntityResult;
	competitors: EntityResult[];
	/** 1-based position of the brand among matched entities, by first mention. null when absent. */
	rank: number | null;
	/** How many tracked entities appeared at all — the denominator rank is out of */
	fieldSize: number;
	/** brand.count / (all tracked mentions). 0 when nothing matched. */
	shareOfVoice: number;
	/** Text around the first brand mention, for auditing */
	excerpt: string | null;
};

const LEGAL_SUFFIX =
	/[,.]?\s+(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|s\.a|sa|bv|ag|pty|holdings|group)\.?$/i;

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip protocol, www, path — "https://www.foo.com/x" -> "foo.com" */
export function bareDomain(input: string): string {
	return input
		.trim()
		.replace(/^[a-z]+:\/\//i, "")
		.replace(/^www\./i, "")
		.split(/[/?#]/)[0]
		.toLowerCase();
}

/**
 * Build the alias set for one entity.
 * Aliases shorter than 3 characters are dropped unless supplied explicitly —
 * two-letter tokens generate too many false positives in prose.
 */
export function buildAliases(
	name: string,
	domain?: string,
	extra: string[] = [],
): string[] {
	const out = new Set<string>();
	const add = (v: string | undefined, minLen = 3) => {
		const t = (v ?? "").trim();
		if (t.length >= minLen) out.add(t);
	};

	add(name);
	add(name.replace(LEGAL_SUFFIX, ""));
	if (/\s/.test(name)) add(name.replace(/\s+/g, ""));
	if (/[-_]/.test(name)) add(name.replace(/[-_]+/g, " "));

	if (domain) {
		const bare = bareDomain(domain);
		add(bare);
		const stem = bare.split(".")[0];
		add(stem);
		if (/[-]/.test(stem)) add(stem.replace(/-+/g, " "));
	}

	// Explicit aliases bypass the length floor — the operator asked for them.
	for (const e of extra) add(e, 2);

	return [...out].filter(Boolean);
}

/**
 * Find every boundary-respecting occurrence of any alias, with overlaps merged.
 * Boundaries are alphanumeric-only, so a trailing "." in a domain still matches
 * and "greenbrahma" will not match inside "mygreenbrahmasite".
 */
export function findMentions(text: string, aliases: string[]): Mention[] {
	if (!text || !aliases.length) return [];
	const hits: Mention[] = [];

	for (const alias of aliases) {
		let re: RegExp;
		try {
			re = new RegExp(
				`(?<![A-Za-z0-9])${escapeRegex(alias)}(?![A-Za-z0-9])`,
				"gi",
			);
		} catch {
			continue;
		}
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			hits.push({ start: m.index, end: m.index + m[0].length, alias });
			if (m.index === re.lastIndex) re.lastIndex++;
		}
	}

	// Longest-first at each start so the merge keeps the widest span.
	hits.sort((a, b) => a.start - b.start || b.end - a.end);

	const merged: Mention[] = [];
	for (const h of hits) {
		const last = merged[merged.length - 1];
		if (last && h.start < last.end) {
			if (h.end > last.end) last.end = h.end;
			continue;
		}
		merged.push({ ...h });
	}
	return merged;
}

function scoreEntity(
	text: string,
	name: string,
	domain: string | undefined,
	extra: string[],
): EntityResult {
	const aliases = buildAliases(name, domain, extra);
	const hits = findMentions(text, aliases);
	return {
		name,
		matched: hits.length > 0,
		count: hits.length,
		firstIndex: hits.length ? hits[0].start : -1,
		matchedVia: hits.length ? hits[0].alias : null,
	};
}

export type AnalyzeInput = {
	text: string;
	brandName: string;
	domain?: string;
	brandAliases?: string[];
	/** Competitor names; a value that looks like a domain also yields its stem */
	competitors?: string[];
	excerptPad?: number;
};

export function analyzeResponse({
	text,
	brandName,
	domain,
	brandAliases = [],
	competitors = [],
	excerptPad = 160,
}: AnalyzeInput): ResponseAnalysis {
	const body = text ?? "";

	const brand = scoreEntity(body, brandName, domain, brandAliases);

	const comps = competitors
		.map((c) => c.trim())
		.filter(Boolean)
		.map((c) => {
			const looksLikeDomain = /\.[a-z]{2,}$/i.test(c);
			return scoreEntity(body, c, looksLikeDomain ? c : undefined, []);
		});

	// Rank by first appearance among everything that actually appeared.
	const appeared = [brand, ...comps].filter((e) => e.matched);
	appeared.sort((a, b) => a.firstIndex - b.firstIndex);
	const rank = brand.matched
		? appeared.findIndex((e) => e === brand) + 1
		: null;

	const totalMentions =
		brand.count + comps.reduce((sum, c) => sum + c.count, 0);
	const shareOfVoice = totalMentions > 0 ? brand.count / totalMentions : 0;

	let excerpt: string | null = null;
	if (brand.matched) {
		const i = brand.firstIndex;
		const end = i + (brand.matchedVia?.length ?? 0);
		excerpt =
			(i > excerptPad ? "…" : "") +
			body.slice(Math.max(0, i - excerptPad), Math.min(body.length, end + excerptPad)).trim() +
			(end + excerptPad < body.length ? "…" : "");
	}

	return {
		brand,
		competitors: comps,
		rank,
		fieldSize: appeared.length,
		shareOfVoice,
		excerpt,
	};
}

// ── Aggregation ────────────────────────────────────────────────────────────

export type ScoredCitation = {
	model: string;
	provider: string;
	prompt: string;
	promptTag?: string;
	/** 1-based repeat index — the same model+prompt is run several times */
	run: number;
	mentioned: boolean;
	rank: number | null;
	brandCount: number;
	shareOfVoice: number;
	competitors: { name: string; matched: boolean; count: number }[];
	excerpt: string | null;
	response: string;
	error?: string | null;
};

export type GroupStat = {
	key: string;
	provider?: string;
	total: number;
	mentioned: number;
	rate: number;
	avgRank: number | null;
	shareOfVoice: number;
};

export type Summary = {
	total: number;
	mentioned: number;
	/** Overall mention rate across every citation */
	rate: number;
	/** Distinct repeat runs completed */
	runs: number;
	/** Mention rate computed independently per run */
	perRun: { run: number; total: number; mentioned: number; rate: number }[];
	/** Spread of per-run rates — the reproducibility signal */
	rateMin: number;
	rateMax: number;
	rateSpread: number;
	avgRank: number | null;
	shareOfVoice: number;
	byModel: GroupStat[];
	byPrompt: GroupStat[];
	byCompetitor: {
		name: string;
		mentioned: number;
		rate: number;
		shareOfVoice: number;
	}[];
	errors: number;
};

function rollup(rows: ScoredCitation[], key: string, provider?: string): GroupStat {
	const total = rows.length;
	const hit = rows.filter((r) => r.mentioned);
	const ranks = hit.map((r) => r.rank).filter((r): r is number => r != null);
	const sov = rows.reduce((s, r) => s + r.shareOfVoice, 0);
	return {
		key,
		provider,
		total,
		mentioned: hit.length,
		rate: total ? hit.length / total : 0,
		avgRank: ranks.length
			? ranks.reduce((a, b) => a + b, 0) / ranks.length
			: null,
		shareOfVoice: total ? sov / total : 0,
	};
}

export function summarize(citations: ScoredCitation[]): Summary {
	const total = citations.length;
	const hit = citations.filter((c) => c.mentioned);
	const ranks = hit.map((c) => c.rank).filter((r): r is number => r != null);

	const runIds = [...new Set(citations.map((c) => c.run))].sort((a, b) => a - b);
	const perRun = runIds.map((run) => {
		const rows = citations.filter((c) => c.run === run);
		const m = rows.filter((r) => r.mentioned).length;
		return {
			run,
			total: rows.length,
			mentioned: m,
			rate: rows.length ? m / rows.length : 0,
		};
	});
	const rates = perRun.map((r) => r.rate);

	const models = [...new Set(citations.map((c) => c.model))];
	const prompts = [...new Set(citations.map((c) => c.prompt))];

	const compNames = [
		...new Set(citations.flatMap((c) => c.competitors.map((x) => x.name))),
	];
	const byCompetitor = compNames.map((name) => {
		let mentioned = 0;
		let compCount = 0;
		let brandCount = 0;
		for (const c of citations) {
			const e = c.competitors.find((x) => x.name === name);
			if (e?.matched) mentioned++;
			compCount += e?.count ?? 0;
			brandCount += c.brandCount;
		}
		const denom = compCount + brandCount;
		return {
			name,
			mentioned,
			rate: total ? mentioned / total : 0,
			shareOfVoice: denom > 0 ? compCount / denom : 0,
		};
	});

	return {
		total,
		mentioned: hit.length,
		rate: total ? hit.length / total : 0,
		runs: runIds.length,
		perRun,
		rateMin: rates.length ? Math.min(...rates) : 0,
		rateMax: rates.length ? Math.max(...rates) : 0,
		rateSpread: rates.length ? Math.max(...rates) - Math.min(...rates) : 0,
		avgRank: ranks.length
			? ranks.reduce((a, b) => a + b, 0) / ranks.length
			: null,
		shareOfVoice: total
			? citations.reduce((s, c) => s + c.shareOfVoice, 0) / total
			: 0,
		byModel: models.map((m) =>
			rollup(
				citations.filter((c) => c.model === m),
				m,
				citations.find((c) => c.model === m)?.provider,
			),
		),
		byPrompt: prompts.map((p) =>
			rollup(
				citations.filter((c) => c.prompt === p),
				p,
			),
		),
		byCompetitor: byCompetitor.sort((a, b) => b.shareOfVoice - a.shareOfVoice),
		errors: citations.filter((c) => c.error).length,
	};
}
