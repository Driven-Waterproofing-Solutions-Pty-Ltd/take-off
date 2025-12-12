import React from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck } from 'lucide-react';
import LicenseManager from './LicenseManager';

interface LicenseSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const LicenseSettingsModal: React.FC<LicenseSettingsModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <ShieldCheck size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">License Management</h2>
                            <p className="text-xs text-slate-500">Manage your subscription & activation</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto bg-white">
                    <LicenseManager forceRefreshOnMount={true} />
                </div>
            </div>
        </div>,
        document.body
    );
};

export default LicenseSettingsModal;
