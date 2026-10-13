"use client";

import { useEffect, useMemo, useState } from "react";
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
import { deletePhotoFolder, getFileUrl, updatePhotoFolder } from "@/lib/api";
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
  count,
  safeMode,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: PhotoFolder;
  cover: FileItem | undefined;
  count: number;
  safeMode: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const coverIsBlurred = cover
    ? shouldBlur({ safeMode, tags: cover.metadata?.tags })
    : false;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition-all hover:-translate-y-1 hover:border-emerald-300/40 hover:bg-white/10">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-[4/3] overflow-hidden bg-linear-to-br from-emerald-500/20 via-teal-500/10 to-blue-500/20">
          {cover ? (
            <img
              src={getFileUrl(cover.name)}
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
            <p className="mt-1 text-xs text-white/50">
              {count} {count === 1 ? "photo" : "photos"}
            </p>
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
  const safeMode = useFileStore((state) => state.safeMode);
  const searchQuery = useFileStore((state) => state.searchQuery);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
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

  const query = searchQuery.trim().toLowerCase();
  const albumPhotos = useMemo(() => {
    const queryText = searchQuery.trim().toLowerCase();
    return files.filter((file) => {
      if (!queryText) return true;
      return (file.metadata.fileName || file.name).toLowerCase().includes(queryText);
    });
  }, [files, searchQuery]);

  const getFolderFiles = (folderId: string) =>
    files
      .filter((file) => file.metadata.folderId === folderId)
      .sort((a, b) => (b.metadata.uploadedAt ?? 0) - (a.metadata.uploadedAt ?? 0));

  const visibleFolders = folders.filter((folder) => {
    if (!query || folder.name.toLowerCase().includes(query)) return true;
    return getFolderFiles(folder.id).some((file) =>
      (file.metadata.fileName || file.name).toLowerCase().includes(query),
    );
  });

  const activeFolder = folders.find((folder) => folder.id === activeFolderId) ?? null;
  const activeFolderFiles = activeFolder
    ? getFolderFiles(activeFolder.id).filter((file) => albumPhotos.includes(file))
    : [];

  const openCreateDialog = () => {
    setEditingFolder(null);
    setFolderDialogOpen(true);
  };

  const openRenameDialog = (folder: PhotoFolder) => {
    setEditingFolder(folder);
    setFolderDialogOpen(true);
  };

  const handleFolderSaved = (folder: PhotoFolder) => {
    if (editingFolder) updateFolderLocal(folder.id, folder);
    else addFolderLocal(folder);
  };

  const handleDeleteFolder = async (folder: PhotoFolder) => {
    const shouldDelete = window.confirm(
      `Delete “${folder.name}”? Its photos will stay in your library as unfiled photos.`,
    );
    if (!shouldDelete) return;

    try {
      const result = await deletePhotoFolder(folder.id);
      result.detachedKeys.forEach((key) => {
        const file = files.find((item) => item.name === key);
        if (!file) return;
        const { folderId: _folderId, ...metadata } = file.metadata;
        updateFileMetadata(key, metadata);
      });
      removeFolderLocal(folder.id);
      if (activeFolderId === folder.id) setActiveFolderId(null);
      toast({ title: "Album deleted", description: "Your photos were kept in the library." });
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
      updateFolderLocal(activeFolder.id, updatedFolder);
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
                  {activeFolderFiles.length} {activeFolderFiles.length === 1 ? "photo" : "photos"}
                  {query ? " matching your search" : " · Click a photo to preview; use its menu to set the poster"}
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
              <ImagePlus className="mr-2 h-4 w-4" /> Add photos
            </Button>
          </div>
        </div>

        {activeFolderFiles.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {activeFolderFiles.map((file) => (
              <FileCard
                key={file.name}
                file={file}
                isFolderPoster={activeFolder.coverKey === file.name}
                onSetFolderPoster={() => handleSetPoster(file)}
                folderPosterUpdating={updatingPosterKey === file.name}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-6 text-center">
            <ImagePlus className="mb-4 h-10 w-10 text-emerald-300/70" />
            <h3 className="text-lg font-medium text-white">
              {query ? "No photos match your search" : "This album is empty"}
            </h3>
            <p className="mt-2 max-w-md text-sm text-white/50">
              {query
                ? "Try another search, or clear the search field to see all album photos."
                : "Add photos from your library, or choose this album in the upload area to save new photos here."}
            </p>
            {!query && (
              <Button onClick={() => setAddPhotosOpen(true)} className="mt-5 bg-emerald-500 text-white hover:bg-emerald-600">
                <ImagePlus className="mr-2 h-4 w-4" /> Add photos
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
          <h2 className="text-xl font-semibold text-white">Your photo albums</h2>
          <p className="mt-1 text-sm text-white/50">
            Keep related photos together, choose a poster, and open an album to browse its gallery.
          </p>
        </div>
        <Button onClick={openCreateDialog} className="bg-emerald-500 text-white hover:bg-emerald-600">
          <Plus className="mr-2 h-4 w-4" /> New album
        </Button>
      </div>

      {visibleFolders.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleFolders.map((folder) => {
            const folderFiles = getFolderFiles(folder.id);
            const cover = folderFiles.find((file) => file.name === folder.coverKey) ?? folderFiles[0];

            return (
              <PhotoFolderCard
                key={folder.id}
                folder={folder}
                cover={cover}
                count={folderFiles.length}
                safeMode={safeMode}
                onOpen={() => setActiveFolderId(folder.id)}
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
            {query ? "No albums match your search" : "No photo albums yet"}
          </h3>
          <p className="mt-2 max-w-md text-sm text-white/50">
            {query
              ? "Try another search or clear the search field."
              : "Create an album, then add existing photos or choose it as the destination when uploading."}
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
