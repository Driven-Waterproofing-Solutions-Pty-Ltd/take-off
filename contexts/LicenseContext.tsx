import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { useToast } from './ToastContext';
import { Loader2 } from 'lucide-react';

interface LicenseContextType {
  isLicensed: boolean;
  licenseExpiration: Date | null;
  checkingLicense: boolean;
  refreshLicense: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextType | undefined>(undefined);

export const LicenseProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { addToast } = useToast();
  const [isLicensed, setIsLicensed] = useState(true); // Always licensed
  const [checkingLicense, setCheckingLicense] = useState(false); // No checking needed
  const [licenseExpiration, setLicenseExpiration] = useState<Date | null>(null); // No expiration

  const checkLicense = async () => {
    // No license check needed
  };

  useEffect(() => {
    // No effect needed
  }, []);

  return (
    <LicenseContext.Provider value={{ isLicensed, licenseExpiration, checkingLicense, refreshLicense: checkLicense }}>
      {children}
    </LicenseContext.Provider>
  );
};

export const useLicense = () => {
  const context = useContext(LicenseContext);
  if (context === undefined) {
    throw new Error('useLicense must be used within a LicenseProvider');
  }
  return context;
};