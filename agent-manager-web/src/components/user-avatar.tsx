import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

type AvatarUser = {
  readonly id: string;
  readonly name: string;
  readonly avatar?: string | null;
};

export function UserAvatar(props: {
  readonly user: AvatarUser;
  readonly className?: string;
  readonly textClassName?: string;
}) {
  const auth = useAuth();
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let nextObjectUrl: string | null = null;
    let currentObjectUrl: string | null = null;

    async function run() {
      if (!props.user.avatar) {
        setImageUrl(null);
        return;
      }

      try {
        const response = await auth.fetchAuthed(`/users/${props.user.id}/avatar`);
        if (!response.ok) {
          throw new Error("Avatar fetch failed");
        }
        const blob = await response.blob();
        nextObjectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          currentObjectUrl = nextObjectUrl;
          setImageUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return nextObjectUrl;
          });
          nextObjectUrl = null;
        }
      } catch {
        if (!cancelled) {
          setImageUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [auth, props.user.avatar, props.user.id]);

  const initial = useMemo(() => {
    const trimmed = props.user.name.trim();
    const first = Array.from(trimmed)[0] ?? "?";
    return first.toUpperCase();
  }, [props.user.name]);

  const background = useMemo(() => {
    let hash = 0;
    const source = `${props.user.id}:${props.user.name}`;
    for (let i = 0; i < source.length; i += 1) {
      hash = (hash * 31 + source.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 54% 48%)`;
  }, [props.user.id, props.user.name]);

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={props.user.name}
        className={cn("rounded-full object-cover", props.className)}
      />
    );
  }

  return (
    <div
      aria-label={props.user.name}
      className={cn(
        "rounded-full flex items-center justify-center text-white font-semibold select-none",
        props.className,
      )}
      style={{ backgroundColor: background }}
    >
      <span className={props.textClassName}>{initial}</span>
    </div>
  );
}
