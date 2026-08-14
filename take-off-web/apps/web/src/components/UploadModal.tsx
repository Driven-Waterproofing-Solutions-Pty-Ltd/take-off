
import React, { useState, useRef } from 'react';
import { Upload, X, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

interface UploadModalProps {
  onUpload: (files: File[], names: string[]) => void;
  onCancel: () => void;
  isFirstUpload: boolean;
}

const UploadModal: React.FC<UploadModalProps> = ({ onUpload, onCancel, isFirstUpload }) => {
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...selectedFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (files.length > 0) {
      const names = files.map(f => f.name.replace(/\.[^/.]+$/, ""));
      onUpload(files, names);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isFirstUpload ? 'Upload Blueprint' : 'Add More Plans'}</DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* File Selection */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${files.length > 0 ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <Upload className={`mb-3 h-10 w-10 ${files.length > 0 ? 'text-primary' : 'text-muted-foreground'}`} />
            <span className="text-sm font-medium text-foreground text-center">
              {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''} selected` : "Click to select PDF(s)"}
            </span>
            {files.length === 0 && (
              <span className="text-xs text-muted-foreground mt-1">You can select multiple files</span>
            )}
          </div>

          {/* Selected Files List */}
          {files.length > 0 && (
            <ScrollArea className="h-48 border rounded-md">
              <div className="p-2 space-y-2">
                {files.map((file, i) => (
                  <div key={i} className="flex justify-between items-center text-sm bg-card px-3 py-2 rounded-lg border shadow-sm">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <span className="truncate pr-3" title={file.name}>{file.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFile(i)}
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={files.length === 0}
          >
            {isFirstUpload ? 'Start Project' : 'Add Plans'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UploadModal;
