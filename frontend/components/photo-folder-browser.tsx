"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Folder,
  FolderOpen,
  ImagePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { AddPhotosToFolderDialog } from "@/components/add-photos-to-folder-dialog";
import { FileCard } from "@/components/file-card";
import { FolderNameDialog } from "@/components/folder-name-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { deletePhotoFolder, getAlbumFiles, getFileUrl, updatePhotoFolder } from "@/lib/api";
import { useFileStore } from "@/lib/file-store";
import { FileItem, PhotoFolder } from "@/lib/types";
import { shouldBlur } from "@/lib/file-preview";
import { cn } from "@/lib/utils";

interface PhotoFolderBrowserProps {
  files: FileItem[];
}

function PhotoFolderCard({
  folder,
  cover,
  safeMode,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: PhotoFolder;
  cover: FileItem | undefined;
  safeMode: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const coverIsBlurred = shouldBlur({
    safeMode,
    tags: cover?.metadata?.tags ?? folder.coverTags,
  });

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition-all hover:-translate-y-1 hover:border-emerald-300/40 hover:bg-white/10">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-[4/3] overflow-hidden bg-linear-to-br from-emerald-500/20 via-teal-500/10 to-blue-500/20">
          {folder.coverKey ? (
            <img
              src={getFileUrl(folder.coverKey)}
              alt=""
              loading="lazy"
              className={cn(
                "h-full w-full object-cover transition-transform duration-500 group-hover:scale-105",
                coverIsBlurred && "scale-110 blur-2xl",
              )}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <FolderOpen className="h-20 w-20 text-emerald-200/50" strokeWidth={1.2} />
            </div>
          )}
          {coverIsBlurred && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45">
              <span className="rounded-full border border-amber-300/30 bg-black/55 px-3 py-1 text-xs font-medium text-amber-200">
                Hidden in safe mode
              </span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-black/85 via-black/30 to-transparent" />
          {folder.coverKey && (
            <span className="absolute bottom-3 left-3 rounded-full border border-white/20 bg-black/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
              Poster
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-white">{folder.name}</h3>
            <p className="mt-1 text-xs text-white/50">Open to browse photos and videos</p>
          </div>
          <Folder className="h-5 w-5 shrink-0 text-emerald-300/80" />
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`More options for ${folder.name}`}
            onClick={(event) => event.stopPropagation()}
            className="absolute right-3 top-3 h-9 w-9 rounded-full border border-white/20 bg-black/45 text-white opacity-100 backdrop-blur transition-opacity hover:bg-black/70 md:opacity-0 md:group-hover:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border-white/10 bg-[#0d2137]">
          <DropdownMenuItem onClick={onRename} className="text-white hover:bg-white/10">
            <Pencil className="mr-2 h-4 w-4" /> Rename album
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="text-red-300 hover:bg-red-500/10">
            <Trash2 className="mr-2 h-4 w-4" /> Delete album
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function PhotoFolderBrowser({ files }: PhotoFolderBrowserProps) {
  const folders = useFileStore((state) => state.folders);
  const fetchFolders = useFileStore((state) => state.fetchFolders);
  const addFolderLocal = useFileStore((state) => state.addFolderLocal);
  const updateFolderLocal = useFileStore((state) => state.updateFolderLocal);
  const removeFolderLocal = useFileStore((state) => state.removeFolderLocal);
  const updateFileMetadata = useFileStore((state) => state.updateFileMetadata);
  const foldersLoading = useFileStore((state) => state.foldersLoading);
  const setUploadAlbumId = useFileStore((state) => state.setUploadAlbumId);
  const albumRefreshVersion = useFileStore((state) => state.albumRefreshVersion);
  const safeMode = useFileStore((state) => state.safeMode);
  const searchQuery = useFileStore((state) => state.searchQuery);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [albumFiles, setAlbumFiles] = useState<FileItem[]>([]);
  const [albumCursor, setAlbumCursor] = useState<string | null>(null);
  const [albumHasMore, setAlbumHasMore] = useState(false);
  const [albumLoading, setAlbumLoading] = useState(false);
  const albumRequestId = useRef(0);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<PhotoFolder | null>(null);
  const [addPhotosOpen, setAddPhotosOpen] = useState(false);
  const [updatingPosterKey, setUpdatingPosterKey] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchFolders().catch((error) => {
      console.error("Unable to load photo albums:", error);
      toast({
        title: "Couldn't load albums",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    });
  }, [fetchFolders, toast]);

  useEffect(() => {
    const requestId = ++albumRequestId.current;
    if (!activeFolderId) {
      setAlbumFiles([]);
      setAlbumCursor(null);
      setAlbumHasMore(false);
      setAlbumLoading(false);
      return;
    }

    let cancelled = false;
    setAlbumFiles([]);
    setAlbumCursor(null);
    setAlbumHasMore(false);
    setAlbumLoading(true);
    getAlbumFiles(activeFolderId)
      .then((result) => {
        if (cancelled || albumRequestId.current !== requestId) return;
        setAlbumFiles(result.keys);
        setAlbumCursor(result.cursor ?? null);
        setAlbumHasMore(!result.list_complete);
      })
      .catch((error) => {
        if (cancelled || albumRequestId.current !== requestId) return;
        toast({
          title: "Couldn't load album media",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled && albumRequestId.current === requestId) setAlbumLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeFolderId, albumRefreshVersion, toast]);

  const query = searchQuery.trim().toLowerCase();
  const visibleFolders = folders.filter((folder) =>
    !query || folder.name.toLowerCase().includes(query),
  );
  const activeFolder = folders.find((folder) => folder.id === activeFolderId) ?? null;
  const activeFolderFiles = useMemo(() => {
    if (!query) return albumFiles;
    return albumFiles.filter((file) =>
      (file.metadata.fileName || file.name).toLowerCase().includes(query),
    );
  }, [albumFiles, query]);

  const openCreateDialog = () => {
    setEditingFolder(null);
    setFolderDialogOpen(true);
  };

  const openRenameDialog = (folder: PhotoFolder) => {
    setEditingFolder(folder);
    setFolderDialogOpen(true);
  };

  const handleFolderSaved = (folder: PhotoFolder) => {
    if (editingFolder) {
      updateFolderLocal(folder.id, { ...folder, coverTags: editingFolder.coverTags });
    } else {
      addFolderLocal(folder);
      // Make the album just created the destination for the next upload.
      setUploadAlbumId(folder.id);
    }
  };

  const loadMoreAlbumFiles = async () => {
    if (!activeFolderId || !albumCursor || albumLoading) return;
    const requestId = albumRequestId.current;
    setAlbumLoading(true);
    try {
      const result = await getAlbumFiles(activeFolderId, albumCursor);
      if (albumRequestId.current !== requestId) return;
      setAlbumFiles((current) => {
        const merged = new Map(current.map((file) => [file.name, file]));
        for (const file of result.keys) merged.set(file.name, file);
        return [...merged.values()];
      });
      setAlbumCursor(result.cursor ?? null);
      setAlbumHasMore(!result.list_complete);
    } catch (error) {
      if (albumRequestId.current === requestId) {
        toast({
          title: "Couldn't load more media",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      if (albumRequestId.current === requestId) setAlbumLoading(false);
    }
  };

  const handleDeleteFolder = async (folder: PhotoFolder) => {
    const shouldDelete = window.confirm(
      `Delete “${folder.name}”? Its photos will stay in your library as unfiled photos.`,
    );
    if (!shouldDelete) return;

    try {
      const result = await deletePhotoFolder(folder.id);
      const loadedFiles = new Map([...files, ...albumFiles].map((file) => [file.name, file]));
      result.detachedKeys.forEach((key) => {
        const file = loadedFiles.get(key);
        if (!file) return;
        const { folderId: _folderId, ...metadata } = file.metadata;
        updateFileMetadata(key, metadata);
      });
      removeFolderLocal(folder.id);
      if (useFileStore.getState().uploadAlbumId === folder.id) setUploadAlbumId("");
      if (activeFolderId === folder.id) setActiveFolderId(null);
      toast({ title: "Album deleted", description: "Its photos and videos remain in your library." });
    } catch (error) {
      toast({
        title: "Couldn't delete album",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSetPoster = async (file: FileItem) => {
    if (!activeFolder || activeFolder.coverKey === file.name) return;

    setUpdatingPosterKey(file.name);
    try {
      const updatedFolder = await updatePhotoFolder(activeFolder.id, { coverKey: file.name });
      updateFolderLocal(activeFolder.id, {
        ...updatedFolder,
        coverTags: Array.isArray(file.metadata.tags) ? file.metadata.tags : [],
      });
      toast({ title: "Album poster updated" });
    } catch (error) {
      toast({
        title: "Couldn't set album poster",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingPosterKey(null);
    }
  };

  if (activeFolder) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setActiveFolderId(null)}
              className="mb-2 -ml-3 h-8 text-white/60 hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Albums
            </Button>
            <div className="flex items-center gap-3">
              <FolderOpen className="h-7 w-7 shrink-0 text-emerald-300" />
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-semibold text-white">{activeFolder.name}</h2>
                <p className="mt-1 text-sm text-white/50">
                  {activeFolderFiles.length}{albumHasMore ? "+" : ""} media items loaded
                  {query ? " matching your search" : " · Photos and videos are both supported"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => openRenameDialog(activeFolder)}
              className="border-white/20 bg-white/5 text-white hover:bg-white/10"
            >
              <Pencil className="mr-2 h-4 w-4" /> Rename
            </Button>
            <Button
              type="button"
              onClick={() => setAddPhotosOpen(true)}
              className="bg-emerald-500 text-white hover:bg-emerald-600"
            >
              <ImagePlus className="mr-2 h-4 w-4" /> Add existing photos
            </Button>
          </div>
        </div>

        {albumLoading && albumFiles.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-300/30 border-t-emerald-300" />
          </div>
        ) : activeFolderFiles.length > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {activeFolderFiles.map((file) => {
                const isImage = file.name.startsWith("img:");
                return (
                  <FileCard
                    key={file.name}
                    file={file}
                    isFolderPoster={isImage && activeFolder.coverKey === file.name}
                    onSetFolderPoster={isImage ? () => handleSetPoster(file) : undefined}
                    folderPosterUpdating={updatingPosterKey === file.name}
                  />
                );
              })}
            </div>
            {albumHasMore && (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  disabled={albumLoading}
                  onClick={loadMoreAlbumFiles}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  {albumLoading ? "Loading…" : "Load more media"}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-6 text-center">
            <ImagePlus className="mb-4 h-10 w-10 text-emerald-300/70" />
            <h3 className="text-lg font-medium text-white">
              {query ? "No media matches your search" : "This album is empty"}
            </h3>
            <p className="mt-2 max-w-md text-sm text-white/50">
              {query
                ? "Try another search, or clear the search field to see all album media."
                : "Choose this album in the upload area, then add photos and videos."}
            </p>
            {!query && (
              <Button onClick={() => setAddPhotosOpen(true)} className="mt-5 bg-emerald-500 text-white hover:bg-emerald-600">
                <ImagePlus className="mr-2 h-4 w-4" /> Add existing photos
              </Button>
            )}
          </div>
        )}

        <FolderNameDialog
          open={folderDialogOpen}
          folder={editingFolder}
          onOpenChange={setFolderDialogOpen}
          onSuccess={handleFolderSaved}
        />
        <AddPhotosToFolderDialog
          folder={activeFolder}
          files={files}
          open={addPhotosOpen}
          onOpenChange={setAddPhotosOpen}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Your albums</h2>
          <p className="mt-1 text-sm text-white/50">
            Create and name an album first, then select it before uploading photos or videos.
          </p>
        </div>
        <Button onClick={openCreateDialog} className="bg-emerald-500 text-white hover:bg-emerald-600">
          <Plus className="mr-2 h-4 w-4" /> New album
        </Button>
      </div>

      {visibleFolders.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleFolders.map((folder) => {
            const cover = files.find((file) => file.name === folder.coverKey);

            return (
              <PhotoFolderCard
                key={folder.id}
                folder={folder}
                cover={cover}
                safeMode={safeMode}
                onOpen={() => {
                  setUploadAlbumId(folder.id);
                  setActiveFolderId(folder.id);
                }}
                onRename={() => openRenameDialog(folder)}
                onDelete={() => handleDeleteFolder(folder)}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-6 text-center">
          {foldersLoading ? (
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-300/30 border-t-emerald-300" />
          ) : (
            <FolderOpen className="mb-4 h-12 w-12 text-emerald-300/70" />
          )}
          <h3 className="text-lg font-medium text-white">
            {query ? "No albums match your search" : "No albums yet"}
          </h3>
          <p className="mt-2 max-w-md text-sm text-white/50">
            {query
              ? "Try another search or clear the search field."
              : "Create and name an album first. It will be selected for your next photo or video upload."}
          </p>
          {!query && (
            <Button onClick={openCreateDialog} className="mt-5 bg-emerald-500 text-white hover:bg-emerald-600">
              <Plus className="mr-2 h-4 w-4" /> Create your first album
            </Button>
          )}
        </div>
      )}

      <FolderNameDialog
        open={folderDialogOpen}
        folder={editingFolder}
        onOpenChange={setFolderDialogOpen}
        onSuccess={handleFolderSaved}
      />
    </div>
  );
}
