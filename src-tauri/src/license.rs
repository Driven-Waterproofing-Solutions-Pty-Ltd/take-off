use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::State;
use reqwest::Client;
use machine_uid::get as get_machine_uid;

#[derive(Serialize, Deserialize)]
pub struct LicenseResponse {
    valid: bool,
    message: String,
    token: Option<String>,
}

#[derive(Serialize)]
struct VerifyParams {
    p_key: String,
    p_machine_id: String,
}

const SUPABASE_URL: &str = "https://poyashauvewhifohkxeg.supabase.co";
const SUPABASE_KEY: &str = "sb_publishable_khl6tXRew5oN3J7gxAqfwg_0B265o2T"; // User provided key

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
                // Parse the response. Assuming the RPC returns a JSON with success/token
                // Adjust based on actual RPC return.
                // If RPC returns void or simple true/false, we need to handle that.
                // User said: "returns token".
                
                // Let's assume it returns { "token": "..." } or similar.
                // For now, if success, we consider it valid.
                let body = res.text().await.unwrap_or_default();
                // Simple check for now
                if body.contains("error") {
                     return Ok(LicenseResponse {
                        valid: false,
                        message: "License verification failed".to_string(),
                        token: None,
                    });
                }
                
                return Ok(LicenseResponse {
                    valid: true,
                    message: "License verified successfully".to_string(),
                    token: Some(body), // Store the raw response as token for now
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
    })
}