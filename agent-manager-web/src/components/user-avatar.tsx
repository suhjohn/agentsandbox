import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { fetchUserAvatarDataUrl, userAvatarQueryKey } from "@/lib/avatar";

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

  const avatarQuery = useQuery({
    queryKey: userAvatarQueryKey(props.user),
    enabled: Boolean(props.user.avatar),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () =>
      fetchUserAvatarDataUrl({
        fetchAuthed: auth.fetchAuthed,
        user: props.user,
      }),
  });

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

  if (avatarQuery.data) {
    return (
      <img
        src={avatarQuery.data}
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
