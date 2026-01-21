import { Navigate, useParams } from "@tanstack/react-router";

export function LegacyImageSettingsRedirect() {
  const params = useParams({ strict: false }) as { readonly imageId?: string };
  const imageId = (params.imageId ?? "").trim();

  if (!imageId) return <Navigate to="/settings/images" />;

  return (
    <Navigate
      to="/settings/images/$imageId"
      params={{ imageId }}
      replace
    />
  );
}
