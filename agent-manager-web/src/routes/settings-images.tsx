import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { useAuth } from "../lib/auth";
import type { Image } from "../lib/api";
import { Button } from "@/components/ui/button";
import { registerSettingsImagesRuntimeController } from "@/frontend-runtime/bridge";
import {
  SettingsList,
  SettingsPage,
  SettingsPanel,
  SettingsPanelBody,
  SettingsSection,
  SettingsRow,
} from "@/components/settings";
import { ChevronRight } from "lucide-react";

function ImagesList(input: {
  readonly images: readonly Image[];
  readonly showArchivedMeta?: boolean;
}) {
  const { images, showArchivedMeta = false } = input;
  return (
    <SettingsList className="rounded-none border-0">
      {images.map((img) => {
        const archivedAtText =
          showArchivedMeta && img.deletedAt
            ? new Date(img.deletedAt).toLocaleString()
            : null;
        return (
          <SettingsRow
            key={img.id}
            className="items-start sm:items-center flex-col sm:flex-row"
            left={
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-sm font-medium truncate">{img.name}</div>
                </div>
                {archivedAtText ? (
                  <div className="text-xs text-text-tertiary truncate">
                    Archived: {archivedAtText}
                  </div>
                ) : null}
              </div>
            }
            right={
              <Button asChild variant="icon" size="icon">
                <Link
                  to="/settings/images/$imageId"
                  params={{ imageId: img.id }}
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            }
          />
        );
      })}
    </SettingsList>
  );
}

function ImagesPanel(input: {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly images: readonly Image[];
  readonly emptyMessage: string;
  readonly showArchivedMeta?: boolean;
}) {
  const {
    isLoading,
    isError,
    error,
    images,
    emptyMessage,
    showArchivedMeta = false,
  } = input;

  if (isLoading) {
    return (
      <SettingsPanelBody>
        <div className="text-sm text-text-secondary">Loading...</div>
      </SettingsPanelBody>
    );
  }
  if (isError) {
    return (
      <SettingsPanelBody>
        <div className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load images"}
        </div>
      </SettingsPanelBody>
    );
  }
  if (images.length === 0) {
    return (
      <SettingsPanelBody>
        <div className="text-sm text-text-secondary">{emptyMessage}</div>
      </SettingsPanelBody>
    );
  }
  return <ImagesList images={images} showArchivedMeta={showArchivedMeta} />;
}

export function SettingsImagesPage() {
  const auth = useAuth();

  const activeImagesQuery = useQuery({
    queryKey: ["images", "active"],
    enabled: !!auth.user,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: () =>
      auth.api.listImages({
        limit: 50,
      }),
  });

  const archivedImagesQuery = useQuery({
    queryKey: ["images", "archived"],
    enabled: !!auth.user,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: () =>
      auth.api.listImages({
        limit: 50,
        archived: true,
      }),
  });

  const activeImages = activeImagesQuery.data?.data ?? [];
  const archivedImages = archivedImagesQuery.data?.data ?? [];
  const visibleImageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const image of activeImages) ids.add(image.id);
    for (const image of archivedImages) ids.add(image.id);
    return [...ids];
  }, [activeImages, archivedImages]);

  useEffect(() => {
    return registerSettingsImagesRuntimeController({
      getSnapshot: () => ({
        imageIds: visibleImageIds,
      }),
    });
  }, [visibleImageIds]);

  return (
    <SettingsPage
      title="Images"
      description="Browse and manage images you use for sandboxes."
    >
      <SettingsSection title="Active images">
        <SettingsPanel>
          <ImagesPanel
            isLoading={activeImagesQuery.isLoading}
            isError={activeImagesQuery.isError}
            error={activeImagesQuery.error}
            images={activeImages}
            emptyMessage="No active images found."
          />
        </SettingsPanel>
      </SettingsSection>

      <SettingsSection title="Archived images">
        <SettingsPanel>
          <ImagesPanel
            isLoading={archivedImagesQuery.isLoading}
            isError={archivedImagesQuery.isError}
            error={archivedImagesQuery.error}
            images={archivedImages}
            emptyMessage="No archived images found."
            showArchivedMeta
          />
        </SettingsPanel>
      </SettingsSection>
    </SettingsPage>
  );
}
