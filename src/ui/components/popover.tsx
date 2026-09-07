import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type * as React from "react";

import { cn } from "@/ui/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
	container,
	className,
	align = "center",
	alignOffset = 0,
	collisionPadding = 5,
	side = "bottom",
	sideOffset = 4,
	...props
}: PopoverPrimitive.Popup.Props &
	Pick<
		PopoverPrimitive.Positioner.Props,
		"align" | "alignOffset" | "collisionPadding" | "side" | "sideOffset"
	> & {
		container?: PopoverPrimitive.Portal.Props["container"];
	}) {
	return (
		<PopoverPrimitive.Portal container={container}>
			<PopoverPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				collisionPadding={collisionPadding}
				side={side}
				sideOffset={sideOffset}
				// Mirrors CONTROL_SURFACE_Z_INDEX. The shadow host normally creates
				// the stacking context; this covers a host that cannot, so the
				// popover still clears GitLab page chrome on its own.
				className="isolate z-[700]"
			>
				<PopoverPrimitive.Popup
					data-slot="popover-content"
					className={cn(
						"z-50 flex w-72 flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden",
						className,
					)}
					{...props}
				/>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="popover-header"
			className={cn("flex flex-col gap-0.5 text-sm", className)}
			{...props}
		/>
	);
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
	return (
		<PopoverPrimitive.Title
			data-slot="popover-title"
			className={cn("font-medium", className)}
			{...props}
		/>
	);
}

function PopoverDescription({
	className,
	...props
}: PopoverPrimitive.Description.Props) {
	return (
		<PopoverPrimitive.Description
			data-slot="popover-description"
			className={cn("text-xs text-muted-foreground", className)}
			{...props}
		/>
	);
}

export {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
};
