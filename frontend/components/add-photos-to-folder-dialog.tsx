"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ImagePlus, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { editMetadata, getFileUrl, updatePhotoFolder } from "@/lib/api";
import { useFileStore } from "@/lib/file-store";
import { FileItem, PhotoFolder } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AddPhotosToFolderDialogProps {
  folder: PhotoFolder | null;
  files: FileItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddPhotosToFolderDialog({
  folder,
  files,
  open,
  onOpenChange,
}: AddPhotosToFolderDialogProps) {
  const folders = useFileStore((state) => state.folders);
  const fetchFolders = useFileStore((state) => state.fetchFolders);
  const updateFolderLocal = useFileStore((state) => state.updateFolderLocal);
  const updateFileMetadata = useFileStore((state) => state.updateFileMetadata);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setSelectedKeys([]);
      setSearchQuery("");
      fetchFolders().catch((error) => console.error("Unable to load albums:", error));
    }
  }, [fetchFolders, open]);

  const candidates = useMemo(
    () => files.filter((file) => file.metadata.folderId !== folder?.id),
    [files, folder?.id],
  );

  const visibleFiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter((file) =>
      (file.metadata.fileName || file.name).toLowerCase().includes(query),
    );
  }, [candidates, searchQuery]);

  const toggleFile = (key: string) => {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((selectedKey) => selectedKey !== key)
        : [...current, key],
    );
  };

  const toggleVisibleFiles = () => {
    const visibleKeys = visibleFiles.map((file) => file.name);
    const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.includes(key));
    setSelectedKeys((current) =>
      allVisibleSelected
        ? current.filter((key) => !visibleKeys.includes(key))
        : Array.from(new Set([...current, ...visibleKeys])),
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!folder || selectedKeys.length === 0) return;

    const chosenFiles = candidates.filter((file) => selectedKeys.includes(file.name));
    setIsSubmitting(true);

    try {
      const results = await Promise.allSettled(
        chosenFiles.map(async (file) => {
          const result = await editMetadata(file.name, { folderId: folder.id });
          updateFileMetadata(file.name, result.metadata);
          return file;
        }),
      );

      const movedFiles = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failedCount = results.length - movedFiles.length;

      if (movedFiles.length > 0 && !folder.coverKey) {
        try {
          const updatedFolder = await updatePhotoFolder(folder.id, {
            coverKey: movedFiles[0].name,
          });
          updateFolderLocal(folder.id, updatedFolder);
        } catch (error) {
          console.error("Unable to set the initial album poster:", error);
        }
      }

      await fetchFolders(true).catch((error) => {
        console.error("Unable to refresh albums:", error);
      });

      if (movedFiles.length > 0) {
        onOpenChange(false);
        toast({
          title: failedCount ? "Some photos weren't added" : "Photos added",
          description: failedCount
            ? `${movedFiles.length} added, ${failedCount} failed.`
            : `${movedFiles.length} photo${movedFiles.length === 1 ? "" : "s"} added to ${folder.name}.`,
          variant: failedCount ? "destructive" : "default",
        });
      } else {
        throw new Error("None of the selected photos could be added.");
      }
    } catch (error) {
      toast({
        title: "Couldn't add photos",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const allVisibleSelected = visibleFiles.length > 0 && visibleFiles.every((file) => selectedKeys.includes(file.name));

  return (
    <Dialog open={open && Boolean(folder)} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#0d2137] text-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5 text-emerald-300" />
            Add photos to {folder?.name ?? "album"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/60">
              Choose photos from your library. Photos already in this album are hidden.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleVisibleFiles}
              disabled={visibleFiles.length === 0 || isSubmitting}
              className="text-emerald-200 hover:bg-white/10 hover:text-white"
            >
              <Check className="mr-2 h-4 w-4" />
              {allVisibleSelected ? "Clear visible" : "Select visible"}
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search your photos…"
              className="border-white/20 bg-white/10 pl-9 text-white placeholder:text-white/40"
            />
          </div>

          <div className="max-h-[55vh] min-h-32 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/10 p-2">
            {visibleFiles.length === 0 ? (
              <div className="flex h-28 items-center justify-center text-center text-sm text-white/45">
                {candidates.length === 0 ? "All your photos are already in this album." : "No photos match your search."}
              </div>
            ) : (
              visibleFiles.map((file) => {
                const checked = selectedKeys.includes(file.name);
                const sourceFolder = folders.find((candidate) => candidate.id === file.metadata.folderId);

                return (
                  <label
                    key={file.name}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition-colors",
                      checked
                        ? "border-emerald-400/50 bg-emerald-500/10"
                        : "border-transparent hover:bg-white/5",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFile(file.name)}
                      disabled={isSubmitting}
                      className="h-4 w-4 accent-emerald-400"
                    />
                    <img
                      src={getFileUrl(file.name)}
                      alt=""
                      loading="lazy"
                      className="h-11 w-11 shrink-0 rounded-md object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{file.metadata.fileName}</span>
                      <span className="block truncate text-xs text-white/45">
                        {sourceFolder ? `Currently in ${sourceFolder.name}` : "Unfiled photo"}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <DialogFooter>
            <span className="mr-auto self-center text-sm text-white/60">
              {selectedKeys.length} selected
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
              className="border-white/20 text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || selectedKeys.length === 0}
              className="bg-emerald-500 text-white hover:bg-emerald-600"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting ? "Adding…" : "Add selected photos"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
