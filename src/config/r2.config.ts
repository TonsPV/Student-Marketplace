import { ConfigService } from '@nestjs/config';

export type R2Config = {
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpointUrl: string;
  publicUrl?: string;
};

export type UploadConfig = {
  maxFileSizeBytes: number;
  signedUrlExpiresSec: number;
  maxFilesPerMessage: number;
};

function requireConfig(configService: ConfigService, key: string): string {
  const value = configService.get<string>(key);

  if (!value) {
    throw new Error(`Missing env variable: ${key}`);
  }

  return value;
}

export function getR2Config(configService: ConfigService): R2Config {
  return {
    accessKeyId: requireConfig(configService, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: requireConfig(configService, 'R2_SECRET_ACCESS_KEY'),
    bucketName: requireConfig(configService, 'R2_BUCKET_NAME'),
    endpointUrl: requireConfig(configService, 'R2_ENDPOINT_URL'),
    publicUrl: configService.get<string>('R2_PUBLIC_URL'),
  };
}

export function getUploadConfig(configService: ConfigService): UploadConfig {
  const maxUploadSizeMb = Number(
    configService.get<string>('MAX_UPLOAD_SIZE_MB') ?? '15',
  );
  const signedUrlExpiresSec = Number(
    configService.get<string>('SIGNED_URL_EXPIRES_SEC') ?? '300',
  );
  const maxFilesPerMessage = Number(
    configService.get<string>('MAX_FILES_PER_MESSAGE') ?? '5',
  );

  return {
    maxFileSizeBytes: maxUploadSizeMb * 1024 * 1024,
    signedUrlExpiresSec,
    maxFilesPerMessage,
  };
}
