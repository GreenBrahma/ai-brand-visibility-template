/**
 * Scorecard — the measured summary of a visibility run.
 *
 * Reports mean with range rather than a single number: the same prompt asked
 * three times can mention a brand twice and miss once, and a lone figure hides
 * that. Where a run produced only one pass, the range is suppressed rather than
 * shown as a misleading zero spread.
 */

type GroupStat = {
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
	rate: number;
	runs: number;
	perRun: { run: number; total: number; mentioned: number; rate: number }[];
	rateMin: number;
	rateMax: number;
	rateSpread: number;
	avgRank: number | null;
	shareOfVoice: number;
	byModel: GroupStat[];
	byCompetitor: {
		name: string;
		mentioned: number;
		rate: number;
		shareOfVoice: number;
	}[];
	errors: number;
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

function Stat({
	label,
	value,
	sub,
	muted,
}: {
	label: string;
	value: string;
	sub?: string;
	muted?: boolean;
}) {
	return (
		<div className="flex flex-col gap-1 p-4 bg-surface rounded-xl ring-1 ring-ring">
			<div className="text-[11px] uppercase tracking-[0.14em] text-brand">
				{label}
			</div>
			<div
				className={`text-2xl leading-none ${muted ? "text-neutral-500" : "text-neutral-900"}`}
			>
				{value}
			</div>
			{sub ? (
				<div className="text-[12px] text-neutral-500 leading-snug">{sub}</div>
			) : null}
		</div>
	);
}

function Bar({ value }: { value: number }) {
	return (
		<div className="h-1.5 w-full bg-neutral-200 rounded-full overflow-hidden">
			<div
				className="h-full bg-brand rounded-full"
				style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
			/>
		</div>
	);
}

export function Scorecard({
	summary,
	brandName,
}: {
	summary: Summary;
	brandName: string;
}) {
	if (!summary || !summary.total) return null;

	const multiRun = summary.runs > 1;
	const rangeNote = multiRun
		? `${pct(summary.rateMin)}–${pct(summary.rateMax)} across ${summary.runs} runs`
		: "single run — no range";

	return (
		<div className="flex flex-col gap-4">
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
				<Stat
					label="Mention rate"
					value={pct(summary.rate)}
					sub={rangeNote}
				/>
				<Stat
					label="Avg position"
					value={summary.avgRank ? `#${summary.avgRank.toFixed(1)}` : "—"}
					sub={
						summary.avgRank
							? "where the brand lands among named options"
							: "never named"
					}
					muted={!summary.avgRank}
				/>
				<Stat
					label="Share of voice"
					value={pct(summary.shareOfVoice)}
					sub="brand mentions vs all tracked names"
				/>
				<Stat
					label="Reproducibility"
					value={multiRun ? `±${pct(summary.rateSpread / 2)}` : "—"}
					sub={
						multiRun
							? summary.rateSpread > 0.2
								? "wide spread — treat the mean with caution"
								: "stable across repeat runs"
							: "needs more than one run"
					}
					muted={!multiRun}
				/>
			</div>

			{summary.errors > 0 ? (
				<div className="text-[12px] text-danger">
					{summary.errors} of {summary.total} calls failed and are counted as
					non-mentions. Check AI Gateway credits before reading these numbers.
				</div>
			) : null}

			<div className="grid lg:grid-cols-2 gap-3">
				<div className="p-4 bg-surface rounded-xl ring-1 ring-ring flex flex-col gap-3">
					<div className="text-[11px] uppercase tracking-[0.14em] text-brand">
						By model
					</div>
					{summary.byModel
						.slice()
						.sort((a, b) => b.rate - a.rate)
						.map((m) => (
							<div key={m.key} className="flex flex-col gap-1.5">
								<div className="flex items-baseline justify-between gap-3">
									<span className="text-[13px] text-neutral-800 truncate">
										{m.key}
									</span>
									<span className="text-[13px] text-neutral-600 tabular-nums shrink-0">
										{pct(m.rate)}
										{m.avgRank ? (
											<span className="text-neutral-400">
												{" "}
												· #{m.avgRank.toFixed(1)}
											</span>
										) : null}
									</span>
								</div>
								<Bar value={m.rate} />
							</div>
						))}
				</div>

				<div className="p-4 bg-surface rounded-xl ring-1 ring-ring flex flex-col gap-3">
					<div className="text-[11px] uppercase tracking-[0.14em] text-brand">
						Share of voice
					</div>
					{summary.byCompetitor.length === 0 ? (
						<div className="text-[12px] text-neutral-500">
							No competitors tracked. Add them in setup to measure rank and
							share of voice against a real field.
						</div>
					) : (
						<>
							<div className="flex flex-col gap-1.5">
								<div className="flex items-baseline justify-between gap-3">
									<span className="text-[13px] text-neutral-900 truncate">
										{brandName}
									</span>
									<span className="text-[13px] text-neutral-700 tabular-nums shrink-0">
										{pct(summary.shareOfVoice)}
									</span>
								</div>
								<Bar value={summary.shareOfVoice} />
							</div>
							{summary.byCompetitor.map((cmp) => (
								<div key={cmp.name} className="flex flex-col gap-1.5">
									<div className="flex items-baseline justify-between gap-3">
										<span className="text-[13px] text-neutral-600 truncate">
											{cmp.name}
										</span>
										<span className="text-[13px] text-neutral-500 tabular-nums shrink-0">
											{pct(cmp.shareOfVoice)}
										</span>
									</div>
									<div className="h-1.5 w-full bg-neutral-200 rounded-full overflow-hidden">
										<div
											className="h-full bg-neutral-400 rounded-full"
											style={{
												width: `${Math.max(0, Math.min(1, cmp.shareOfVoice)) * 100}%`,
											}}
										/>
									</div>
								</div>
							))}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
