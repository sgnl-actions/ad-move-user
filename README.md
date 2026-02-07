# AD Move Object

Move any Active Directory object (users, groups, OUs, computers, etc.) to a new parent container/OU via LDAP.

## Overview

This action moves AD objects using the LDAP `modifyDN` operation with support for:
- Moving any object type (users, groups, OUs, computers, etc.)
- Optional renaming during move
- Dry run mode for validation

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `objectDN` | text | Yes | Current Distinguished Name of the object to move |
| `newParentDN` | text | Yes | Target container/OU DN to move the object into |
| `newName` | text | No | New name for the object (without prefix). If omitted, keeps current name |
| `address` | text | No | Optional LDAP/LDAPS URL override |
| `dry_run` | boolean | No | Validate without making changes |

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

## Development

### Setup

```bash
npm install
```

### Run tests

```bash
npm test
```

### Build

```bash
npm run build
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

## License

MIT License - see [LICENSE](LICENSE) for details.
