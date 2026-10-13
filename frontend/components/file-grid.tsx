"use client"

import { useEffect, useState } from "react"
import { FolderOpen, Images } from "lucide-react"
import { useActiveItems, useFileStore, useFilteredFiles } from "@/lib/file-store"
import { FileCard } from "@/components/file-card"
import { MasonryImageCard } from "@/components/masonry-image-card"
import { ViewModeToggle } from "@/components/view-mode-toggle"
import { SortTypeDropdown } from "@/components/sort-type-dropdown"
import { PhotoFolderBrowser } from "@/components/photo-folder-browser"
import { ViewMode, FileType } from "@/lib/types"
import { PhotoProvider } from "react-photo-view"
import { ZoomIn, ZoomOut, RotateCw } from "lucide-react"
import { Button } from "./ui/button"
import { useInitFileStore } from "@/hooks/use-init-file-store"

function PhotoToolbar({
  rotate,
  onRotate,
  scale,
  onScale,
}: any) {
  return (
    <div className="flex items-center gap-1">
      <ToolbarButton onClick={() => onScale(scale + 0.2)}>
        <ZoomIn className="h-5 w-5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => onScale(scale - 0.2)}>
        <ZoomOut className="h-5 w-5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => onRotate(rotate + 90)}>
        <RotateCw className="h-5 w-5" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className="text-white/80 backdrop-blur-sm hover:bg-white/10 hover:text-white"
    >
      {children}
    </Button>
  );
}

function FileListRenderer({
  viewMode,
  files,
}: {
  viewMode: ViewMode;
  files: any[];
}) {
  if (viewMode === ViewMode.Grid) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {files.map((file) => (
          <FileCard key={file.name} file={file} />
        ))}
      </div>
    )
  }

  if (viewMode === ViewMode.Masonry) {
    return (
      <div className="columns-2 gap-4 space-y-4 md:columns-3 lg:columns-4 xl:columns-5">
        {files.map((file) => (
          <div key={file.name} className="break-inside-avoid">
            <MasonryImageCard file={file} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <FileCard key={file.name} file={file} listView />
      ))}
    </div>
  )
}

export function FileGrid() {
  useInitFileStore()

  const activeType = useFileStore((state) => state.activeType)
  const viewMode = useFileStore((state) => state.viewMode)
  const searchQuery = useFileStore((state) => state.searchQuery)
  const activeItems = useActiveItems()
  const filteredFiles = useFilteredFiles()
  const [photoSection, setPhotoSection] = useState<"photos" | "albums">("photos")

  useEffect(() => {
    setPhotoSection("photos")
  }, [activeType])

  const isAlbumSection = activeType === FileType.Image && photoSection === "albums"

  return (
    <PhotoProvider
      maskOpacity={0.85}
      toolbarRender={(props) => <PhotoToolbar {...props} />}
    >
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          {activeType === FileType.Image && (
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={photoSection === "photos"}
                onClick={() => setPhotoSection("photos")}
                className={photoSection === "photos"
                  ? "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/25"
                  : "text-white/60 hover:bg-white/10 hover:text-white"}
              >
                <Images className="mr-2 h-4 w-4" /> Photos
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={photoSection === "albums"}
                onClick={() => setPhotoSection("albums")}
                className={photoSection === "albums"
                  ? "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/25"
                  : "text-white/60 hover:bg-white/10 hover:text-white"}
              >
                <FolderOpen className="mr-2 h-4 w-4" /> Albums
              </Button>
            </div>
          )}

          <div className="text-sm text-white/60">
            {isAlbumSection
              ? "Organize photos into albums"
              : `${filteredFiles.length} ${filteredFiles.length === 1 ? "file" : "files"}`}
          </div>
        </div>

        {!isAlbumSection && (
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <SortTypeDropdown />
            <ViewModeToggle />
          </div>
        )}
      </div>

      {isAlbumSection ? (
        <PhotoFolderBrowser files={activeItems} />
      ) : filteredFiles.length > 0 ? (
        <FileListRenderer viewMode={viewMode} files={filteredFiles} />
      ) : (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-6 text-center">
          <Images className="mb-4 h-12 w-12 text-emerald-300/70" />
          <h3 className="text-lg font-medium text-white">
            {searchQuery.trim() ? "No photos match your search" : "No photos yet"}
          </h3>
          <p className="mt-2 max-w-md text-sm text-white/50">
            {searchQuery.trim()
              ? "Try another search or clear the search field."
              : "Upload photos above, or switch to Albums to create a folder-style collection."}
          </p>
        </div>
      )}
    </PhotoProvider>
  )
}
