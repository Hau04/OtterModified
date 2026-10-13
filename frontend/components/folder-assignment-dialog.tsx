"use client";

import { useEffect, useState } from "react";
import { FolderInput, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { createPhotoFolder, editMetadata, updatePhotoFolder } from "@/lib/api";
import { useFileStore } from "@/lib/file-store";
import { FileItem, PhotoFolder } from "@/lib/types";

const CREATE_FOLDER_OPTION = "__create__";
const UNFILED_OPTION = "__unfiled__";

interface FolderAssignmentDialogProps {
  files: FileItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FolderAssignmentDialog({
  files,
  open,
  onOpenChange,
}: FolderAssignmentDialogProps) {
  const folders = useFileStore((state) => state.folders);
  const fetchFolders = useFileStore((state) => state.fetchFolders);
  const addFolderLocal = useFileStore((state) => state.addFolderLocal);
  const updateFolderLocal = useFileStore((state) => state.updateFolderLocal);
  const updateFileMetadata = useFileStore((state) => state.updateFileMetadata);
  const clearSelection = useFileStore((state) => state.clearSelection);
  const [destination, setDestination] = useState(CREATE_FOLDER_OPTION);
  const [newFolderName, setNewFolderName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchFolders().catch((error) => console.error("Unable to load albums:", error));
      setDestination(CREATE_FOLDER_OPTION);
      setNewFolderName("");
    }
  }, [fetchFolders, open]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!files.length) return;

    setIsSubmitting(true);
    let destinationFolderId: string | null = null;
    let destinationFolder: PhotoFolder | null = null;

    try {
      if (destination === CREATE_FOLDER_OPTION) {
        const trimmedName = newFolderName.trim();
        if (!trimmedName) {
          toast({ title: "Enter an album name first", variant: "destructive" });
          setIsSubmitting(false);
          return;
        }
        destinationFolder = await createPhotoFolder(trimmedName);
        destinationFolderId = destinationFolder.id;
        addFolderLocal(destinationFolder);
      } else if (destination !== UNFILED_OPTION) {
        destinationFolderId = destination;
        destinationFolder = folders.find((folder) => folder.id === destination) ?? null;
        if (!destinationFolder) {
          throw new Error("That album no longer exists. Please reopen this dialog.");
        }
      }

      const results = await Promise.allSettled(
        files.map(async (file) => {
          const result = await editMetadata(file.name, {
            folderId: destinationFolderId,
          });
          updateFileMetadata(file.name, result.metadata);
          return file;
        }),
      );

      const assignedFiles = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failedCount = results.length - assignedFiles.length;

      if (destinationFolder && !destinationFolder.coverKey && assignedFiles.length > 0) {
        try {
          const updatedFolder = await updatePhotoFolder(destinationFolder.id, {
            coverKey: assignedFiles[0].name,
          });
          updateFolderLocal(destinationFolder.id, updatedFolder);
        } catch (error) {
          console.error("Unable to set the initial album poster:", error);
        }
      }

      await fetchFolders(true).catch((error) => {
        console.error("Unable to refresh albums:", error);
      });

      if (assignedFiles.length > 0) {
        clearSelection();
        onOpenChange(false);
        toast({
          title: failedCount ? "Some photos weren't moved" : "Photos updated",
          description: failedCount
            ? `${assignedFiles.length} moved, ${failedCount} failed.`
            : `${assignedFiles.length} photo${assignedFiles.length === 1 ? "" : "s"} updated.`,
          variant: failedCount ? "destructive" : "default",
        });
      } else {
        throw new Error("None of the selected photos could be updated.");
      }
    } catch (error) {
      toast({
        title: "Couldn't update photos",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#0d2137] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-5 w-5 text-emerald-300" />
            Organize {files.length} photo{files.length === 1 ? "" : "s"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="photo-destination" className="text-white/80">Move selected photos to</Label>
            <select
              id="photo-destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              disabled={isSubmitting}
              className="h-10 w-full rounded-md border border-white/20 bg-[#10263a] px-3 text-sm text-white outline-none focus:border-emerald-400"
            >
              <option value={CREATE_FOLDER_OPTION}>Create a new album…</option>
              <option value={UNFILED_OPTION}>Unfiled photos</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
          </div>

          {destination === CREATE_FOLDER_OPTION && (
            <div className="space-y-2">
              <Label htmlFor="new-album-name" className="text-white/80">New album name</Label>
              <Input
                id="new-album-name"
                autoFocus
                maxLength={80}
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="e.g. Family, holidays, nature…"
                disabled={isSubmitting}
                className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
              />
            </div>
          )}

          <p className="text-xs leading-relaxed text-white/50">
            Photos stay in your library. Moving them changes their album, and the first photo becomes the poster for a new album.
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
              className="border-white/20 text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || files.length === 0} className="bg-emerald-500 text-white hover:bg-emerald-600">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting ? "Saving…" : "Save photos"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
