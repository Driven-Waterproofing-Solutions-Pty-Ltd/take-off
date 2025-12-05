import React, { useState, useEffect } from 'react';

interface PromptModalProps {
  isOpen: boolean;
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  confirmText?: string;
}

const PromptModal: React.FC<PromptModalProps> = ({ 
  isOpen, 
  title, 
  message, 
  defaultValue = '', 
  placeholder = '', 
  onConfirm, 
  onCancel,
  confirmText = "OK"
}) => {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (isOpen) setValue(defaultValue);
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(value);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[100]" onMouseDown={(e) => e.stopPropagation()}>
      <div className="bg-white rounded-xl shadow-xl w-96 p-6 animate-in zoom-in-95 duration-200">
        <h3 className="font-bold text-lg text-slate-800 mb-2">{title}</h3>
        {message && <p className="text-slate-600 text-sm mb-4">{message}</p>}
        
        <form onSubmit={handleSubmit}>
          <input 
            autoFocus
            className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-900 focus:border-slate-900 outline-none mb-6 text-slate-900"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />

          <div className="flex justify-end gap-3">
            <button 
              type="button"
              onClick={onCancel} 
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {confirmText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PromptModal;