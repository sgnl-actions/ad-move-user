/**
 * Active Directory Move User Action
 *
 * Moves a user to a new parent container/OU in Active Directory using the LDAP modifyDN operation.
 * Optionally supports renaming the user during the move.
 */

import { Client } from 'ldapts';
import { getBaseURL } from '@sgnl-actions/utils';

/**
 * Escape special characters in LDAP filter values to prevent injection.
 *
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for use in LDAP filters
 */
function escapeLDAPFilter(str) {
  return str.replace(/[\\*()\0]/g, (char) => '\\' + char.charCodeAt(0).toString(16).padStart(2, '0'));
}

/**
 * Find a user's Distinguished Name by searching for their sAMAccountName.
 *
 * @param {Client} client - Bound ldapts Client instance
 * @param {string} baseDN - Base DN to search from
 * @param {string} samAccountName - User's sAMAccountName
 * @returns {Promise<string>} The user's Distinguished Name
 * @throws {Error} If user not found or multiple users found
 */
async function findUserDN(client, baseDN, samAccountName) {
  console.log(`Searching for user with sAMAccountName: ${samAccountName}`);

  const escapedSamAccountName = escapeLDAPFilter(samAccountName);
  const { searchEntries } = await client.search(baseDN, {
    scope: 'sub',
    filter: `(&(objectClass=user)(sAMAccountName=${escapedSamAccountName}))`,
    attributes: ['distinguishedName']
  });

  if (!searchEntries || searchEntries.length === 0) {
    throw new Error(`User not found with sAMAccountName: ${samAccountName}`);
  }

  if (searchEntries.length > 1) {
    throw new Error(`Multiple users found with sAMAccountName: ${samAccountName}. Expected exactly one.`);
  }

  const userDN = searchEntries[0].dn;
  console.log(`Found user DN: ${userDN}`);
  return userDN;
}

/**
 * Extract the RDN (Relative Distinguished Name) from a full DN.
 * The RDN is the first component of the DN (e.g., "CN=John Doe" from "CN=John Doe,OU=Users,DC=example,DC=com").
 * Handles escaped characters in DN values (e.g., "CN=O\'Brien\, Pat" or "CN=Test\\Slash").
 *
 * @param {string} dn - The Distinguished Name
 * @returns {string|null} The RDN or null if invalid
 */
function extractRDN(dn) {
  const match = dn.match(/^((?:[^\\,]|\\.)+)/);
  return match ? match[1] : null;
}

/**
 * Extract the RDN attribute prefix (e.g., "CN=", "OU=") from a DN.
 * This is used to preserve the correct prefix when renaming objects.
 *
 * @param {string} dn - The Distinguished Name
 * @returns {string} The prefix (defaults to "CN=" if not found)
 */
function extractRDNPrefix(dn) {
  const match = dn.match(/^([A-Za-z]+=)/);
  return match ? match[1] : 'CN=';
}

/**
 * Escape special characters in a DN attribute value per RFC 4514.
 * Characters that must be escaped: , + " \ < > ; and # at start, space at start/end.
 *
 * @param {string} value - The raw attribute value
 * @returns {string} The escaped value safe for use in a DN
 */
