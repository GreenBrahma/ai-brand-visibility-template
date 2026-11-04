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
	/** The question itself named the brand, so a mention proves nothing */
	promptNamedBrand: boolean;
	/** Named without being asked about — the metric that actually matters */
	unprompted: boolean;
	/** The model named the brand only to say it knows nothing about it */
	disclaimed: boolean;
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

	const stripped = name.replace(LEGAL_SUFFIX, "").trim();

	add(name);
	add(stripped);
	if (/\s/.test(name)) add(name.replace(/\s+/g, ""));
	if (/[-_]/.test(name)) add(name.replace(/[-_]+/g, " "));

	if (domain) {
		const bare = bareDomain(domain);
		add(bare);

		/**
		 * The bare domain stem is only safe as an alias when the brand name is
		 * itself a single word.
		 *
		 * Yonke Law LLC on yonke.law taught us this: the stem "yonke" is Mexican
		 * Spanish for junkyard and the name of an unrelated auto-parts
		 * marketplace, so every answer about scrapyards scored as a mention of
		 * the law firm and the tool reported 92% visibility for a firm the model
		 * had never heard of. A multi-word brand must match on its multi-word
		 * form. Operators who genuinely go by the short name can add it to
		 * `aliases` explicitly.
		 */
		const stem = bare.split(".")[0];
		const nameWords = stripped.split(/\s+/).filter(Boolean);
		if (nameWords.length <= 1) {
			add(stem);
			if (/[-]/.test(stem)) add(stem.replace(/-+/g, " "));
		}
	}

	// Explicit aliases bypass both the length floor and the single-word rule.
	for (const e of extra) add(e, 2);

	return [...out].filter(Boolean);
}

/**
 * Phrases a model uses to say it has no knowledge of the subject.
 * A response that names the brand only to disclaim it is not visibility.
 */
const DISCLAIMER =
	/\b(?:don'?t|do not|cannot|can'?t|unable to)\s+(?:have|find|provide|give|offer|recall)\b[^.]{0,80}\b(?:specific|detailed|verified|reliable|any|much|enough)?\s*(?:information|details|data|knowledge|record)\b|not\s+(?:in|within)\s+my\s+(?:training\s+data|knowledge\s+base)|(?:i'?m|i am)\s+not\s+familiar\s+with|no\s+(?:specific|verified|reliable)\s+information\s+about|don'?t\s+have\s+(?:specific|detailed|verified|reliable)\b/i;

export function looksDisclaimed(text: string): boolean {
	return DISCLAIMER.test(text ?? "");
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
	/** The question that produced this text — used to tell echo from discovery */
	prompt?: string;
	excerptPad?: number;
};

export function analyzeResponse({
	text,
	brandName,
	domain,
	brandAliases = [],
	competitors = [],
	prompt = "",
	excerptPad = 160,
}: AnalyzeInput): ResponseAnalysis {
	const body = text ?? "";

	const brand = scoreEntity(body, brandName, domain, brandAliases);

	/**
	 * If the question already named the brand, the model repeating it back is
	 * not evidence of anything. Real visibility is the model volunteering the
	 * name when it was not given one.
	 */
	const aliases = buildAliases(brandName, domain, brandAliases);
	const promptNamedBrand = findMentions(prompt, aliases).length > 0;
	const disclaimed = looksDisclaimed(body);

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
		promptNamedBrand,
		unprompted: brand.matched && !promptNamedBrand,
		disclaimed: brand.matched && disclaimed,
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
	promptNamedBrand?: boolean;
	unprompted?: boolean;
	disclaimed?: boolean;
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
	/** Citations whose prompt did NOT name the brand */
	openQuestions: number;
	/** Of those, how many volunteered the brand. The headline number. */
	unpromptedMentions: number;
	unpromptedRate: number;
	/** Mentions where the model named the brand only to disclaim knowledge of it */
	disclaimedMentions: number;
	disclaimedRate: number;
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

	const open = citations.filter((c) => !c.promptNamedBrand);
	const openHits = open.filter((c) => c.mentioned);
	const disclaimedHits = hit.filter((c) => c.disclaimed);

	return {
		total,
		mentioned: hit.length,
		rate: total ? hit.length / total : 0,
		openQuestions: open.length,
		unpromptedMentions: openHits.length,
		unpromptedRate: open.length ? openHits.length / open.length : 0,
		disclaimedMentions: disclaimedHits.length,
		disclaimedRate: hit.length ? disclaimedHits.length / hit.length : 0,
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
