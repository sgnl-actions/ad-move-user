# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **SGNL Action** that moves objects in on-premise Active Directory via LDAP/LDAPS. It runs on SGNL's CAEP Hub as a Node.js 20 job.

## Repository Structure

```
ad-move-object/
├── src/
│   └── script.mjs       # Main action implementation
├── tests/
│   └── script.test.js   # Jest unit tests
├── scripts/
│   ├── dev-runner.js    # Local development testing
│   └── validate-metadata.js
├── dist/                # Built output (committed for job service)
├── metadata.yaml        # Action inputs/outputs definition
├── package.json         # Dependencies and scripts
└── rollup.config.mjs    # Build configuration
```

## Common Commands

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build for production
npm run build

# Local development testing (requires ../.env with credentials)
npm run dev

# Validate metadata.yaml
npm run validate

# Lint code
npm run lint
```

## Key Implementation Details

### LDAP modifyDN Operation

The action uses `client.modifyDN(currentDN, newDN)` to move objects:
- `currentDN`: The current full DN of the object
- `newDN`: The complete new DN including parent (e.g., "CN=John Doe,OU=DisabledUsers,DC=example,DC=com")

Note: The ldapts library accepts the full new DN as the second parameter, not separate RDN and parent parameters.

### RDN Extraction

The script extracts and preserves the RDN prefix:
- `CN=` for users, groups, computers
- `OU=` for organizational units
- Other prefixes are supported automatically

### Environment Configuration

The action reads configuration from context:
- `context.environment.ADDRESS`: LDAP server URL
- `context.environment.TLS_SKIP_VERIFY`: Skip TLS verification
- `context.secrets.LDAP_BIND_DN`: Bind account DN
- `context.secrets.LDAP_BIND_PASSWORD`: Bind account password

### Script Handlers

The script exports three handlers:
- `invoke`: Main execution - moves the object
- `error`: Error classification and recovery
- `halt`: Graceful shutdown handling

## Testing

Tests use Jest with ES module support. Mock the ldapts Client for unit tests:

```javascript
jest.unstable_mockModule('ldapts', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bind: mockBind,
    unbind: mockUnbind,
    modifyDN: mockModifyDN
  }))
}));
```

## Important Notes

- The `dist/` directory must be committed (required by job service)
- Use `--env-file=../.env` for local development credentials
- LDAPS (port 636) is recommended for production
- Works with any AD object type (users, groups, OUs, computers, etc.)
