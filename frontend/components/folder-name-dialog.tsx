"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { createPhotoFolder, updatePhotoFolder } from "@/lib/api";
import { PhotoFolder } from "@/lib/types";

interface FolderNameDialogProps {
  open: boolean;
  folder: PhotoFolder | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: (folder: PhotoFolder) => void;
}

export function FolderNameDialog({
  open,
  folder,
  onOpenChange,
  onSuccess,
}: FolderNameDialogProps) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) setName(folder?.name ?? "");
  }, [folder, open]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      toast({ title: "Album name can't be empty", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const savedFolder = folder
        ? await updatePhotoFolder(folder.id, { name: trimmedName })
        : await createPhotoFolder(trimmedName);

      onSuccess(savedFolder);
      onOpenChange(false);
      toast({ title: folder ? "Album renamed" : "Album created" });
    } catch (error) {
      toast({
        title: folder ? "Couldn't rename album" : "Couldn't create album",
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
          <DialogTitle>{folder ? "Rename album" : "Create photo album"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="photo-folder-name" className="text-white/80">Album name</Label>
            <Input
              id="photo-folder-name"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Summer trip"
              disabled={isSubmitting}
              className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
            />
            <p className="text-xs text-white/45">Up to 80 characters. Albums only contain photos.</p>
          </div>
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
            <Button type="submit" disabled={isSubmitting} className="bg-emerald-500 text-white hover:bg-emerald-600">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting ? "Saving…" : folder ? "Save changes" : "Create album"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
