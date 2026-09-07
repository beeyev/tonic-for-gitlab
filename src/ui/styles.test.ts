import { describe, expect, test } from "bun:test";

/**
 * Guards the one contrast rule that a palette edit can silently break.
 *
 * The switch carries its state in the thumb's position, so the thumb has to be
 * visible against its own track in both states, and the track against the popup
 * surface. The light map shipped below that floor once: a near-white thumb on a
 * near-white track measured 1.58:1, so the off switch read as a blank pill.
 * Nothing in the type system or in Biome can catch that, and it is invisible in
 * a diff that only moves a lightness value.
 *
 * The tokens are read out of the stylesheet rather than duplicated here, so this
 * fails when the real palette drifts instead of when a copy of it does.
 */

const STYLESHEET = await Bun.file(
	new URL("./tokens.css", import.meta.url),
).text();
const PREFERRED_DARK_STYLESHEET = await Bun.file(
	new URL("./tokens-preferred-dark.css", import.meta.url),
).text();

/** WCAG 1.4.11 non-text contrast, for a control and its state indicator. */
const NON_TEXT_CONTRAST_FLOOR = 3;

type Oklch = readonly [lightness: number, chroma: number, hue: number];

function parseOklch(value: string): Oklch {
	const match = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);

	if (!match) {
		throw new Error(`Not an oklch() color: ${value}`);
	}

	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Reads a custom property out of one token block. Both maps declare the same
 * names and both are keyed to a selector list rather than a single selector, so
 * the block is isolated by whether its selectors carry the dark state.
 */
function readToken(theme: "light" | "dark", property: string): Oklch {
	/*
	 * Comments are stripped before the blocks are split. The file's own header
	 * comment explains the dark state and would otherwise be read as part of the
	 * light block's selector text, which is one edit away from silently matching
	 * the wrong block and asserting a palette against itself.
	 */
	const blocks = [
		...STYLESHEET.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(
			/([^{}]+)\{([^{}]*)\}/g,
		),
	];
	const block = blocks.find(([, selectors]) => {
		const isDarkBlock = selectors.includes(DARK_STATE);
		return selectors.includes(":host") && isDarkBlock === (theme === "dark");
	});

	if (!block) {
		throw new Error(`Missing ${theme} token block`);
	}

	const declaration = block[2].match(new RegExp(`--${property}:\\s*([^;]+);`));

	if (!declaration) {
		throw new Error(`Missing --${property} in the ${theme} token block`);
	}

	return parseOklch(declaration[1].trim());
}

