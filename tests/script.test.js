import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockBind = jest.fn();
const mockUnbind = jest.fn();
const mockModifyDN = jest.fn();
const mockSearch = jest.fn();

jest.unstable_mockModule('ldapts', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bind: mockBind,
    unbind: mockUnbind,
    modifyDN: mockModifyDN,
    search: mockSearch
  }))
}));

const mockGetBaseURL = jest.fn().mockReturnValue('ldaps://dc.example.com:636');

jest.unstable_mockModule('@sgnl-actions/utils', () => ({
  getBaseURL: mockGetBaseURL
}));

const { default: script } = await import('../src/script.mjs');
const { Client } = await import('ldapts');

describe('AD Move User Script', () => {
  const mockContext = {
    environment: {
      ADDRESS: 'ldaps://dc.example.com:636'
    },
    secrets: {
      LDAP_BIND_DN: 'CN=admin,DC=example,DC=com',
      LDAP_BIND_PASSWORD: 'password123'
    },
    outputs: {}
  };

  const defaultParams = {
    baseDN: 'DC=example,DC=com',
    samAccountName: 'jdoe',
    newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
  };

  const mockUserDN = 'CN=John Doe,OU=Users,DC=example,DC=com';

  beforeEach(() => {
    jest.clearAllMocks();
    mockBind.mockResolvedValue(undefined);
    mockUnbind.mockResolvedValue(undefined);
    mockModifyDN.mockResolvedValue(undefined);
    mockGetBaseURL.mockReturnValue('ldaps://dc.example.com:636');
    // Mock search to return user DN
    mockSearch.mockResolvedValue({
      searchEntries: [{ dn: mockUserDN }]
    });
  });

  describe('invoke handler', () => {
    test('should move user to new OU', async () => {
      const result = await script.invoke(defaultParams, mockContext);

      expect(result.status).toBe('success');
      expect(result.userDN).toBe(mockUserDN);
      expect(result.previousDN).toBe(mockUserDN);
      expect(result.newDN).toBe('CN=John Doe,OU=DisabledUsers,DC=example,DC=com');
      expect(result.moved).toBe(true);
      expect(result.renamed).toBe(false);

      // Verify search was called to find user
      expect(mockSearch).toHaveBeenCalledWith(defaultParams.baseDN, {
        scope: 'sub',
        filter: `(&(objectClass=user)(sAMAccountName=${defaultParams.samAccountName}))`,
        attributes: ['distinguishedName']
      });

      // Verify modifyDN was called with resolved DN
      expect(mockModifyDN).toHaveBeenCalledWith(
        mockUserDN,
        'CN=John Doe,OU=DisabledUsers,DC=example,DC=com'
      );
    });

    test('should move and rename user simultaneously', async () => {
      const params = {
        ...defaultParams,
        newName: 'John Doe (Disabled)'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.previousDN).toBe(mockUserDN);
      expect(result.newDN).toBe('CN=John Doe (Disabled),OU=DisabledUsers,DC=example,DC=com');
      expect(result.moved).toBe(true);
      expect(result.renamed).toBe(true);

      expect(mockModifyDN).toHaveBeenCalledWith(
        mockUserDN,
        'CN=John Doe (Disabled),OU=DisabledUsers,DC=example,DC=com'
      );
    });

    test('should throw when user not found', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [] });

      await expect(script.invoke(defaultParams, mockContext)).rejects.toThrow(
        'User not found with sAMAccountName: jdoe'
      );

      expect(mockModifyDN).not.toHaveBeenCalled();
      expect(mockUnbind).toHaveBeenCalled();
    });

    test('should throw when multiple users found', async () => {
      mockSearch.mockResolvedValueOnce({
        searchEntries: [
          { dn: 'CN=John Doe,OU=Users,DC=example,DC=com' },
          { dn: 'CN=Jane Doe,OU=Users,DC=example,DC=com' }
        ]
      });

      await expect(script.invoke(defaultParams, mockContext)).rejects.toThrow(
        'Multiple users found with sAMAccountName: jdoe. Expected exactly one.'
      );

      expect(mockModifyDN).not.toHaveBeenCalled();
      expect(mockUnbind).toHaveBeenCalled();
    });

    test('should handle dry run without making changes', async () => {
      const params = {
        ...defaultParams,
        dry_run: true
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('dry_run_completed');
      expect(result.baseDN).toBe(defaultParams.baseDN);
      expect(result.samAccountName).toBe(defaultParams.samAccountName);
      expect(result.userDN).toBeNull();
      expect(result.previousDN).toBeNull();
      expect(result.newDN).toBeNull();
      expect(result.moved).toBe(false);
      expect(result.renamed).toBe(false);
      expect(mockBind).not.toHaveBeenCalled();
      expect(mockSearch).not.toHaveBeenCalled();
      expect(mockModifyDN).not.toHaveBeenCalled();
    });

    test('should handle dry run with rename', async () => {
      const params = {
        ...defaultParams,
        newName: 'John Doe (Disabled)',
        dry_run: true
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('dry_run_completed');
      expect(result.renamed).toBe(true);
      expect(mockModifyDN).not.toHaveBeenCalled();
    });

    test('should throw when baseDN is missing', async () => {
      const params = {
        samAccountName: 'jdoe',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow(
        'baseDN is required'
      );
      expect(mockBind).not.toHaveBeenCalled();
    });

    test('should throw when samAccountName is missing', async () => {
      const params = {
        baseDN: 'DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow(
        'samAccountName is required'
      );
      expect(mockBind).not.toHaveBeenCalled();
    });

    test('should throw when newParentDN is missing', async () => {
      const params = {
        baseDN: 'DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow(
        'newParentDN is required'
      );
      expect(mockBind).not.toHaveBeenCalled();
    });

    test('should throw on missing LDAP_BIND_DN', async () => {
      const context = {
        ...mockContext,
        secrets: { ...mockContext.secrets, LDAP_BIND_DN: '' }
      };

      await expect(script.invoke(defaultParams, context)).rejects.toThrow('LDAP_BIND_DN secret is required');
    });

    test('should throw on missing LDAP_BIND_PASSWORD', async () => {
      const context = {
        ...mockContext,
        secrets: { ...mockContext.secrets, LDAP_BIND_PASSWORD: '' }
      };

      await expect(script.invoke(defaultParams, context)).rejects.toThrow('LDAP_BIND_PASSWORD secret is required');
    });

    test('should propagate LDAP error when target already has object', async () => {
      mockModifyDN.mockRejectedValue(
        Object.assign(new Error('Entry already exists'), { code: 68 })
      );

      await expect(script.invoke(defaultParams, mockContext)).rejects.toThrow('Entry already exists');
    });

    test('should set rejectUnauthorized false when TLS_SKIP_VERIFY is true', async () => {
      const context = {
        ...mockContext,
        environment: { ...mockContext.environment, TLS_SKIP_VERIFY: 'true' }
      };

      await script.invoke(defaultParams, context);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldaps://dc.example.com:636',
        timeout: 10000,
        connectTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
      });
    });

    test('should set rejectUnauthorized to true for ldaps:// URLs when TLS_SKIP_VERIFY is not set', async () => {
      await script.invoke(defaultParams, mockContext);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldaps://dc.example.com:636',
        timeout: 10000,
        connectTimeout: 10000,
        tlsOptions: { rejectUnauthorized: true }
      });
    });

    test('should not include tlsOptions for ldap:// URLs when TLS_SKIP_VERIFY is not set', async () => {
      mockGetBaseURL.mockReturnValue('ldap://dc.example.com:389');

      await script.invoke(defaultParams, mockContext);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldap://dc.example.com:389',
        timeout: 10000,
        connectTimeout: 10000
      });
    });

    test('should handle unbind errors gracefully', async () => {
      mockUnbind.mockRejectedValue(new Error('Unbind failed'));

      const result = await script.invoke(defaultParams, mockContext);

      expect(result.status).toBe('success');
      expect(mockUnbind).toHaveBeenCalled();
    });

    test('should not mask original error when unbind also fails', async () => {
      mockModifyDN.mockRejectedValue(new Error('ModifyDN operation failed'));
      mockUnbind.mockRejectedValue(new Error('Unbind failed'));

      await expect(script.invoke(defaultParams, mockContext)).rejects.toThrow('ModifyDN operation failed');
    });

    test('should escape special characters in samAccountName for LDAP filter', async () => {
      const paramsWithSpecialChars = {
        ...defaultParams,
        samAccountName: 'john*doe'
      };

      mockSearch.mockResolvedValueOnce({
        searchEntries: [{ dn: mockUserDN }]
      });

      await script.invoke(paramsWithSpecialChars, mockContext);

      expect(mockSearch).toHaveBeenCalledWith(defaultParams.baseDN, {
        scope: 'sub',
        filter: '(&(objectClass=user)(sAMAccountName=john\\2adoe))',
        attributes: ['distinguishedName']
      });
    });

    test('should escape DN special characters in newName (comma)', async () => {
      const params = {
        ...defaultParams,
        newName: 'Doe, John'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.renamed).toBe(true);
      expect(mockModifyDN).toHaveBeenCalledWith(
        mockUserDN,
        'CN=Doe\\, John,OU=DisabledUsers,DC=example,DC=com'
      );
    });

    test('should escape DN special characters in newName (plus sign)', async () => {
      const params = {
        ...defaultParams,
        newName: 'John + Jane Doe'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(mockModifyDN).toHaveBeenCalledWith(
        mockUserDN,
        'CN=John \\+ Jane Doe,OU=DisabledUsers,DC=example,DC=com'
      );
    });

    test('should handle apostrophe in newName (no escaping needed)', async () => {
      const params = {
        ...defaultParams,
        newName: "O'Shea"
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(mockModifyDN).toHaveBeenCalledWith(
        mockUserDN,
        "CN=O'Shea,OU=DisabledUsers,DC=example,DC=com"
      );
    });

    test('should handle dashes in newName (no escaping needed)', async () => {
      const params = {
        ...defaultParams,
        newName: 'John Doe - Disabled'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(mockModifyDN).toHaveBeenCalledWith(
        mockUserDN,
        'CN=John Doe - Disabled,OU=DisabledUsers,DC=example,DC=com'
      );
    });

    test('should handle forward slash in newName (no escaping needed)', async () => {
      const params = {
        ...defaultParams,
        newName: 'Sales/Marketing Lead'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(mockModifyDN).toHaveBeenCalledWith(
        mockUserDN,
        'CN=Sales/Marketing Lead,OU=DisabledUsers,DC=example,DC=com'
      );
    });

    test('should escape backslash in newName', async () => {
      const params = {
        ...defaultParams,
        newName: 'Test\\User'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(mockModifyDN).toHaveBeenCalledWith(
        mockUserDN,
        'CN=Test\\\\User,OU=DisabledUsers,DC=example,DC=com'
      );
    });

    test('should handle escaped comma in current user DN during move', async () => {
      const userDNWithComma = 'CN=Doe\\, John,OU=Users,DC=example,DC=com';
      mockSearch.mockResolvedValueOnce({
        searchEntries: [{ dn: userDNWithComma }]
      });

      const result = await script.invoke(defaultParams, mockContext);

      expect(result.status).toBe('success');
      expect(result.previousDN).toBe(userDNWithComma);
      expect(mockModifyDN).toHaveBeenCalledWith(
        userDNWithComma,
        'CN=Doe\\, John,OU=DisabledUsers,DC=example,DC=com'
      );
    });

    test('should escape backslash in samAccountName for LDAP filter', async () => {
      const paramsWithBackslash = {
        ...defaultParams,
        samAccountName: 'domain\\user'
      };

      mockSearch.mockResolvedValueOnce({
        searchEntries: [{ dn: mockUserDN }]
      });

      await script.invoke(paramsWithBackslash, mockContext);

      expect(mockSearch).toHaveBeenCalledWith(defaultParams.baseDN, {
        scope: 'sub',
        filter: '(&(objectClass=user)(sAMAccountName=domain\\5cuser))',
        attributes: ['distinguishedName']
      });
    });
  });

  describe('error handler', () => {
    test('should wrap authentication errors', async () => {
      const error = new Error('Invalid credentials');
      const params = {
        ...defaultParams,
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('LDAP authentication failed');
    });

    test('should wrap permission errors', async () => {
      const error = new Error('Insufficient access rights');
      const params = {
        ...defaultParams,
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Insufficient LDAP permissions');
    });

    test('should wrap user not found errors', async () => {
      const error = new Error('User not found with sAMAccountName: jdoe');
      const params = {
        ...defaultParams,
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('User not found');
    });

    test('should wrap multiple users found errors', async () => {
      const error = new Error('Multiple users found with sAMAccountName: jdoe');
      const params = {
        ...defaultParams,
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Multiple users found');
    });

    test('should wrap object not found errors', async () => {
      const error = new Error('No such object');
      const params = {
        ...defaultParams,
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Object not found');
    });

    test('should wrap already exists errors', async () => {
      const error = new Error('Entry already exists');
      const params = {
        ...defaultParams,
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Object already exists at target');
    });

    test('should wrap invalid DN errors', async () => {
      const error = new Error('Invalid DN syntax');
      const params = {
        ...defaultParams,
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Invalid DN syntax');
    });

    test('should re-throw connection errors for retry', async () => {
      const error = new Error('Connection timeout');
      const params = {
        ...defaultParams,
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow(error);
    });
  });

  describe('halt handler', () => {
    test('should return halted status with parameters', async () => {
      const params = {
        ...defaultParams,
        reason: 'timeout'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.baseDN).toBe(defaultParams.baseDN);
      expect(result.samAccountName).toBe(defaultParams.samAccountName);
      expect(result.reason).toBe('timeout');
      expect(result.halted_at).toBeDefined();
    });

    test('should handle halt without baseDN and samAccountName', async () => {
      const params = {
        reason: 'system_shutdown'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.baseDN).toBe('unknown');
      expect(result.samAccountName).toBe('unknown');
      expect(result.reason).toBe('system_shutdown');
    });
  });
});
