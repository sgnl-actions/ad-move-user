import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockBind = jest.fn();
const mockUnbind = jest.fn();
const mockModifyDN = jest.fn();

jest.unstable_mockModule('ldapts', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bind: mockBind,
    unbind: mockUnbind,
    modifyDN: mockModifyDN
  }))
}));

const mockGetBaseURL = jest.fn().mockReturnValue('ldaps://dc.example.com:636');

jest.unstable_mockModule('@sgnl-actions/utils', () => ({
  getBaseURL: mockGetBaseURL
}));

const { default: script } = await import('../src/script.mjs');
const { Client } = await import('ldapts');

describe('AD Move Object Script', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockBind.mockResolvedValue(undefined);
    mockUnbind.mockResolvedValue(undefined);
    mockModifyDN.mockResolvedValue(undefined);
    mockGetBaseURL.mockReturnValue('ldaps://dc.example.com:636');
  });

  describe('invoke handler', () => {
    test('should move object to new OU', async () => {
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.previousDN).toBe('CN=John Doe,OU=Users,DC=example,DC=com');
      expect(result.newDN).toBe('CN=John Doe,OU=DisabledUsers,DC=example,DC=com');
      expect(result.moved).toBe(true);
      expect(result.renamed).toBe(false);
      expect(mockModifyDN).toHaveBeenCalledWith(
        'CN=John Doe,OU=Users,DC=example,DC=com',
        'CN=John Doe',
        'OU=DisabledUsers,DC=example,DC=com'
      );
    });

    test('should move and rename object simultaneously', async () => {
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com',
        newName: 'John Doe (Disabled)'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.previousDN).toBe('CN=John Doe,OU=Users,DC=example,DC=com');
      expect(result.newDN).toBe('CN=John Doe (Disabled),OU=DisabledUsers,DC=example,DC=com');
      expect(result.moved).toBe(true);
      expect(result.renamed).toBe(true);
      expect(mockModifyDN).toHaveBeenCalledWith(
        'CN=John Doe,OU=Users,DC=example,DC=com',
        'CN=John Doe (Disabled)',
        'OU=DisabledUsers,DC=example,DC=com'
      );
    });

    test('should move OU object preserving OU= prefix', async () => {
      const params = {
        objectDN: 'OU=SalesTeam,OU=Departments,DC=example,DC=com',
        newParentDN: 'OU=ArchivedDepartments,DC=example,DC=com'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.newDN).toBe('OU=SalesTeam,OU=ArchivedDepartments,DC=example,DC=com');
      expect(mockModifyDN).toHaveBeenCalledWith(
        'OU=SalesTeam,OU=Departments,DC=example,DC=com',
        'OU=SalesTeam',
        'OU=ArchivedDepartments,DC=example,DC=com'
      );
    });

    test('should move OU object with rename', async () => {
      const params = {
        objectDN: 'OU=SalesTeam,OU=Departments,DC=example,DC=com',
        newParentDN: 'OU=ArchivedDepartments,DC=example,DC=com',
        newName: 'SalesTeam (Archived)'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.newDN).toBe('OU=SalesTeam (Archived),OU=ArchivedDepartments,DC=example,DC=com');
      expect(result.renamed).toBe(true);
      expect(mockModifyDN).toHaveBeenCalledWith(
        'OU=SalesTeam,OU=Departments,DC=example,DC=com',
        'OU=SalesTeam (Archived)',
        'OU=ArchivedDepartments,DC=example,DC=com'
      );
    });

    test('should handle dry run without making changes', async () => {
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com',
        dry_run: true
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('dry_run_completed');
      expect(result.previousDN).toBe('CN=John Doe,OU=Users,DC=example,DC=com');
      expect(result.newDN).toBe('CN=John Doe,OU=DisabledUsers,DC=example,DC=com');
      expect(result.moved).toBe(false);
      expect(result.renamed).toBe(false);
      expect(mockBind).not.toHaveBeenCalled();
      expect(mockModifyDN).not.toHaveBeenCalled();
    });

    test('should handle dry run with rename', async () => {
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com',
        newName: 'John Doe (Disabled)',
        dry_run: true
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('dry_run_completed');
      expect(result.newDN).toBe('CN=John Doe (Disabled),OU=DisabledUsers,DC=example,DC=com');
      expect(result.renamed).toBe(true);
      expect(mockModifyDN).not.toHaveBeenCalled();
    });

    test('should throw when objectDN is missing', async () => {
      const params = {
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow(
        'objectDN is required'
      );
      expect(mockBind).not.toHaveBeenCalled();
    });

    test('should throw when newParentDN is missing', async () => {
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com'
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

      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      await expect(script.invoke(params, context)).rejects.toThrow('LDAP_BIND_DN secret is required');
    });

    test('should throw on missing LDAP_BIND_PASSWORD', async () => {
      const context = {
        ...mockContext,
        secrets: { ...mockContext.secrets, LDAP_BIND_PASSWORD: '' }
      };

      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      await expect(script.invoke(params, context)).rejects.toThrow('LDAP_BIND_PASSWORD secret is required');
    });

    test('should propagate LDAP error when object does not exist', async () => {
      mockModifyDN.mockRejectedValue(
        Object.assign(new Error('No such object'), { code: 32 })
      );

      const params = {
        objectDN: 'CN=NonExistent,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow('No such object');
    });

    test('should propagate LDAP error when target already has object', async () => {
      mockModifyDN.mockRejectedValue(
        Object.assign(new Error('Entry already exists'), { code: 68 })
      );

      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow('Entry already exists');
    });

    test('should set rejectUnauthorized false when TLS_SKIP_VERIFY is true', async () => {
      const context = {
        ...mockContext,
        environment: { ...mockContext.environment, TLS_SKIP_VERIFY: 'true' }
      };

      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      await script.invoke(params, context);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldaps://dc.example.com:636',
        timeout: 10000,
        connectTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
      });
    });

    test('should set rejectUnauthorized to true for ldaps:// URLs when TLS_SKIP_VERIFY is not set', async () => {
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      await script.invoke(params, mockContext);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldaps://dc.example.com:636',
        timeout: 10000,
        connectTimeout: 10000,
        tlsOptions: { rejectUnauthorized: true }
      });
    });

    test('should not include tlsOptions for ldap:// URLs when TLS_SKIP_VERIFY is not set', async () => {
      mockGetBaseURL.mockReturnValue('ldap://dc.example.com:389');

      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      await script.invoke(params, mockContext);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldap://dc.example.com:389',
        timeout: 10000,
        connectTimeout: 10000
      });
    });

    test('should handle unbind errors gracefully', async () => {
      mockUnbind.mockRejectedValue(new Error('Unbind failed'));

      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      // Should still succeed even if unbind fails
      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(mockUnbind).toHaveBeenCalled();
    });

    test('should not mask original error when unbind also fails', async () => {
      mockModifyDN.mockRejectedValue(new Error('ModifyDN operation failed'));
      mockUnbind.mockRejectedValue(new Error('Unbind failed'));

      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        newParentDN: 'OU=DisabledUsers,DC=example,DC=com'
      };

      // Should throw the original error, not the unbind error
      await expect(script.invoke(params, mockContext)).rejects.toThrow('ModifyDN operation failed');
    });
  });

  describe('error handler', () => {
    test('should wrap authentication errors', async () => {
      const error = new Error('Invalid credentials');
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('LDAP authentication failed');
    });

    test('should wrap permission errors', async () => {
      const error = new Error('Insufficient access rights');
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Insufficient LDAP permissions');
    });

    test('should wrap object not found errors', async () => {
      const error = new Error('No such object');
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Object not found');
    });

    test('should wrap already exists errors', async () => {
      const error = new Error('Entry already exists');
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Object already exists at target');
    });

    test('should wrap invalid DN errors', async () => {
      const error = new Error('Invalid DN syntax');
      const params = {
        objectDN: 'invalid-dn',
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Invalid DN syntax');
    });

    test('should re-throw connection errors for retry', async () => {
      const error = new Error('Connection timeout');
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow(error);
    });
  });

  describe('halt handler', () => {
    test('should return halted status with objectDN', async () => {
      const params = {
        objectDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        reason: 'timeout'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.objectDN).toBe('CN=John Doe,OU=Users,DC=example,DC=com');
      expect(result.reason).toBe('timeout');
      expect(result.halted_at).toBeDefined();
    });

    test('should handle halt without objectDN', async () => {
      const params = {
        reason: 'system_shutdown'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.objectDN).toBe('unknown');
      expect(result.reason).toBe('system_shutdown');
    });
  });
});
