use serde::{Deserialize, Serialize};
use reqwest::Client;
use machine_uid::get as get_machine_uid;

#[derive(Serialize, Deserialize, Debug)]
pub struct LicenseResponse {
    valid: bool,
    message: String,
    token: Option<String>,
    expires_at: Option<String>,
    license_type: Option<String>,
}

#[derive(Serialize)]
struct VerifyParams {
    p_key: String,
    p_machine_id: String,
}

// Internal struct to match Supabase RPC return
#[derive(Deserialize)]
struct RpcResponse {
    valid: bool,
    message: String,
    expires_at: Option<String>,
    license_type: Option<String>,
}

const SUPABASE_URL: &str = "https://poyashauvewhifohkxeg.supabase.co";
const SUPABASE_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBveWFzaGF1dmV3aGlmb2hreGVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NTI2OTgsImV4cCI6MjA4MDUyODY5OH0.WWDtyUhPo1GO48sgDGPi5RCHmTvzvzMSSckTyAAqiwA";

#[tauri::command]
pub fn get_machine_id() -> Result<String, String> {
    get_machine_uid().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn verify_license(key: String) -> Result<LicenseResponse, String> {
    let machine_id = get_machine_uid().map_err(|e| e.to_string())?;
    
    // 1. Online Verification
    let client = Client::new();
    let params = VerifyParams {
        p_key: key.clone(),
        p_machine_id: machine_id.clone(),
    };

    let response = client
        .post(format!("{}/rest/v1/rpc/verify_license_key", SUPABASE_URL))
        .header("apikey", SUPABASE_KEY)
        .header("Authorization", format!("Bearer {}", SUPABASE_KEY))
        .header("Content-Type", "application/json")
        .json(&params)
        .send()
        .await;

    match response {
        Ok(res) => {
            if res.status().is_success() {
                // Parse the response as JSON directly
                match res.json::<RpcResponse>().await {
                    Ok(rpc_data) => {
                        return Ok(LicenseResponse {
                            valid: rpc_data.valid,
                            message: rpc_data.message,
                            token: None, // We aren't using this token field much, but keeping for compatibility
                            expires_at: rpc_data.expires_at,
                            license_type: rpc_data.license_type,
                        });
                    },
                    Err(_) => {
                         return Ok(LicenseResponse {
                            valid: false,
                            message: "Failed to parse license server response".to_string(),
                            token: None,
                            expires_at: None,
                            license_type: None,
                        });
                    }
                }
             } else {
                 // Try to get error text
                 return Ok(LicenseResponse {
                    valid: false,
                    message: "Server returned error".to_string(),
                    token: None,
                    expires_at: None,
                    license_type: None,
                });
            }
        }
        Err(_) => {
            // Network error, fall through to offline check
        }
    }

    // 2. Offline Verification (RSA)
    // Placeholder: In a real app, 'key' would be a signed JWT or similar.
    // Here we just fail if online check failed for now, as we don't have the public key.
    
    Ok(LicenseResponse {
        valid: false,
        message: "Could not verify license (Network error and offline check failed)".to_string(),
        token: None,
        expires_at: None,
        license_type: None,
    })
}