/**
 * Checks for a newer plugin among this repository's releases on GitHub (OpenPres-SD): stable
 * ones (0.8.0), and betas (0.8.0.2 beta) when the server follows the beta program. Asked when
 * the plugin starts, then once a day. A plugin that isn't from a release (built by hand)
 * doesn't ask.
 */

const RELEASES = process.env.OPENPRES_UPDATE_URL || "https://api.github.com/repos/NathanDSanta/OpenPres-SD/releases?per_page=30";
const DAY = 24 * 60 * 60 * 1000;
/** The version in the repository's manifest: releases write theirs before packing. */
const TEST_BUILD = "0.1.0";

export interface UpdateInfo {
	/** This plugin's version ("0.7.0", or "0.7.0.3 beta"). */
	current: string;
	/** Betas are offered too (the server follows the beta program). */
	beta: boolean;
	/** Not from a release: it doesn't check. */
	test_build: boolean;
	/** A newer version, and where to get it. */
	latest: string | null;
	url: string | null;
	checked_at_ms: number | null;
	error: string;
}

/** "0.7.0", "v0.7.0.3-beta", "0.7.0.3 beta" -> [0, 7, 0, 3] (a stable one has 0 betas). */
function parts(version: string): number[] | null {
	const m = /^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
	return m ? [...m.slice(1, 4).map(Number), Number(m[4] ?? 0)] : null;
}

/** 0.7.0 < 0.7.0.3 beta < 0.7.1 < 0.7.1.1 beta < 0.8.0 */
export function isNewer(version: string, than: string): boolean {
	const a = parts(version);
	const b = parts(than);
	if (!a || !b) return false;
	for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

/** "0.7.0.0" -> "0.7.0"; "0.7.0.3" -> "0.7.0.3 beta". */
export function displayVersion(version: string): string {
	const p = parts(version);
	if (!p) return version;
	return p[3] ? `${p.join(".")} beta` : p.slice(0, 3).join(".");
}

type Release = { tag_name?: string; html_url?: string; prerelease?: boolean; draft?: boolean; assets?: { name?: string; browser_download_url?: string }[] };

export class UpdateCheck {
	info: UpdateInfo;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private pluginVersion: string,
		private onChange: () => void,
		/** Whether the server follows the beta program. */
		private beta: () => boolean = () => false,
	) {
		// Stream Deck versions have four parts: "0.7.0.0", or "0.7.0.3" for a beta.
		const current = displayVersion(pluginVersion);
		this.info = { current, beta: false, test_build: current === TEST_BUILD, latest: null, url: null, checked_at_ms: null, error: "" };
	}

	/** The server joined or left the beta program: look again. */
	follow(beta: boolean) {
		if (this.timer && beta !== this.info.beta) void this.check();
	}

	start() {
		if (this.info.test_build || this.timer) return;
		void this.check();
		this.timer = setInterval(() => void this.check(), DAY);
		this.timer.unref?.();
	}

	async check(): Promise<void> {
		try {
			const res = await fetch(RELEASES, { headers: { accept: "application/vnd.github+json", "user-agent": "openpres-streamdeck" }, signal: AbortSignal.timeout(15_000) });
			if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
			const beta = this.beta();
			// The newest one with a plugin: betas only for the beta program.
			const releases = ((await res.json()) as Release[]).filter((r) => !r.draft && (beta || !r.prerelease) && parts(r.tag_name ?? "") && r.assets?.some((a) => a.name?.endsWith(".streamDeckPlugin")));
			const release = releases.reduce<Release | null>((best, r) => (!best || isNewer(r.tag_name ?? "", best.tag_name ?? "") ? r : best), null);
			const asset = release?.assets?.find((a) => a.name?.endsWith(".streamDeckPlugin"));
			const newer = !!release && !!asset && isNewer(release.tag_name ?? "", this.pluginVersion);
			Object.assign(this.info, {
				beta,
				latest: newer ? displayVersion(release!.tag_name!.replace(/^v/, "").replace(/-beta$/, "")) : null,
				url: newer ? (asset?.browser_download_url ?? release?.html_url ?? null) : null,
				checked_at_ms: Date.now(),
				error: "",
			});
		} catch (e) {
			this.info.error = e instanceof Error ? e.message : String(e);
		}
		this.onChange();
	}
}
