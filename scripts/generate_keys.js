import { generateKeyPairSync } from 'crypto';
import fs from 'fs';

console.log("Generating RSA Key Pair for License Signing...");

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
    },
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
    }
});

console.log("\n--- PUBLIC KEY (Put this in services/licenseService.ts) ---\n");
console.log(publicKey);

console.log("\n--- PRIVATE KEY (Set this as LICENSE_PRIVATE_KEY secret in Supabase) ---\n");
console.log(privateKey);

// Optional: Save to files
// fs.writeFileSync('public.pem', publicKey);
// fs.writeFileSync('private.pem', privateKey);
