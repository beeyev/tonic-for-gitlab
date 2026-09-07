import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/ui/lib/utils";

function Input({ className, ...props }: InputPrimitive.Props) {
	return (
		<InputPrimitive
			data-slot="input"
			className={cn(
				"h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm transition-[color,box-shadow] outline-none",
				"placeholder:text-muted-foreground",
				"focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
				"aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
				"disabled:pointer-events-none disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
