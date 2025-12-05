
import React, { useState, useRef } from 'react';
import { Upload, X } from 'lucide-react';

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length > 0) {
      const names = files.map(f => f.name.replace(/\.[^/.]+$/, ""));
      onUpload(files, names);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[100]" onMouseDown={(e) => e.stopPropagation()}>
      <div className="bg-white rounded-2xl shadow-2xl w-[450px] overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-900">
            {isFirstUpload ? 'Upload Blueprint' : 'Add More Plans'}
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* File Selection */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${files.length > 0 ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50/50'}`}
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
            <Upload className={`mb-3 ${files.length > 0 ? 'text-slate-900' : 'text-slate-400'}`} size={32} />
            <span className="text-sm font-medium text-slate-700 text-center">
              {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''} selected` : "Click to select PDF(s)"}
            </span>
            {files.length === 0 && (
              <span className="text-xs text-slate-400 mt-1">You can select multiple files</span>
            )}
          </div>

          {/* Selected Files List */}
          {files.length > 0 && (
            <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg bg-slate-50 p-2 space-y-1.5">
              {files.map((file, i) => (
                <div key={i} className="flex justify-between items-center text-sm bg-white px-3 py-2 rounded-lg shadow-sm border border-slate-100 hover:border-slate-200 transition-colors">
                  <span className="truncate flex-1 pr-3 text-slate-700">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-1 rounded transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onCancel} className="text-slate-600 px-4 py-2 text-sm font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button
              type="submit"
              disabled={files.length === 0}
              className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg text-sm font-medium shadow-sm transition-all"
            >
              {isFirstUpload ? 'Start Project' : 'Add Plans'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UploadModal;
