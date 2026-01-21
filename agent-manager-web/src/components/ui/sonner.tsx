import type { ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = ComponentProps<typeof Sonner>;

export function Toaster(props: ToasterProps) {
  const toastOptions = props.toastOptions ?? {};
  return (
    <Sonner
      {...props}
      toastOptions={{
        ...toastOptions,
        style: {
          background: "var(--color-card)",
          border: "1px solid var(--color-border)",
          color: "var(--color-card-foreground)",
          ...(toastOptions.style ?? {}),
        },
        classNames: {
          ...(toastOptions.classNames ?? {}),
          toast: "bg-card",
          info: "bg-card",
          success: "bg-card",
        },
      }}
    />
  );
}

