import {
  DeleteParameterCommand,
  GetParameterCommand,
  ParameterNotFound,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';

export const ssm = new SSMClient({});

/**
 * Get a parameter from SSM Parameter Store
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
    return response.Parameter?.Value;
  } catch (error) {
    console.error(`Error getting parameter ${parameterName}:`, error);
    return undefined;
  }
};

export const putParameter = async (parameterName: string, value: string): Promise<void> => {
  await ssm.send(
    new PutParameterCommand({
      Name: parameterName,
      Value: value,
      Type: 'String',
      Overwrite: true,
    })
  );
};

export const deleteParameter = async (parameterName: string): Promise<void> => {
  try {
    await ssm.send(
      new DeleteParameterCommand({
        Name: parameterName,
      })
    );
  } catch (error) {
    if (error instanceof ParameterNotFound) {
      return;
    }
    throw error;
  }
};
