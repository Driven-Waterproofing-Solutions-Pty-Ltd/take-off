import React from 'react';
import LicenseManager from './LicenseManager';
import {
    Dialog,
    DialogContent,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

interface LicenseSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const LicenseSettingsModal: React.FC<LicenseSettingsModalProps> = ({ isOpen, onClose }) => {
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[550px] p-0 gap-0 overflow-hidden">
                <ScrollArea className="max-h-[80vh]">
                    <LicenseManager forceRefreshOnMount={true} showHeader={true} />
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
};

export default LicenseSettingsModal;
