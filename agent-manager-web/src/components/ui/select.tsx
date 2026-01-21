import * as React from "react";

import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const selectVariants = cva(
  "flex h-10 w-full rounded-none bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-input ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        borderless:
          "border-0 bg-transparent focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface SelectProps
  extends
    React.SelectHTMLAttributes<HTMLSelectElement>,
    VariantProps<typeof selectVariants> {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(selectVariants({ variant, className }))}
        {...props}
      />
    );
  },
);
Select.displayName = "Select";
