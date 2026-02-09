# AD Move Object

Move any Active Directory object (users, groups, OUs, computers, etc.) to a new parent container/OU via LDAP.

## Overview

This action moves AD objects using the LDAP `modifyDN` operation with support for:
- Moving any object type (users, groups, OUs, computers, etc.)
- Optional renaming during move
- Dry run mode for validation

## Inputs

| Name | Type | Required | Description | Example |
|------|------|----------|-------------|---------|
| `objectDN` | text | Yes | Current Distinguished Name of the object to move | `CN=John Doe,OU=Users,DC=corp,DC=example,DC=com` |
| `newParentDN` | text | Yes | Target container/OU DN to move the object into | `OU=DisabledUsers,DC=corp,DC=example,DC=com` |
| `newName` | text | No | New name for the object (without prefix). If omitted, keeps current name | `John Doe (Disabled)` |
| `dry_run` | boolean | No | Validate without making changes | `true` |
| `address` | text | No | Optional LDAP server URL override | `ldaps://ad.corp.example.com:636` |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `status` | text | Operation result (`success`, `halted`, `dry_run_completed`) |
| `previousDN` | text | Original DN before move |
| `newDN` | text | New DN after move |
| `moved` | boolean | Whether the object was moved |
| `renamed` | boolean | Whether the object was renamed during the move |
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

```javascript
{
  objectDN: "CN=John Doe,OU=Users,DC=example,DC=com",
  newParentDN: "OU=DisabledUsers,DC=example,DC=com"
}
```

Result: User moved to `CN=John Doe,OU=DisabledUsers,DC=example,DC=com`

### Move and rename a user

```javascript
{
  objectDN: "CN=John Doe,OU=Users,DC=example,DC=com",
  newParentDN: "OU=DisabledUsers,DC=example,DC=com",
  newName: "John Doe (Disabled)"
}
```

Result: User moved to `CN=John Doe (Disabled),OU=DisabledUsers,DC=example,DC=com`

### Move an OU

```javascript
{
  objectDN: "OU=SalesTeam,OU=Departments,DC=example,DC=com",
  newParentDN: "OU=ArchivedDepartments,DC=example,DC=com"
}
```

Result: OU moved to `OU=SalesTeam,OU=ArchivedDepartments,DC=example,DC=com`

### Move a computer object

```javascript
{
  objectDN: "CN=WORKSTATION01,OU=Workstations,DC=example,DC=com",
  newParentDN: "OU=DecommissionedComputers,DC=example,DC=com"
}
```

### Dry run to validate the move

```javascript
{
  objectDN: "CN=John Doe,OU=Users,DC=example,DC=com",
  newParentDN: "OU=DisabledUsers,DC=example,DC=com",
  dry_run: true
}
```

## Error Handling

### Success Scenarios

- **Object moved**: Returns `status: "success"`, `moved: true`
- **Object moved and renamed**: Returns `status: "success"`, `moved: true`, `renamed: true`

### Retryable Errors

The framework automatically retries on transient errors such as:
- Network connectivity issues
- LDAP server temporarily unavailable
- Connection timeouts

### Fatal Errors

| LDAP Code | Error | Description |
|-----------|-------|-------------|
| 32 | No Such Object | The object DN does not exist |
| 68 | Entry Already Exists | An object with the same name already exists at the target location |
| 49 | Invalid Credentials | Bind DN or password is incorrect |
| 50 | Insufficient Access Rights | Service account lacks permission to move objects |
| 34 | Invalid DN Syntax | Malformed Distinguished Name |

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

1. **"Missing LDAP bind credentials"**
   - Ensure `LDAP_BIND_DN` and `LDAP_BIND_PASSWORD` are set in secrets
   - Verify the bind DN is a valid Distinguished Name

2. **"No URL specified"**
   - Ensure the `ADDRESS` environment variable is set or `address` is provided in params
   - Verify the URL format (e.g., `ldaps://ad.corp.example.com:636`)

3. **"Invalid credentials"**
   - Verify the service account DN and password are correct
   - Check that the account is not locked or expired in Active Directory

4. **"Insufficient access rights"**
   - Verify the service account has permission to move objects between containers
   - The account needs Delete permission on the source and Create permission on the target

5. **"No such object"**
   - Verify the object DN exists in Active Directory
   - Verify the target parent DN exists
   - Check for typos in the Distinguished Names

6. **"Entry already exists"**
   - An object with the same name already exists at the target location
   - Use a different `newName` or move the existing object first

7. **TLS/SSL connection errors**
   - Verify the LDAP server is accessible on the configured port
   - For LDAPS, ensure the server certificate is trusted or set `TLS_SKIP_VERIFY=true` for testing
   - Check that the correct port is used (389 for LDAP, 636 for LDAPS)

### Verifying Object Location

To verify the action worked correctly, you can check the object location using:

```bash
# Using ldapsearch
ldapsearch -H ldaps://ad.corp.example.com:636 \
  -D "CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com" \
  -W -b "DC=corp,DC=example,DC=com" \
  "(cn=John Doe)" dn

# Using PowerShell
Get-ADUser -Identity "John Doe" | Select-Object DistinguishedName
```

## Support

- [ldapts Documentation](https://github.com/ldapts/ldapts)
- [Active Directory LDAP Reference](https://docs.microsoft.com/en-us/windows/win32/ad/active-directory-domain-services)
- [SGNL Actions Documentation](https://github.com/sgnl-actions)

## License

MIT License - see [LICENSE](LICENSE) for details.
