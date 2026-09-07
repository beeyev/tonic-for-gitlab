import type { SVGProps } from "react";

import { cn } from "@/ui/lib/utils";

/**
 * Inline glyphs. The project ships no icon dependency, and the handful of marks
 * the two surfaces need does not justify adding one.
 */
function Glyph({ className, ...props }: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className={cn("size-4 shrink-0", className)}
			fill="none"
			focusable="false"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			viewBox="0 0 24 24"
			{...props}
		/>
	);
}

export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<Glyph {...props}>
			<path d="m6 9 6 6 6-6" />
		</Glyph>
	);
}

export function AlertTriangleIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<Glyph {...props}>
			<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
			<path d="M12 9v4" />
			<path d="M12 17h.01" />
		</Glyph>
	);
}

export function CircleCheckIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<Glyph {...props}>
			<circle cx="12" cy="12" r="10" />
			<path d="m9 12 2 2 4-4" />
		</Glyph>
	);
}

export function CircleInfoIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<Glyph {...props}>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 16v-4" />
			<path d="M12 8h.01" />
		</Glyph>
	);
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<Glyph {...props}>
			<path d="M5 12h14" />
			<path d="M12 5v14" />
		</Glyph>
	);
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<Glyph {...props}>
			<path d="M3 6h18" />
			<path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
			<path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
		</Glyph>
	);
}
