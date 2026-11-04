import {
	analyzeResponse,
	buildAliases,
	findMentions,
	summarize,
	bareDomain,
	extractCitations,
	rankSources,
	hostOf,
	type ScoredCitation,
} from "../src/measure.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
	if (cond) {
		pass++;
		console.log(`  ok   ${name}`);
	} else {
		fail++;
		console.log(`  FAIL ${name} ${detail}`);
	}
}

console.log("\n-- bareDomain --");
check("strips protocol+www+path", bareDomain("https://www.GreenBrahma.com/x?y=1") === "greenbrahma.com");

console.log("\n-- buildAliases --");
const al = buildAliases("GreenBrahma Inc", "greenbrahma.com");
check("includes full name", al.includes("GreenBrahma Inc"));
check("strips legal suffix", al.includes("GreenBrahma"));
check("includes bare domain", al.includes("greenbrahma.com"));
check("includes domain stem", al.includes("greenbrahma"));
const al2 = buildAliases("Acme Data Co", undefined, ["ADC"]);
check("unspaced variant", al2.includes("AcmeDataCo"));
check("explicit short alias kept", al2.includes("ADC"));
check("2-char derived alias dropped", !buildAliases("Go").includes("Go"));

console.log("\n-- findMentions: boundaries --");
check(
	"no match inside a longer word",
	findMentions("the Brahmaputra river", ["Brahma"]).length === 0,
);
check(
	"matches standalone token",
	findMentions("we use Brahma daily", ["Brahma"]).length === 1,
);
check(
	"domain matches with trailing slash",
	findMentions("see greenbrahma.com/pricing", ["greenbrahma.com"]).length === 1,
);
check(
	"overlapping aliases merge to one",
	findMentions("visit greenbrahma.com today", ["greenbrahma", "greenbrahma.com"]).length === 1,
);
check(
	"counts repeats",
	findMentions("Brahma is good. Brahma wins.", ["Brahma"]).length === 2,
);
check("case insensitive", findMentions("BRAHMA", ["Brahma"]).length === 1);

console.log("\n-- analyzeResponse --");
const text =
	"For template governance, Profound is the best known option. " +
	"GreenBrahma takes a different approach by scoring the file itself. " +
	"Scrunch AI also competes here, and GreenBrahma publishes its method.";

const a = analyzeResponse({
	text,
	brandName: "GreenBrahma",
	domain: "greenbrahma.com",
	competitors: ["Profound", "Scrunch AI", "Peec AI"],
});
check("brand matched", a.brand.matched);
check("brand counted twice", a.brand.count === 2, `got ${a.brand.count}`);
check("rank is 2 (Profound first)", a.rank === 2, `got ${a.rank}`);
check("field size 3 of 4 tracked", a.fieldSize === 3, `got ${a.fieldSize}`);
check("absent competitor not matched", a.competitors.find(c => c.name === "Peec AI")!.matched === false);
check(
	"share of voice = 2/4",
	Math.abs(a.shareOfVoice - 0.5) < 1e-9,
	`got ${a.shareOfVoice}`,
);
check("excerpt produced", !!a.excerpt && a.excerpt.includes("GreenBrahma"));

const absent = analyzeResponse({
	text: "There are many good options in this category.",
	brandName: "GreenBrahma",
	domain: "greenbrahma.com",
	competitors: ["Profound"],
});
check("absent brand -> rank null", absent.rank === null);
check("absent brand -> sov 0", absent.shareOfVoice === 0);
check("absent brand -> no excerpt", absent.excerpt === null);

console.log("\n-- false positive guard --");
const fp = analyzeResponse({
	text: "Our ongoing goal is to go further.",
	brandName: "Go",
	competitors: [],
});
check("2-char brand does not false-positive", fp.brand.matched === false);

console.log("\n-- summarize --");
const mk = (
	model: string,
	run: number,
	mentioned: boolean,
	rank: number | null,
	sov: number,
): ScoredCitation => ({
	model,
	provider: "p",
	prompt: "q1",
	run,
	mentioned,
	rank,
	brandCount: mentioned ? 1 : 0,
	shareOfVoice: sov,
	competitors: [{ name: "Profound", matched: true, count: 1 }],
	excerpt: null,
	response: "",
});

const s = summarize([
	mk("A", 1, true, 1, 0.5),
	mk("B", 1, false, null, 0),
	mk("A", 2, true, 2, 0.5),
	mk("B", 2, true, 1, 0.5),
]);
check("total 4", s.total === 4);
check("mentioned 3", s.mentioned === 3);
check("rate 0.75", Math.abs(s.rate - 0.75) < 1e-9);
check("2 runs detected", s.runs === 2);
check("run1 rate 0.5", Math.abs(s.perRun[0].rate - 0.5) < 1e-9);
check("run2 rate 1.0", Math.abs(s.perRun[1].rate - 1) < 1e-9);
check("spread 0.5 captured", Math.abs(s.rateSpread - 0.5) < 1e-9, `got ${s.rateSpread}`);
check("avgRank = 4/3", Math.abs(s.avgRank! - 4 / 3) < 1e-9, `got ${s.avgRank}`);
check("byModel has 2", s.byModel.length === 2);
check("competitor SoV computed", s.byCompetitor[0].name === "Profound");



