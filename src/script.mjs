/**
 * Active Directory Move Object Action
 *
 * Moves any Active Directory object (users, groups, OUs, computers, etc.)
 * to a new parent container/OU using the LDAP modifyDN operation.
 * Optionally supports renaming the object during the move.
 */

import { Client } from 'ldapts';
import { getBaseURL } from '@sgnl-actions/utils';

/**
 * Extract the RDN (Relative Distinguished Name) from a full DN.
 * The RDN is the first component of the DN (e.g., "CN=John Doe" from "CN=John Doe,OU=Users,DC=example,DC=com").
 *
 * @param {string} dn - The Distinguished Name
 * @returns {string|null} The RDN or null if invalid
 */
function extractRDN(dn) {
  const match = dn.match(/^([^,]+)/);
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
 * Safely disconnect from LDAP server.
 * Errors during unbind are logged but not thrown to avoid masking original errors.
 *
 * @param {Client} client - The ldapts client
 */
async function safeUnbind(client) {
  try {
    await client.unbind();
  } catch (unbindError) {
    console.warn(`Warning: Error during LDAP unbind: ${unbindError.message}`);
  }
}

export default {
  /**
   * Main execution handler - moves an object in Active Directory.
   *
   * Uses the LDAP modifyDN operation which can:
   * - Move an object to a new parent container/OU
   * - Rename an object (change its RDN)
   * - Do both simultaneously
   *
   * @param {Object} params - Job input parameters
   * @param {string} params.objectDN - Current Distinguished Name of the object to move
   * @param {string} params.newParentDN - Target container/OU DN to move the object into
   * @param {string} [params.newName] - New name for the object (without prefix). If omitted, keeps current name
   * @param {string} [params.address] - Optional LDAP server URL override
   * @param {boolean} [params.dry_run] - If true, validate without making changes
   * @param {Object} context - Execution context with environment and secrets
   * @returns {Object} Job results including status, previousDN, newDN, and moved flag
   */
  invoke: async (params, context) => {
    console.log('Starting Active Directory move object operation');

    const { objectDN, newParentDN, newName, dry_run = false } = params;

    // Validate required inputs
    if (!objectDN) {
      throw new Error('objectDN is required');
    }
    if (!newParentDN) {
      throw new Error('newParentDN is required');
    }

    // Extract and validate the current RDN
    const currentRDN = extractRDN(objectDN);
    if (!currentRDN) {
      throw new Error('Invalid objectDN format: could not extract RDN');
    }

    // Determine the new RDN (either keep current or use newName with correct prefix)
    let newRDN = currentRDN;
    const renamed = !!newName;
    if (newName) {
      const prefix = extractRDNPrefix(objectDN);
      newRDN = `${prefix}${newName}`;
      console.log(`Object will be renamed from "${currentRDN}" to "${newRDN}"`);
    }

    // Construct the new full DN
    const newDN = `${newRDN},${newParentDN}`;

    console.log(`Planning move: ${objectDN} -> ${newDN}`);

    // Handle dry run - validate and return without making changes
    if (dry_run) {
      console.log('DRY RUN: No changes will be made to Active Directory');
      console.log(`Would move: ${objectDN}`);
      console.log(`To: ${newDN}`);
      return {
        status: 'dry_run_completed',
        previousDN: objectDN,
        newDN,
        moved: false,
        renamed
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

      console.log(`Executing modifyDN: moving "${objectDN}" to "${newDN}"`);
      // ldapts modifyDN signature: modifyDN(currentDN, newDN, controls?)
      // newDN is the complete new Distinguished Name including the new parent
      await client.modifyDN(objectDN, newDN);

      console.log(`Successfully moved object to: ${newDN}`);
      return {
        status: 'success',
        previousDN: objectDN,
        newDN,
        moved: true,
        renamed,
        address
      };
    } catch (error) {
      console.error(`Failed to move object: ${error.message}`);
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
   * @param {string} params.objectDN - The object DN that was being moved
   * @param {Object} _context - Execution context (unused)
   * @throws {Error} Re-throws with appropriate classification
   */
  error: async (params, _context) => {
    const { error, objectDN } = params;
    console.error(`Error handler invoked for object ${objectDN}: ${error.message}`);

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
   * @param {string} [params.objectDN] - The object DN being processed
   * @param {Object} _context - Execution context (unused)
   * @returns {Object} Cleanup results with halted status
   */
  halt: async (params, _context) => {
    const { reason, objectDN } = params;
    console.log(`Active Directory move object operation halted: ${reason}`);

    return {
      status: 'halted',
      objectDN: objectDN || 'unknown',
      reason,
      halted_at: new Date().toISOString()
    };
  }
};
