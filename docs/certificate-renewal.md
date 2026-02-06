# Certificate & Provisioning Profile Renewal

Certificates expire ~1 year after creation. When they expire, CI builds will fail.
This doc covers how to renew everything and update GitHub secrets.

## What expires and when

| Asset | Type | Check expiry |
|---|---|---|
| Apple Distribution cert | Signs the .app | Keychain Access > My Certificates > check expiry date |
| Mac Installer Distribution cert | Signs the .pkg | Keychain Access > My Certificates > check expiry date |
| Distribution provisioning profile | Links app ID + cert | Apple Developer portal > Profiles |
| App Store Connect API key (.p8) | **Does not expire** | N/A |

## Step 1: Renew the Apple Distribution certificate

1. Go to https://developer.apple.com/account/resources/certificates/add
2. Select **"Apple Distribution"**
3. You need a CSR file. If you don't have one saved:
   - Open **Keychain Access** > Certificate Assistant > Request a Certificate from a Certificate Authority
   - Email: `ptheofan@gmail.com`, Common Name: `ARALU Single Member P.C.`
   - Select "Saved to disk"
4. Upload the CSR, download the `.cer` file
5. Double-click the `.cer` to install in Keychain
6. **Revoke the old certificate** in the portal (it's expired anyway)

## Step 2: Renew the Mac Installer Distribution certificate

1. Go to https://developer.apple.com/account/resources/certificates/add
2. Select **"Mac Installer Distribution"**
3. Upload the same CSR file
4. Download the `.cer`, double-click to install
5. Revoke the old certificate

## Step 3: Regenerate the provisioning profile

The profile is bound to a specific certificate. When you renew the cert, the old profile becomes invalid.

1. Go to https://developer.apple.com/account/resources/profiles/list
2. Find the **Mac App Distribution** profile for `com.aralu.markdown-viewer`
3. Click it > **Edit** (or delete and recreate)
4. Select the **new Apple Distribution** certificate
5. Download the new `.provisionprofile`

## Step 4: Export the new certificates as .p12

For each new certificate:

1. Open **Keychain Access** > **My Certificates**
2. Find the certificate (e.g. "Apple Distribution: ARALU Single Member P.C.")
3. Right-click > **Export...** > format: `.p12`
4. Set a password (remember it!)

## Step 5: Update GitHub secrets

Base64-encode and update each secret:

```bash
# Apple Distribution certificate
base64 -i apple_distribution.p12 | pbcopy
# Paste into GitHub secret: MACOS_CERTIFICATE
# Update MACOS_CERTIFICATE_PWD with the new password

# Mac Installer Distribution certificate
base64 -i mac_installer.p12 | pbcopy
# Paste into GitHub secret: MAC_INSTALLER_CERTIFICATE
# Update MAC_INSTALLER_CERTIFICATE_PWD with the new password

# Provisioning profile
base64 -i dist.provisionprofile | pbcopy
# Paste into GitHub secret: MAS_PROVISIONING_PROFILE
```

Also copy the new provisioning profile locally:
```bash
cp dist.provisionprofile resources/provisioning/dist.provisionprofile
```

## Step 6: Verify

Run locally:
```bash
fastlane mac build
fastlane mac pkg
```

Then push a test tag to trigger CI:
```bash
git tag v<next-version>
git push origin v<next-version>
```

## GitHub secrets reference

| Secret | Content |
|---|---|
| `MACOS_CERTIFICATE` | base64 of Apple Distribution .p12 |
| `MACOS_CERTIFICATE_PWD` | Password for the .p12 above |
| `MAC_INSTALLER_CERTIFICATE` | base64 of Mac Installer Distribution .p12 |
| `MAC_INSTALLER_CERTIFICATE_PWD` | Password for the .p12 above |
| `MAS_PROVISIONING_PROFILE` | base64 of distribution .provisionprofile |
| `APPLE_API_KEY` | base64 of AuthKey_ZR355Z7Z2L.p8 (does not expire) |
| `APPLE_API_KEY_ID` | `ZR355Z7Z2L` (does not expire) |
| `APPLE_API_ISSUER` | `8bae5749-c5e4-49aa-8c9c-76987e155341` (does not expire) |
| `APPLE_TEAM_ID` | `KGRHL55T3R` (does not expire) |
| `MACOS_KEYCHAIN_PWD` | Random password for CI temp keychain (does not expire) |
