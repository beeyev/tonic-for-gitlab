import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { SUPPORTED_GITLAB_MAJORS } from "./gitlab-dom";

/*
 * `SUPPORTED_GITLAB_MAJORS` claims to be the single list, but nothing made the
 * fixture tree and the lab agree with it, and the two halves are edited months
 * apart by whoever adds a major. These assertions are that agreement.
 *
 * The lab half exists for one failure in particular: a new instance that is
 * missing from the seeder's `depends_on` is not gated on its own health, so the
 * seeder runs against a GitLab that is still booting and the run fails as if
 * seeding were broken.
 */

const fixtureRoot = new URL("../fixtures/gitlab/", import.meta.url);
const composePath = new URL("../../lab/compose.yaml", import.meta.url);

interface ComposeFile {
	services: Record<string, { depends_on?: Record<string, unknown> }>;
	volumes: Record<string, unknown>;
}

async function readCompose(): Promise<ComposeFile> {
	return Bun.YAML.parse(await Bun.file(composePath).text()) as ComposeFile;
}

describe("supported GitLab majors", () => {
	test("has exactly one fixture directory per major and no orphans", async () => {
		const directories = await readdir(fixtureRoot, { withFileTypes: true });

		expect(
			directories
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.sort(),
		).toEqual([...SUPPORTED_GITLAB_MAJORS].sort());
	});

	test("has one lab service, its volumes, and a seeder dependency per major", async () => {
		const compose = await readCompose();
		const expectedServices = SUPPORTED_GITLAB_MAJORS.map(
			(major) => `gitlab-${major}`,
		);

		expect(
			Object.keys(compose.services)
				.filter((name) => name.startsWith("gitlab-"))
				.sort(),
		).toEqual([...expectedServices].sort());

		for (const service of expectedServices) {
			expect(Object.keys(compose.services.seed?.depends_on ?? {})).toContain(
				service,
			);

			for (const suffix of ["config", "data", "logs"]) {
				expect(Object.keys(compose.volumes)).toContain(`${service}-${suffix}`);
			}
		}
	});
});
