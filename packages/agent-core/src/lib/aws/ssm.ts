import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export const ssm = new SSMClient({});

/**
 * AWS KMS ciphertext blobs (including undecrypted SSM SecureString values)
 * are base64 and start with this prefix.
 */
export const isKmsCiphertext = (value: string): boolean => value.startsWith('AQICA');

/**
 * Get a parameter from SSM Parameter Store.
 * Always requests decryption so SecureString parameters return plaintext.
 * @param parameterName The name of the parameter
 * @returns The parameter value
 */
export const getParameter = async (parameterName: string): Promise<string | undefined> => {
  try {
    const response = await ssm.send(
      new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true,
      })
    );
    const value = response.Parameter?.Value;
    if (value && isKmsCiphertext(value)) {
      console.error(
        `SSM parameter ${parameterName} still looks like KMS ciphertext after decryption. Check IAM kms:Decrypt for SSM.`
      );
      return undefined;
    }
    return value;
  } catch (error) {
    console.error(`Error getting parameter ${parameterName}:`, error);
    return undefined;
  }
};

/**
 * Resolve a secret from an environment variable or, when only a parameter name
 * is provided, from SSM Parameter Store.
 *
 * Environment values that look like undecrypted KMS ciphertext (typical when
 * `aws ssm get-parameter` ran without `--with-decryption`) are ignored so we
 * can fall back to a decrypted SSM read. This matters on EC2 resume: systemd
 * re-runs start-app.sh and may export the encrypted blob as OPENAI_API_KEY.
 */
export const resolveCredential = async (envVar?: string, parameterName?: string): Promise<string | undefined> => {
  if (envVar && !isKmsCiphertext(envVar)) {
    return envVar;
  }
  if (envVar && isKmsCiphertext(envVar)) {
    console.warn(
      'Ignoring environment credential that looks like an undecrypted KMS ciphertext; fetching from SSM instead.'
    );
  }
  if (parameterName) {
    return getParameter(parameterName);
  }
  return undefined;
};
