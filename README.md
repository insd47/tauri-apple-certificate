# Prepare Tauri Apple Certificate

A GitHub Action to import an Apple .p12 certificate into a temporary macOS keychain for Tauri code signing, find a matching identity by prefix, and expose certificate info as action outputs. The action generates the keychain password at runtime and removes the keychain in a post step.

## Features
- Accepts a base64-encoded .p12 certificate and its password.
- Accepts an identity prefix (default: `Apple Development`) to select the certificate identity.
- Generates a random keychain password at runtime (no secret required for the keychain).
- Imports the certificate, allows codesign access, and finds the matching identity.
- Cleans up by deleting the created keychain in the post action.

## Inputs
- `apple-certificate` (required) — base64-encoded .p12 certificate (use a GitHub secret).
- `apple-certificate-password` (required) — password for the .p12 certificate (use a GitHub secret).
- `identity-prefix` (optional) — identity name prefix to match (default: `Apple Development`).

## Outputs
- `cert-id` — the quoted certificate identity matched by the prefix (e.g. `Apple Development: My Name (TEAMID)`).
- `cert-info` — the full line returned by `security find-identity` for the matched identity.

## Example usage
```yaml
- name: Prepare Apple Certificate
  uses: insd47/tauri-apple-certificate@v1
  with:
    apple-certificate: ${{ secrets.APPLE_CERTIFICATE }}
    apple-certificate-password: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
    identity-prefix: Apple Distribution
# then use: ${{ steps.<id>.outputs.cert-id }}
```

Note: This action runs on macOS runners and requires the compiled JS entrypoints referenced in `action.yml` (dist/index.js and dist/post/index.js).

## Packaging / Release notes
- When publishing the action (tag/release), ensure the compiled `dist/` files are committed and included in the release. GitHub does not build the TypeScript for actions at runtime, so leaving `dist/` in `.gitignore` will break consumers.
- Alternatively, produce a release artifact that contains the compiled `dist/` files.

## Security
- Keep the `.p12` and its password in GitHub Secrets.
- The action writes the certificate to a temporary directory on the runner; runners are ephemeral but avoid logging secrets.
- The action deletes the created keychain in the post step; confirm your workflow uses the action with a `post` run (action.yml defines a post step).

## Troubleshooting
- If no identity matches the prefix, the action will print the available identities for debugging and fail.
- Ensure the runner is macOS and has `security` and `codesign` available (GitHub-hosted macOS runners do).

License: MIT