import { describe, expect, test } from "bun:test";
import {
	applyShadowRootPropertyFallback,
	decodeBundledStylesheet,
} from "./bundled-stylesheet";

const MINIFIED_PROPERTIES_LAYER =
	"@layer properties{@supports (((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b)))){*,:before,:after,::backdrop{--tw-border-style:solid;--tw-shadow:0 0 #0000}}}";

const DEVELOPMENT_PROPERTIES_LAYER = `@layer properties;
@layer theme, base, components, utilities;
@layer properties {
  @supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) {
    *, ::before, ::after, ::backdrop {
      --tw-border-style: solid;
      --tw-shadow: 0 0 #0000;
    }
  }
}`;

function bundleAsBase64(stylesheet: string): string {
	return `data:text/css;base64,${btoa(stylesheet)}`;
}

function bundleAsUtf8(stylesheet: string): string {
	return `data:text/css;charset=utf-8,${encodeURIComponent(stylesheet)}`;
}

describe("bundled control-panel stylesheet", () => {
	test("decodes the Extension.js base64 CSS module without a network request", () => {
		const stylesheet = `${MINIFIED_PROPERTIES_LAYER}:host{content:"Tonic"}`;

		expect(decodeBundledStylesheet(bundleAsBase64(stylesheet))).toContain(
			':host{content:"Tonic"}',
		);
	});

	/*
	 * The shape Extension.js emits since 4.1.14. Reading it from the built
	 * bundle is what caught the regression that unit tests missed, so both
	 * encodings stay covered until the build is known to emit only one.
	 */
	test("decodes the percent-encoded CSS module the current bundler emits", () => {
		const stylesheet = `${MINIFIED_PROPERTIES_LAYER}:host{content:"Tonic, escaped"}`;

		expect(decodeBundledStylesheet(bundleAsUtf8(stylesheet))).toContain(
			':host{content:"Tonic, escaped"}',
		);
	});

	test("rejects an unexpected CSS module representation", () => {
		expect(() =>
			decodeBundledStylesheet("chrome-extension://example/control-panel.css"),
		).toThrow("Expected the bundled control-panel CSS as a data URL");
	});

	test("unwraps the minified @supports guard so --tw-* fallbacks apply in a ShadowRoot", () => {
		expect(
			applyShadowRootPropertyFallback(`${MINIFIED_PROPERTIES_LAYER}:host{}`),
		).toBe(
			"@layer properties{*,:before,:after,::backdrop{--tw-border-style:solid;--tw-shadow:0 0 #0000}}:host{}",
		);
	});

	test("unwraps the development build shape, ignoring the @layer properties statement", () => {
		const result = applyShadowRootPropertyFallback(
			DEVELOPMENT_PROPERTIES_LAYER,
		);

		expect(result).not.toContain("@supports");
		expect(result).toContain("--tw-border-style: solid");
		expect(result.startsWith("@layer properties;")).toBe(true);
	});

	test("preserves CSS before and after the properties layer", () => {
		const result = applyShadowRootPropertyFallback(
			`/*! tailwindcss */${MINIFIED_PROPERTIES_LAYER}@layer utilities{.p-1{padding:1px}}`,
		);

		expect(result.startsWith("/*! tailwindcss */@layer properties{")).toBe(
			true,
		);
		expect(result.endsWith("@layer utilities{.p-1{padding:1px}}")).toBe(true);
		expect(result).not.toContain("@supports");
	});

	test("fails loudly when Tailwind stops emitting the fallback layer", () => {
		expect(() => applyShadowRootPropertyFallback(":host{}")).toThrow(
			"Expected a Tailwind @layer properties block",
		);
	});

	test("fails loudly when the properties layer loses its @supports fallback", () => {
		expect(() =>
			applyShadowRootPropertyFallback("@layer properties{*{--tw-x:0}}"),
		).toThrow("Expected an @supports fallback");
	});
});