/** Standard OKLab to linear sRGB conversion (Ottosson). */
function toLinearSrgb([lightness, chroma, hue]: Oklch): [
	number,
	number,
	number,
] {
	const radians = (hue * Math.PI) / 180;
	const a = chroma * Math.cos(radians);
	const b = chroma * Math.sin(radians);
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

function relativeLuminance(color: Oklch): number {
	const [red, green, blue] = toLinearSrgb(color).map((channel) =>
		Math.min(1, Math.max(0, channel)),
	);

	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastOfLuminance(a: number, b: number): number {
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function contrastRatio(foreground: Oklch, background: Oklch): number {
	return contrastOfLuminance(
		relativeLuminance(foreground),
		relativeLuminance(background),
	);
}

/**
 * Luminance of a token painted at partial alpha over an opaque surface, which
 * is what a Tailwind `/10` or `/30` colour is. Compositing happens in the
 * gamma-encoded sRGB the browser paints in, not in OKLab.
 */
function overlaidLuminance(
	color: Oklch,
	surface: Oklch,
	alpha: number,
): number {
	const encode = (channel: number) => {
		const value = Math.min(1, Math.max(0, channel));

		return value <= 0.0031308
			? value * 12.92
			: 1.055 * value ** (1 / 2.4) - 0.055;
	};
	const decode = (channel: number) =>
		channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	const front = toLinearSrgb(color).map(encode);
	const back = toLinearSrgb(surface).map(encode);
	const [red, green, blue] = front.map((channel, index) =>
		decode(channel * alpha + (back[index] as number) * (1 - alpha)),
	);

	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

const DARK_STATE = 'data-tonic-theme="dark"';
const LIGHT = "light";
const DARK = "dark";

describe("control panel switch contrast", () => {
	/*
	 * The thumb token differs per theme and state because the switch overrides it
	 * in the dark map: light always paints the thumb with --background, dark uses
	 * --foreground when unchecked and --primary-foreground when checked.
	 */
	const cases = [
		{
			name: "light unchecked: thumb against track",
			a: readToken(LIGHT, "background"),
			b: readToken(LIGHT, "input"),
		},
		{
			name: "light unchecked: track against popup surface",
			a: readToken(LIGHT, "input"),
			b: readToken(LIGHT, "popover"),
		},
		{
			name: "light checked: thumb against track",
			a: readToken(LIGHT, "background"),
			b: readToken(LIGHT, "primary"),
		},
		{
			name: "light checked: track against popup surface",
			a: readToken(LIGHT, "primary"),
			b: readToken(LIGHT, "popover"),
		},
		/*
		 * The dark unchecked track against the popup surface is deliberately not
		 * asserted. It measures 1.72:1, but the state stays perceivable through
		 * the thumb below, which is what 1.4.11 asks for. Asserting it would also
		 * be wrong here: the dark switch paints that track at 80 percent opacity,
		 * so the raw token is not the rendered color.
		 */
		{
			name: "dark unchecked: thumb against track",
			a: readToken(DARK, "foreground"),
			b: readToken(DARK, "input"),
		},
		{
			name: "dark checked: thumb against track",
			a: readToken(DARK, "primary-foreground"),
			b: readToken(DARK, "primary"),
		},
		{
			name: "dark checked: track against popup surface",
			a: readToken(DARK, "primary"),
			b: readToken(DARK, "popover"),
		},
	];

	for (const { name, a, b } of cases) {
		test(`${name} stays at or above 3:1`, () => {
			expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(
				NON_TEXT_CONTRAST_FLOOR,
			);
		});
	}
});

/**
 * The toolbar action reports the current tab's control-surface state in a tinted
 * card: an accent glyph, a heading in `--foreground`, and supporting text in
 * `--muted-foreground`, over the tone at partial alpha. The tone is what
 * separates the working state from the failed one at a glance, so the accent and
 * both text weights have to survive every tint in both themes.
 *
 * The neutral tone is included because it carries five of the seven states:
 * loading, no active tab, a failed tab query, a non-Tonic page, and an invalid
 * response.
 */
describe("toolbar action status card contrast", () => {
	/** WCAG 1.4.3 contrast minimum, for body-size text. */
	const TEXT_CONTRAST_FLOOR = 4.5;
	/** Matches the `/10` accent tints and the `/60` neutral tint in `App.tsx`. */
	const TONES = [
		{ accent: "primary", tint: "primary", alpha: 0.1 },
		{ accent: "warning", tint: "warning", alpha: 0.1 },
		{ accent: "muted-foreground", tint: "muted", alpha: 0.6 },
	] as const;

	for (const theme of [LIGHT, DARK] as const) {
		const surface = readToken(theme, "background");
		const foreground = readToken(theme, "foreground");
		const mutedForeground = readToken(theme, "muted-foreground");

		for (const { accent, tint, alpha } of TONES) {
			const accentToken = readToken(theme, accent);
			const card = overlaidLuminance(readToken(theme, tint), surface, alpha);

			test(`${theme} ${tint} card keeps its glyph at or above 3:1`, () => {
				expect(
					contrastOfLuminance(relativeLuminance(accentToken), card),
				).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST_FLOOR);
			});

			test(`${theme} ${tint} card keeps both text weights at or above 4.5:1`, () => {
				expect(
					contrastOfLuminance(relativeLuminance(foreground), card),
				).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
				expect(
					contrastOfLuminance(relativeLuminance(mutedForeground), card),
				).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
			});
		}
	}
});

/**
 * The popup resolves its dark palette twice: from the OS preference in CSS, so
 * it is right before script runs, and from the explicit `data-tonic-theme` state
 * afterwards. CSS cannot share one declaration list between a selector and a
 * media query, so the map is written twice and held together here instead.
 */
describe("preferred-colour-scheme dark map", () => {
	function readDeclarations(stylesheet: string): string[] {
		const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
		const darkBlock = withoutComments
			.split("{")
			.at(-1)
			?.replace(/\}/g, "")
			.trim();

		return (darkBlock ?? "")
			.split(";")
			.map((declaration) => declaration.trim())
			.filter((declaration) => declaration.length > 0);
	}

	test("declares exactly what the explicit dark state declares", () => {
		const explicit = readDeclarations(
			STYLESHEET.slice(0, STYLESHEET.indexOf("@theme")),
		);
		const preferred = readDeclarations(PREFERRED_DARK_STYLESHEET);

		expect(preferred).toEqual(explicit);
		expect(preferred.length).toBeGreaterThan(0);
	});
});
