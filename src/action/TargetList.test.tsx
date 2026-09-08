import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TargetOriginRejection } from "../host-access/target-origin";
import { TargetList, type TargetListProps } from "./TargetList";

afterEach(cleanup);

function renderList(overrides: Partial<TargetListProps> = {}) {
	const props: TargetListProps = {
		isLoading: false,
		targets: [],
		currentOrigin: undefined,
		busyOrigin: undefined,
		isAdding: false,
		failure: undefined,
		hasStaleTabs: false,
		onAdd: () => undefined,
		onGrant: () => {},
		onRemove: () => {},
		...overrides,
	};

	return { ...render(<TargetList {...props} />), props };
}

function row(origin: string): HTMLElement {
	const item = screen.getByText(origin).closest("li");

	if (!item) {
		throw new Error(`No row for ${origin}`);
	}

	return item;
}

describe("GitLab instance list", () => {
	test("shows GitLab.com as built in and offers no way to remove it", () => {
		renderList();
		const builtIn = row("https://gitlab.com");

		expect(builtIn.textContent).toContain("Built in");
		expect(
			within(builtIn).queryByRole("button", { name: /remove/i }),
		).toBeNull();
	});

	/*
	 * The pulsing dot is decoration. The same fact has to survive without colour
	 * and without motion, so it is asserted as text on the row.
	 */
	test("marks the current tab's instance in text, not colour alone", () => {
		renderList({
			currentOrigin: "http://localhost:10019",
			targets: [{ origin: "http://localhost:10019", access: "active" }],
		});

		expect(row("http://localhost:10019").textContent).toContain(
			"Active on this tab",
		);
		expect(row("https://gitlab.com").textContent).not.toContain(
			"Active on this tab",
		);
	});

	test("keeps enabled, access needed, and failed registration distinct", () => {
		renderList({
			targets: [
				{ origin: "https://enabled.example.com", access: "active" },
				{
					origin: "https://waiting.example.com",
					access: "permission-required",
				},
				{ origin: "https://broken.example.com", access: "registration-failed" },
			],
		});

		expect(row("https://enabled.example.com").textContent).toContain("Enabled");
		expect(row("https://waiting.example.com").textContent).toContain(
			"Access needed",
		);
		expect(row("https://broken.example.com").textContent).toContain(
			"Could not be enabled",
		);
	});

	test("offers a grant control only where permission is missing", async () => {
		const granted: string[] = [];
		renderList({
			onGrant: (origin) => granted.push(origin),
			targets: [
				{
					origin: "https://waiting.example.com",
					access: "permission-required",
				},
				{ origin: "https://enabled.example.com", access: "active" },
			],
		});

		expect(
			within(row("https://enabled.example.com")).queryByRole("button", {
				name: /grant access/i,
			}),
		).toBeNull();
		await userEvent.click(
			within(row("https://waiting.example.com")).getByRole("button", {
				name: /grant access/i,
			}),
		);

		expect(granted).toEqual(["https://waiting.example.com"]);
	});

	test("removes by origin", async () => {
		const removed: string[] = [];
		renderList({
			onRemove: (origin) => removed.push(origin),
			targets: [{ origin: "http://localhost:10019", access: "active" }],
		});

		await userEvent.click(
			screen.getByRole("button", { name: "Remove http://localhost:10019" }),
		);

		expect(removed).toEqual(["http://localhost:10019"]);
	});

	test("disables the row controls while its change is in flight", () => {
		renderList({
			busyOrigin: "https://waiting.example.com",
			targets: [
				{
					origin: "https://waiting.example.com",
					access: "permission-required",
				},
			],
		});
		const controls = within(row("https://waiting.example.com")).getAllByRole(
			"button",
		);

		expect(controls.every((control) => control.hasAttribute("disabled"))).toBe(
			true,
		);
	});
});

describe("adding an instance", () => {
	test("explains the browser permission scope", () => {
		renderList();

		expect(screen.getByText(/access covers every port/i)).toBeTruthy();
	});

	test("passes the raw input through and clears the field once accepted", async () => {
		const submitted: string[] = [];
		renderList({
			onAdd: (input) => {
				submitted.push(input);
				return undefined;
			},
		});
		const field = screen.getByLabelText(
			/self-managed gitlab address/i,
		) as HTMLInputElement;

		await userEvent.type(field, "http://localhost:10019");
		await userEvent.click(screen.getByRole("button", { name: /add/i }));

		expect(submitted).toEqual(["http://localhost:10019"]);
		expect(field.value).toBe("");
	});

	test("keeps the typed text and names the refusal", async () => {
		const rejections: TargetOriginRejection[] = ["unsupported-protocol"];
		renderList({ onAdd: () => rejections.shift() });
		const field = screen.getByLabelText(
			/self-managed gitlab address/i,
		) as HTMLInputElement;

		await userEvent.type(field, "ftp://gitlab.example.com");
		await userEvent.click(screen.getByRole("button", { name: /add/i }));

		expect(field.value).toBe("ftp://gitlab.example.com");
		expect(screen.getByRole("alert").textContent).toContain(
			"Only http:// and https:// addresses work.",
		);
		expect(field.getAttribute("aria-invalid")).toBe("true");
	});

	test("keeps the typed text when another access change starts first", async () => {
		renderList({ onAdd: () => "busy" });
		const field = screen.getByLabelText(
			/self-managed gitlab address/i,
		) as HTMLInputElement;

		await userEvent.type(field, "gitlab.example.com");
		await userEvent.click(screen.getByRole("button", { name: /add/i }));

		expect(field.value).toBe("gitlab.example.com");
		expect(screen.getByRole("alert").textContent).toContain(
			"Finish the current access change",
		);
		expect(field.getAttribute("aria-invalid")).toBe("false");
	});

	test("clears the refusal as soon as the address is edited", async () => {
		renderList({ onAdd: () => "invalid-url" });
		const field = screen.getByLabelText(
			/self-managed gitlab address/i,
		) as HTMLInputElement;

		await userEvent.type(field, "?");
		await userEvent.click(screen.getByRole("button", { name: /add/i }));
		expect(screen.getByRole("alert")).toBeTruthy();

		await userEvent.type(field, "a");
		expect(screen.queryByRole("alert")).toBeNull();
	});

	test("asks for a reload only after access actually changed", () => {
		const { rerender } = renderList();

		expect(screen.queryByText(/reload any open gitlab tab/i)).toBeNull();

		rerender(
			<TargetList
				busyOrigin={undefined}
				currentOrigin={undefined}
				failure={undefined}
				hasStaleTabs
				isAdding={false}
				isLoading={false}
				onAdd={() => undefined}
				onGrant={() => {}}
				onRemove={() => {}}
				targets={[{ origin: "http://localhost:10019", access: "active" }]}
			/>,
		);

		expect(screen.getByText(/reload any open gitlab tab/i)).toBeTruthy();
	});

	test("reports a failed operation without blaming the input", () => {
		renderList({ failure: "remove-failed" });

		expect(screen.getByRole("alert").textContent).toContain(
			"Tonic could not finish removing that instance.",
		);
		expect(
			screen
				.getByLabelText(/self-managed gitlab address/i)
				.getAttribute("aria-invalid"),
		).toBe("false");
	});
});
