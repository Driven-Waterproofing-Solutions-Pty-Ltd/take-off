import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { licenseService } from '../services/licenseService';
import { useToast } from './ToastContext';
import { Loader2 } from 'lucide-react';
import LicenseModal from '../components/LicenseModal';

interface LicenseContextType {
  isLicensed: boolean;
  licenseExpiration: Date | null;
  checkingLicense: boolean;
  refreshLicense: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextType | undefined>(undefined);

export const LicenseProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { addToast } = useToast();
  const [isLicensed, setIsLicensed] = useState(false);
  const [checkingLicense, setCheckingLicense] = useState(true);
  const [licenseExpiration, setLicenseExpiration] = useState<Date | null>(null);
  const [licenseError, setLicenseError] = useState<string | null>(null);

  const checkLicense = async () => {
    try {
      const res = await licenseService.checkLicense();
      if (res.valid) {
        setIsLicensed(true);
        if (res.expiresAt) setLicenseExpiration(new Date(res.expiresAt));
        setLicenseError(null);
      } else {
        setIsLicensed(false);
        if (res.message) {
          // Only show toast on initial load or explicit refresh, maybe not needed here if handled by UI
          // addToast(res.message, 'error'); 
          setLicenseError(res.message);
        }
      }
    } catch (e) {
      console.error("Failed to load license", e);
      setLicenseError("Failed to check license status.");
    } finally {
      setCheckingLicense(false);
    }
  };

  useEffect(() => {
    checkLicense();
  }, []);

  if (checkingLicense) {
    return (
      <div className="h-screen w-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  if (!isLicensed) {
    return <LicenseModal onSuccess={() => checkLicense()} initialMessage={licenseError} />;
  }

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