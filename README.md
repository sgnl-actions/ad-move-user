# Active Directory Move User Action

Move a user to a new parent container/OU in Active Directory via LDAP/LDAPS.

## Overview

This action moves AD users using the LDAP `modifyDN` operation. It first looks up the user by their `sAMAccountName`, resolves their Distinguished Name, then performs the move to the specified target OU/container. The action supports comprehensive error handling through the enhanced SGNL testing framework.

Key capabilities:
- **User lookup by sAMAccountName**: Searches the base DN to resolve the user's Distinguished Name
- **Idempotent operations**: AD accepts move to the same location as a no-op, returning success
- **Optional renaming during move**: Rename the user's CN as part of the move operation
- **Dry run mode**: Validate parameters without making changes to Active Directory
- **LDAP filter escaping**: Prevents injection via special characters in sAMAccountName
- **Comprehensive testing**: Scenario-based testing framework with full ldapts mocking and 10 test scenarios

## Prerequisites

- Network access to an Active Directory Domain Controller (LDAP port 389 or LDAPS port 636)
- A service account with permission to **move user objects** between containers/OUs

## Configuration

### Authentication

| Secret | Description |
|--------|-------------|
| `LDAP_BIND_DN` | Bind DN of the service account (e.g., `CN=svc-sgnl,OU=Service Accounts,DC=example,DC=com`) |
| `LDAP_BIND_PASSWORD` | Password for the service account |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ADDRESS` | LDAP/LDAPS URL of the Domain Controller (e.g., `ldaps://dc.example.com:636`) | Required |
| `TLS_SKIP_VERIFY` | Set to `true` to skip TLS certificate verification | `false` |

### Input Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `baseDN` | text | Yes | Base DN to search for the user | `DC=corp,DC=example,DC=com` |
| `samAccountName` | text | Yes | The user's sAMAccountName (pre-Windows 2000 logon name) | `jdoe` |
| `newParentDN` | text | Yes | Target container/OU DN to move the user into | `OU=DisabledUsers,DC=corp,DC=example,DC=com` |
| `newName` | text | No | New name for the user (without prefix). If omitted, keeps current name | `John Doe (Disabled)` |
| `dry_run` | boolean | No | Validate without making changes | `true` |
| `address` | text | No | Optional LDAP server URL override | `ldaps://ad.corp.example.com:636` |

### Output

| Field | Type | Description |
|-------|------|-------------|
| `status` | text | Operation result (`success`, `halted`, `dry_run_completed`) |
| `userDN` | text | The resolved Distinguished Name of the user |
| `previousDN` | text | Original DN before move |
| `newDN` | text | New DN after move |
| `moved` | boolean | Whether the user was moved |
| `renamed` | boolean | Whether the user was renamed during the move |
| `address` | text | LDAP server address used |

## Usage Examples

### Move a User to a Different OU

```json
{
  "baseDN": "DC=corp,DC=example,DC=com",
  "samAccountName": "jdoe",
  "newParentDN": "OU=DisabledUsers,DC=corp,DC=example,DC=com"
}
```

The action will lookup the user by sAMAccountName, find their DN (e.g., `CN=John Doe,OU=Users,DC=corp,DC=example,DC=com`), and move them to the new location.

### Move and Rename a User

```json
{
  "baseDN": "DC=corp,DC=example,DC=com",
  "samAccountName": "jdoe",
  "newParentDN": "OU=DisabledUsers,DC=corp,DC=example,DC=com",
  "newName": "John Doe (Disabled)"
}
```

Result: User moved to `CN=John Doe (Disabled),OU=DisabledUsers,DC=corp,DC=example,DC=com`

### Dry Run to Validate the Move

```json
{
  "baseDN": "DC=corp,DC=example,DC=com",
  "samAccountName": "jdoe",
  "newParentDN": "OU=DisabledUsers,DC=corp,DC=example,DC=com",
  "dry_run": true
}
```

### Skip TLS Verification

For development or self-signed certificate environments:

```json
{
  "environment": {
    "ADDRESS": "ldaps://dc.dev.example.com:636",
    "TLS_SKIP_VERIFY": "true"
  }
}
```

## Error Handling

### Success Scenarios

- **User moved** — returns `status: "success"`, `moved: true`
- **User moved and renamed** — returns `status: "success"`, `moved: true`, `renamed: true`

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

- Use LDAPS (port 636) in production to encrypt credentials and data in transit
- Only skip TLS verification (`TLS_SKIP_VERIFY=true`) in development environments
- The service account should have minimal permissions — only the ability to move objects between the relevant containers/OUs
- Bind credentials are provided via secrets and are never logged
- Connections are unbound in a `finally` block to prevent resource leaks
- Special characters in sAMAccountName are escaped to prevent LDAP injection

## Development

### Setup

```bash
npm install
```

### Run tests

This action uses the enhanced SGNL testing framework with comprehensive LDAP mocking support. All 10 test scenarios validate user moving, idempotency, error handling, and dry run behavior:

```bash
npm test
```

The test suite includes:
- Successful move of a user to a new OU
- Idempotent behavior when moving to the same OU
- Entry already exists at target handling
- User not found handling
- Authentication and permission failure handling
- Dry run validation
- Missing required parameter validation (baseDN, samAccountName, newParentDN)

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

Copy the sample environment file and configure with your AD credentials:

```bash
cp .env.sample .env
```

Then edit `.env` with your actual values:

```
AD_ADDRESS=ldap://your-dc.example.com:389
LDAP_BIND_DN=CN=admin,DC=example,DC=com
LDAP_BIND_PASSWORD=your-password
TLS_SKIP_VERIFY=false

# Test parameters - customize as needed
BASE_DN=DC=corp,DC=example,DC=com
SAM_ACCOUNT_NAME=jdoe
NEW_PARENT_DN=OU=DisabledUsers,DC=corp,DC=example,DC=com
NEW_NAME=
DRY_RUN=false
```

Then run:

```bash
npm run dev
```

## Troubleshooting

### Connection Issues

- Verify the Domain Controller is reachable: `telnet dc.example.com 636`
- Check that the `ADDRESS` environment variable includes the protocol and port: `ldaps://dc.example.com:636`
- For LDAPS, ensure the DC's certificate is trusted or set `TLS_SKIP_VERIFY=true` for testing

### Authentication Failures

- Verify the bind DN format matches your AD structure
- Ensure the service account password has not expired
- Check that the service account is not locked out

### Permission Errors

- The service account needs permission to move objects between containers
- The account needs Delete permission on the source and Create permission on the target OU
- Use AD delegation to grant the appropriate permissions

### User Not Found

- Verify the sAMAccountName is correct (case-insensitive in AD)
- Check that the user exists within the specified `baseDN`

### Entry Already Exists

- An object with the same name already exists at the target location
- Use a different `newName` or move the existing object first

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

- [ldapts Documentation](https://github.com/ldapts/ldapts) - LDAP client library used for Active Directory operations
- [SGNL Testing Framework](https://github.com/sgnl-actions/testing) - Enhanced testing with LDAP mocking capabilities
- [Active Directory LDAP Reference](https://docs.microsoft.com/en-us/windows/win32/ad/active-directory-domain-services)
- [SGNL Actions Documentation](https://github.com/sgnl-actions)
