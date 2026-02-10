# AD Move User

Move a user to a new parent container/OU in Active Directory via LDAP.

## Overview

This action moves AD users using the LDAP `modifyDN` operation with support for:
- User lookup by sAMAccountName
- Optional renaming during move
- Dry run mode for validation

## Inputs

| Name | Type | Required | Description | Example |
|------|------|----------|-------------|---------|
| `baseDN` | text | Yes | Base DN to search for the user | `DC=corp,DC=example,DC=com` |
| `samAccountName` | text | Yes | The user's sAMAccountName (pre-Windows 2000 logon name) | `jdoe` |
| `newParentDN` | text | Yes | Target container/OU DN to move the user into | `OU=DisabledUsers,DC=corp,DC=example,DC=com` |
| `newName` | text | No | New name for the user (without prefix). If omitted, keeps current name | `John Doe (Disabled)` |
| `dry_run` | boolean | No | Validate without making changes | `true` |
| `address` | text | No | Optional LDAP server URL override | `ldaps://ad.corp.example.com:636` |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `status` | text | Operation result (`success`, `halted`, `dry_run_completed`) |
| `userDN` | text | The resolved Distinguished Name of the user |
| `previousDN` | text | Original DN before move |
| `newDN` | text | New DN after move |
| `moved` | boolean | Whether the user was moved |
| `renamed` | boolean | Whether the user was renamed during the move |
| `address` | text | LDAP server address used |

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| `ADDRESS` | Yes | LDAP server URL (e.g., `ldap://dc.example.com:389`) |
| `TLS_SKIP_VERIFY` | No | Skip TLS certificate verification (`true`/`false`) |

## Secrets

| Name | Required | Description |
|------|----------|-------------|
| `LDAP_BIND_DN` | Yes | DN of the account to bind with |
| `LDAP_BIND_PASSWORD` | Yes | Password for the bind account |

## Examples

### Move a user to a different OU

```json
{
  "baseDN": "DC=corp,DC=example,DC=com",
  "samAccountName": "jdoe",
  "newParentDN": "OU=DisabledUsers,DC=corp,DC=example,DC=com"
}
```

The action will lookup the user by sAMAccountName, find their DN (e.g., `CN=John Doe,OU=Users,DC=corp,DC=example,DC=com`), and move them to the new location.

### Move and rename a user

```json
{
  "baseDN": "DC=corp,DC=example,DC=com",
  "samAccountName": "jdoe",
  "newParentDN": "OU=DisabledUsers,DC=corp,DC=example,DC=com",
  "newName": "John Doe (Disabled)"
}
```

Result: User moved to `CN=John Doe (Disabled),OU=DisabledUsers,DC=corp,DC=example,DC=com`

### Dry run to validate the move

```json
{
  "baseDN": "DC=corp,DC=example,DC=com",
  "samAccountName": "jdoe",
  "newParentDN": "OU=DisabledUsers,DC=corp,DC=example,DC=com",
  "dry_run": true
}
```

## Error Handling

### Success Scenarios

- **User moved**: Returns `status: "success"`, `moved: true`
- **User moved and renamed**: Returns `status: "success"`, `moved: true`, `renamed: true`

### Retryable Errors

| Error | Description |
|-------|-------------|
| Network timeout | Domain Controller unreachable |
| Connection refused | LDAP service not running |
| Server busy | DC under heavy load |

### Fatal Errors

| Error | Description |
|-------|-------------|
| User not found with sAMAccountName | No user exists with the specified sAMAccountName |
| Multiple users found | More than one user matches the sAMAccountName (should not happen in a properly configured AD) |
| Invalid Credentials | Bind DN or password is incorrect |
| Insufficient Access Rights | Service account lacks permission to move objects |
| Entry Already Exists | An object with the same name already exists at the target location |
| Invalid DN Syntax | Malformed Distinguished Name |

## Security Considerations

- **Authentication**: Uses LDAP Simple Bind with a dedicated service account
- **Transport Security**: Supports LDAPS (LDAP over TLS) for encrypted connections
- **TLS Verification**: Certificate verification is enabled by default; `TLS_SKIP_VERIFY` should only be used in development or with self-signed certificates
- **Credential Security**: Bind credentials are provided via secrets and are never logged
- **Connection Lifecycle**: Connections are unbound in a `finally` block to prevent resource leaks
- **LDAP Filter Escaping**: Special characters in sAMAccountName are escaped to prevent LDAP injection

## Development

### Setup

```bash
npm install
```

### Run tests

```bash
npm test
```

### Run tests in watch mode

```bash
npm run test:watch
```

### Build

```bash
npm run build
```

### Validate metadata

```bash
npm run validate
```

### Lint

```bash
npm run lint
npm run lint:fix
```

### Local testing

Create a `../.env` file with your AD credentials:

```
AD_ADDRESS=ldap://your-dc.example.com:389
LDAP_BIND_DN=CN=admin,DC=example,DC=com
LDAP_BIND_PASSWORD=your-password
TLS_SKIP_VERIFY=false
```

Then run:

```bash
npm run dev
```

## Troubleshooting

### Common Issues

1. **"User not found with sAMAccountName"**
   - Verify the sAMAccountName is correct (case-insensitive in AD)
   - Check that the user exists within the specified baseDN

2. **"Multiple users found"**
   - This should not happen in a properly configured AD since sAMAccountName must be unique within a domain

3. **"Missing LDAP bind credentials"**
   - Ensure `LDAP_BIND_DN` and `LDAP_BIND_PASSWORD` are set in secrets
   - Verify the bind DN is a valid Distinguished Name

4. **"No URL specified"**
   - Ensure the `ADDRESS` environment variable is set or `address` is provided in params
   - Verify the URL format (e.g., `ldaps://ad.corp.example.com:636`)

5. **"Invalid credentials"**
   - Verify the service account DN and password are correct
   - Check that the account is not locked or expired in Active Directory

6. **"Insufficient access rights"**
   - Verify the service account has permission to move objects between containers
   - The account needs Delete permission on the source and Create permission on the target

7. **"Entry already exists"**
   - An object with the same name already exists at the target location
   - Use a different `newName` or move the existing object first

8. **TLS/SSL connection errors**
   - Verify the LDAP server is accessible on the configured port
   - For LDAPS, ensure the server certificate is trusted or set `TLS_SKIP_VERIFY=true` for testing
   - Check that the correct port is used (389 for LDAP, 636 for LDAPS)

### Verifying User Location

To verify the action worked correctly, you can check the user location using:

```bash
# Using ldapsearch
ldapsearch -H ldaps://ad.corp.example.com:636 \
  -D "CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com" \
  -W -b "DC=corp,DC=example,DC=com" \
  "(sAMAccountName=jdoe)" dn

# Using PowerShell
Get-ADUser -Identity "jdoe" | Select-Object DistinguishedName
```

## Support

- [ldapts Documentation](https://github.com/ldapts/ldapts)
- [Active Directory LDAP Reference](https://docs.microsoft.com/en-us/windows/win32/ad/active-directory-domain-services)
- [SGNL Actions Documentation](https://github.com/sgnl-actions)
