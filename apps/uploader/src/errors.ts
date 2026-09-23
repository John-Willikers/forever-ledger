/** Problems the user has to fix (config, token, uploader version). Uploading stops until they do. */
export class FatalUploadError extends Error {
  readonly code: 'unauthorized' | 'unsupported-schema' | 'config';
  constructor(code: FatalUploadError['code'], message: string) {
    super(message);
    this.name = 'FatalUploadError';
    this.code = code;
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
