
import { TErrorSources, TGenericErrorResponse } from '../interface/error';

interface CastErrorLike {
  path:    string;
  message: string;
}

const handleCastError = (err: CastErrorLike): TGenericErrorResponse => {
  const errorSources: TErrorSources = [{ path: err.path, message: err.message }];

  return {
    statusCode: 400,
    message:    'Invalid ID',
    errorSources,
  };
};

export default handleCastError;
