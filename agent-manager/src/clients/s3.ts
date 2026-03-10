import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export type S3ObjectStorageConfig = {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle?: boolean;
};

export class S3ObjectStorageClient {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: S3ObjectStorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      bucketEndpoint: false,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
    });
  }

  async putObject(input: {
    readonly key: string;
    readonly body: Uint8Array;
    readonly contentType: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  async getObject(key: string): Promise<Uint8Array> {
    const output = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    return await bodyToUint8Array(output.Body);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}

async function bodyToUint8Array(body: unknown): Promise<Uint8Array> {
  if (!body) {
    throw new Error("Object body was empty");
  }

  if (body instanceof Uint8Array) {
    return body;
  }

  if (typeof (body as Blob).arrayBuffer === "function") {
    return new Uint8Array(await (body as Blob).arrayBuffer());
  }

  if (
    typeof (
      body as { transformToByteArray?: () => Promise<Uint8Array> }
    ).transformToByteArray === "function"
  ) {
    return await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
  }

  if (body instanceof ReadableStream) {
    return await readReadableStream(body);
  }

  if (
    typeof body === "object" &&
    body !== null &&
    Symbol.asyncIterator in body
  ) {
    return await readAsyncIterable(
      body as AsyncIterable<Uint8Array | string | ArrayBuffer>,
    );
  }

  throw new Error("Unsupported object body type");
}

async function readReadableStream(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value == null) continue;
    chunks.push(
      value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer),
    );
  }

  return concatChunks(chunks);
}

async function readAsyncIterable(
  iterable: AsyncIterable<Uint8Array | string | ArrayBuffer>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of iterable) {
    if (typeof chunk === "string") {
      chunks.push(new TextEncoder().encode(chunk));
      continue;
    }
    chunks.push(
      chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk),
    );
  }
  return concatChunks(chunks);
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
