export function Header({ domain }: { domain?: string }) {
	return (
		<header className="sticky top-0 z-50 h-[58px] bg-surface border-b border-neutral-200 flex items-center px-4 sm:px-6">
			<div className="flex items-center gap-3 flex-1 min-w-0">
				{/* GreenBrahma mark */}
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="#5cb824"
					strokeWidth="1.6"
					className="shrink-0"
					aria-hidden="true"
				>
					<rect x="3" y="3" width="18" height="18" />
					<path d="M7 12 L11 12 M11 8 L11 16 M14 8 L17 8 L17 16 L14 16" />
				</svg>
				<span className="text-sm tracking-[0.14em] text-neutral-900">
					GREENBRAHMA
				</span>
				<div className="w-px h-6 bg-neutral-200 shrink-0" />
				<span className="text-sm text-neutral-700 truncate">
					AI Visibility
					{domain && (
						<span className="text-neutral-500 ml-1">· {domain}</span>
					)}
				</span>
			</div>
			<a
				href="https://greenbrahma.com"
				className="text-[12px] tracking-[0.1em] text-neutral-500 hover:text-neutral-900 shrink-0 ml-3"
			>
				GREENBRAHMA.COM &rarr;
			</a>
		</header>
	);
}