function escapeDNValue(value) {
  let escaped = value.replace(/([,+"\\<>;])/g, '\\$1');
  if (escaped.startsWith('#') || escaped.startsWith(' ')) {
    escaped = '\\' + escaped;
  }
  if (escaped.endsWith(' ')) {
    escaped = escaped.slice(0, -1) + '\\ ';
  }
  return escaped;
}

/**
 * Safely disconnect from LDAP server.
 * Errors during unbind are logged but not thrown to avoid masking original errors.
 *
 * @param {Client} client - The ldapts client
 */
async function safeUnbind(client) {
  if (!client) {
    return;
  }
  try {
    await client.unbind();
  } catch (unbindError) {
    console.warn(`Warning: Error during LDAP unbind: ${unbindError.message}`);
  }
}

export default {
  /**
   * Main execution handler - moves a user in Active Directory.
   *
   * Uses the LDAP modifyDN operation which can:
   * - Move a user to a new parent container/OU
   * - Rename a user (change their RDN)
   * - Do both simultaneously
   *
   * @param {Object} params - Job input parameters
   * @param {string} params.baseDN - Base DN to search for the user
   * @param {string} params.samAccountName - User's sAMAccountName to lookup
   * @param {string} params.newParentDN - Target container/OU DN to move the user into
   * @param {string} [params.newName] - New name for the user (without prefix). If omitted, keeps current name
   * @param {string} [params.address] - Optional LDAP server URL override
   * @param {boolean} [params.dry_run] - If true, validate without making changes
   * @param {Object} context - Execution context with environment and secrets
   * @returns {Object} Job results including status, previousDN, newDN, and moved flag
   */
  invoke: async (params, context) => {
    console.log('Starting Active Directory move user operation');

    const { baseDN, samAccountName, newParentDN, newName, dry_run = false } = params;

    // Validate required inputs
    if (!baseDN) {
      throw new Error('baseDN is required');
    }
    if (!samAccountName) {
      throw new Error('samAccountName is required');
    }
    if (!newParentDN) {
      throw new Error('newParentDN is required');
    }

    console.log(`Planning to move user "${samAccountName}" to "${newParentDN}"`);

    // Handle dry run - validate and return without making changes
    if (dry_run) {
      console.log('DRY RUN: No changes will be made to Active Directory');
      return {
        status: 'dry_run_completed',
        baseDN,
        samAccountName,
        userDN: null,
        previousDN: null,
        newDN: null,
        newParentDN,
        moved: false,
        renamed: !!newName
      };
    }

    // Get LDAP connection details
    const address = getBaseURL(params, context);
    const bindDN = context.secrets.LDAP_BIND_DN;
    const bindPassword = context.secrets.LDAP_BIND_PASSWORD;

    // Validate required secrets
    if (!bindDN) {
      throw new Error('LDAP_BIND_DN secret is required');
    }
    if (!bindPassword) {
      throw new Error('LDAP_BIND_PASSWORD secret is required');
    }

    // Configure LDAP client with timeouts
    const clientOptions = {
      url: address,
      timeout: 10000,
      connectTimeout: 10000
    };

    // Configure TLS options for secure connections
    if (address.startsWith('ldaps://') || context.environment?.TLS_SKIP_VERIFY === 'true') {
      clientOptions.tlsOptions = {
        rejectUnauthorized: context.environment?.TLS_SKIP_VERIFY !== 'true'
      };
    }

    const client = new Client(clientOptions);

    try {
      console.log(`Connecting to LDAP server at ${address}`);
      await client.bind(bindDN, bindPassword);
      console.log('Successfully authenticated to LDAP server');

      // Lookup user DN by sAMAccountName
      const userDN = await findUserDN(client, baseDN, samAccountName);

      // Extract and validate the current RDN
      const currentRDN = extractRDN(userDN);
      if (!currentRDN) {
        throw new Error('Invalid userDN format: could not extract RDN');
      }

      // Determine the new RDN (either keep current or use newName with correct prefix)
      let newRDN = currentRDN;
      const renamed = !!newName;
      if (newName) {
        const prefix = extractRDNPrefix(userDN);
        newRDN = `${prefix}${escapeDNValue(newName)}`;
        console.log(`User will be renamed from "${currentRDN}" to "${newRDN}"`);
      }

      // Construct the new full DN
      const newDN = `${newRDN},${newParentDN}`;

      console.log(`Executing modifyDN: moving "${userDN}" to "${newDN}"`);
      // ldapts modifyDN signature: modifyDN(currentDN, newDN, controls?)
      // newDN is the complete new Distinguished Name including the new parent
      await client.modifyDN(userDN, newDN);

      console.log(`Successfully moved user to: ${newDN}`);
      return {
        status: 'success',
        userDN,
        previousDN: userDN,
        newDN,
        moved: true,
        renamed,
        address
      };
    } catch (error) {
      console.error(`Failed to move user: ${error.message}`);
      throw error;
    } finally {
      await safeUnbind(client);
    }
  },

  /**
   * Error recovery handler - classifies errors and determines retry behavior.
   *
   * @param {Object} params - Original params plus error information
   * @param {Error} params.error - The error that occurred
   * @param {string} params.baseDN - The base DN being searched
   * @param {string} params.samAccountName - The sAMAccountName being looked up
   * @param {Object} _context - Execution context (unused)
   * @throws {Error} Re-throws with appropriate classification
   */
  error: async (params, _context) => {
    const { error, baseDN, samAccountName } = params;
    console.error(`Error handler invoked for user "${samAccountName}" in "${baseDN}": ${error.message}`);

    const errorMessage = error.message.toLowerCase();

    // Authentication errors (fatal - don't retry)
    if (errorMessage.includes('invalid credentials') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('bind failed')) {
      console.error('Authentication failed - check LDAP_BIND_DN and LDAP_BIND_PASSWORD');
      throw new Error(`LDAP authentication failed: ${error.message}`);
    }

    // Connection errors (retryable - framework will retry)
    if (errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('econnrefused')) {
      console.error('Connection error - may be transient, framework will retry');
      throw error;
    }

    // User not found (fatal - don't retry)
    if (errorMessage.includes('user not found')) {
      console.error('User not found - check samAccountName and baseDN');
      throw new Error(`User not found: ${error.message}`);
    }

    // Multiple users found (fatal - don't retry)
    if (errorMessage.includes('multiple users found')) {
      console.error('Multiple users found - sAMAccountName should be unique');
      throw new Error(`Multiple users found: ${error.message}`);
    }

    // Object not found (fatal - don't retry)
    if (errorMessage.includes('no such object') ||
        errorMessage.includes('not found') ||
        errorMessage.includes('does not exist')) {
      console.error('Source object not found in Active Directory');
      throw new Error(`Object not found: ${error.message}`);
    }

    // Already exists at target (fatal - don't retry)
    if (errorMessage.includes('already exists') ||
        errorMessage.includes('entry_exists')) {
      console.error('An object with the same name already exists at target location');
      throw new Error(`Object already exists at target: ${error.message}`);
    }

    // Invalid DN syntax (fatal - don't retry)
    if (errorMessage.includes('invalid dn syntax') ||
        errorMessage.includes('invalid dn') ||
        errorMessage.includes('bad dn')) {
      console.error('Invalid Distinguished Name format provided');
      throw new Error(`Invalid DN syntax: ${error.message}`);
    }

    // Insufficient permissions (fatal - don't retry)
    if (errorMessage.includes('insufficient access') ||
        errorMessage.includes('permission denied')) {
      console.error('Insufficient permissions - check service account privileges');
      throw new Error(`Insufficient LDAP permissions: ${error.message}`);
    }

    // Unknown error - re-throw for framework retry
    console.error('Unknown error occurred, allowing framework to retry');
    throw error;
  },

  /**
   * Graceful shutdown handler - called when the job is halted.
   *
   * @param {Object} params - Original params plus halt reason
   * @param {string} params.reason - The reason for the halt
   * @param {string} [params.baseDN] - The base DN being searched
   * @param {string} [params.samAccountName] - The sAMAccountName being looked up
   * @param {Object} _context - Execution context (unused)
   * @returns {Object} Cleanup results with halted status
   */
  halt: async (params, _context) => {
    const { reason, baseDN, samAccountName } = params;
    console.log(`Active Directory move user operation halted: ${reason}`);

    return {
      status: 'halted',
      baseDN: baseDN || 'unknown',
      samAccountName: samAccountName || 'unknown',
      reason,
      halted_at: new Date().toISOString()
    };
  }
};
