
import { TErrorSources, TGenericErrorResponse } from '../interface/error';

interface ValidationErrorLike {
  errors: Record<string, { path: string; message: string }>;
}

const handleValidationError = (err: ValidationErrorLike): TGenericErrorResponse => {
  const errorSources: TErrorSources = Object.values(err.errors).map((val) => ({
    path:    val?.path,
    message: val?.message,
  }));

  return {
    statusCode: 400,
    message:    'Validation Error',
    errorSources,
  };
};

export default handleValidationError;
