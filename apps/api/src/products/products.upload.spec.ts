import { BadRequestException } from '@nestjs/common';
import { ProductsController } from './products.controller';
import type { JwtPayload } from '@repo/shared-types';

/**
 * Product image upload — the buffer contract.
 *
 * ProductsModule registers no MulterModule, so the file arrives on multer's
 * memory default: `file.buffer`, never `file.path`. The handler used to read
 * `file.path` anyway, so EVERY upload died on readFile(undefined) with a 500
 * the UI could only report as a vague server error. These tests pin the
 * working contract so it cannot quietly regress to a temp-path assumption.
 */
describe('ProductsController — uploadImage', () => {
  const USER = { sub: 'u-1', tenantId: 't-1' } as JwtPayload;

  function build() {
    const puts: any[] = [];
    const storage: any = {
      putBuffer: jest.fn((buffer: Buffer, key: string, opts: any) => {
        puts.push({ buffer, key, opts });
        return Promise.resolve();
      }),
      getPublicUrl: jest.fn((key: string) => `/api/v1/products/photos/${key.split('/').pop()}`),
    };
    const ctrl = new ProductsController({} as any, storage);
    return { ctrl, storage, puts };
  }

  const jpeg = (bytes = 1024): any => ({
    buffer: Buffer.alloc(bytes, 1),
    size: bytes,
    mimetype: 'image/jpeg',
    originalname: 'latte.jpg',
    // Deliberately NO `path` — memory storage never provides one.
  });

  it('stores the in-memory buffer and returns a URL', async () => {
    const { ctrl, puts } = build();
    const out = await ctrl.uploadImage(USER, jpeg());

    expect(out.url).toContain('/products/photos/');
    expect(puts).toHaveLength(1);
    expect(Buffer.isBuffer(puts[0].buffer)).toBe(true);
    expect(puts[0].opts.tenantId).toBe('t-1');
    expect(puts[0].opts.contentType).toBe('image/jpeg');
    // The storage key is tenant-scoped so one shop can never see another's photos.
    expect(puts[0].key).toContain('products/t-1/');
  });

  it('rejects a file with no buffer instead of crashing on a phantom temp path', async () => {
    const { ctrl, storage } = build();
    await expect(ctrl.uploadImage(USER, { size: 10, mimetype: 'image/jpeg' } as any))
      .rejects.toThrow(BadRequestException);
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });

  it('rejects a non-image mimetype', async () => {
    const { ctrl, storage } = build();
    await expect(ctrl.uploadImage(USER, { ...jpeg(), mimetype: 'application/pdf' }))
      .rejects.toThrow(BadRequestException);
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });

  it('rejects an oversized image', async () => {
    const { ctrl, storage } = build();
    await expect(ctrl.uploadImage(USER, jpeg(6 * 1024 * 1024)))
      .rejects.toThrow(BadRequestException);
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });
});
