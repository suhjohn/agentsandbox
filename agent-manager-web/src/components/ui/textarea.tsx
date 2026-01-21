import * as React from "react";
import TextareaAutosize, {
  type TextareaAutosizeProps,
} from "react-textarea-autosize";

import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  TextareaAutosizeProps
>(({ className, minRows, ...props }, ref) => {
  return (
    <TextareaAutosize
      className={cn(
        "flex w-full rounded-none bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-none",
        className,
      )}
      minRows={minRows ?? 3}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