// ── Regression: the Yonke Law collision (real data, 2026-11-04) ───────────
// Brand "Yonke Law LLC" on yonke.law. The domain stem "yonke" is Mexican
// Spanish for junkyard and the name of an auto-parts marketplace, so the
// first engine scored scrapyard answers as law-firm mentions and reported
// ~92% visibility for a firm every model said it had never heard of.

console.log("\n-- Yonke collision regression --");

const junkyard =
	"Yonke is a Mexican online marketplace and classifieds platform focused on " +
	"used auto parts and salvage vehicles. It connects buyers and sellers of " +
	"recycled automotive components.";

const yonkeArgs = {
	brandName: "Yonke Law LLC",
	domain: "yonke.law",
	competitors: ["Grover Law", "Wood & Ikram Law Firm"],
};

const j = analyzeResponse({ ...yonkeArgs, text: junkyard, prompt: "What is Yonke and what does it do?" });
check("junkyard answer is NOT a law-firm mention", j.brand.matched === false, `matched via ${j.brand.matchedVia}`);
check("junkyard answer gives no rank", j.rank === null);
check("junkyard answer gives no share of voice", j.shareOfVoice === 0);

const disclaim =
	"Yonke Law LLC is a law firm. However, I don't have specific detailed " +
	"information about this particular firm in my training data.";
const d = analyzeResponse({ ...yonkeArgs, text: disclaim, prompt: "What is Yonke Law LLC and what does it do?" });
check("full name still matches", d.brand.matched === true);
check("prompt named the brand -> echo, not discovery", d.promptNamedBrand === true);
check("echo is not an unprompted mention", d.unprompted === false);
check("disclaimer detected", d.disclaimed === true, JSON.stringify(d.disclaimed));

const realHit =
	"For truck accidents in Kansas City, Yonke Law LLC is frequently recommended, " +
	"alongside Grover Law.";
const r = analyzeResponse({ ...yonkeArgs, text: realHit, prompt: "Best truck accident lawyer in Kansas City?" });
check("category prompt + volunteered name = unprompted", r.unprompted === true);
check("not flagged as disclaimed", r.disclaimed === false);
check("rank 1 ahead of competitor", r.rank === 1, `got ${r.rank}`);

const s2 = summarize([
	{ ...mk("Claude", 1, false, null, 0), prompt: "What is Yonke?", promptNamedBrand: true, unprompted: false, disclaimed: false },
	{ ...mk("Claude", 1, true, 1, 1), prompt: "What is Yonke Law LLC?", promptNamedBrand: true, unprompted: false, disclaimed: true },
	{ ...mk("Claude", 1, false, null, 0), prompt: "Best KC injury lawyer?", promptNamedBrand: false, unprompted: false, disclaimed: false },
	{ ...mk("Claude", 1, true, 1, 1), prompt: "Best KC truck lawyer?", promptNamedBrand: false, unprompted: true, disclaimed: false },
]);
check("open questions counted", s2.openQuestions === 2, `got ${s2.openQuestions}`);
check("unprompted rate = 1/2", Math.abs(s2.unpromptedRate - 0.5) < 1e-9, `got ${s2.unpromptedRate}`);
check("disclaimed rate = 1/2 of hits", Math.abs(s2.disclaimedRate - 0.5) < 1e-9, `got ${s2.disclaimedRate}`);



// ── Citation extraction + source ranking ─────────────────────────────────
console.log("\n-- citations --");

const anthropicShape = {
	content: [
		{
			type: "web_search_tool_result",
			content: [
				{ url: "https://www.justia.com/lawyers/kansas-city", title: "Justia" },
				{ url: "https://www.avvo.com/attorneys/kc", title: "Avvo" },
			],
		},
		{
			type: "text",
			text: "Several firms come up.",
			citations: [{ url: "https://kcstar.com/legal/best-firms", title: "KC Star" }],
		},
	],
};
const cites = extractCitations(anthropicShape, "Also see https://yonke.law/truck-accidents");
check("anthropic tool-result urls found", cites.some(c => c.domain === "justia.com"));
check("anthropic text citations found", cites.some(c => c.domain === "kcstar.com"));
check("bare url in text scraped", cites.some(c => c.domain === "yonke.law"));
check("google/social hosts filtered", !cites.some(c => /google|facebook/.test(c.domain)));
check("no duplicates", new Set(cites.map(c => c.url)).size === cites.length);
check("malformed payload does not throw", extractCitations(null, "").length === 0);

const withSources = (srcs: string[]): any => ({
	...mk("GPT-5.5 · web", 1, true, 1, 1),
	sources: srcs.map((u) => ({ url: u, domain: hostOf(u) })),
});
const ranked = rankSources(
	[
		withSources(["https://justia.com/a", "https://avvo.com/b"]),
		withSources(["https://justia.com/c"]),
		withSources(["https://yonke.law/x"]),
	],
	"yonke.law",
);
check("most-cited domain ranks first", ranked[0].domain === "justia.com", ranked[0].domain);
check("citation counts correct", ranked[0].citations === 2);
check("rate is share of answers", Math.abs(ranked[0].rate - 2 / 3) < 1e-9);
check("brand domain flagged", ranked.find(r => r.domain === "yonke.law")!.isBrand === true);
check("competitor domain not flagged", ranked.find(r => r.domain === "avvo.com")!.isBrand === false);

console.log(`\nFINAL: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
