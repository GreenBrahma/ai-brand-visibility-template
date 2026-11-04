import {
	analyzeResponse,
	buildAliases,
	findMentions,
	summarize,
	bareDomain,
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
