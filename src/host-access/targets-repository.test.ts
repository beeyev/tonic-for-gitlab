import { beforeEach, describe, expect, test } from "bun:test";
import { fakeBrowser } from "@webext-core/fake-browser";
import {
	createTargetsRepository,
	NewerTargetsSchemaError,
	resolveTargets,
	TARGETS_STORAGE_KEY,
} from "./targets-repository";

beforeEach(() => {
	fakeBrowser.reset();
});

function createRepository(onDropped: (dropped: unknown[]) => void = () => {}) {
	return createTargetsRepository(fakeBrowser.storage.local, onDropped);
}

describe("targets resolution", () => {
	test("uses an empty list when nothing is stored", () => {
		expect(resolveTargets(undefined)).toEqual({
			outcome: "default",
			targets: { schemaVersion: 1, origins: [] },
			droppedOrigins: [],
		});
	});

	test("keeps stored origins in order", () => {
		expect(
			resolveTargets({
				schemaVersion: 1,
				origins: ["https://gitlab.example.com", "http://localhost:10019"],
			}),
		).toEqual({
			outcome: "stored",
			targets: {
				schemaVersion: 1,
				origins: ["https://gitlab.example.com", "http://localhost:10019"],
			},
			droppedOrigins: [],
		});
	});

	/*
	 * Deliberately unlike the settings reset policy: entries are independent, so
	 * one unusable origin must not take every other configured instance with it.
	 */
	test("drops only the unusable entries and keeps the rest", () => {
		expect(
			resolveTargets({
				schemaVersion: 1,
				origins: [
					"https://gitlab.example.com",
					"gitlab.example.org",
					42,
					"https://gitlab.example.com",
				],
			}),
		).toEqual({
			outcome: "stored",
			targets: {
				schemaVersion: 1,
				origins: ["https://gitlab.example.com"],
			},
			droppedOrigins: ["gitlab.example.org", 42, "https://gitlab.example.com"],
		});
	});

	/*
	 * The built-in host scope already has the manifest's static content script.
	 * Registering a second one for another HTTPS port would run both copies.
	 */
	test("drops every origin covered by the built-in GitLab.com scope", () => {
		expect(
			resolveTargets({
				schemaVersion: 1,
				origins: [
					"https://gitlab.com",
					"https://gitlab.com:8443",
					"http://gitlab.com",
					"https://gitlab.example.com",
				],
			}),
		).toEqual({
			outcome: "stored",
			targets: {
				schemaVersion: 1,
				origins: ["http://gitlab.com", "https://gitlab.example.com"],
			},
			droppedOrigins: ["https://gitlab.com", "https://gitlab.com:8443"],
		});
	});

	test("resets an unusable container and defers to a newer schema", () => {
		expect(resolveTargets({ schemaVersion: 1, origins: "nope" }).outcome).toBe(
			"reset",
		);
		expect(resolveTargets("nope").outcome).toBe("reset");
		expect(resolveTargets({ schemaVersion: 2, origins: [] })).toEqual({
			outcome: "newer-schema",
			targets: { schemaVersion: 1, origins: [] },
			droppedOrigins: [],
		});
	});
});

describe("targets repository", () => {
	test("adds, ignores a repeat add, and removes", async () => {
		const repository = createRepository();

		expect(await repository.add("https://gitlab.example.com")).toEqual({
			schemaVersion: 1,
			origins: ["https://gitlab.example.com"],
		});
		expect(await repository.add("https://gitlab.example.com")).toEqual({
			schemaVersion: 1,
			origins: ["https://gitlab.example.com"],
		});
		expect(await repository.add("http://localhost:10019")).toEqual({
			schemaVersion: 1,
			origins: ["https://gitlab.example.com", "http://localhost:10019"],
		});
		expect(await repository.remove("https://gitlab.example.com")).toEqual({
			schemaVersion: 1,
			origins: ["http://localhost:10019"],
		});
		expect((await repository.read()).targets).toEqual({
			schemaVersion: 1,
			origins: ["http://localhost:10019"],
		});
	});

	/*
	 * Two adds that both read before either writes would otherwise lose the
	 * first origin, which is a permission the user granted and can no longer see.
	 */
	test("serializes overlapping writes", async () => {
		const repository = createRepository();
		const [, second] = await Promise.all([
			repository.add("https://a.example.com"),
			repository.add("https://b.example.com"),
		]);

		expect(second.origins).toEqual([
			"https://a.example.com",
			"https://b.example.com",
		]);
	});

	test("refuses to write over a newer schema instead of downgrading it", async () => {
		await fakeBrowser.storage.local.set({
			[TARGETS_STORAGE_KEY]: { schemaVersion: 2, origins: [], extra: true },
		});
		const repository = createRepository();

		expect(repository.add("https://gitlab.example.com")).rejects.toThrow(
			NewerTargetsSchemaError,
		);
		expect(
			(await fakeBrowser.storage.local.get(TARGETS_STORAGE_KEY))[
				TARGETS_STORAGE_KEY
			],
		).toEqual({ schemaVersion: 2, origins: [], extra: true });
	});

	test("a rejected write does not stall later ones", async () => {
		const repository = createTargetsRepository({
			async get() {
				throw new Error("storage unavailable");
			},
			async set() {},
		});

		expect(repository.add("https://a.example.com")).rejects.toThrow(
			"storage unavailable",
		);
		expect(repository.add("https://b.example.com")).rejects.toThrow(
			"storage unavailable",
		);
	});

	test("reports dropped entries so a lost instance is not silent", async () => {
		await fakeBrowser.storage.local.set({
			[TARGETS_STORAGE_KEY]: { schemaVersion: 1, origins: ["not-an-origin"] },
		});
		const dropped: unknown[][] = [];
		const repository = createRepository((entries) => dropped.push(entries));

		expect((await repository.read()).targets).toEqual({
			schemaVersion: 1,
			origins: [],
		});
		expect(dropped).toEqual([["not-an-origin"]]);
	});
});
